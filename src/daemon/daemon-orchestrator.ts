/**
 * Agent 调度闭环：dispatch loop、Electron API 转发、busy 重排、claim 门控。
 * queue/merge 仍驻 daemon.ts，经 OrchestratorDeps 注入。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { QueueMessage } from "../bridge/file-queue.js";
import { resolveLaunchChatName } from "./chat-name-resolve.js";
import { createOrchestratorNotify } from "./daemon-orchestrator-notify.js";
import { createDispatchRetry } from "./daemon-orchestrator-retry.js";
import type { DispatchLaunchFailureOpts, DispatchLaunchFailureResult } from "./daemon-http-routes-types.js";

export type AgentPhase = "starting" | "processing" | "idle";

export interface OrchestratorChannelRuntime {
  cfg: {
    id: string;
    name: string;
    type: string;
    mainUserEnabled?: boolean;
    mainUserChatId?: string;
  };
  client?: unknown;
}

export interface OrchestratorDeps {
  log: (level: string, ...args: unknown[]) => void;
  appDataDir: string;
  httpJson: <T = unknown>(url: string, body?: unknown, timeoutMs?: number) => Promise<T>;
  localDaemonUrl: (p: string) => string;
  channels: Map<string, OrchestratorChannelRuntime>;
  mergeBatchBySession: ReadonlyMap<string, { phase: string }>;
  shouldDeferDispatch: (sessionKey: string) => boolean;
  performClaimAndMerge: (
    sessionKey: string,
  ) => { ok: true; text: string; message_ids: string[] } | { ok: false; error: string };
  flushReadyMergeBatches: (sessionKey: string) => Promise<void>;
  getDistinctSessions: () => Array<{ sessionKey: string; chatType: string; senderOpenId?: string }>;
  getSessionUnclaimedCount: (sessionKey: string) => number;
  claimSessionMessages: (sessionKey: string) => QueueMessage[];
  applyMergeOverrideForPoll: (sessionKey: string, messages: QueueMessage[]) => QueueMessage[];
  clearMergeBatchState: (sessionKey: string) => void;
  formatMergeBody: (messages: QueueMessage[]) => string;
  collectFreshAndTrack: (messages: QueueMessage[], sessionKey: string) => string[];
  applyPollGetReactions: (freshIds: string[], sessionKey: string) => void;
  ackMessages: (messageId: string, sessionKey?: string) => string[];
  /** 失败重入队：.claimed→.qmsg（T1 原语；勿与 ack 删除混淆） */
  releaseClaimedMessages: (messageIds: string[], sessionKey?: string) => string[];
  setActiveSession: (chatId: string, sessionKey: string) => void;
  resolveChannelRuntime: (
    sessionKey: string,
  ) => { rt: OrchestratorChannelRuntime; chatId: string } | null;
  isMergeDispatchAllowed: (sessionKey: string) => boolean;
}

export interface OrchestratorApi {
  scheduleAgentDispatch: (sessionKey?: string) => void;
  runAgentDispatchLoop: () => Promise<void>;
  forwardElectronAgentApi: (subpath: string, body: object) => Promise<{ ok: boolean; error?: string }>;
  /** 斜杠指令同步转发 Electron command API（T4；对称 forwardElectronAgentApi） */
  forwardElectronCommandApi: (
    subpath: string,
    body: object,
  ) => Promise<{ ok: boolean; error?: string; message?: string }>;
  claimForOrchestratorDispatch: (
    sessionKey: string,
  ) => { ok: true; text: string; message_ids: string[] } | { ok: false };
  getSessionAgentPhase: (sessionKey: string) => AgentPhase | undefined;
  setSessionAgentPhase: (sessionKey: string, phase: AgentPhase | "idle") => void;
  parseBusyRetryDelayMs: (error?: string) => number;
  scheduleBusyRetry: (sessionKey: string, delayMs: number) => void;
  /** 与 HTTP dispatch 共用 dispatchRetry */
  handleLaunchFailure: (opts: DispatchLaunchFailureOpts) => Promise<DispatchLaunchFailureResult>;
  clearDispatchRetryAttempt: (sessionKey: string) => void;
  notifySessionUser: (sessionKey: string, text: string, stopProgress?: boolean) => Promise<void>;
  formatOrchestratorFailure: (error?: string) => string;
}

