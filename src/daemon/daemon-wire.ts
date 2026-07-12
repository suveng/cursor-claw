/**
 * 批1/批2 子模块接线：orchestrator / slash / presentation / admin HTTP（仅组装 deps）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseChatKey } from "../shared/channel-types.js";
import {
  getEarliestMessageTime, claimSessionMessages, ackMessages, releaseClaimedMessages,
  getSessionUnclaimedCount, getSessionPendingCount, listUnclaimedMessages,
  replaceSessionUnclaimedMessages, getDistinctSessions,
  getQueueLength as getFileQueueLength, getQueueMessages as getFileQueueMessages,
} from "../bridge/file-queue.js";
import { createOrchestrator, type OrchestratorApi, type AgentPhase } from "./daemon-orchestrator.js";
import {
  createPresentationHandlers,
  type PresentationHandlerApi,
} from "./daemon-presentation-handlers.js";
import { createAdminCrudRoutes } from "./daemon-http-admin-crud.js";
import { createAdminApiHandler } from "./daemon-http-routes.js";
import { wireSessionRoutingPersist, fallbackSessionMap } from "./daemon-session-routing.js";
import type { SlashExecutorDeps } from "./daemon-slash-executor.js";
import type { SessionProgressState } from "./daemon-presentation-ordering.js";
import type { ChannelRuntime } from "./daemon-channel.js";
import type { MergeBatch } from "./daemon-queue-types.js";
import type * as http from "node:http";

export interface DaemonWireDeps {
  log: (level: string, ...args: unknown[]) => void;
  appDataDir: string;
  workspaceDir: string;
  pkgVersion: string;
  tasksFile: string;
  daemonPort: number;
  getDaemonPort: () => number;
  httpJson: <T = unknown>(url: string, body?: unknown, timeoutMs?: number) => Promise<T>;
  localDaemonUrl: (p: string) => string;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  json: (res: http.ServerResponse, data: unknown, status?: number) => void;
  channels: Map<string, ChannelRuntime>;
  getChannelStatusList: () => unknown[];
  activeSessionMap: Map<string, string>;
  sessionToChatMap: Map<string, string>;
  sessionChatTypeMap: Map<string, string>;
  sessionLastReplyAt: Map<string, number>;
  sessionProgressMap: Map<string, SessionProgressState>;
  sessionGetReactedIds: Map<string, Set<string>>;
  sseClients: Set<http.ServerResponse>;
  mergeBatchBySession: Map<string, MergeBatch>;
  mergeCardRegistry: Map<string, { sessionKey: string; batchId: string }>;
  shouldDeferDispatch: (sessionKey: string) => boolean;
  performClaimAndMerge: (sessionKey: string) => unknown;
  flushReadyMergeBatches: (sessionKey: string) => Promise<void>;
  applyMergeOverrideForPoll: (sessionKey: string, messages: unknown[]) => unknown[];
  clearMergeBatchState: (sessionKey: string) => void;
  formatMergeBody: (messages: Array<{ text: string }>) => string;
  isTerminalMergePhase: (phase: string) => boolean;
  renderMergeBatchCardForSession: (batch: { sessionKey: string; phase: string }) => Promise<void>;
  isMergeDispatchAllowed: (sessionKey: string) => boolean;
  handleMergeBatchAction: (
    sessionKey: string,
    action: string,
    text?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  collectFreshAndTrack: (messages: unknown[], sessionKey: string) => string[];
  applyPollGetReactions: (freshIds: string[], sessionKey: string) => void;
  setActiveSession: (chatId: string, sessionKey: string) => void;
  clearActiveSession: (chatId: string) => void;
  resolveChannelRuntime: (sessionKey: string) => unknown;
  resolveChannel: (sessionKey?: string) => unknown;
  extractWorkspaceTitle: (sessionKey?: string) => string | undefined;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
  addReactionToMessages: (messageIds: string[], sessionKey: string, emojiType?: string) => void;
  ackOnReply: (messageId?: string, sessionKey?: string) => void;
  clearFileQueue: () => number;
  pushCommandToQueue: (
    command: string,
    messageId: string,
    source: string,
    chatId?: string,
    chatType?: string,
  ) => boolean;
  getSlashExecMode: () => string;
  isWechatChatId: (rawChatId?: string) => rawChatId is string;
  readTasksFile: () => Array<{ enabled: boolean }>;
  scheduleAgentDispatchRef: { current: (sessionKey?: string) => void };
  activeMcpConnections: number;
  lastMcpRequestTime: number;
  pruneSlashExecutedMessageIds: () => void;
  isSlashMessageIdExecuted: (messageId: string) => boolean;
  listSlashExecutedMessageIds: () => string[];
}

export interface DaemonWireResult {
  orchestratorApi: OrchestratorApi;
  presentationApi: PresentationHandlerApi;
  slashExecutorDeps: SlashExecutorDeps;
  handleAdminApiRef: (
    pathname: string,
    method: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => Promise<boolean>;
  stopSessionProgress: (sessionKey: string) => void;
  getSessionAgentPhase: (sessionKey: string) => AgentPhase | undefined;
}

/** 组装批1 子模块并返回 API 句柄 */
export function wireDaemonSubmodules(deps: DaemonWireDeps): DaemonWireResult {
  function getPresentationReplyAnchor(sessionKey: string): string | undefined {
    const batch = deps.mergeBatchBySession.get(sessionKey);
    if (!batch || deps.isTerminalMergePhase(batch.phase)) return undefined;
    return batch.lastInboundMessageId;
  }

  function logPresentationFailedOrdering(sessionKey: string, kind: string, reason: string): void {
    deps.log("WARN", `presentation_failed session=${sessionKey} kind=${kind} reason=${reason}`);
  }

  const stopProgressRef: { fn: (sessionKey: string) => void } = { fn: () => {} };

  const orchestratorApi = createOrchestrator({
    log: deps.log,
    appDataDir: deps.appDataDir,
    httpJson: deps.httpJson,
    localDaemonUrl: deps.localDaemonUrl,
    channels: deps.channels,
    mergeBatchBySession: deps.mergeBatchBySession,
    shouldDeferDispatch: deps.shouldDeferDispatch,
    performClaimAndMerge: deps.performClaimAndMerge as any,
    flushReadyMergeBatches: deps.flushReadyMergeBatches,
    getDistinctSessions,
    getSessionUnclaimedCount,
    claimSessionMessages,
    applyMergeOverrideForPoll: deps.applyMergeOverrideForPoll as any,
    clearMergeBatchState: deps.clearMergeBatchState,
    formatMergeBody: deps.formatMergeBody as any,
    collectFreshAndTrack: deps.collectFreshAndTrack as any,
    applyPollGetReactions: deps.applyPollGetReactions,
    ackMessages,
    releaseClaimedMessages,
    setActiveSession: deps.setActiveSession,
    resolveChannelRuntime: deps.resolveChannelRuntime as any,
    isMergeDispatchAllowed: deps.isMergeDispatchAllowed,
  });
  deps.scheduleAgentDispatchRef.current = orchestratorApi.scheduleAgentDispatch;
  wireSessionRoutingPersist(deps.activeSessionMap);

  const slashExecutorDeps: SlashExecutorDeps = {
    log: deps.log,
    replyToMessage: deps.replyToMessage,
    forwardElectronCommandApi: (subpath, body) =>
      orchestratorApi.forwardElectronCommandApi(subpath, body),
    getSlashExecMode: deps.getSlashExecMode,
    workspaceDir: deps.workspaceDir,
    pkgVersion: deps.pkgVersion,
    getUptime: () => process.uptime(),
    getFileQueueLength,
    getFileQueueMessages: () =>
      getFileQueueMessages().map((m) => ({ index: m.index, preview: m.preview })),
    clearFileQueue: deps.clearFileQueue,
    readTasks: deps.readTasksFile,
    isElectronApiReachable: () => {
      if (!deps.appDataDir) return false;
      try {
        const portFile = path.join(deps.appDataDir, "agent-api-port.json");
        if (!fs.existsSync(portFile)) return false;
        const data = JSON.parse(fs.readFileSync(portFile, "utf-8")) as { port?: number };
        return (data.port ?? 0) > 0;
      } catch {
        return false;
      }
    },
  };

  const presentationApi = createPresentationHandlers({
    log: deps.log,
    sessionChatTypeMap: deps.sessionChatTypeMap,
    listUnclaimedMessages,
    resolveChannelRuntime: deps.resolveChannelRuntime as any,
    isWechatChatId: deps.isWechatChatId,
    resolveChannel: deps.resolveChannel as any,
    extractWorkspaceTitle: deps.extractWorkspaceTitle,
    getPresentationReplyAnchor,
    trackMessageSession: deps.trackMessageSession,
    sessionLastReplyAt: deps.sessionLastReplyAt,
    ackOnReply: deps.ackOnReply,
    stopSessionProgress: (sk) => stopProgressRef.fn(sk),
    logPresentationFailed: logPresentationFailedOrdering,
    sessionProgressMap: deps.sessionProgressMap,
    sessionGetReactedIds: deps.sessionGetReactedIds,
    mergeBatchBySession: deps.mergeBatchBySession,
    mergeCardRegistry: deps.mergeCardRegistry,
    getSessionAgentPhase: (sk) => orchestratorApi.getSessionAgentPhase(sk),
    getSessionUnclaimedCount,
    getSessionPendingCount,
    replaceSessionUnclaimedMessages,
    formatMergeBody: deps.formatMergeBody as any,
    isTerminalMergePhase: deps.isTerminalMergePhase,
    renderMergeBatchCardForSession: deps.renderMergeBatchCardForSession as any,
    replyToMessage: deps.replyToMessage,
    addReactionToMessages: deps.addReactionToMessages,
  });
  stopProgressRef.fn = (sk) => presentationApi.stopSessionProgress(sk);

  const { adminCrudRoutes, adminEntityRoutes } = createAdminCrudRoutes({
    log: deps.log,
    workspaceDir: deps.workspaceDir,
    tasksFile: deps.tasksFile,
    channels: deps.channels,
    activeSessionMap: deps.activeSessionMap,
    sessionToChatMap: deps.sessionToChatMap,
    readBody: deps.readBody,
    json: deps.json,
    clearFileQueue: deps.clearFileQueue,
    pushCommandToQueue: deps.pushCommandToQueue,
    getSlashExecMode: deps.getSlashExecMode,
    forwardElectronCommandApi: (subpath, body) =>
      orchestratorApi.forwardElectronCommandApi(subpath, body),
  });

  let handleAdminApiRef = createAdminApiHandler({
    log: deps.log,
    pkgVersion: deps.pkgVersion,
    daemonPort: deps.getDaemonPort(),
    lastMcpRequestTime: deps.lastMcpRequestTime,
    activeMcpConnections: deps.activeMcpConnections,
    readBody: deps.readBody,
    json: deps.json,
    readTasks: deps.readTasksFile,
    getChannelStatusList: deps.getChannelStatusList as any,
    getFileQueueLength,
    getSessionAgentPhase: (sk) => orchestratorApi.getSessionAgentPhase(sk),
    setSessionAgentPhase: (sk, phase) => orchestratorApi.setSessionAgentPhase(sk, phase),
    mergeBatchBySession: deps.mergeBatchBySession,
    isTerminalMergePhase: deps.isTerminalMergePhase,
    renderMergeBatchCardForSession: deps.renderMergeBatchCardForSession,
    flushReadyMergeBatches: deps.flushReadyMergeBatches,
    scheduleAgentDispatch: (sk) => orchestratorApi.scheduleAgentDispatch(sk),
    handleMergeBatchAction: deps.handleMergeBatchAction,
    performClaimAndMerge: deps.performClaimAndMerge as any,
    resolveChannel: deps.resolveChannel as any,
    extractWorkspaceTitle: deps.extractWorkspaceTitle,
    trackMessageSession: deps.trackMessageSession,
    sessionLastReplyAt: deps.sessionLastReplyAt,
    ackOnReply: deps.ackOnReply,
    stopSessionProgress: (sk) => stopProgressRef.fn(sk),
    handlePresentationEvent: (body) => presentationApi.handlePresentationEvent(body),
    handleStreamText: (body) =>
      presentationApi.handleStreamText(body as Parameters<typeof presentationApi.handleStreamText>[0]),
    forwardElectronAgentApi: orchestratorApi.forwardElectronAgentApi,
    parseBusyRetryDelayMs: orchestratorApi.parseBusyRetryDelayMs,
    scheduleBusyRetry: orchestratorApi.scheduleBusyRetry,
    handleLaunchFailure: (opts) => orchestratorApi.handleLaunchFailure(opts),
    clearDispatchRetryAttempt: (sk) => orchestratorApi.clearDispatchRetryAttempt(sk),
    notifySessionUser: orchestratorApi.notifySessionUser,
    formatOrchestratorFailure: orchestratorApi.formatOrchestratorFailure,
    ackMessages,
    getEarliestMessageTime,
    setActiveSession: deps.setActiveSession,
    clearActiveSession: deps.clearActiveSession,
    activeSessionMap: deps.activeSessionMap,
    fallbackSessionMap,
    sseClients: deps.sseClients,
    channels: deps.channels,
    parseChatKey,
    adminCrudRoutes,
    adminEntityRoutes,
  });

  const baseHandleAdminApi = handleAdminApiRef;
  handleAdminApiRef = async (pathname, method, req, res) => {
    if (method === "GET" && pathname === "/commands/skip-check") {
      const reqUrl = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
      const mid = reqUrl.searchParams.get("messageId") ?? "";
      deps.pruneSlashExecutedMessageIds();
      deps.json(res, { executed: Boolean(mid && deps.isSlashMessageIdExecuted(mid)) });
      return true;
    }
    if (method === "GET" && pathname === "/commands/executed-ids") {
      deps.json(res, { messageIds: deps.listSlashExecutedMessageIds() });
      return true;
    }
    return baseHandleAdminApi(pathname, method, req, res);
  };

  return {
    orchestratorApi,
    presentationApi,
    slashExecutorDeps,
    handleAdminApiRef,
    stopSessionProgress: (sk) => stopProgressRef.fn(sk),
    getSessionAgentPhase: (sk) => orchestratorApi.getSessionAgentPhase(sk),
  };
}
