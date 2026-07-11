// @ts-nocheck — 批1 通道类型与 daemon ChannelRuntime 对齐留批2
/**
 * Presentation handlers 工厂：入队确认、合并预览回复、里程碑降级与 stream/events 组装。
 */

import type { QueueMessageMeta } from "../bridge/file-queue.js";
import { clearMilestoneState } from "./daemon-presentation-milestone.js";
import type { AgentPhase } from "./daemon-orchestrator.js";
import {
  createPresentationOrdering,
  type PresentationOrderingApi,
  type PresentationOrderingDeps,
  type SessionProgressState,
} from "./daemon-presentation-ordering.js";
import { createStreamTextHandler } from "./daemon-presentation-stream.js";
import { createProcessPresentationHandlers } from "./daemon-presentation-process-events.js";
import { createAssistantPresentationHandlers } from "./daemon-presentation-assistant-events.js";
import { MERGE_EDIT_MAX_CHARS } from "./daemon-presentation-types.js";
import type { PresentationEvent, PresentationHandlerCtx } from "./daemon-presentation-types.js";
export type { PresentationEvent, PresentationKind } from "./daemon-presentation-types.js";

/** handlers 层 deps：ordering 子集 + 队列/通道回调（仍驻 daemon） */
export interface PresentationHandlerDeps extends PresentationOrderingDeps {
  sessionProgressMap: Map<string, SessionProgressState>;
  sessionGetReactedIds: Map<string, Set<string>>;
  sessionLastReplyAt: Map<string, number>;
  mergeBatchBySession: Map<string, {
    sessionKey: string;
    phase: string;
    batchId: string;
    overrideText?: string;
    lastInboundMessageId?: string;
    cardMessageId?: string;
    updatedAt: number;
  }>;
  mergeCardRegistry: Map<string, { sessionKey: string; batchId: string }>;
  getSessionAgentPhase: (sessionKey: string) => AgentPhase | undefined;
  getSessionUnclaimedCount: (sessionKey: string) => number;
  getSessionPendingCount: (sessionKey: string) => number;
  listUnclaimedMessages: (sessionKey: string) => Array<{ text: string; meta?: { chatType?: string } }>;
  replaceSessionUnclaimedMessages: (
    sessionKey: string,
    text: string,
    meta: QueueMessageMeta,
  ) => { ok: boolean; error?: string };
  formatMergeBody: (messages: Array<{ text: string }>) => string;
  isTerminalMergePhase: (phase: string) => boolean;
  renderMergeBatchCardForSession: (batch: {
    sessionKey: string;
    phase: string;
    batchId: string;
    overrideText?: string;
    lastInboundMessageId?: string;
    updatedAt: number;
  }) => Promise<void>;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
  addReactionToMessages: (messageIds: string[], sessionKey: string, emojiType?: string) => void;
  ackOnReply: (messageId?: string, sessionKey?: string) => void;
}

export interface PresentationHandlerApi {
  ordering: PresentationOrderingApi;
  rememberSessionChatType: (sessionKey: string, chatType: string) => void;
  handleStreamText: ReturnType<typeof createStreamTextHandler>["handleStreamText"];
  handlePresentationEvent: (body: PresentationEvent) => Promise<{ ok: boolean; outbound_message_id?: string; error?: string }>;
  confirmEnqueueAndStartProgress: (messageId: string, sessionKey: string, chatId?: string) => Promise<void>;
  stopSessionProgress: (sessionKey: string) => void;
  buildEnqueueStatusText: (sessionKey: string, pending: number) => string;
  tryHandleMergePreviewReply: (
    parentId: string | undefined,
    text: string,
    messageId: string,
    chatKey: string,
    chatType: string,
    senderOpenId?: string,
    meta?: QueueMessageMeta,
  ) => Promise<boolean>;
  getPresentationReplyAnchor: (sessionKey: string) => string | undefined;
  logPresentationFailed: (sessionKey: string, kind: string, reason: string) => void;
  recordGetReactions: (sessionKey: string, messageIds: string[]) => void;
  clearGetReactions: (sessionKey: string, messageIds: string[]) => void;
}