export function createOrchestrator(deps: OrchestratorDeps): OrchestratorApi {
  const { notifySessionUser, formatOrchestratorFailure } = createOrchestratorNotify({
    httpJson: deps.httpJson,
    localDaemonUrl: deps.localDaemonUrl,
    log: deps.log,
  });
  const sessionAgentPhaseMap = new Map<string, AgentPhase>();
  let dispatchLoopBusy = false;
  let dispatchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // scheduleAgentDispatch 为 function 声明（提升），供 retry 工厂闭包延后调用
  const dispatchRetry = createDispatchRetry({
    log: deps.log,
    releaseClaimedMessages: deps.releaseClaimedMessages,
    ackMessages: deps.ackMessages,
    notifySessionUser,
    formatOrchestratorFailure,
    scheduleAgentDispatch: (sk) => scheduleAgentDispatch(sk),
  });

  function getSessionAgentPhase(sessionKey: string): AgentPhase | undefined {
    return sessionAgentPhaseMap.get(sessionKey);
  }

  function setSessionAgentPhase(sessionKey: string, phase: AgentPhase | "idle"): void {
    if (phase === "idle") sessionAgentPhaseMap.delete(sessionKey);
    else sessionAgentPhaseMap.set(sessionKey, phase);
  }

  function readElectronAgentApiPort(): number {
    try {
      const fp = path.join(deps.appDataDir, "agent-api-port.json");
      if (!fs.existsSync(fp)) return 0;
      const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as { port?: number };
      return data.port ?? 0;
    } catch {
      return 0;
    }
  }

  async function forwardElectronAgentApi(subpath: string, body: object): Promise<{ ok: boolean; error?: string }> {
    const port = readElectronAgentApiPort();
    if (!port) return { ok: false, error: "Agent API 未就绪，请确保 Cursor Claw 已运行" };
    try {
      const res = await deps.httpJson<{ ok?: boolean; error?: string }>(
        `http://127.0.0.1:${port}${subpath}`,
        body,
        120_000,
      );
      return { ok: !!res.ok, error: res.error };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** POST /api/command/execute 等斜杠同步路径；未就绪返回可理解中文 */
  async function forwardElectronCommandApi(
    subpath: string,
    body: object,
  ): Promise<{ ok: boolean; error?: string; message?: string }> {
    const port = readElectronAgentApiPort();
    if (!port) {
      const msg = "❌ 应用未运行，请先启动 Cursor Claw";
      return { ok: false, error: msg, message: msg };
    }
    try {
      const res = await deps.httpJson<{ ok?: boolean; error?: string; message?: string }>(
        `http://127.0.0.1:${port}${subpath}`, body, 60_000,
      );
      return { ok: !!res.ok, error: res.error, message: res.message ?? res.error };
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return { ok: false, error: err, message: `❌ 应用未运行或未就绪: ${err}` };
    }
  }

  function parseBusyRetryDelayMs(error?: string): number {
    const raw = error?.trim() ?? "";
    if (!/agent busy/i.test(raw)) return 0;
    const m = raw.match(/retry_after=(\d+)/i);
    const parsed = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return 1500;
    return Math.min(10_000, parsed);
  }

  function extractSessionChatId(sessionKey: string): string {
    const idx = sessionKey.indexOf("::");
    return idx > 0 ? sessionKey.slice(0, idx) : sessionKey;
  }

  function isSessionMainUser(sessionKey: string, chatType?: string): boolean {
    if (chatType !== "p2p") return false;
    const resolved = deps.resolveChannelRuntime(sessionKey);
    if (!resolved) return false;
    const { rt, chatId } = resolved;
    if (!rt.cfg.mainUserEnabled || !rt.cfg.mainUserChatId?.trim()) return false;
    return chatId === rt.cfg.mainUserChatId.trim();
  }

  function claimForOrchestratorDispatch(sessionKey: string):
    | { ok: true; text: string; message_ids: string[] }
    | { ok: false } {
    if (deps.shouldDeferDispatch(sessionKey)) return { ok: false };
    if (getSessionAgentPhase(sessionKey) === "processing") return { ok: false };

    const batch = deps.mergeBatchBySession.get(sessionKey);
    if (batch?.phase === "ready" && deps.isMergeDispatchAllowed(sessionKey)) {
      const r = deps.performClaimAndMerge(sessionKey);
      if (!r.ok) return { ok: false };
      return { ok: true, text: r.text, message_ids: r.message_ids };
    }
    if (batch?.phase === "collecting") return { ok: false };
    if (deps.getSessionUnclaimedCount(sessionKey) === 0) return { ok: false };

    let messages = deps.claimSessionMessages(sessionKey);
    messages = deps.applyMergeOverrideForPoll(sessionKey, messages);
    if (messages.length === 0) return { ok: false };
    deps.clearMergeBatchState(sessionKey);

    const text = deps.formatMergeBody(messages);
    const message_ids = messages.map((m) => m.messageId).filter(Boolean);
    const freshIds = deps.collectFreshAndTrack(messages, sessionKey);
    deps.applyPollGetReactions(freshIds, sessionKey);
    deps.log("INFO", `orchestrator-claim: session=${sessionKey} count=${messages.length}`);
    return { ok: true, text, message_ids };
  }

  async function dispatchSessionToAgent(sessionKey: string, chatType: string, senderOpenId?: string): Promise<void> {
    const claimed = claimForOrchestratorDispatch(sessionKey);
    if (!claimed.ok) return;

    const chatId = extractSessionChatId(sessionKey);
    const mainUser = isSessionMainUser(sessionKey, chatType);

    sessionAgentPhaseMap.set(sessionKey, "starting");
    // 阶段一 starting_connect：与 buildEnqueueStatusText 对齐
    await notifySessionUser(sessionKey, "正在连接 Agent…");

    const chatName = await resolveLaunchChatName({
      chatType,
      chatId,
      senderOpenId,
      channels: deps.channels as Parameters<typeof resolveLaunchChatName>[0]["channels"],
      logWarn: (msg) => deps.log("WARN", msg),
    });

    const launchBody: Record<string, unknown> = {
      session_key: sessionKey,
      task_text: claimed.text,
      chat_type: chatType,
      chat_id: chatId,
      sender_open_id: senderOpenId,
      use_main_workspace: mainUser,
      message_ids: claimed.message_ids,
    };
    if (chatName) launchBody.chat_name = chatName;

    const textHasGroupName = /group_name:\s*\S/.test(claimed.text);
    const textPreview = claimed.text.length > 200 ? `${claimed.text.slice(0, 200)}…` : claimed.text;
    deps.log("INFO", `agent_launch_prompt: session=${sessionKey} chat_name_field=${chatName ?? "omit"} text_has_group_name=${textHasGroupName} preview=${JSON.stringify(textPreview)}`);

    const result = await forwardElectronAgentApi("/api/agent/launch", launchBody);

    if (result.ok) {
      if (chatId !== sessionKey) deps.setActiveSession(chatId, sessionKey);
      // launch 成功：清零重试计数，后续新消息独立计数；不 ack（等 final/ackOnReply）
      dispatchRetry.clearAttempt(sessionKey);
      return;
    }

    deps.log("WARN", `dispatch_failed: session=${sessionKey} error=${result.error ?? "unknown"}`);
    sessionAgentPhaseMap.delete(sessionKey);
    await dispatchRetry.handleLaunchFailure({
      sessionKey,
      messageIds: claimed.message_ids,
      error: result.error,
      busyDelayMs: parseBusyRetryDelayMs(result.error),
    });
  }

  async function runAgentDispatchLoop(): Promise<void> {
    if (dispatchLoopBusy) return;
    dispatchLoopBusy = true;
    try {
      for (const { sessionKey, chatType, senderOpenId } of deps.getDistinctSessions()) {
        await dispatchSessionToAgent(sessionKey, chatType, senderOpenId);
      }
    } catch (e: unknown) {
      deps.log("ERROR", `dispatch loop 异常: ${e instanceof Error ? e.message : e}`);
    } finally {
      dispatchLoopBusy = false;
    }
  }

  function scheduleAgentDispatch(_sessionKey?: string): void {
    if (dispatchDebounceTimer) clearTimeout(dispatchDebounceTimer);
    dispatchDebounceTimer = setTimeout(() => void runAgentDispatchLoop(), 300);
  }

  return {
    scheduleAgentDispatch,
    runAgentDispatchLoop,
    forwardElectronAgentApi,
    forwardElectronCommandApi,
    claimForOrchestratorDispatch,
    getSessionAgentPhase,
    setSessionAgentPhase,
    parseBusyRetryDelayMs,
    scheduleBusyRetry: dispatchRetry.scheduleBusyRetry,
    handleLaunchFailure: dispatchRetry.handleLaunchFailure,
    clearDispatchRetryAttempt: dispatchRetry.clearAttempt,
    notifySessionUser,
    formatOrchestratorFailure,
  };
}
