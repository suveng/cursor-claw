/**
 * Daemon 薄组装入口（批2）。硬门槛 ≤200：工厂组装 + daemonMain 冷启动。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { stopDaemonScheduledTasks } from "./daemon-scheduled-tasks.js";
import { stripProxyEnv } from "../bridge/lark-core.js";
import type { QueueMessageMeta } from "../bridge/file-queue.js";
import { formatUnknownError } from "../shared/format-unknown-error.js";
import type { DaemonChannelConfig } from "../shared/channel-types.js";
import { fallbackSessionMap } from "./daemon-session-routing.js";
import {
  loadSessionRoutingInto, scheduleSessionRoutingPersist, startSessionRoutingPruneTimer,
} from "./daemon-session-routing-persist.js";
import { createDaemonLogger, markDaemonStderrBroken } from "./daemon-logging.js";
import { isBrokenPipeError } from "../shared/is-broken-pipe-error.js";
import { createQueueController } from "./daemon-queue.js";
import {
  createChannelRegistry, replyViaResolvedChannel, type ChannelRuntime,
} from "./daemon-channel.js";
import { createSessionMaps } from "./daemon-session-maps.js";
import { createSlashCommandRouter, getSlashExecMode } from "./daemon-slash-command-router.js";
import { readBody, json, httpJson, makeLocalDaemonUrl } from "./daemon-http-utils.js";
import { wireDaemonSubmodules, type DaemonWireDeps } from "./daemon-wire.js";
import {
  clearFileQueue as clearFileQueueImpl, createLockHelpers, startMediaCacheCleanup,
  startChannelsHttpAndScheduler,
} from "./daemon-bootstrap.js";
import { startDaemonParentWatch } from "./daemon-parent-watch.js";
import type { PresentationHandlerApi } from "./daemon-presentation-handlers.js";
import type { SlashExecutorDeps } from "./daemon-slash-executor.js";

const _require = createRequire(import.meta.url);
const PKG_VERSION = (_require("../../package.json") as { version: string }).version;
const ENCRYPT_KEY = process.env.LARK_ENCRYPT_KEY ?? "";
const CONFIGURED_PORT = process.env.LARK_DAEMON_PORT ? Number(process.env.LARK_DAEMON_PORT) : 0;
const WORKSPACE_DIR = process.env.LARK_WORKSPACE_DIR ?? process.cwd();
const MESSAGE_PREFIX = process.env.LARK_MESSAGE_PREFIX ?? "";
const APP_DATA_DIR = process.env.APP_DATA_DIR || "";
const TASKS_FILE = path.join(APP_DATA_DIR, "scheduled-tasks.json");
function parseChannelConfigs(): DaemonChannelConfig[] {
  try {
    const raw = process.env.CLAW_CHANNELS_JSON ?? "";
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as DaemonChannelConfig[]) : [];
  } catch { return []; }
}
const CHANNEL_CONFIGS = parseChannelConfigs();
stripProxyEnv();

const { log, logFilePath: LOG_FILE_PATH } = createDaemonLogger();
let daemonPort = 0;
let presentationApi: PresentationHandlerApi | null = null;
let slashExecutorDeps: SlashExecutorDeps | null = null;
const scheduleAgentDispatchRef = { current: (_sk?: string) => {} };
const localDaemonUrl = makeLocalDaemonUrl(() => daemonPort);
const { writeLockFile, removeLockFile } = createLockHelpers({
  appDataDir: APP_DATA_DIR, pkgVersion: PKG_VERSION, workspaceDir: WORKSPACE_DIR,
});
const presentationFwd = {
  remember: (sk: string, ct: string) => presentationApi?.rememberSessionChatType(sk, ct),
  confirm: (mid: string, sk: string, cid?: string) => presentationApi!.confirmEnqueueAndStartProgress(mid, sk, cid),
  tryPreview: (...a: [string | undefined, string, string, string, string, string?, QueueMessageMeta?]) =>
    presentationApi!.tryHandleMergePreviewReply(...a),
  stop: (sk: string) => presentationApi?.stopSessionProgress(sk),
  recordGet: (sk: string, ids: string[]) => presentationApi?.recordGetReactions(sk, ids),
  clearGet: (sk: string, ids: string[]) => presentationApi?.clearGetReactions(sk, ids),
  eligible: (sk: string) => presentationApi?.ordering.isMainUserP2pEligible(sk) ?? false,
  phase: (_sk: string) => undefined as string | undefined,
  statusText: (sk: string, n: number) => presentationApi?.buildEnqueueStatusText(sk, n) ?? "已收到",
  chatType: (sk: string) => presentationApi?.ordering.resolveSessionChatType(sk),
};

const sessions = createSessionMaps({
  log, resolveChannel: (sk) => resolveChannel(sk),
  resolveSessionChatType: (sk) => presentationFwd.chatType(sk) ?? undefined,
  recordGetReactions: (sk, ids) => presentationFwd.recordGet(sk, ids),
});
const {
  activeSessionMap, sessionToChatMap, sessionLastReplyAt, sessionProgressMap, sessionGetReactedIds,
  sessionChatTypeMap, enqueuePendingDone, flushPendingDone, setActiveSession, clearActiveSession,
  resolveRawChatId, extractWorkspaceTitle, trackMessageSession, collectFreshAndTrack,
  addReactionToMessages, applyPollGetReactions, resolveRoutingKey, sweepPendingDoneTimeouts,
} = sessions;

const channelReg = createChannelRegistry({
  log, workspaceDir: WORKSPACE_DIR, appDataDir: APP_DATA_DIR, messagePrefix: MESSAGE_PREFIX,
  encryptKey: ENCRYPT_KEY, httpJson, resolveRawChatId,
  pushMessage: (...a) => pushMessage(...a), handleCommand: (...a) => handleCommand(...a),
  replyToMessage: (...a) => replyToMessage(...a), isCommand: (t) => isCommand(t),
  handleMergeBatchAction: (...a) => handleMergeBatchAction(...a),
  tryHandleMergePreviewReply: (...a) => presentationFwd.tryPreview(...a),
});
const {
  channels, channelWorkspaceDir, isChannelConnected, getChannelStatusList, channelDefaultChatId,
  pickChannel, resolveChannel, resolveChannelRuntime, startFeishuChannel, initWeChatChannel, isWechatChatId,
} = channelReg;

const queue = createQueueController({
  log, scheduleAgentDispatchRef, channels, workspaceDir: WORKSPACE_DIR,
  channelWorkspaceDir: (rt) => channelWorkspaceDir(rt as ChannelRuntime),
  resolveRoutingKey, setActiveSession,
  rememberSessionChatType: (sk, ct) => presentationFwd.remember(sk, ct),
  confirmEnqueueAndStartProgress: (mid, sk, cid) => presentationFwd.confirm(mid, sk, cid),
  addReactionToMessages, recordGetReactions: (sk, ids) => presentationFwd.recordGet(sk, ids),
  clearGetReactions: (sk, ids) => presentationFwd.clearGet(sk, ids),
  stopSessionProgress: (sk) => presentationFwd.stop(sk), enqueuePendingDone, flushPendingDone,
  isMergeBatchEligible: (sk) => presentationFwd.eligible(sk),
  getSessionAgentPhase: (sk) => presentationFwd.phase(sk),
  buildEnqueueStatusText: (sk, n) => presentationFwd.statusText(sk, n),
  resolveChannel: (sk) => {
    const ch = resolveChannel(sk);
    return ch.type === "feishu"
      ? { type: "feishu", chatId: ch.chatId, sender: ch.rt.sender }
      : { type: ch.type };
  },
  trackMessageSession, collectFreshAndTrack, applyPollGetReactions,
  resolveSessionChatType: (sk) => presentationFwd.chatType(sk),
});
const {
  sseClients, initQueue, pushMessage, ackOnReply, mergeBatchBySession, mergeCardRegistry,
  performClaimAndMerge, handleMergeBatchAction, flushReadyMergeBatches, clearMergeBatchState,
  applyMergeOverrideForPoll, shouldDeferDispatch, isMergeDispatchAllowed, formatMergeBody,
  isTerminalMergePhase, renderMergeBatchCardForSession,
} = queue;

const replyToMessage = (mid: string, text: string, chatId?: string) =>
  replyViaResolvedChannel(log, resolveChannel, mid, text, chatId);
const slash = createSlashCommandRouter({
  log, handleMergeBatchAction, replyToMessage, getSlashExecutorDeps: () => slashExecutorDeps,
});
const {
  handleCommand, isCommand, pushCommandToQueue, getPendingCommands, claimCommand, cleanExpiredCommands,
  pruneSlashExecutedMessageIds, isSlashMessageIdExecuted, listSlashExecutedMessageIds,
} = slash;
const clearFileQueue = () => clearFileQueueImpl(log);
const readTasksFile = (): Array<{ enabled: boolean }> => {
  try {
    if (!fs.existsSync(TASKS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
};

/** 冷启动：logger→queue→routing→wire→channel/http/scheduler */
export async function daemonMain(): Promise<void> {
  if (CHANNEL_CONFIGS.length === 0) {
    log("ERROR", "未配置任何消息通道，至少需要启用一个（CLAW_CHANNELS_JSON 为空）");
    process.exit(1);
  }
  for (const line of [
    `Daemon v${PKG_VERSION} 启动`, `workspace: ${WORKSPACE_DIR}`,
    `SLASH_EXEC_MODE=${getSlashExecMode()}`,
    `通道(${CHANNEL_CONFIGS.length}): ${CHANNEL_CONFIGS.map((c) => `${c.name}[${c.type}]`).join(" + ")}`,
    `日志文件: ${LOG_FILE_PATH}`,
  ]) log("INFO", line);
  // 父进程监护：Electron 强杀时 stdin 断管 / ppid 消失后自退出
  startDaemonParentWatch({
    log,
    removeLockFile,
    stopScheduledTasks: stopDaemonScheduledTasks,
  });
  const cleanup = () => { stopDaemonScheduledTasks(); removeLockFile(); process.exit(0); };
  process.on("SIGINT", cleanup); process.on("SIGTERM", cleanup); process.on("exit", removeLockFile);
  // EPIPE：stderr 断管时写日志会再次抛错；深度计数防 finally 过早清零导致重入
  let loggingUncaughtDepth = 0;
  process.on("uncaughtException", (err) => {
    if (isBrokenPipeError(err)) {
      markDaemonStderrBroken();
      return;
    }
    if (loggingUncaughtDepth > 0) return;
    loggingUncaughtDepth++;
    try {
      log("ERROR", `未捕获异常: ${formatUnknownError(err, { includeRegistrationHint: true })}`);
    } catch {
      /* 写日志失败不向外抛，避免二次 uncaught */
    } finally {
      loggingUncaughtDepth--;
    }
  });
  process.on("unhandledRejection", (reason, promise) => {
    if (isBrokenPipeError(reason)) {
      markDaemonStderrBroken();
      return;
    }
    if (loggingUncaughtDepth > 0) return;
    loggingUncaughtDepth++;
    try {
      log("ERROR", `未处理的 Promise 拒绝: ${formatUnknownError(reason, { includeRegistrationHint: true })}${promise ? ` | promise=${Object.prototype.toString.call(promise)}` : ""}`);
    } catch {
      /* 写日志失败不向外抛 */
    } finally {
      loggingUncaughtDepth--;
    }
  });
  initQueue(); startMediaCacheCleanup(log);
  // 冷启动仅重建反向索引：touch:false 禁止 mark/schedule，避免全员续命（R1）
  const routingLoad = loadSessionRoutingInto(
    activeSessionMap,
    fallbackSessionMap,
    (chatId, sessionKey) => setActiveSession(chatId, sessionKey, { touch: false }),
  );
  if (!routingLoad.ok) log("WARN", `session_routing_load_failed: ${routingLoad.error}`);
  else if (routingLoad.pruned > 0) {
    log("INFO", `session_routing_pruned: ${routingLoad.pruned}`);
    scheduleSessionRoutingPersist(activeSessionMap, fallbackSessionMap);
  }
  startSessionRoutingPruneTimer(activeSessionMap, fallbackSessionMap);

  const wired = wireDaemonSubmodules({
    log, appDataDir: APP_DATA_DIR, workspaceDir: WORKSPACE_DIR, pkgVersion: PKG_VERSION,
    tasksFile: TASKS_FILE, daemonPort, getDaemonPort: () => daemonPort, httpJson, localDaemonUrl,
    readBody, json, channels, getChannelStatusList, activeSessionMap, sessionToChatMap,
    sessionChatTypeMap, sessionLastReplyAt, sessionProgressMap, sessionGetReactedIds, sseClients,
    mergeBatchBySession, mergeCardRegistry, shouldDeferDispatch, performClaimAndMerge,
    flushReadyMergeBatches, applyMergeOverrideForPoll, clearMergeBatchState, formatMergeBody,
    isTerminalMergePhase, renderMergeBatchCardForSession, isMergeDispatchAllowed, handleMergeBatchAction,
    collectFreshAndTrack, applyPollGetReactions, setActiveSession, clearActiveSession,
    resolveChannelRuntime, resolveChannel, extractWorkspaceTitle, trackMessageSession, replyToMessage,
    addReactionToMessages, ackOnReply, clearFileQueue, pushCommandToQueue, getSlashExecMode,
    isWechatChatId, readTasksFile, scheduleAgentDispatchRef, activeMcpConnections: 0, lastMcpRequestTime: 0,
    pruneSlashExecutedMessageIds, isSlashMessageIdExecuted, listSlashExecutedMessageIds,
  } as unknown as DaemonWireDeps);
  presentationApi = wired.presentationApi;
  slashExecutorDeps = wired.slashExecutorDeps;
  presentationFwd.phase = (sk) => wired.getSessionAgentPhase(sk);
  setInterval(() => sweepPendingDoneTimeouts(), 60_000).unref();

  const port = await startChannelsHttpAndScheduler({
    log, pkgVersion: PKG_VERSION, configuredPort: CONFIGURED_PORT, channelConfigs: CHANNEL_CONFIGS,
    channels, startFeishuChannel, initWeChatChannel, pickChannel, channelDefaultChatId,
    isChannelConnected, getChannelStatusList, pushMessage, trackMessageSession, sessionToChatMap,
    replyToMessage, readBody, json, handleAdminApi: wired.handleAdminApiRef, activeMcpConnections: 0,
    lastMcpRequestTime: 0, cleanExpiredCommands, getPendingCommands, claimCommand, clearFileQueue,
    removeLockFile, writeLockFile, setDaemonPort: (p) => { daemonPort = p; },
  });
  log("INFO", `Daemon 就绪 ✓ port=${port}`);
}
