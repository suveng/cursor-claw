import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  startDaemonScheduledTasks,
  stopDaemonScheduledTasks,
  setDaemonSchedulerLogger,
} from "./daemon-scheduled-tasks.js";
import { stripProxyEnv, localTimestamp, createLarkClient, LarkSender, LarkMessageEvent, cleanupMediaCache, type MergeBatchCardView, type MergeBatchCardState, type PresentationCardState, type FeishuMenuEvent, type FeishuP2pEnteredEvent } from "../bridge/lark-core.js";
import { onFeishuMenuV6, onFeishuP2pEntered } from "./feishu-event-handlers.js";
import { formatToolMilestoneText, mergeShellToolDetail, normalizePresentationToolName, shouldSuppressToolStartedPresentation } from "../shared/tool-presentation.js";
import { WeChatManager } from "../bridge/wechat-manager.js";
import {
  initFileQueue,
  getQueueDir,
  pushToFileQueue,
  getEarliestMessageTime,
  claimNextMessage,
  claimSessionMessages,
  ackMessages,
  releaseClaimedMessages,
  getQueueLength as getFileQueueLength,
  getQueueMessages as getFileQueueMessages,
  deleteQueueMessage as deleteFileQueueMessage,
  getDistinctSessions,
  cleanupStaleMessages,
  cleanupOrphanClaimedOnColdStart,
  getSessionPendingCount,
  getSessionUnclaimedCount,
  listUnclaimedMessages,
  replaceSessionUnclaimedMessages,
  type QueueMessage,
  type QueueMessageMeta,
} from "../bridge/file-queue.js";
import { LOCK_FILE_NAME } from "../shared/constants.js";
import { formatUnknownError } from "../shared/format-unknown-error.js";
import {
  makeChatKey,
  parseChatKey,
  type DaemonChannelConfig,
  type ChannelStatusInfo,
} from "../shared/channel-types.js";
import {
  isFeishuProcessPresentationSuppressed as feishuSuppressesProcessKind,
} from "../shared/feishu-presentation-gate.js";
import {
  sendMilestoneText,
  clearMilestoneState,
} from "./daemon-presentation-milestone.js";
import { resolveLaunchChatName } from "./chat-name-resolve.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { registerAdminTools } from "./server-admin.js";
import { registerWorkflowAgentTools, registerWorkflowAdminTools } from "../workflow/server-workflow.js";
import { createOrchestrator, type AgentPhase, type OrchestratorApi } from "./daemon-orchestrator.js";
import { createPresentationHandlers, type PresentationHandlerApi, type PresentationHandlerDeps } from "./daemon-presentation-handlers.js";
import type { SessionProgressState } from "./daemon-presentation-ordering.js";
import { createAdminCrudRoutes } from "./daemon-http-admin-crud.js";
import { createAdminApiHandler } from "./daemon-http-routes.js";
import { fallbackSessionMap } from "./daemon-session-routing.js";
import { startHttpServer as startDaemonHttpServer, type HttpServerDeps } from "./daemon-http-server.js";

const _require = createRequire(import.meta.url);
const PKG_VERSION: string = (_require("../../package.json") as { version: string }).version;

// ── 环境变量 ──────────────────────────────────────────────

const ENCRYPT_KEY = process.env.LARK_ENCRYPT_KEY ?? "";
const CONFIGURED_PORT = process.env.LARK_DAEMON_PORT ? Number(process.env.LARK_DAEMON_PORT) : 0;
let WORKSPACE_DIR = process.env.LARK_WORKSPACE_DIR ?? process.cwd();
const MESSAGE_PREFIX = process.env.LARK_MESSAGE_PREFIX ?? "";
const APP_DATA_DIR = process.env.APP_DATA_DIR || "";

function parseChannelConfigs(): DaemonChannelConfig[] {
  try {
    const raw = process.env.CLAW_CHANNELS_JSON ?? "";
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as DaemonChannelConfig[]) : [];
  } catch {
    return [];
  }
}

const CHANNEL_CONFIGS = parseChannelConfigs();

const savedProxyKeys = stripProxyEnv();

// ── 活跃 MCP 连接追踪 ──
let activeMcpConnections = 0;
let lastMcpRequestTime = 0;

// ── 日志 ─────────────────────────────────────────────────

/** 子进程由 Electron 注入 DAEMON_LOG_PATH；独立运行时兜底至 APP_DATA_DIR/daemon.log */
const LOG_FILE_PATH = process.env.DAEMON_LOG_PATH?.trim()
  || (APP_DATA_DIR ? path.join(APP_DATA_DIR, "daemon.log") : path.join(process.cwd(), "daemon.log"));
const MAX_LOG_SIZE = 2 * 1024 * 1024;
const LOG_ROTATE_CHECK_INTERVAL = 100;
let logWriteCount = 0;
let logDirEnsured = false;

/** 换行用 ⏎ 标记（展示层还原），避免与 Windows 路径中 \n、\r 字面量冲突 */
function escapeLogContentSingleLine(s: string): string {
  return s.replace(/\r?\n/g, "⏎");
}

