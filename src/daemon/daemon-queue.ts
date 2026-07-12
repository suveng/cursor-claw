/**
 * 文件队列编排 facade：SSE、initQueue、pushMessage、ackOnReply，并组装 MergeBatch。
 * 经 scheduleAgentDispatchRef 断开 queue↔orchestrator 环；禁止 import presentation/orchestrator。
 */
import * as http from "node:http";
import {
  initFileQueue,
  pushToFileQueue,
  ackMessages,
  cleanupStaleMessages,
  cleanupOrphanClaimedOnColdStart,
  claimSessionMessages,
  getSessionPendingCount,
  getSessionUnclaimedCount,
  listUnclaimedMessages,
  replaceSessionUnclaimedMessages,
  type QueueMessage,
  type QueueMessageMeta,
} from "../bridge/file-queue.js";
import { parseChatKey, type DaemonChannelConfig } from "../shared/channel-types.js";
import { resolveLaunchChatName } from "./chat-name-resolve.js";
import { createMergeBatchController } from "./daemon-queue-merge.js";
import type { MergeCardChannel } from "./daemon-queue-merge-card.js";

/** 通道最小形态（pushMessage 选 workspace / 拉名） */
export interface QueueChannelRuntime {
  cfg: DaemonChannelConfig;
}

export interface QueueControllerDeps {
  log: (level: string, ...args: unknown[]) => void;
  /** orchestrator 注入后改写；初始空操作 */
  scheduleAgentDispatchRef: { current: (sessionKey?: string) => void };
  channels: Map<string, QueueChannelRuntime>;
  workspaceDir: string;
  channelWorkspaceDir: (rt: QueueChannelRuntime) => string;
  resolveRoutingKey: (chatId?: string, replyMessageId?: string) => string | undefined;
  setActiveSession: (chatId: string, sessionKey: string) => void;
  rememberSessionChatType: (sessionKey: string, chatType: string) => void;
  confirmEnqueueAndStartProgress: (messageId: string, sessionKey: string, chatId?: string) => Promise<void>;
  addReactionToMessages: (messageIds: string[], sessionKey: string, emojiType?: string) => void;
  recordGetReactions: (sessionKey: string, messageIds: string[]) => void;
  clearGetReactions: (sessionKey: string, messageIds: string[]) => void;
  stopSessionProgress: (sessionKey: string) => void;
  enqueuePendingDone: (sessionKey: string, messageIds: string[]) => void;
  flushPendingDone: (sessionKey: string) => void;
  // MergeBatch deps
  isMergeBatchEligible: (sessionKey: string) => boolean;
  getSessionAgentPhase: (sessionKey: string) => string | undefined;
  buildEnqueueStatusText: (sessionKey: string, pending: number) => string;
  resolveChannel: (sessionKey: string) => MergeCardChannel;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  collectFreshAndTrack: (messages: QueueMessage[], sessionKey: string) => string[];
  applyPollGetReactions: (freshIds: string[], sessionKey: string) => void;
  resolveSessionChatType: (sessionKey: string) => string | undefined;
}

