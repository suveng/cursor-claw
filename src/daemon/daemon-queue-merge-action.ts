/**
 * MergeBatch 用户动作：send_now / split / edit（按钮与 /merge 共用）。
 * 由 createMergeBatchController 组装；禁止改 phase 规则外语义。
 */
import type { QueueMessageMeta } from "../bridge/file-queue.js";
import {
  MERGE_EDIT_MAX_CHARS,
  isTerminalMergePhase,
  type MergeBatch,
} from "./daemon-queue-types.js";

export interface MergeActionContext {
  mergeBatchBySession: Map<string, MergeBatch>;
  clearMergeBatchQuietTimer: (batch: MergeBatch) => void;
  clearMergeBatchState: (sessionKey: string) => void;
  renderCard: (batch: MergeBatch) => Promise<void>;
  flushReadyMergeBatches: (sessionKey: string) => Promise<void>;
  broadcastQueueEvent: (chatId?: string) => void;
  getSessionPendingCount: (sessionKey: string) => number;
  getSessionUnclaimedCount: (sessionKey: string) => number;
  resolveSessionChatType: (sessionKey: string) => string | undefined;
  replaceSessionUnclaimedMessages: (
    sessionKey: string,
    text: string,
    meta: QueueMessageMeta,
  ) => { ok: boolean; error?: string };
}

/** send_now | split | edit；action 可带 merge_ 前缀 */
export async function handleMergeBatchAction(
  ctx: MergeActionContext,
  sessionKey: string,
  action: string,
  text?: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = action.replace(/^merge_/, "");
  const batch = ctx.mergeBatchBySession.get(sessionKey);

  if (normalized === "send_now") {
    if (!batch || batch.phase !== "collecting") {
      return { ok: false, error: "batch not in collecting" };
    }
    ctx.clearMergeBatchQuietTimer(batch);
    batch.phase = "ready";
    batch.quietDeadlineAt = undefined;
    batch.updatedAt = Date.now();
    await ctx.renderCard(batch);
    await ctx.flushReadyMergeBatches(sessionKey);
    return { ok: true };
  }

  if (normalized === "split") {
    if (!batch || isTerminalMergePhase(batch.phase)) {
      return { ok: false, error: "no active merge batch" };
    }
    if (batch.phase === "locked" || batch.phase === "dispatched") {
      return { ok: false, error: "batch already dispatching" };
    }
    ctx.clearMergeBatchQuietTimer(batch);
    batch.phase = "cancelled";
    ctx.clearMergeBatchState(sessionKey);
    ctx.broadcastQueueEvent(sessionKey);
    // ponytail: 取消合并后仍由 orchestrator 按未合并路径领取（跨 session 可并行 kickoff）
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
    const claimed = ctx.getSessionPendingCount(sessionKey) - ctx.getSessionUnclaimedCount(sessionKey);
    if (claimed > 0) return { ok: false, error: "messages already claimed" };
    const chatType = ctx.resolveSessionChatType(sessionKey) ?? "p2p";
    const result = ctx.replaceSessionUnclaimedMessages(sessionKey, trimmed, { chatType });
    if (!result.ok) return { ok: false, error: result.error ?? "edit failed" };
    batch.overrideText = trimmed;
    batch.updatedAt = Date.now();
    await ctx.renderCard(batch);
    return { ok: true };
  }

  return { ok: false, error: "unknown action" };
}
