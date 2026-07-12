/**
 * Presentation handlers 工厂：里程碑降级与 stream/events 组装。
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
import { createStreamTextHandler, type StreamHandlerDeps } from "./daemon-presentation-stream.js";
import { createProcessPresentationHandlers } from "./daemon-presentation-process-events.js";
import { createAssistantPresentationHandlers } from "./daemon-presentation-assistant-events.js";
import { createEnqueueHandlers, type EnqueueHandlerDeps } from "./daemon-presentation-enqueue.js";
import { createMergePreviewHandler } from "./daemon-presentation-merge-preview.js";
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
  tryHandleMergePreviewReply: ReturnType<typeof createMergePreviewHandler>;
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
      const result = await ch.rt.wechat!.sendText(ch.chatId, text, { skipTyping: true });
      if (result.outboundId) {
        deps.trackMessageSession(result.outboundId, sessionKey);
        deps.sessionLastReplyAt.set(sessionKey, Date.now());
      }
      return result.ok;
    }
    const sentMsgId = await ch.rt.sender!.sendMessage(text, undefined, (ch as { chatId?: string }).chatId, title);
    if (sentMsgId) {
      deps.trackMessageSession(sentMsgId, sessionKey);
      deps.sessionLastReplyAt.set(sessionKey, Date.now());
    }
    return !!sentMsgId;
  }

  function milestoneLogFn(message: string): void {
    deps.log("WARN", message);
  }

  function stopSessionProgress(sessionKey: string): void {
    const state = deps.sessionProgressMap.get(sessionKey);
    if (!state) return;
    if (state.typingActive) {
      const ch = deps.resolveChannel(sessionKey);
      if (ch.type === "wechat") {
        (ch.rt.wechat as { stopProgressTyping?: (chatId: string) => Promise<void> }).stopProgressTyping?.(ch.chatId).catch((e: unknown) => {
          deps.log("WARN", `stopProgressTyping 失败: ${e instanceof Error ? e.message : e}`);
        });
      }
    }
    clearMilestoneState(state);
    deps.sessionProgressMap.delete(sessionKey);
  }

  const enqueue = createEnqueueHandlers({
    log: deps.log,
    sessionProgressMap: deps.sessionProgressMap,
    sessionGetReactedIds: deps.sessionGetReactedIds,
    getSessionAgentPhase: deps.getSessionAgentPhase,
    getSessionUnclaimedCount: deps.getSessionUnclaimedCount,
    resolveChannel: deps.resolveChannel as EnqueueHandlerDeps["resolveChannel"],
    replyToMessage: deps.replyToMessage,
    addReactionToMessages: deps.addReactionToMessages,
  });

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
    renderMergeBatchCardForSession: deps.renderMergeBatchCardForSession as PresentationHandlerCtx["renderMergeBatchCardForSession"],
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

  const tryHandleMergePreviewReply = createMergePreviewHandler({
    log: deps.log,
    mergeBatchBySession: deps.mergeBatchBySession,
    mergeCardRegistry: deps.mergeCardRegistry,
    getSessionPendingCount: deps.getSessionPendingCount,
    getSessionUnclaimedCount: deps.getSessionUnclaimedCount,
    replaceSessionUnclaimedMessages: deps.replaceSessionUnclaimedMessages,
    renderMergeBatchCardForSession: deps.renderMergeBatchCardForSession,
    replyToMessage: deps.replyToMessage,
  });

  return {
    ordering,
    rememberSessionChatType: ordering.rememberSessionChatType,
    handleStreamText,
    handlePresentationEvent,
    confirmEnqueueAndStartProgress: enqueue.confirmEnqueueAndStartProgress,
    stopSessionProgress,
    buildEnqueueStatusText: enqueue.buildEnqueueStatusText,
    tryHandleMergePreviewReply,
    getPresentationReplyAnchor,
    logPresentationFailed,
    recordGetReactions: enqueue.recordGetReactions,
    clearGetReactions: enqueue.clearGetReactions,
  };
}
