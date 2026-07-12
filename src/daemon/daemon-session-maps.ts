/**
 * 会话路由映射、messageId 追踪、Get/DONE 表情与 pendingDone。
 * 经 createSessionMaps 注入 channel.resolve；禁止 import presentation/orchestrator。
 */
import { parseChatKey } from "../shared/channel-types.js";
import {
  clearActiveTouched,
  markActiveTouched,
  scheduleSessionRoutingPersist,
} from "./daemon-session-routing-persist.js";
import { fallbackSessionMap } from "./daemon-session-routing.js";
import type { QueueMessage } from "../bridge/file-queue.js";
import type { SessionProgressState } from "./daemon-presentation-ordering.js";

export interface SessionMapsDeps {
  log: (level: string, ...args: unknown[]) => void;
  resolveChannel: (sessionKey?: string) =>
    | { type: "feishu"; rt: { sender?: { addReaction: (mid: string, emoji: string) => Promise<unknown> } } }
    | { type: string };
  resolveSessionChatType: (sessionKey: string) => string | undefined;
  recordGetReactions: (sessionKey: string, messageIds: string[]) => void;
}

export function createSessionMaps(deps: SessionMapsDeps) {
  const activeSessionMap = new Map<string, string>();
  const messageSessionMap = new Map<string, string>();
  const sessionToChatMap = new Map<string, string>();
  const MSG_SESSION_MAP_MAX = 5000;
  const sessionLastReplyAt = new Map<string, number>();
  const sessionProgressMap = new Map<string, SessionProgressState>();
  const sessionGetReactedIds = new Map<string, Set<string>>();
  const sessionChatTypeMap = new Map<string, string>();
  const pendingDoneReactions = new Map<string, Map<string, number>>();
  const PENDING_DONE_TIMEOUT_MS = 10 * 60 * 1000;

  function enqueuePendingDone(sessionKey: string, messageIds: string[]): void {
    const now = Date.now();
    let map = pendingDoneReactions.get(sessionKey);
    if (!map) {
      map = new Map();
      pendingDoneReactions.set(sessionKey, map);
    }
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
    deps.log("INFO", `打 DONE 表情: ${ids.length} 条, session=${sessionKey}`);
  }

  /**
   * 绑定 active 映射并维护反向索引。
   * @param opts.touch 默认 true（运行期触达续期）；冷启动 load 须传 false，禁止 mark/schedule
   */
  function setActiveSession(
    chatId: string,
    sessionKey: string,
    opts?: { touch?: boolean },
  ): void {
    activeSessionMap.set(chatId, sessionKey);
    sessionToChatMap.set(sessionKey, chatId);
    // 冷启动重建反向索引：与触达 mark 解耦（R1）
    if (opts?.touch === false) return;
    // 仅本键续期；须在 schedule 之前 mark，避免写盘保真读到旧戳
    markActiveTouched(chatId);
    scheduleSessionRoutingPersist(activeSessionMap, fallbackSessionMap);
    deps.log("INFO", `会话路由更新: ${chatId} → ${sessionKey}`);
  }

  function clearActiveSession(chatId: string): void {
    const sessionKey = activeSessionMap.get(chatId);
    activeSessionMap.delete(chatId);
    if (sessionKey) sessionToChatMap.delete(sessionKey);
    // 清除旁路 touch，避免孤儿键；须在 schedule 之前
    clearActiveTouched(chatId);
    scheduleSessionRoutingPersist(activeSessionMap, fallbackSessionMap);
    deps.log("INFO", `会话路由清除: ${chatId}`);
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
    if (deps.resolveSessionChatType(sessionKey) === "p2p") return undefined;
    const idx = sessionKey.indexOf("::");
    if (idx < 0) return undefined;
    const wsDir = sessionKey.slice(idx + 2);
    if (!wsDir) return undefined;
    const name = wsDir.replace(/\\/g, "/").split("/").filter(Boolean).pop();
    return name || undefined;
  }

  function trackMessageSession(messageId: string, sessionKey: string): void {
    if (!messageId || !sessionKey) return;
    if (messageSessionMap.size >= MSG_SESSION_MAP_MAX) {
      const oldest = messageSessionMap.keys().next().value;
      if (oldest) messageSessionMap.delete(oldest);
    }
    messageSessionMap.set(messageId, sessionKey);
  }

  function collectFreshAndTrack(messages: QueueMessage[], sessionKey: string): string[] {
    const fresh: string[] = [];
    for (const m of messages) {
      if (!m.messageId) continue;
      if (!messageSessionMap.has(m.messageId)) fresh.push(m.messageId);
      trackMessageSession(m.messageId, sessionKey);
    }
    return fresh;
  }

  function addReactionToMessages(
    messageIds: string[],
    sessionKey: string,
    emojiType = "Get",
  ): void {
    const ch = deps.resolveChannel(sessionKey);
    if (ch.type !== "feishu" || !("rt" in ch) || !ch.rt.sender) return;
    const sender = ch.rt.sender;
    for (const mid of messageIds) {
      if (mid) sender.addReaction(mid, emojiType).catch(() => {});
    }
  }

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
    deps.recordGetReactions(sessionKey, ids);
  }

  function resolveRoutingKey(chatId?: string, replyMessageId?: string): string | undefined {
    if (replyMessageId) {
      const sk = messageSessionMap.get(replyMessageId);
      if (sk) {
        const skChannel = parseChatKey(
          sk.includes("::") ? sk.slice(0, sk.indexOf("::")) : sk,
        ).channelId;
        const msgChannel = chatId ? parseChatKey(chatId).channelId : undefined;
        if (!skChannel || !msgChannel || skChannel === msgChannel) {
          deps.log("INFO", `路由命中 messageId 映射: ${replyMessageId} → ${sk}`);
          return sk;
        }
        deps.log(
          "INFO",
          `messageId 映射跨通道(${skChannel}→${msgChannel})，忽略: ${replyMessageId}`,
        );
      }
    }
    if (!chatId) return undefined;
    return activeSessionMap.get(chatId) ?? chatId;
  }

  /** 超时未 ack 的 DONE 表情扫描（daemonMain 定时器调用） */
  function sweepPendingDoneTimeouts(): void {
    const now = Date.now();
    for (const [sk, map] of pendingDoneReactions) {
      const expired = [...map.entries()].filter(([, ts]) => now - ts > PENDING_DONE_TIMEOUT_MS);
      if (expired.length === 0) continue;
      for (const [mid] of expired) map.delete(mid);
      addReactionToMessages(
        expired.map(([mid]) => mid),
        sk,
        "DONE",
      );
      deps.log("INFO", `超时自动打 DONE 表情: ${expired.length} 条, session=${sk}`);
      if (map.size === 0) pendingDoneReactions.delete(sk);
    }
  }

  return {
    activeSessionMap,
    messageSessionMap,
    sessionToChatMap,
    sessionLastReplyAt,
    sessionProgressMap,
    sessionGetReactedIds,
    sessionChatTypeMap,
    pendingDoneReactions,
    enqueuePendingDone,
    flushPendingDone,
    setActiveSession,
    clearActiveSession,
    resolveRawChatId,
    extractWorkspaceTitle,
    trackMessageSession,
    collectFreshAndTrack,
    addReactionToMessages,
    applyPollGetReactions,
    resolveRoutingKey,
    sweepPendingDoneTimeouts,
  };
}