function ensureLogDir(): void {
  if (logDirEnsured) return;
  const dir = path.dirname(LOG_FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  logDirEnsured = true;
}

function rotateLogIfNeeded(): void {
  if (++logWriteCount % LOG_ROTATE_CHECK_INTERVAL !== 0) return;
  try {
    if (fs.existsSync(LOG_FILE_PATH) && fs.statSync(LOG_FILE_PATH).size > MAX_LOG_SIZE) {
      const backup = LOG_FILE_PATH + ".old";
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      fs.renameSync(LOG_FILE_PATH, backup);
    }
  } catch { /* ignore */ }
}

function log(level: string, ...args: unknown[]): void {
  const ts = localTimestamp();
  const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  const line = `${ts} [Daemon] ${level} ${escapeLogContentSingleLine(msg)}\n`;
  process.stderr.write(line);
  try {
    ensureLogDir();
    rotateLogIfNeeded();
    fs.appendFileSync(LOG_FILE_PATH, line);
  } catch { /* ignore */ }
}

// ── 通道运行时（多飞书 + 多微信）──────────────────────────

interface ChannelRuntime {
  cfg: DaemonChannelConfig;
  // feishu
  client?: ReturnType<typeof createLarkClient>;
  sender?: LarkSender;
  botOpenId?: string;
  /** 机器人应用名（bot/v3/info 的 app_name），用于协作名册 */
  botName?: string;
  feishuConnected?: boolean;
  // wechat
  wechat?: WeChatManager;
  /** 该通道最近一次私聊的原始 chatId */
  lastP2pChatId: string | null;
  /** 主用户绑定模式：下一条私聊消息绑定为主用户 */
  bindArmed: boolean;
}

const channels = new Map<string, ChannelRuntime>();

function channelWorkspaceDir(rt: ChannelRuntime): string {
  return rt.cfg.workspaceDir?.trim() || WORKSPACE_DIR;
}

function isChannelConnected(rt: ChannelRuntime): boolean {
  if (rt.cfg.type === "feishu") return !!rt.feishuConnected && !!rt.sender;
  return rt.wechat?.isConnected() ?? false;
}

function getChannelStatusList(): ChannelStatusInfo[] {
  return [...channels.values()].map((rt) => ({
    id: rt.cfg.id,
    name: rt.cfg.name,
    type: rt.cfg.type,
    connected: isChannelConnected(rt),
    status: rt.cfg.type === "wechat"
      ? (rt.wechat?.getStatus() ?? "disconnected")
      : (rt.feishuConnected ? "connected" : "connecting"),
    mainUserBound: !!(rt.cfg.mainUserEnabled && rt.cfg.mainUserChatId),
    botName: rt.botName,
  }));
}

/** 通道的默认私聊目标（主用户优先，其次最近私聊） */
function channelDefaultChatId(rt: ChannelRuntime): string | null {
  if (rt.cfg.mainUserEnabled && rt.cfg.mainUserChatId) return rt.cfg.mainUserChatId;
  return rt.lastP2pChatId;
}

function pickChannel(channelId?: string): ChannelRuntime | null {
  if (channelId) {
    const rt = channels.get(channelId);
    if (rt) return rt;
  }
  for (const rt of channels.values()) {
    if (isChannelConnected(rt)) return rt;
  }
  return channels.values().next().value ?? null;
}

/** 主用户绑定（armed bind）命中：写回 Electron 并回执 */
function completeBind(rt: ChannelRuntime, chatId: string, messageId?: string): void {
  rt.bindArmed = false;
  rt.cfg.mainUserEnabled = true;
  rt.cfg.mainUserChatId = chatId;
  if (rt.sender) rt.sender.chatId = chatId;
  process.stdout.write(`__BIND_RESULT__:${JSON.stringify({ channelId: rt.cfg.id, chatId })}\n`);
  log("INFO", `[Bind] 通道「${rt.cfg.name}」主用户绑定成功: ${chatId}`);
  void postSdkWarmupRequest(rt, "bind-daemon");
  if (messageId) {
    replyToMessage(messageId, "✅ 主用户绑定成功！", makeChatKey(rt.cfg.id, chatId)).catch(() => {});
  }
}

/** bind 成功后请求 Electron SDK 预热（fire-and-forget，失败不阻断 bind） */
function postSdkWarmupRequest(rt: ChannelRuntime, source: string): void {
  if (!APP_DATA_DIR) return;
  try {
    const portFile = path.join(APP_DATA_DIR, "agent-api-port.json");
    if (!fs.existsSync(portFile)) return;
    const data = JSON.parse(fs.readFileSync(portFile, "utf-8")) as { port?: number };
    const port = data.port ?? 0;
    if (!port) return;
    void httpJson(`http://127.0.0.1:${port}/api/sdk-warmup`, {
      source,
      channel_id: rt.cfg.id,
      workspace_dir: channelWorkspaceDir(rt),
    }, 5000).catch((e: unknown) => {
      log("WARN", `[sdk_warmup] ${source} 请求失败: ${e instanceof Error ? e.message : String(e)}`);
    });
  } catch (e: unknown) {
    log("WARN", `[sdk_warmup] ${source} 跳过: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function isWechatChatId(rawChatId?: string): rawChatId is string {
  if (!rawChatId) return false;
  return rawChatId.startsWith("wxid_") || rawChatId.startsWith("wx_") || rawChatId.includes("@chatroom") || rawChatId.includes("@im.wechat");
}

function isFeishuChatId(rawChatId?: string): rawChatId is string {
  if (!rawChatId) return false;
  return rawChatId.startsWith("oc_");
}

// ── WeChat 通道 ──────────────────────────────────────────

function wechatDataDir(channelId: string): string {
  return path.join(APP_DATA_DIR, "wechat-data", channelId);
}

function wechatStateFile(channelId: string): string {
  return path.join(wechatDataDir(channelId), "state.json");
}

function loadWechatState(rt: ChannelRuntime): void {
  try {
    const file = wechatStateFile(rt.cfg.id);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (data.lastChatId) {
        rt.lastP2pChatId = data.lastChatId;
        log("INFO", `[WeChat:${rt.cfg.name}] 已恢复 context 绑定: chatId=${rt.lastP2pChatId}`);
      }
    }
  } catch { /* ignore */ }
}

function saveWechatState(rt: ChannelRuntime): void {
  try {
    const file = wechatStateFile(rt.cfg.id);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ lastChatId: rt.lastP2pChatId }));
  } catch { /* ignore */ }
}

function initWeChatChannel(rt: ChannelRuntime): WeChatManager {
  const channelId = rt.cfg.id;
  return new WeChatManager({
    dataDir: wechatDataDir(channelId),
    log: (level: string, ...args: unknown[]) => log(level, `[${rt.cfg.name}]`, ...args),
    onMessage: (msg) => {
      const chatKey = makeChatKey(channelId, msg.chatId);
      const firstMessage = !rt.lastP2pChatId;
      if (msg.chatType === "p2p" && msg.chatId) {
        rt.lastP2pChatId = msg.chatId;
        saveWechatState(rt);
      }
      if (rt.bindArmed && msg.chatType === "p2p" && msg.chatId) {
        completeBind(rt, msg.chatId, msg.messageId);
        return;
      }
      if (firstMessage) {
        log("INFO", `[WeChat:${rt.cfg.name}] 首条消息已收到，context_token 已绑定（chatId=${msg.chatId}），不入队`);
        return;
      }
      if (isCommand(msg.text)) {
        handleCommand(msg.text, msg.messageId, chatKey, msg.chatType).catch((e: any) =>
          log("ERROR", `[WeChat:${rt.cfg.name}] 指令处理失败: ${e?.message ?? e}`),
        );
        return;
      }
      pushMessage(msg.text, msg.messageId, chatKey, msg.chatType, msg.senderOpenId).catch((e: unknown) =>
        log("WARN", `[WeChat:${rt.cfg.name}] 入队失败: ${e instanceof Error ? e.message : e}`),
      );
    },
    onQrCode: (dataUrl) => {
      process.stdout.write(`__WECHAT_QR__:${channelId}:${dataUrl}\n`);
    },
    onStatusChange: (status) => {
      process.stdout.write(`__WECHAT_STATUS__:${channelId}:${status}\n`);
    },
  });
}

// ── SSE 客户端管理 ───────────────────────────────────────

const sseClients = new Set<http.ServerResponse>();

function broadcastQueueEvent(chatId?: string): void {
  const data = JSON.stringify({ type: "queue-update", chatId: chatId ?? null, ts: Date.now() });
  for (const res of sseClients) {
    try { res.write(`data: ${data}\n\n`); } catch { sseClients.delete(res); }
  }
  scheduleAgentDispatchRef(chatId);
}

// ── 会话路由映射 ─────────────────────────────────────────

const activeSessionMap = new Map<string, string>();
const messageSessionMap = new Map<string, string>();
const sessionToChatMap = new Map<string, string>();
const MSG_SESSION_MAP_MAX = 5000;
const sessionLastReplyAt = new Map<string, number>();

// ── 会话进行中指示（入队确认后至任务完成，供 T8 停止）──

const sessionProgressMap = new Map<string, SessionProgressState>();
/** 会话 Get 去重集合（stopSessionProgress 清 map 后仍保留，ack 后逐条清理） */
const sessionGetReactedIds = new Map<string, Set<string>>();
/** 会话 chatType 缓存（presentation ordering 消费） */
const sessionChatTypeMap = new Map<string, string>();

// ── 延迟 DONE 表情队列（Agent 回复确认后打出）──
const pendingDoneReactions = new Map<string, Map<string, number>>();
const PENDING_DONE_TIMEOUT_MS = 10 * 60 * 1000;


type MergeBatchPhase = "collecting" | "ready" | "locked" | "dispatched" | "cancelled";

interface MergeBatch {
  sessionKey: string;
  batchId: string;
  phase: MergeBatchPhase;
  messageIds: string[];
  overrideText?: string;
  cardEntityId?: string;
  cardMessageId?: string;
  cardSequence?: number;
  quietTimer?: NodeJS.Timeout;
  quietDeadlineAt?: number;
  lastInboundMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

type PresentationKind = "assistant" | "thinking" | "tool" | "diff" | "merge_batch" | "task";

/** 工具卡状态：缓存 shell 命令供 completed PATCH */
interface ToolProgressCardState extends PresentationCardState {
  shellCommand?: string;
  shellCwd?: string;
  shellOutput?: string;
}

interface PresentationEvent {
  session_key: string;
  kind: PresentationKind;
  delta?: string;
  tool_name?: string;
  tool_status?: "started" | "completed" | "failed";
  tool_shell_command?: string;
  tool_shell_cwd?: string;
  tool_shell_output?: string;
  /** task 工具 tool_call：子代理任务描述（飞书里程碑摘要） */
  tool_task_description?: string;
  /** edit/write/delete 工具：目标文件路径（完成态里程碑） */
  tool_file_path?: string;
  /** task 里程碑状态（如 in_progress / completed） */
  task_status?: string;
  /** task 里程碑展示文案 */
  task_text?: string;
  final?: boolean;
  outbound_message_id?: string;
}

const mergeBatchBySession = new Map<string, MergeBatch>();
const mergeCardRegistry = new Map<string, { sessionKey: string; batchId: string }>();

const MERGE_QUIET_MS = Number(process.env.MERGE_QUIET_MS) > 0 ? Number(process.env.MERGE_QUIET_MS) : 2500;
const MERGE_MIN_COUNT = 2;
const MERGE_CARD_MAX_ITEMS = 20;
const MERGE_EDIT_MAX_CHARS = 30000;

function formatMergeBody(messages: QueueMessage[]): string {
  if (messages.length === 0) return "";
  if (messages.length === 1) return messages[0].text.trim();
  return messages.map((m, i) => `【消息 ${i + 1}】\n${m.text.trim()}`).join("\n\n");
}

function isMergeBatchEligible(sessionKey: string): boolean {
  return isMainUserP2pEligible(sessionKey);
}

function isTerminalMergePhase(phase: MergeBatchPhase): boolean {
  return phase === "dispatched" || phase === "cancelled";
}

function registerMergeCardMessage(sessionKey: string, batchId: string, cardMessageId: string): void {
  mergeCardRegistry.set(cardMessageId, { sessionKey, batchId });
}

function clearMergeBatchQuietTimer(batch: MergeBatch): void {
  if (batch.quietTimer) {
    clearTimeout(batch.quietTimer);
    batch.quietTimer = undefined;
  }
}

function clearMergeBatchState(sessionKey: string): void {
  const batch = mergeBatchBySession.get(sessionKey);
  if (!batch) return;
  clearMergeBatchQuietTimer(batch);
  if (batch.cardMessageId) mergeCardRegistry.delete(batch.cardMessageId);
  mergeBatchBySession.delete(sessionKey);
}

function applyMergeOverrideForPoll(sessionKey: string, messages: QueueMessage[]): QueueMessage[] {
  const batch = mergeBatchBySession.get(sessionKey);
  if (!batch?.overrideText || messages.length === 0) return messages;

  const formatted = formatMergeBody(messages);
  if (batch.overrideText === formatted) return messages;

  const last = messages[messages.length - 1];
  return [{
    text: batch.overrideText,
    messageId: last.messageId,
    sessionKey: last.sessionKey || sessionKey,
    timestamp: last.timestamp,
    ...(last.meta ? { meta: last.meta } : {}),
  }];
}

function buildMergeBatchCardView(batch: MergeBatch, sessionKey: string): MergeBatchCardView {
  const messages = listUnclaimedMessages(sessionKey);
  const count = messages.length;
  const sliceStart = Math.max(0, count - MERGE_CARD_MAX_ITEMS);
  const displayItems = messages.slice(sliceStart).map((m, i) => {
    const idx = sliceStart + i + 1;
    const preview = m.text.trim().slice(0, 300);
    return `${idx}. ${preview}${m.text.trim().length > 300 ? "…" : ""}`;
  });
  if (count > MERGE_CARD_MAX_ITEMS) {
    displayItems.unshift(`*（仅展示最近 ${MERGE_CARD_MAX_ITEMS} 条）*`);
  }

  let footerText: string;
  if (batch.phase === "collecting" && batch.quietDeadlineAt) {
    const secs = Math.max(0, Math.ceil((batch.quietDeadlineAt - Date.now()) / 1000));
    footerText = secs > 0 ? `${secs} 秒后发送…` : "即将发送…";
  } else if (batch.phase === "ready") {
    footerText = getSessionAgentPhase(sessionKey) === "processing"
      ? "当前任务完成后发送"
      : "即将发送";
  } else if (batch.phase === "locked") {
    footerText = "发送中…";
  } else {
    footerText = buildEnqueueStatusText(sessionKey, count);
  }

  return {
    title: `待发送 · ${count} 条消息`,
    bodyMarkdown: displayItems.join("\n") || "（无内容）",
    footerText,
  };
}

async function renderMergeBatchCardForSession(batch: MergeBatch): Promise<void> {
  if (!isMergeBatchEligible(batch.sessionKey)) return;

  const ch = resolveChannel(batch.sessionKey);
  if (ch.type !== "feishu" || !ch.rt.sender || !ch.chatId) return;

  const view = buildMergeBatchCardView(batch, batch.sessionKey);
  const existing: MergeBatchCardState | undefined =
    batch.cardMessageId
      ? {
        cardEntityId: batch.cardEntityId ?? "",
        cardMessageId: batch.cardMessageId,
        cardSequence: batch.cardSequence ?? 0,
      }
      : undefined;

  const result = await ch.rt.sender.renderMergeBatchCard(
    ch.chatId,
    view,
    existing,
    existing ? undefined : batch.lastInboundMessageId,
  );
  if (!result) {
    log("WARN", `合并预览 text 渲染失败: session=${batch.sessionKey} batch=${batch.batchId}`);
    return;
  }

  batch.cardEntityId = result.cardEntityId;
  batch.cardSequence = result.cardSequence;
  if (result.cardMessageId !== batch.cardMessageId) {
    if (batch.cardMessageId) mergeCardRegistry.delete(batch.cardMessageId);
    batch.cardMessageId = result.cardMessageId;
    registerMergeCardMessage(batch.sessionKey, batch.batchId, result.cardMessageId);
    trackMessageSession(result.cardMessageId, batch.sessionKey);
  }
  batch.updatedAt = Date.now();
}

function scheduleMergeBatchQuietTimer(batch: MergeBatch): void {
  clearMergeBatchQuietTimer(batch);
  batch.quietDeadlineAt = Date.now() + MERGE_QUIET_MS;
  batch.quietTimer = setTimeout(() => {
    batch.quietTimer = undefined;
    if (batch.phase !== "collecting") return;
    if (getSessionUnclaimedCount(batch.sessionKey) < MERGE_MIN_COUNT) return;
    batch.phase = "ready";
    batch.quietDeadlineAt = undefined;
    batch.updatedAt = Date.now();
    renderMergeBatchCardForSession(batch).catch((e: unknown) => {
      log("WARN", `合并卡 ready 更新失败: ${e instanceof Error ? e.message : e}`);
    });
    void flushReadyMergeBatches(batch.sessionKey);
  }, MERGE_QUIET_MS);
  batch.quietTimer.unref?.();
}

/** ≥2 条入队时进入 collecting；F1 门控由 shouldSendEnqueueF1 配合 */
function onMessageEnqueued(
  sessionKey: string,
  messageId: string,
  _chatId?: string,
  chatType?: string,
  _senderOpenId?: string,
): void {
  if (chatType !== "p2p" || !isMergeBatchEligible(sessionKey)) return;

  const unclaimed = getSessionUnclaimedCount(sessionKey);
  if (unclaimed < MERGE_MIN_COUNT) return;

  let batch = mergeBatchBySession.get(sessionKey);
  if (batch && isTerminalMergePhase(batch.phase)) {
    clearMergeBatchState(sessionKey);
    batch = undefined;
  }

  const now = Date.now();
  if (!batch) {
    batch = {
      sessionKey,
      batchId: randomUUID(),
      phase: "collecting",
      messageIds: [],
      createdAt: now,
      updatedAt: now,
    };
    mergeBatchBySession.set(sessionKey, batch);
  }

  if (messageId && !batch.messageIds.includes(messageId)) {
    batch.messageIds.push(messageId);
  }
  batch.lastInboundMessageId = messageId;
  batch.phase = "collecting";
  batch.updatedAt = now;

  scheduleMergeBatchQuietTimer(batch);
  renderMergeBatchCardForSession(batch).catch((e: unknown) => {
    log("WARN", `合并 CardKit 更新失败: ${e instanceof Error ? e.message : e}`);
  });
}

/** F1 门控（M3）：collecting 批次第 2+ 条不发逐条 F1 */
function shouldSendEnqueueF1(sessionKey: string): boolean {
  const batch = mergeBatchBySession.get(sessionKey);
  if (!batch || batch.phase !== "collecting") return true;
  return getSessionUnclaimedCount(sessionKey) < MERGE_MIN_COUNT;
}

/** M7：Agent processing 时禁止 dispatch；collecting 静默窗口内亦禁止 claim */
function isMergeDispatchAllowed(sessionKey: string): boolean {
  return getSessionAgentPhase(sessionKey) !== "processing";
}

/** collecting 静默窗口或 ready 但 M7 阻塞时禁止 claim/dispatch */
function shouldDeferDispatch(sessionKey: string): boolean {
  const batch = mergeBatchBySession.get(sessionKey);
  if (!batch || isTerminalMergePhase(batch.phase)) return false;
  if (batch.phase === "collecting" && getSessionUnclaimedCount(sessionKey) >= MERGE_MIN_COUNT) {
    return true;
  }
  if (batch.phase === "ready" && !isMergeDispatchAllowed(sessionKey)) {
    return true;
  }
  return false;
}

type ClaimMergeResult =
  | { ok: true; text: string; message_ids: string[] }
  | { ok: false; error: string };

/** 仅 ready|locked 且 M7 通过时 claim；返回合并正文与 message_ids */
function performClaimAndMerge(sessionKey: string): ClaimMergeResult {
  const batch = mergeBatchBySession.get(sessionKey);
  if (!batch) return { ok: false, error: "no merge batch" };
  if (batch.phase === "collecting") return { ok: false, error: "batch collecting" };
  if (isTerminalMergePhase(batch.phase)) return { ok: false, error: "batch terminal" };
  if (batch.phase === "ready" && !isMergeDispatchAllowed(sessionKey)) {
    return { ok: false, error: "agent processing, batch queued" };
  }

  clearMergeBatchQuietTimer(batch);
  const overrideText = batch.overrideText;
  if (batch.phase === "ready") {
    batch.phase = "locked";
    batch.updatedAt = Date.now();
    renderMergeBatchCardForSession(batch).catch((e: unknown) => {
      log("WARN", `合并卡 locked 更新失败: ${e instanceof Error ? e.message : e}`);
    });
  }

  const messages = claimSessionMessages(sessionKey);
  if (messages.length === 0) {
    clearMergeBatchState(sessionKey);
    return { ok: false, error: "no messages to claim" };
  }

  const text = overrideText ?? formatMergeBody(messages);
  const message_ids = messages.map((m) => m.messageId).filter(Boolean);

  batch.phase = "dispatched";
  clearMergeBatchState(sessionKey);

  const pollMessages = overrideText && overrideText !== formatMergeBody(messages)
    ? [{
        text: overrideText,
        messageId: message_ids[message_ids.length - 1] ?? "",
        sessionKey,
        timestamp: messages[messages.length - 1]?.timestamp ?? Date.now(),
        ...(messages[messages.length - 1]?.meta ? { meta: messages[messages.length - 1].meta } : {}),
      }]
    : messages;
  const freshIds = collectFreshAndTrack(pollMessages, sessionKey);
  applyPollGetReactions(freshIds, sessionKey);
  broadcastQueueEvent(sessionKey);
  log("INFO", `claim-and-merge: session=${sessionKey} count=${message_ids.length}`);
  return { ok: true, text, message_ids };
}

/** ready 批次在 M7 允许时触发 Daemon dispatch 循环 */
async function flushReadyMergeBatches(sessionKey: string): Promise<void> {
  const batch = mergeBatchBySession.get(sessionKey);
  if (!batch || batch.phase !== "ready") return;
  if (!isMergeDispatchAllowed(sessionKey)) {
    await renderMergeBatchCardForSession(batch);
    return;
  }
  broadcastQueueEvent(sessionKey);
}


async function handleMergeBatchAction(
  sessionKey: string,
  action: string,
  text?: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = action.replace(/^merge_/, "");
  const batch = mergeBatchBySession.get(sessionKey);

  if (normalized === "send_now") {
    if (!batch || batch.phase !== "collecting") {
      return { ok: false, error: "batch not in collecting" };
    }
    clearMergeBatchQuietTimer(batch);
    batch.phase = "ready";
    batch.quietDeadlineAt = undefined;
    batch.updatedAt = Date.now();
    await renderMergeBatchCardForSession(batch);
    await flushReadyMergeBatches(sessionKey);
    return { ok: true };
  }

  if (normalized === "split") {
    if (!batch || isTerminalMergePhase(batch.phase)) {
      return { ok: false, error: "no active merge batch" };
    }
    if (batch.phase === "locked" || batch.phase === "dispatched") {
      return { ok: false, error: "batch already dispatching" };
    }
    clearMergeBatchQuietTimer(batch);
    batch.phase = "cancelled";
    clearMergeBatchState(sessionKey);
    broadcastQueueEvent(sessionKey);
    // ponytail: T7 单条顺序 dispatch；取消合并后由 orchestrator dispatch 按未合并路径领取
    return { ok: true };
  }

  if (normalized === "edit") {
    if (!batch || isTerminalMergePhase(batch.phase)) {
      return { ok: false, error: "no active merge batch" };
    }
    if (batch.phase === "locked" || batch.phase === "dispatched") {
      return { ok: false, error: "batch already dispatching" };
    }
    const trimmed = text?.trim();
    if (!trimmed) return { ok: false, error: "text is required for edit" };
    if (trimmed.length > MERGE_EDIT_MAX_CHARS) {
      return { ok: false, error: `text exceeds ${MERGE_EDIT_MAX_CHARS} chars` };
    }
    const claimed = getSessionPendingCount(sessionKey) - getSessionUnclaimedCount(sessionKey);
    if (claimed > 0) return { ok: false, error: "messages already claimed" };
    const chatType = resolveSessionChatType(sessionKey) ?? "p2p";
    const result = replaceSessionUnclaimedMessages(sessionKey, trimmed, { chatType });
    if (!result.ok) return { ok: false, error: result.error ?? "edit failed" };
    batch.overrideText = trimmed;
    batch.updatedAt = Date.now();
    await renderMergeBatchCardForSession(batch);
    return { ok: true };
  }

  return { ok: false, error: "unknown action" };
}

function enqueuePendingDone(sessionKey: string, messageIds: string[]): void {
  const now = Date.now();
  let map = pendingDoneReactions.get(sessionKey);
  if (!map) { map = new Map(); pendingDoneReactions.set(sessionKey, map); }
  for (const mid of messageIds) {
    if (mid && !mid.startsWith("internal_")) map.set(mid, now);
  }
}

function flushPendingDone(sessionKey: string): void {
  const map = pendingDoneReactions.get(sessionKey);
  if (!map || map.size === 0) return;
  const ids = [...map.keys()];
  map.clear();
  addReactionToMessages(ids, sessionKey, "DONE");
  log("INFO", `打 DONE 表情: ${ids.length} 条, session=${sessionKey}`);
}

function setActiveSession(chatId: string, sessionKey: string): void {
  activeSessionMap.set(chatId, sessionKey);
  sessionToChatMap.set(sessionKey, chatId);
  log("INFO", `会话路由更新: ${chatId} → ${sessionKey}`);
}

function resolveRawChatId(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined;
  const mapped = sessionToChatMap.get(sessionKey);
  if (mapped) return mapped;
  const idx = sessionKey.indexOf("::");
  return idx > 0 ? sessionKey.slice(0, idx) : sessionKey;
}

function extractWorkspaceTitle(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined;
  // 私聊不展示工作区目录名前缀（如【cursor-claw】），群聊仍保留便于区分项目
  if (resolveSessionChatType(sessionKey) === "p2p") return undefined;
  const idx = sessionKey.indexOf("::");
  if (idx < 0) return undefined;
  const wsDir = sessionKey.slice(idx + 2);
  if (!wsDir) return undefined;
  const name = wsDir.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return name || undefined;
}

type ResolvedChannel =
  | { type: "wechat"; rt: ChannelRuntime; chatId: string }
  | { type: "feishu"; rt: ChannelRuntime; chatId?: string }
  | { type: "error"; message: string };

function resolveChannel(sessionKey?: string): ResolvedChannel {
  const rawKey = resolveRawChatId(sessionKey);

  if (rawKey) {
    const { channelId, chatId } = parseChatKey(rawKey);
    if (channelId) {
      const rt = channels.get(channelId);
      if (rt) {
        if (rt.cfg.type === "wechat") {
          return rt.wechat?.isConnected()
            ? { type: "wechat", rt, chatId }
            : { type: "error", message: `微信通道「${rt.cfg.name}」未连接` };
        }
        if (rt.sender) return { type: "feishu", rt, chatId };
        return { type: "error", message: `飞书通道「${rt.cfg.name}」未连接` };
      }
    }
    // 旧格式（无通道前缀）：按 chatId 形态启发式匹配
    for (const rt of channels.values()) {
      if (rt.cfg.type === "wechat" && isWechatChatId(rawKey) && rt.wechat?.isConnected()) {
        return { type: "wechat", rt, chatId: rawKey };
      }
      if (rt.cfg.type === "feishu" && isFeishuChatId(rawKey) && rt.sender) {
        return { type: "feishu", rt, chatId: rawKey };
      }
    }
  }

  // 兜底：第一个有默认私聊目标的已连接通道
  for (const rt of channels.values()) {
    const target = channelDefaultChatId(rt);
    if (!target || !isChannelConnected(rt)) continue;
    if (rt.cfg.type === "wechat") return { type: "wechat", rt, chatId: target };
    return { type: "feishu", rt, chatId: target };
  }
  for (const rt of channels.values()) {
    if (rt.cfg.type === "feishu" && rt.sender) return { type: "feishu", rt };
  }
  return { type: "error", message: "无可用消息通道" };
}

function trackMessageSession(messageId: string, sessionKey: string): void {
  if (!messageId || !sessionKey) return;
  if (messageSessionMap.size >= MSG_SESSION_MAP_MAX) {
    const oldest = messageSessionMap.keys().next().value;
    if (oldest) messageSessionMap.delete(oldest);
  }
  messageSessionMap.set(messageId, sessionKey);
}

/** 记录消息归属会话，并返回首次投递（之前未见过）的 messageId——只对新消息打 Get，避免重投时重复打表情 */
function collectFreshAndTrack(messages: QueueMessage[], sessionKey: string): string[] {
  const fresh: string[] = [];
  for (const m of messages) {
    if (!m.messageId) continue;
    if (!messageSessionMap.has(m.messageId)) fresh.push(m.messageId);
    trackMessageSession(m.messageId, sessionKey);
  }
  return fresh;
}

function addReactionToMessages(messageIds: string[], sessionKey: string, emojiType = "Get"): void {
  const ch = resolveChannel(sessionKey);
  if (ch.type !== "feishu" || !ch.rt.sender) return;
  const sender = ch.rt.sender;
  for (const mid of messageIds) {
    if (mid) sender.addReaction(mid, emojiType).catch(() => {});
  }
}

/** poll 投递 Get：按 messageId 去重，跳过入队确认或前次 poll 已打 Get 的 inbound（F5.3） */
function idsNeedingPollGetReaction(freshIds: string[], sessionKey: string): string[] {
  if (freshIds.length === 0) return freshIds;
  const reacted = sessionGetReactedIds.get(sessionKey);
  if (!reacted?.size) return freshIds;
  return freshIds.filter((id) => !reacted.has(id));
}

function applyPollGetReactions(freshIds: string[], sessionKey: string): void {
  const ids = idsNeedingPollGetReaction(freshIds, sessionKey);
  if (ids.length === 0) return;
  addReactionToMessages(ids, sessionKey, "Get");
  recordGetReactions(sessionKey, ids);
}

/**
 * Agent 回复确认（ack）：删除该 message_id 及更早的未确认消息。
 * DONE 表情在 ack 时打出（T7 已删除 poll-message）。
 */
function ackOnReply(messageId?: string, sessionKey?: string): void {
  if (!messageId) return;
  const acked = ackMessages(messageId, sessionKey);
  if (acked.length === 0) return;
  log("INFO", `回复确认 ${acked.length} 条消息: session=${sessionKey ?? "?"} (via ${messageId})`);
  if (sessionKey) {
    enqueuePendingDone(sessionKey, acked);
    flushPendingDone(sessionKey);
    broadcastQueueEvent(sessionKey);
    clearGetReactions(sessionKey, acked);
    stopSessionProgress(sessionKey);
    clearMergeBatchState(sessionKey);
  }
}

function resolveRoutingKey(chatId?: string, replyMessageId?: string): string | undefined {
  if (replyMessageId) {
    const sk = messageSessionMap.get(replyMessageId);
    if (sk) {
      // 同一条消息（message_id 全局唯一）可能被多个通道分别接收（bot 协作 reply 链）。
      // messageId 映射仅在通道一致时生效，否则会把 A 通道的消息错投进 B 通道的会话。
      const skChannel = parseChatKey(sk.includes("::") ? sk.slice(0, sk.indexOf("::")) : sk).channelId;
      const msgChannel = chatId ? parseChatKey(chatId).channelId : undefined;
      if (!skChannel || !msgChannel || skChannel === msgChannel) {
        log("INFO", `路由命中 messageId 映射: ${replyMessageId} → ${sk}`);
        return sk;
      }
      log("INFO", `messageId 映射跨通道(${skChannel}→${msgChannel})，忽略: ${replyMessageId}`);
    }
  }
  if (!chatId) return undefined;
  return activeSessionMap.get(chatId) ?? chatId;
}

// ── 文件队列 ─────────────────────────────────────────────

function initQueue(): void {
  const dir = initFileQueue();
  log("INFO", `共享文件队列: ${dir}`);
  cleanupStaleMessages();
  const reclaimed = cleanupOrphanClaimedOnColdStart();
  if (reclaimed > 0) {
    log("INFO", `冷启动回收遗留 claimed→qmsg: ${reclaimed} 条`);
  }
}

/** 媒体缓存清理：启动清一次 + 每 6 小时清一次，删除 24 小时前的旧文件 */
function startMediaCacheCleanup(): void {
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const sweep = () => {
    const n = cleanupMediaCache(MAX_AGE_MS);
    if (n > 0) log("INFO", `媒体缓存已清理 ${n} 个过期文件`);
  };
  sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}

/**
 * 写入文件队列。入队前按 chat_type 解析名称并 append `\ngroup_name: <名称>`；
 * 无名/失败保持原文，WARN 不阻断入队。
 */
async function pushMessage(content: string, messageId?: string, chatId?: string, chatType?: string, senderOpenId?: string, replyMessageId?: string, meta?: QueueMessageMeta): Promise<void> {
  if (!content?.trim()) {
    log("WARN", `丢弃空消息 (messageId=${messageId})`);
    return;
  }
  let routedId = resolveRoutingKey(chatId, replyMessageId);
  if (routedId && routedId === chatId && chatType === "p2p" && !routedId.includes("::")) {
    const { channelId } = parseChatKey(chatId!);
    const rt = channelId ? channels.get(channelId) : undefined;
    const wsDir = rt ? channelWorkspaceDir(rt) : WORKSPACE_DIR;
    if (wsDir) {
      const defaultSessionKey = `${chatId}::${wsDir}`;
      setActiveSession(chatId!, defaultSessionKey);
      routedId = defaultSessionKey;
    }
  }

  // 有 chatType 才拉名；有名拼尾，失败/无名不拼、不阻断
  let queueContent = content;
  if (chatType) {
    try {
      const resolvedName = await resolveLaunchChatName({
        chatType,
        chatId: chatId ?? "",
        senderOpenId,
        channels,
        logWarn: (msg) => log("WARN", msg),
      });
      if (resolvedName) {
        queueContent = `${content}\ngroup_name: ${resolvedName}`;
        log("INFO", `group_name_inject: ok chat=${chatId ?? "none"} type=${chatType} name=${resolvedName}`);
      } else {
        log("WARN", `group_name_inject: omit chat=${chatId ?? "none"} type=${chatType} reason=no_name`);
      }
    } catch (e: unknown) {
      log("WARN", `入队前名称解析异常 messageId=${messageId ?? "none"}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const fullMeta: QueueMessageMeta = { ...(meta || {}) };
  if (chatType) fullMeta.chatType = chatType;
  if (senderOpenId) fullMeta.senderOpenId = senderOpenId;
  const written = pushToFileQueue(queueContent, messageId, `daemon-${process.pid}`, routedId, false, Object.keys(fullMeta).length > 0 ? fullMeta : undefined);
  if (written) {
    if (routedId && fullMeta.chatType) rememberSessionChatType(routedId, fullMeta.chatType);
    log("INFO", `消息已写入共享队列: ${JSON.stringify(queueContent)} (id=${messageId ?? "none"}, chat=${chatId ?? "none"}${routedId !== chatId ? ` → routed=${routedId}` : ""}${replyMessageId ? `, reply=${replyMessageId}` : ""})`);
    broadcastQueueEvent(routedId);
    if (messageId && !messageId.startsWith("internal_") && routedId) {
      if (fullMeta.chatType === "p2p") {
        onMessageEnqueued(routedId, messageId, chatId, fullMeta.chatType, senderOpenId);
      }
      if (shouldSendEnqueueF1(routedId)) {
        confirmEnqueueAndStartProgress(messageId, routedId, chatId).catch((e: unknown) => {
          log("WARN", `入队确认/进度启动失败: ${e instanceof Error ? e.message : e}`);
        });
      } else if (messageId) {
        addReactionToMessages([messageId], routedId, "Get");
        recordGetReactions(routedId, [messageId]);
      }
    }
  } else {
    log("INFO", `消息已跳过（重复或写入失败）: id=${messageId ?? "none"}`);
  }
}

function clearFileQueue(): number {
  const queueDir = getQueueDir();
  if (!queueDir) return 0;
  let count = 0;
  const exts = [".qmsg", ".claimed", ".done", ".tmp"];
  const clearDir = (dir: string) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
          clearDir(full);
        } else if (exts.some((ext) => f.endsWith(ext))) {
          try { fs.unlinkSync(full); count++; } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  };
  clearDir(queueDir);
  log("INFO", `队列已清空: ${count} 条消息`);
  return count;
}

// ── 飞书 WebSocket 长连接（每通道一条）───────────────────

function isBotMentioned(rt: ChannelRuntime, ev: LarkMessageEvent): boolean {
  if (!rt.botOpenId) return ev.mentions.length > 0;
  return ev.mentions.some((m) => m.id === rt.botOpenId || m.key === "@_all");
}

/**
 * 将 `@_user_N` 占位符还原为可读形式：
 * - @自己 → 删除（与旧行为一致）
 * - @其他人/机器人 → `@名字(open_id=ou_xxx)`，Agent 可直接取 open_id 回 @
 */
function resolveMentionTags(text: string, mentions: LarkMessageEvent["mentions"], selfOpenId?: string): string {
  let out = text;
  for (const m of mentions) {
    if (!m.key) continue;
    const replacement = (selfOpenId && m.id === selfOpenId) || m.key === "@_all"
      ? ""
      : (m.id ? `@${m.name}(open_id=${m.id})` : `@${m.name}`);
    out = out.split(m.key).join(replacement);
  }
  return out.replace(/@_user_\d+/g, "").replace(/\s{2,}/g, " ").trim();
}

/** 同实例其他飞书机器人名册（互相感知，供 Agent 按名字路由协作） */
function buildBotRoster(self: ChannelRuntime): string {
  const peers: string[] = [];
  for (const rt of channels.values()) {
    if (rt.cfg.type !== "feishu" || rt === self || !rt.botOpenId) continue;
    peers.push(`${rt.botName ?? rt.cfg.name}=${rt.botOpenId}`);
  }
  return peers.join(", ");
}

async function startFeishuChannel(rt: ChannelRuntime): Promise<void> {
  const { appId, appSecret } = rt.cfg;
  if (!appId || !appSecret) { log("ERROR", `[${rt.cfg.name}] 飞书凭据未配置`); return; }

  rt.client = createLarkClient(appId, appSecret);
  rt.sender = new LarkSender({
    client: rt.client,
    chatId: rt.cfg.mainUserEnabled ? rt.cfg.mainUserChatId : "",
    messagePrefix: MESSAGE_PREFIX,
    log: (level: string, ...args: unknown[]) => log(level, `[${rt.cfg.name}]`, ...args),
  });

  try {
    const botInfo = await rt.client.request({ method: "GET", url: "/open-apis/bot/v3/info" }) as any;
    rt.botOpenId = botInfo?.bot?.open_id;
    rt.botName = botInfo?.bot?.app_name || rt.cfg.name;
    if (rt.botOpenId) log("INFO", `[${rt.cfg.name}] 机器人 open_id: ${rt.botOpenId} (${rt.botName})`);
    else log("WARN", `[${rt.cfg.name}] 未能获取机器人 open_id，群消息过滤将使用宽松模式`);
  } catch (e: any) {
    log("WARN", `[${rt.cfg.name}] 获取机器人信息失败: ${e?.message ?? e}`);
  }

  const sender = rt.sender;
  const feishuEventDeps = {
    log,
    pushCommandToQueue,
    makeChatKey,
  };
  sender.startConnection(appId, appSecret, ENCRYPT_KEY, (ev) => {
    rt.feishuConnected = true;
    const { text, messageId, chatId, chatType, messageType, rawContent, senderOpenId, parentId } = ev;
    const chatKey = makeChatKey(rt.cfg.id, chatId);

    if (chatType === "p2p" && chatId) {
      rt.lastP2pChatId = chatId;
      if (rt.bindArmed) {
        completeBind(rt, chatId, messageId);
        return;
      }
      if (!sender.chatId) {
        sender.chatId = chatId;
        log("INFO", `[${rt.cfg.name}] 自动绑定默认 chat_id: ${chatId}`);
      }
    }

    if (chatType === "group" && !isBotMentioned(rt, ev)) {
      return;
    }

    const cleanText = chatType === "group" ? resolveMentionTags(text, ev.mentions, rt.botOpenId) : text;
    log("INFO", `[${rt.cfg.name}] 收到消息 [${chatType}] chat=${chatId} sender=${senderOpenId ?? "?"}${ev.senderType === "app" ? "(bot)" : ""}${parentId ? ` reply=${parentId}` : ""}: ${cleanText.slice(0, 100)}`);

    if (messageType === "text" && isCommand(cleanText)) {
      handleCommand(cleanText, messageId, chatKey, chatType).catch((e: any) =>
        log("ERROR", `指令处理失败: ${e?.message ?? e}`),
      );
      return;
    }

    const enqueue = async (content: string) => {
      // 元数据进独立的 meta 字段，text 只保留纯正文（单一职责，不污染消息内容）
      const meta: QueueMessageMeta = {
        senderType: ev.senderType === "app" ? "bot" : "user",
      };
      if (rt.botOpenId) {
        meta.botOpenId = rt.botOpenId;
        meta.botName = rt.botName ?? rt.cfg.name;
      }
      if (chatType === "group") {
        const roster = buildBotRoster(rt);
        if (roster) meta.botRoster = roster;
      }
      if (parentId) {
        const original = await sender.fetchMessageContent(parentId);
        if (original) meta.quotedContent = original;
      }
      if (messageType === "text") {
        const handled = await tryHandleMergePreviewReply(
          parentId, content, messageId, chatKey, chatType, senderOpenId, meta,
        );
        if (handled) return;
      }
      await pushMessage(content, messageId, chatKey, chatType, senderOpenId, parentId, meta);
    };

    if (messageType === "text") {
      enqueue(cleanText);
    } else {
      sender.processIncomingMessage(messageId, messageType, rawContent)
        .then((result) => enqueue(result || cleanText))
        .catch(() => enqueue(cleanText));
    }
  }, {
    onMenuV6: (ev: FeishuMenuEvent) => {
      onFeishuMenuV6(rt, sender, ev, feishuEventDeps).catch((e: unknown) => {
        log("ERROR", `[${rt.cfg.name}] menu_v6 处理失败: ${e instanceof Error ? e.message : e}`);
      });
    },
    onP2pEntered: (ev: FeishuP2pEnteredEvent) => {
      onFeishuP2pEntered(rt, sender, ev, feishuEventDeps).catch((e: unknown) => {
        log("ERROR", `[${rt.cfg.name}] p2p_entered 处理失败: ${e instanceof Error ? e.message : e}`);
      });
    },
  });
  // WSClient.start 为异步建立；这里乐观置位，错误会在日志中体现
  rt.feishuConnected = true;
}

// ── 指令系统 ─────────────────────────────────────────────

const COMMANDS: Record<string, string> = {
  "/stop": "停止当前运行中的 Agent",
  "/status": "查看 Agent / Daemon 状态",
  "/list": "查看消息队列列表（不消费）",
  "/task": "定时任务（/task 查看子命令说明；如 /task ls）",
  "/workflow": "工作流管理（/workflow ls | info | run | status | delete）",
  "/wf": "同 /workflow",
  "/model": "SDK / Claude Code 模型（/model ls | info | set <序号>）",
  "/mcp": "MCP 服务器管理（/mcp ls | info | enable | disable | delete | add）",
  "/workspace": "切换工作目录（/workspace 查看当前 | /workspace set <路径>）",
  "/chat": "会话管理（/chat ls | /chat <序号> | /chat stop <序号> | /chat new <描述> [-dir <路径>]；省略 -dir 用当前主会话目录，无效目录不创建）",
  "/clean": "清空消息队列",
  "/reset": "重置会话上下文（下次拉起为新会话），不删除本地文件",
  "/restart": "停止 Agent + 清空队列 + 重启 Daemon",
  "/help": "显示可用指令列表",
};

function isCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return Object.keys(COMMANDS).some((cmd) => trimmed === cmd || trimmed.startsWith(cmd + " "));
}

async function replyToMessage(messageId: string, text: string, chatId?: string): Promise<void> {
  const ch = resolveChannel(chatId);
  if (ch.type === "error") { log("WARN", `回复失败: ${ch.message}`); return; }
  if (ch.type === "wechat") {
    try { await ch.rt.wechat!.sendText(ch.chatId, text); } catch (e: any) { log("WARN", `微信回复失败: ${e?.message}`); }
    return;
  }
  if (ch.chatId) {
    await ch.rt.sender!.sendMessage(text, undefined, ch.chatId);
  } else {
    await ch.rt.sender!.replyMessage(messageId, text);
  }
}

// ── 共享指令文件队列（.fcmd）──────────────────────────────

function pushCommandToQueue(command: string, messageId: string, source: string, chatId?: string, chatType?: string): boolean {
  const queueDir = getQueueDir();
  if (!queueDir) return false;
  const ts = Date.now();
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");

  try {
    const existing = fs.readdirSync(queueDir);
    if (existing.some((f) => f.includes(`_${safeId}.fcmd`))) return false;
  } catch { /* ignore */ }

  try {
    const data = JSON.stringify({ command, messageId, timestamp: ts, source, chatId, chatType });
    const filename = `${ts}_${safeId}.fcmd`;
    const tmpPath = path.join(queueDir, filename + ".tmp");
    const finalPath = path.join(queueDir, filename);
    fs.writeFileSync(tmpPath, data, "utf-8");
    fs.renameSync(tmpPath, finalPath);
    log("INFO", `指令已入队: ${command} (msgId=${messageId}, source=${source})`);
    return true;
  } catch { return false; }
}

interface CmdEntry { id: string; command: string; messageId: string; chatId?: string; chatType?: string }

function getPendingCommands(): CmdEntry[] {
  const queueDir = getQueueDir();
  if (!queueDir) return [];
  try {
    const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".fcmd")).sort();
    return files.map((f) => {
      try {
        const raw = fs.readFileSync(path.join(queueDir, f), "utf-8");
        const p = JSON.parse(raw);
        return { id: f, command: p.command, messageId: p.messageId, chatId: p.chatId, chatType: p.chatType };
      } catch { return null; }
    }).filter(Boolean) as CmdEntry[];
  } catch { return []; }
}