/** 组装 queue + merge；对外一次暴露 */
export function createQueueController(deps: QueueControllerDeps) {
  const sseClients = new Set<http.ServerResponse>();

  function broadcastQueueEvent(chatId?: string): void {
    const data = JSON.stringify({ type: "queue-update", chatId: chatId ?? null, ts: Date.now() });
    for (const res of sseClients) {
      try {
        res.write(`data: ${data}\n\n`);
      } catch {
        sseClients.delete(res);
      }
    }
    deps.scheduleAgentDispatchRef.current(chatId);
  }

  const merge = createMergeBatchController({
    log: deps.log,
    isMergeBatchEligible: deps.isMergeBatchEligible,
    getSessionAgentPhase: deps.getSessionAgentPhase,
    buildEnqueueStatusText: deps.buildEnqueueStatusText,
    resolveChannel: deps.resolveChannel,
    trackMessageSession: deps.trackMessageSession,
    broadcastQueueEvent,
    collectFreshAndTrack: deps.collectFreshAndTrack,
    applyPollGetReactions: deps.applyPollGetReactions,
    listUnclaimedMessages,
    getSessionUnclaimedCount,
    getSessionPendingCount,
    claimSessionMessages,
    replaceSessionUnclaimedMessages,
    resolveSessionChatType: deps.resolveSessionChatType,
  });

  function initQueue(): void {
    const dir = initFileQueue();
    deps.log("INFO", `共享文件队列: ${dir}`);
    cleanupStaleMessages();
    const reclaimed = cleanupOrphanClaimedOnColdStart();
    if (reclaimed > 0) {
      deps.log("INFO", `冷启动回收遗留 claimed→qmsg: ${reclaimed} 条`);
    }
  }

  /**
   * Agent 回复确认（ack）：删除该 message_id 及更早的未确认消息。
   * DONE 表情在 ack 时打出。
   */
  function ackOnReply(messageId?: string, sessionKey?: string): void {
    if (!messageId) return;
    const acked = ackMessages(messageId, sessionKey);
    if (acked.length === 0) return;
    deps.log("INFO", `回复确认 ${acked.length} 条消息: session=${sessionKey ?? "?"} (via ${messageId})`);
    if (sessionKey) {
      deps.enqueuePendingDone(sessionKey, acked);
      deps.flushPendingDone(sessionKey);
      broadcastQueueEvent(sessionKey);
      deps.clearGetReactions(sessionKey, acked);
      deps.stopSessionProgress(sessionKey);
      merge.clearMergeBatchState(sessionKey);
    }
  }

  /**
   * 写入文件队列。入队前按 chat_type 解析名称并 append `\ngroup_name: <名称>`；
   * 无名/失败保持原文，WARN 不阻断入队。
   */
  async function pushMessage(
    content: string,
    messageId?: string,
    chatId?: string,
    chatType?: string,
    senderOpenId?: string,
    replyMessageId?: string,
    meta?: QueueMessageMeta,
  ): Promise<void> {
    if (!content?.trim()) {
      deps.log("WARN", `丢弃空消息 (messageId=${messageId})`);
      return;
    }
    let routedId = deps.resolveRoutingKey(chatId, replyMessageId);
    if (routedId && routedId === chatId && chatType === "p2p" && !routedId.includes("::")) {
      const { channelId } = parseChatKey(chatId!);
      const rt = channelId ? deps.channels.get(channelId) : undefined;
      const wsDir = rt ? deps.channelWorkspaceDir(rt) : deps.workspaceDir;
      if (wsDir) {
        const defaultSessionKey = `${chatId}::${wsDir}`;
        deps.setActiveSession(chatId!, defaultSessionKey);
        routedId = defaultSessionKey;
      }
    }

    let queueContent = content;
    if (chatType) {
      try {
        const resolvedName = await resolveLaunchChatName({
          chatType,
          chatId: chatId ?? "",
          senderOpenId,
          channels: deps.channels,
          logWarn: (msg) => deps.log("WARN", msg),
        });
        if (resolvedName) {
          queueContent = `${content}\ngroup_name: ${resolvedName}`;
          deps.log("INFO", `group_name_inject: ok chat=${chatId ?? "none"} type=${chatType} name=${resolvedName}`);
        } else {
          deps.log("WARN", `group_name_inject: omit chat=${chatId ?? "none"} type=${chatType} reason=no_name`);
        }
      } catch (e: unknown) {
        deps.log(
          "WARN",
          `入队前名称解析异常 messageId=${messageId ?? "none"}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const fullMeta: QueueMessageMeta = { ...(meta || {}) };
    if (chatType) fullMeta.chatType = chatType;
    if (senderOpenId) fullMeta.senderOpenId = senderOpenId;
    const written = pushToFileQueue(
      queueContent,
      messageId,
      `daemon-${process.pid}`,
      routedId,
      false,
      Object.keys(fullMeta).length > 0 ? fullMeta : undefined,
    );
    if (written) {
      if (routedId && fullMeta.chatType) deps.rememberSessionChatType(routedId, fullMeta.chatType);
      deps.log(
        "INFO",
        `消息已写入共享队列: ${JSON.stringify(queueContent)} (id=${messageId ?? "none"}, chat=${chatId ?? "none"}${routedId !== chatId ? ` → routed=${routedId}` : ""}${replyMessageId ? `, reply=${replyMessageId}` : ""})`,
      );
      broadcastQueueEvent(routedId);
      if (messageId && !messageId.startsWith("internal_") && routedId) {
        if (fullMeta.chatType === "p2p") {
          merge.onMessageEnqueued(routedId, messageId, chatId, fullMeta.chatType, senderOpenId);
        }
        if (merge.shouldSendEnqueueF1(routedId)) {
          deps.confirmEnqueueAndStartProgress(messageId, routedId, chatId).catch((e: unknown) => {
            deps.log("WARN", `入队确认/进度启动失败: ${e instanceof Error ? e.message : e}`);
          });
        } else if (messageId) {
          deps.addReactionToMessages([messageId], routedId, "Get");
          deps.recordGetReactions(routedId, [messageId]);
        }
      }
    } else {
      deps.log("INFO", `消息已跳过（重复或写入失败）: id=${messageId ?? "none"}`);
    }
  }

  return {
    sseClients,
    broadcastQueueEvent,
    initQueue,
    pushMessage,
    ackOnReply,
    ...merge,
  };
}