export function createPresentationHandlers(deps: PresentationHandlerDeps): PresentationHandlerApi {
  const ordering = createPresentationOrdering(deps);

  function logPresentationFailed(sessionKey: string, kind: string, reason: string): void {
    deps.log("WARN", `presentation_failed session=${sessionKey} kind=${kind} reason=${reason}`);
  }

  function getPresentationReplyAnchor(sessionKey: string): string | undefined {
    const batch = deps.mergeBatchBySession.get(sessionKey);
    if (!batch || deps.isTerminalMergePhase(batch.phase)) return undefined;
    return batch.lastInboundMessageId;
  }

  async function sendMilestonePlainText(sessionKey: string, text: string): Promise<boolean> {
    const ch = deps.resolveChannel(sessionKey);
    if (ch.type === "error") return false;
    const title = deps.extractWorkspaceTitle(sessionKey);
    if (ch.type === "wechat") {
      return ch.rt.wechat!.sendText(ch.chatId, text, { skipTyping: true });
    }
    const sentMsgId = await ch.rt.sender!.sendMessage(text, undefined, ch.chatId, title);
    if (sentMsgId) {
      deps.trackMessageSession(sentMsgId, sessionKey);
      deps.sessionLastReplyAt.set(sessionKey, Date.now());
    }
    return !!sentMsgId;
  }

  function milestoneLogFn(message: string): void {
    deps.log("WARN", message);
  }

  function buildEnqueueStatusText(sessionKey: string, pending: number): string {
    const phase = deps.getSessionAgentPhase(sessionKey) ?? "idle";
    let text: string;
    if (phase === "starting") {
      text = "已收到。正在连接 Agent，你的消息已排队";
    } else if (phase === "processing") {
      text = "已收到。Agent 正在处理上一条，你的消息已排队";
    } else if (pending <= 1) {
      text = "已收到，等待 Agent 领取";
    } else {
      text = "已收到，已加入待处理队列";
    }
    if (pending > 1) text += `（前面还有 ${pending - 1} 条待处理）`;
    return text;
  }

  function getGetReactedIds(sessionKey: string): Set<string> {
    let set = deps.sessionGetReactedIds.get(sessionKey);
    if (!set) {
      set = new Set();
      deps.sessionGetReactedIds.set(sessionKey, set);
    }
    const state = deps.sessionProgressMap.get(sessionKey);
    if (state) state.getReactedMessageIds = set;
    return set;
  }

  function recordGetReactions(sessionKey: string, messageIds: string[]): void {
    const set = getGetReactedIds(sessionKey);
    for (const id of messageIds) {
      if (id) set.add(id);
    }
  }

  function clearGetReactions(sessionKey: string, messageIds: string[]): void {
    const set = deps.sessionGetReactedIds.get(sessionKey);
    if (!set) return;
    for (const id of messageIds) set.delete(id);
    if (set.size === 0) deps.sessionGetReactedIds.delete(sessionKey);
  }

  function stopSessionProgress(sessionKey: string): void {
    const state = deps.sessionProgressMap.get(sessionKey);
    if (!state) return;
    if (state.typingActive) {
      const ch = deps.resolveChannel(sessionKey);
      if (ch.type === "wechat") {
        ch.rt.wechat!.stopProgressTyping(ch.chatId).catch((e: unknown) => {
          deps.log("WARN", `stopProgressTyping 失败: ${e instanceof Error ? e.message : e}`);
        });
      }
    }
    clearMilestoneState(state);
    deps.sessionProgressMap.delete(sessionKey);
  }

  const { handleStreamText } = createStreamTextHandler({
    log: deps.log,
    sessionProgressMap: deps.sessionProgressMap,
    sessionLastReplyAt: deps.sessionLastReplyAt,
    ordering,
    resolveChannel: deps.resolveChannel as StreamHandlerDeps["resolveChannel"],
    extractWorkspaceTitle: deps.extractWorkspaceTitle,
    getPresentationReplyAnchor,
    trackMessageSession: deps.trackMessageSession,
    ackOnReply: deps.ackOnReply,
    stopSessionProgress,
  });

  const ctx: PresentationHandlerCtx = {
    log: deps.log,
    ordering,
    sessionProgressMap: deps.sessionProgressMap,
    sessionGetReactedIds: deps.sessionGetReactedIds,
    sessionLastReplyAt: deps.sessionLastReplyAt,
    mergeBatchBySession: deps.mergeBatchBySession,
    mergeCardRegistry: deps.mergeCardRegistry,
    getSessionAgentPhase: deps.getSessionAgentPhase,
    getSessionUnclaimedCount: deps.getSessionUnclaimedCount,
    getSessionPendingCount: deps.getSessionPendingCount,
    listUnclaimedMessages: deps.listUnclaimedMessages,
    replaceSessionUnclaimedMessages: deps.replaceSessionUnclaimedMessages,
    formatMergeBody: deps.formatMergeBody,
    isTerminalMergePhase: deps.isTerminalMergePhase,
    renderMergeBatchCardForSession: deps.renderMergeBatchCardForSession,
    replyToMessage: deps.replyToMessage,
    addReactionToMessages: deps.addReactionToMessages,
    resolveChannel: deps.resolveChannel as PresentationHandlerCtx["resolveChannel"],
    extractWorkspaceTitle: deps.extractWorkspaceTitle,
    trackMessageSession: deps.trackMessageSession,
    sendMilestonePlainText,
    milestoneLogFn,
    getPresentationReplyAnchor,
    logPresentationFailed,
    handleStreamText,
  };

  const processHandlers = createProcessPresentationHandlers(ctx);
  const assistantHandlers = createAssistantPresentationHandlers(ctx);

  async function handlePresentationEvent(body: PresentationEvent) {
    switch (body.kind) {
      case "merge_batch":
        return assistantHandlers.handleMergeBatchPresentationEvent(body);
      case "tool":
        return processHandlers.handleToolPresentationEvent(body);
      case "thinking":
        return processHandlers.handleThinkingPresentationEvent(body);
      case "assistant":
        return assistantHandlers.handleAssistantPresentationEvent(body);
      case "task":
        return assistantHandlers.handleTaskPresentationEvent(body);
      default:
        logPresentationFailed(body.session_key ?? "?", body.kind, "unsupported kind");
        return { ok: false, error: "unsupported presentation kind" };
    }
  }

  async function tryHandleMergePreviewReply(
    parentId: string | undefined,
    text: string,
    messageId: string,
    chatKey: string,
    chatType: string,
    senderOpenId?: string,
    meta?: QueueMessageMeta,
  ): Promise<boolean> {
    if (!parentId) return false;
    const entry = deps.mergeCardRegistry.get(parentId);
    if (!entry) return false;

    const { sessionKey, batchId } = entry;
    const batch = deps.mergeBatchBySession.get(sessionKey);
    if (!batch || batch.batchId !== batchId) return false;

    const failReply = async (reason: string) => {
      await deps.replyToMessage(messageId, `${reason}请直接回复合并卡片，并发送完整合并正文。`, chatKey);
    };

    if (batch.phase === "locked" || batch.phase === "dispatched") {
      await deps.replyToMessage(messageId, "该批消息 Agent 已开始处理，无法修改。如需补充请直接发送新消息。", chatKey);
      return true;
    }

    const claimed = deps.getSessionPendingCount(sessionKey) - deps.getSessionUnclaimedCount(sessionKey);
    if (claimed > 0) {
      await deps.replyToMessage(messageId, "该批消息 Agent 已开始处理，无法修改。如需补充请直接发送新消息。", chatKey);
      return true;
    }

    const trimmed = text?.trim();
    if (!trimmed) {
      await failReply("未能识别修改。");
      return true;
    }
    if (trimmed.length > MERGE_EDIT_MAX_CHARS) {
      await failReply(`正文过长（>${MERGE_EDIT_MAX_CHARS} 字）。`);
      return true;
    }

    const fullMeta: QueueMessageMeta = { ...(meta || {}), chatType, senderOpenId };
    const result = deps.replaceSessionUnclaimedMessages(sessionKey, trimmed, fullMeta);
    if (!result.ok) {
      await failReply("未能识别修改。");
      return true;
    }

    batch.overrideText = trimmed;
    batch.updatedAt = Date.now();
    deps.renderMergeBatchCardForSession(batch).catch((e: unknown) => {
      deps.log("WARN", `合并卡编辑后更新失败: ${e instanceof Error ? e.message : e}`);
    });
    await deps.replyToMessage(messageId, "已按你的内容更新合并批次。Agent 领取后将按新内容处理。", chatKey);
    return true;
  }

  async function confirmEnqueueAndStartProgress(
    messageId: string,
    sessionKey: string,
    chatId?: string,
  ): Promise<void> {
    const pending = deps.getSessionUnclaimedCount(sessionKey);
    const statusText = buildEnqueueStatusText(sessionKey, pending);
    try {
      await deps.replyToMessage(messageId, statusText, chatId);
    } catch (e: unknown) {
      deps.log("WARN", `入队确认发送失败: ${e instanceof Error ? e.message : e}`);
    }

    let state = deps.sessionProgressMap.get(sessionKey);
    if (!state) {
      state = { typingActive: false };
      deps.sessionProgressMap.set(sessionKey, state);
    }

    const ch = deps.resolveChannel(sessionKey);
    if (ch.type === "wechat") {
      state.typingActive = true;
      ch.rt.wechat!.startProgressTyping(ch.chatId).catch((e: unknown) => {
        deps.log("WARN", `startProgressTyping 失败: ${e instanceof Error ? e.message : e}`);
      });
    } else if (ch.type === "feishu") {
      state.typingActive = true;
      deps.addReactionToMessages([messageId], sessionKey, "Get");
      recordGetReactions(sessionKey, [messageId]);
    }
  }

  return {
    ordering,
    rememberSessionChatType: ordering.rememberSessionChatType,
    handleStreamText,
    handlePresentationEvent,
    confirmEnqueueAndStartProgress,
    stopSessionProgress,
    buildEnqueueStatusText,
    tryHandleMergePreviewReply,
    getPresentationReplyAnchor,
    logPresentationFailed,
    recordGetReactions,
    clearGetReactions,
  };
}