function claimCommand(fileId: string): Omit<CmdEntry, "id"> | null {
  const queueDir = getQueueDir();
  if (!queueDir) return null;
  const srcPath = path.join(queueDir, fileId);
  const claimedPath = srcPath + ".claimed";
  try {
    fs.renameSync(srcPath, claimedPath);
    const raw = fs.readFileSync(claimedPath, "utf-8");
    fs.unlinkSync(claimedPath);
    const p = JSON.parse(raw);
    return { command: p.command, messageId: p.messageId, chatId: p.chatId, chatType: p.chatType };
  } catch { return null; }
}

function cleanExpiredCommands(): void {
  const queueDir = getQueueDir();
  if (!queueDir) return;
  const now = Date.now();
  try {
    const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".fcmd"));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(queueDir, f), "utf-8");
        const parsed = JSON.parse(raw);
        if (now - (parsed.timestamp ?? 0) > 60_000) {
          fs.unlinkSync(path.join(queueDir, f));
          log("WARN", `指令超时已清除: ${parsed.command} (msgId=${parsed.messageId})`);
          if (parsed.messageId) {
            replyToMessage(parsed.messageId, `⚠️ 指令 ${parsed.command} 执行超时`, parsed.chatId).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

async function handleCommand(text: string, messageId: string, chatId?: string, chatType?: string): Promise<void> {
  const trimmed = text.trim();
  pushCommandToQueue(trimmed, messageId, `daemon-${process.pid}`, chatId, chatType);
}

// ── HTTP 工具（批1 仍驻 daemon，供子模块 deps 注入）────────

let daemonPort = 0;
const TASKS_FILE = path.join(APP_DATA_DIR, "scheduled-tasks.json");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    req.on("end", () => resolve(chunks.join("")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function httpJson<T = unknown>(url: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const isPost = body !== undefined;
    const payload = isPost ? JSON.stringify(body) : undefined;
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: isPost ? "POST" : "GET",
      headers: isPost ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload!) } : undefined,
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error(`daemon JSON parse: ${Buffer.concat(chunks).toString().slice(0, 200)}`)); }
      });
    });
    req.on("error", (e) => reject(new Error(`daemon request failed: ${e.message}`)));
    req.on("timeout", () => { req.destroy(); reject(new Error("daemon request timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

function localDaemonUrl(p: string): string {
  return `http://127.0.0.1:${daemonPort}${p}`;
}

function readTasksFile(): Array<{ enabled: boolean }> {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
      return Array.isArray(data) ? data : [];
    }
  } catch { /* ignore */ }
  return [];
}

// ── Lock 文件 ────────────────────────────────────────────

function getLockFilePath(): string {
  return path.join(APP_DATA_DIR, LOCK_FILE_NAME);
}

function writeLockFile(port: number): void {
  const lockPath = getLockFilePath();
  const lockDir = path.dirname(lockPath);
  if (!fs.existsSync(lockDir)) fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid, port, version: PKG_VERSION,
    startedAt: localTimestamp(), workspaceDir: WORKSPACE_DIR,
  }));
}

