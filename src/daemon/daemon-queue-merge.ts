/**
 * MergeBatch 状态机核心：入队衔接、静默计时、claim/merge、清理。
 * 经 deps 注入 file-queue / channel / presentation 回调；禁止互 import。
 */
import { randomUUID } from "node:crypto";
import type { QueueMessage, QueueMessageMeta } from "../bridge/file-queue.js";
import {
  MERGE_MIN_COUNT,
  MERGE_QUIET_MS,
  applyMergeOverrideForPoll as applyOverride,
  formatMergeBody,
  isTerminalMergePhase,
  type ClaimMergeResult,
  type MergeBatch,
  type MergeBatchPhase,
} from "./daemon-queue-types.js";
import {
  renderMergeBatchCardForSession,
  type MergeCardChannel,
  type MergeCardDeps,
} from "./daemon-queue-merge-card.js";
import { handleMergeBatchAction as runMergeBatchAction } from "./daemon-queue-merge-action.js";

export type {
  ClaimMergeResult,
  MergeBatch,
  MergeBatchPhase,
} from "./daemon-queue-types.js";
export {
  MERGE_MIN_COUNT,
  MERGE_QUIET_MS,
  formatMergeBody,
  isTerminalMergePhase,
} from "./daemon-queue-types.js";
export { MERGE_EDIT_MAX_CHARS } from "./daemon-queue-types.js";

export interface MergeBatchControllerDeps {
  log: (level: string, ...args: unknown[]) => void;
  isMergeBatchEligible: (sessionKey: string) => boolean;
  getSessionAgentPhase: (sessionKey: string) => string | undefined;
  buildEnqueueStatusText: (sessionKey: string, pending: number) => string;
  resolveChannel: (sessionKey: string) => MergeCardChannel;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  broadcastQueueEvent: (chatId?: string) => void;
  collectFreshAndTrack: (messages: QueueMessage[], sessionKey: string) => string[];
  applyPollGetReactions: (freshIds: string[], sessionKey: string) => void;
  listUnclaimedMessages: (sessionKey: string) => QueueMessage[];
  getSessionUnclaimedCount: (sessionKey: string) => number;
  getSessionPendingCount: (sessionKey: string) => number;
  claimSessionMessages: (sessionKey: string) => QueueMessage[];
  replaceSessionUnclaimedMessages: (
    sessionKey: string,
    text: string,
    meta: QueueMessageMeta,
  ) => { ok: boolean; error?: string };
  resolveSessionChatType: (sessionKey: string) => string | undefined;
}

export function createMergeBatchController(deps: MergeBatchControllerDeps) {
  const mergeBatchBySession = new Map<string, MergeBatch>();
  const mergeCardRegistry = new Map<string, { sessionKey: string; batchId: string }>();

  const cardDeps: MergeCardDeps = {
    log: deps.log,
    isMergeBatchEligible: deps.isMergeBatchEligible,
    listUnclaimedMessages: deps.listUnclaimedMessages,
    getSessionAgentPhase: deps.getSessionAgentPhase,
    buildEnqueueStatusText: deps.buildEnqueueStatusText,
    resolveChannel: deps.resolveChannel,
    trackMessageSession: deps.trackMessageSession,
    mergeCardRegistry,
  };

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
    return applyOverride(mergeBatchBySession, sessionKey, messages);
  }

  async function renderCard(batch: MergeBatch): Promise<void> {
    return renderMergeBatchCardForSession(cardDeps, batch);
  }

  function scheduleMergeBatchQuietTimer(batch: MergeBatch): void {
    clearMergeBatchQuietTimer(batch);
    batch.quietDeadlineAt = Date.now() + MERGE_QUIET_MS;
    batch.quietTimer = setTimeout(() => {
      batch.quietTimer = undefined;
      if (batch.phase !== "collecting") return;
      if (deps.getSessionUnclaimedCount(batch.sessionKey) < MERGE_MIN_COUNT) return;
      batch.phase = "ready";
      batch.quietDeadlineAt = undefined;
      batch.updatedAt = Date.now();
      renderCard(batch).catch((e: unknown) => {
        deps.log("WARN", `合并卡 ready 更新失败: ${e instanceof Error ? e.message : e}`);
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
    if (chatType !== "p2p" || !deps.isMergeBatchEligible(sessionKey)) return;

    const unclaimed = deps.getSessionUnclaimedCount(sessionKey);
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
    renderCard(batch).catch((e: unknown) => {
      deps.log("WARN", `合并 CardKit 更新失败: ${e instanceof Error ? e.message : e}`);
    });
  }

  function shouldSendEnqueueF1(sessionKey: string): boolean {
    const batch = mergeBatchBySession.get(sessionKey);
    if (!batch || batch.phase !== "collecting") return true;
    return deps.getSessionUnclaimedCount(sessionKey) < MERGE_MIN_COUNT;
  }

  function isMergeDispatchAllowed(sessionKey: string): boolean {
    return deps.getSessionAgentPhase(sessionKey) !== "processing";
  }

  function shouldDeferDispatch(sessionKey: string): boolean {
    const batch = mergeBatchBySession.get(sessionKey);
    if (!batch || isTerminalMergePhase(batch.phase)) return false;
    if (batch.phase === "collecting" && deps.getSessionUnclaimedCount(sessionKey) >= MERGE_MIN_COUNT) {
      return true;
    }
    if (batch.phase === "ready" && !isMergeDispatchAllowed(sessionKey)) {
      return true;
    }
    return false;
  }

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
      renderCard(batch).catch((e: unknown) => {
        deps.log("WARN", `合并卡 locked 更新失败: ${e instanceof Error ? e.message : e}`);
      });
    }

    const messages = deps.claimSessionMessages(sessionKey);
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
    const freshIds = deps.collectFreshAndTrack(pollMessages, sessionKey);
    deps.applyPollGetReactions(freshIds, sessionKey);
    deps.broadcastQueueEvent(sessionKey);
    deps.log("INFO", `claim-and-merge: session=${sessionKey} count=${message_ids.length}`);
    return { ok: true, text, message_ids };
  }

  async function flushReadyMergeBatches(sessionKey: string): Promise<void> {
    const batch = mergeBatchBySession.get(sessionKey);
    if (!batch || batch.phase !== "ready") return;
    if (!isMergeDispatchAllowed(sessionKey)) {
      await renderCard(batch);
      return;
    }
    deps.broadcastQueueEvent(sessionKey);
  }

  async function handleMergeBatchAction(
    sessionKey: string,
    action: string,
    text?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return runMergeBatchAction(
      {
        mergeBatchBySession,
        clearMergeBatchQuietTimer,
        clearMergeBatchState,
        renderCard,
        flushReadyMergeBatches,
        broadcastQueueEvent: deps.broadcastQueueEvent,
        getSessionPendingCount: deps.getSessionPendingCount,
        getSessionUnclaimedCount: deps.getSessionUnclaimedCount,
        resolveSessionChatType: deps.resolveSessionChatType,
        replaceSessionUnclaimedMessages: deps.replaceSessionUnclaimedMessages,
      },
      sessionKey,
      action,
      text,
    );
  }

  return {
    mergeBatchBySession,
    mergeCardRegistry,
    onMessageEnqueued,
    performClaimAndMerge,
    handleMergeBatchAction,
    flushReadyMergeBatches,
    clearMergeBatchState,
    applyMergeOverrideForPoll,
    shouldSendEnqueueF1,
    shouldDeferDispatch,
    isMergeDispatchAllowed,
    formatMergeBody,
    isTerminalMergePhase,
    renderMergeBatchCardForSession: renderCard,
  };
}