function removeLockFile(): void {
  try {
    const lockPath = getLockFilePath();
    if (fs.existsSync(lockPath)) { fs.unlinkSync(lockPath); }
  } catch { /* ignore */ }
}

// ── 主函数 ───────────────────────────────────────────────


// ── 批1 子模块句柄与 deps 契约（T1）────────────────────────
let orchestratorApi: OrchestratorApi;
let presentationApi: PresentationHandlerApi;
let scheduleAgentDispatchRef: (sessionKey?: string) => void = () => {};
let handleAdminApiRef: (pathname: string, method: string, req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean> = async () => false;

/** 组装期共享 Map/回调（批2 queue/channel 仍驻本文件） */
interface DaemonBootstrapContext {
  channels: Map<string, ChannelRuntime>;
  sessionProgressMap: Map<string, SessionProgressState>;
  mergeBatchBySession: Map<string, MergeBatch>;
}

function getSessionAgentPhase(sessionKey: string): AgentPhase | undefined {
  return orchestratorApi?.getSessionAgentPhase(sessionKey);
}

function resolveChannelRuntime(sessionKey: string): {
  rt: ChannelRuntime;
  rawKey: string;
  chatId: string;
} | null {
  const rawKey = resolveRawChatId(sessionKey);
  if (!rawKey) return null;
  const { channelId, chatId: raw } = parseChatKey(rawKey);
  let rt: ChannelRuntime | undefined;
  if (channelId) {
    rt = channels.get(channelId);
  } else {
    for (const c of channels.values()) {
      if (isWechatChatId(rawKey) && c.cfg.type === "wechat") { rt = c; break; }
      if (isFeishuChatId(rawKey) && c.cfg.type === "feishu") { rt = c; break; }
    }
  }
  if (!rt) return null;
  return { rt, rawKey, chatId: raw || rawKey };
}

function isMainUserP2pEligible(sessionKey: string): boolean {
  return presentationApi?.ordering.isMainUserP2pEligible(sessionKey) ?? false;
}

function rememberSessionChatType(sessionKey: string, chatType: string): void {
  presentationApi?.rememberSessionChatType(sessionKey, chatType);
}

function resolveSessionChatType(sessionKey: string): string | undefined {
  return presentationApi?.ordering.resolveSessionChatType(sessionKey);
}

function buildEnqueueStatusText(sessionKey: string, pending: number): string {
  return presentationApi?.buildEnqueueStatusText(sessionKey, pending) ?? "已收到";
}

function confirmEnqueueAndStartProgress(messageId: string, sessionKey: string, chatId?: string): Promise<void> {
  return presentationApi.confirmEnqueueAndStartProgress(messageId, sessionKey, chatId);
}

function tryHandleMergePreviewReply(
  parentId: string | undefined,
  text: string,
  messageId: string,
  chatKey: string,
  chatType: string,
  senderOpenId?: string,
  meta?: QueueMessageMeta,
): Promise<boolean> {
  return presentationApi.tryHandleMergePreviewReply(parentId, text, messageId, chatKey, chatType, senderOpenId, meta);
}

function stopSessionProgress(sessionKey: string): void {
  presentationApi?.stopSessionProgress(sessionKey);
}

function recordGetReactions(sessionKey: string, messageIds: string[]): void {
  presentationApi?.recordGetReactions(sessionKey, messageIds);
}

function clearGetReactions(sessionKey: string, messageIds: string[]): void {
  presentationApi?.clearGetReactions(sessionKey, messageIds);
}

/** 批1 子模块工厂接线（T7） */
function wireDaemonSubmodules(_ctx: DaemonBootstrapContext): void {
  function getPresentationReplyAnchor(sessionKey: string): string | undefined {
    const batch = mergeBatchBySession.get(sessionKey);
    if (!batch || isTerminalMergePhase(batch.phase)) return undefined;
    return batch.lastInboundMessageId;
  }

  function logPresentationFailedOrdering(sessionKey: string, kind: string, reason: string): void {
    log("WARN", `presentation_failed session=${sessionKey} kind=${kind} reason=${reason}`);
  }

  const stopProgressRef: { fn: (sessionKey: string) => void } = { fn: () => {} };

  orchestratorApi = createOrchestrator({
    log,
    appDataDir: APP_DATA_DIR,
    httpJson,
    localDaemonUrl,
    channels,
    mergeBatchBySession,
    shouldDeferDispatch,
    performClaimAndMerge,
    flushReadyMergeBatches,
    getDistinctSessions,
    getSessionUnclaimedCount,
    claimSessionMessages,
    applyMergeOverrideForPoll,
    clearMergeBatchState,
    formatMergeBody,
    collectFreshAndTrack,
    applyPollGetReactions,
    ackMessages,
    releaseClaimedMessages,
    setActiveSession,
    resolveChannelRuntime,
    isMergeDispatchAllowed,
  });
  scheduleAgentDispatchRef = orchestratorApi.scheduleAgentDispatch;

  presentationApi = createPresentationHandlers({
    log,
    sessionChatTypeMap,
    listUnclaimedMessages,
    resolveChannelRuntime,
    isWechatChatId,
    resolveChannel,
    extractWorkspaceTitle,
    getPresentationReplyAnchor,
    trackMessageSession,
    sessionLastReplyAt,
    ackOnReply,
    stopSessionProgress: (sk) => stopProgressRef.fn(sk),
    logPresentationFailed: logPresentationFailedOrdering,
    sessionProgressMap,
    sessionGetReactedIds,
    mergeBatchBySession,
    mergeCardRegistry,
    getSessionAgentPhase: (sk) => orchestratorApi.getSessionAgentPhase(sk),
    getSessionUnclaimedCount,
    getSessionPendingCount,
    replaceSessionUnclaimedMessages,
    formatMergeBody: formatMergeBody as PresentationHandlerDeps["formatMergeBody"],
    isTerminalMergePhase: isTerminalMergePhase as (phase: string) => boolean,
    renderMergeBatchCardForSession: renderMergeBatchCardForSession as PresentationHandlerDeps["renderMergeBatchCardForSession"],
    replyToMessage,
    addReactionToMessages,
  });
  stopProgressRef.fn = (sk) => presentationApi.stopSessionProgress(sk);

  const { adminCrudRoutes, adminEntityRoutes } = createAdminCrudRoutes({
    log,
    workspaceDir: WORKSPACE_DIR,
    tasksFile: TASKS_FILE,
    channels,
    activeSessionMap,
    sessionToChatMap,
    readBody,
    json,
    clearFileQueue,
    pushCommandToQueue,
  });

  handleAdminApiRef = createAdminApiHandler({
    log,
    pkgVersion: PKG_VERSION,
    daemonPort,
    lastMcpRequestTime,
    activeMcpConnections,
    readBody,
    json,
    readTasks: readTasksFile,
    getChannelStatusList,
    getFileQueueLength: getFileQueueLength,
    getSessionAgentPhase: (sk) => orchestratorApi.getSessionAgentPhase(sk),
    setSessionAgentPhase: (sk, phase) => orchestratorApi.setSessionAgentPhase(sk, phase),
    mergeBatchBySession,
    isTerminalMergePhase: isTerminalMergePhase as (phase: string) => boolean,
    renderMergeBatchCardForSession: renderMergeBatchCardForSession as (batch: { sessionKey: string; phase: string }) => Promise<void>,
    flushReadyMergeBatches,
    scheduleAgentDispatch: (sk) => orchestratorApi.scheduleAgentDispatch(sk),
    handleMergeBatchAction,
    performClaimAndMerge,
    resolveChannel,
    extractWorkspaceTitle,
    trackMessageSession,
    sessionLastReplyAt,
    ackOnReply,
    stopSessionProgress,
    handlePresentationEvent: (body) => presentationApi.handlePresentationEvent(body),
    handleStreamText: (body) => presentationApi.handleStreamText(body as Parameters<typeof presentationApi.handleStreamText>[0]),
    forwardElectronAgentApi: orchestratorApi.forwardElectronAgentApi,
    parseBusyRetryDelayMs: orchestratorApi.parseBusyRetryDelayMs,
    scheduleBusyRetry: orchestratorApi.scheduleBusyRetry,
    notifySessionUser: orchestratorApi.notifySessionUser,
    formatOrchestratorFailure: orchestratorApi.formatOrchestratorFailure,
    ackMessages,
    getEarliestMessageTime,
    setActiveSession,
    activeSessionMap,
    fallbackSessionMap,
    sseClients,
    channels,
    parseChatKey,
    adminCrudRoutes,
    adminEntityRoutes,
  });
}

export async function daemonMain(): Promise<void> {
  if (CHANNEL_CONFIGS.length === 0) {
    log("ERROR", "未配置任何消息通道，至少需要启用一个（CLAW_CHANNELS_JSON 为空）");
    process.exit(1);
  }

  log("INFO", `Daemon v${PKG_VERSION} 启动`);
  log("INFO", `workspace: ${WORKSPACE_DIR}`);
  log("INFO", `通道(${CHANNEL_CONFIGS.length}): ${CHANNEL_CONFIGS.map((c) => `${c.name}[${c.type}]`).join(" + ")}`);
  log("INFO", `日志文件: ${LOG_FILE_PATH}`);

  const cleanup = () => {
    stopDaemonScheduledTasks();
    removeLockFile();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", removeLockFile);

  // 全局兜底：消息桥接守护进程，掉线比带病更糟——漏网异步异常只记录不退出，避免飞书/微信整体掉线
  process.on("uncaughtException", (err) => {
    log("ERROR", `未捕获异常: ${formatUnknownError(err, { includeRegistrationHint: true })}`);
  });
  process.on("unhandledRejection", (reason, promise) => {
    const detail = formatUnknownError(reason, { includeRegistrationHint: true });
    const promiseCtx = promise ? ` | promise=${Object.prototype.toString.call(promise)}` : "";
    log("ERROR", `未处理的 Promise 拒绝: ${detail}${promiseCtx}`);
  });

  initQueue();
  startMediaCacheCleanup();

  wireDaemonSubmodules({ channels, sessionProgressMap, mergeBatchBySession });

  // 超时兜底：Agent 崩溃不再 poll 时，超过 10 分钟的 pendingDone 自动打出
  setInterval(() => {
    const now = Date.now();
    for (const [sk, map] of pendingDoneReactions) {
      const expired = [...map.entries()].filter(([, t]) => now - t > PENDING_DONE_TIMEOUT_MS);
      if (expired.length === 0) continue;
      for (const [mid] of expired) map.delete(mid);
      addReactionToMessages(expired.map(([mid]) => mid), sk, "DONE");
      log("INFO", `超时自动打 DONE 表情: ${expired.length} 条, session=${sk}`);
      if (map.size === 0) pendingDoneReactions.delete(sk);
    }
  }, 60_000).unref();

  for (const cfg of CHANNEL_CONFIGS) {
    const rt: ChannelRuntime = { cfg, lastP2pChatId: null, bindArmed: false };
    channels.set(cfg.id, rt);
    if (cfg.type === "feishu") {
      startFeishuChannel(rt).catch((e: any) => {
        log("ERROR", `[${cfg.name}] 飞书通道启动失败: ${e?.message ?? e}`);
      });
    } else {
      loadWechatState(rt);
      rt.wechat = initWeChatChannel(rt);
      rt.wechat.start(cfg.wechatToken, cfg.wechatAccountId).catch((e: any) => {
        log("WARN", `[WeChat:${cfg.name}] 启动失败: ${e?.message ?? e}`);
      });
    }
  }

  daemonPort = await startDaemonHttpServer({
    log,
    pkgVersion: PKG_VERSION,
    configuredPort: CONFIGURED_PORT,
    readBody,
    json,
    handleAdminApi: handleAdminApiRef,
    activeMcpConnections,
    lastMcpRequestTime,
    getChannelStatusList,
    getFileQueueLength,
    getFileQueueMessages,
    deleteFileQueueMessage: deleteFileQueueMessage,
    stopDaemonScheduledTasks,
    removeLockFile,
    cleanExpiredCommands,
    channels,
    channelDefaultChatId: channelDefaultChatId as HttpServerDeps["channelDefaultChatId"],
    isChannelConnected: isChannelConnected as (rt: unknown) => boolean,
    pushMessage,
    clearFileQueue,
    claimNextMessage,
    trackMessageSession,
    getDistinctSessions,
    getPendingCommands,
    claimCommand,
    replyToMessage,
  });
  process.env.LARK_DAEMON_PORT = String(daemonPort);
  writeLockFile(daemonPort);
  log("INFO", "MCP 服务已就绪 (/mcp + /mcp-admin)");

  setDaemonSchedulerLogger((msg) => { log("INFO", msg); });
  startDaemonScheduledTasks(
    (task, content) => {
      const rt = pickChannel(task.channelId);
      const target = rt ? channelDefaultChatId(rt) : null;
      if (rt && target) {
        pushMessage(content, `internal_${task.id}_${Date.now()}`, makeChatKey(rt.cfg.id, target), "p2p").catch((e: unknown) =>
          log("WARN", `定时任务「${task.name}」入队失败: ${e instanceof Error ? e.message : e}`),
        );
      } else {
        log("WARN", `定时任务「${task.name}」消息无法入队: 通道无主用户且无私聊记录`);
      }
    },
    (task, content) => {
      const rt = pickChannel(task.channelId);
      const target = rt ? channelDefaultChatId(rt) : null;
      const notifyChatKey = rt && target ? makeChatKey(rt.cfg.id, target) : undefined;
      // 任务会话 → 通知目标映射，供 send_text(session_key=taskId) 精确回投
      if (notifyChatKey) sessionToChatMap.set(task.id, notifyChatKey);
      const payload = JSON.stringify({
        taskId: task.id, taskName: task.name, content,
        channelId: rt?.cfg.id, model: task.model, modelParams: task.modelParams,
      });
      process.stdout.write(`__IND_LAUNCH__:${payload}\n`);
    },
  );

  log("INFO", `Daemon 就绪 ✓ port=${daemonPort}`);
}

