/**
 * MergeBatch 类型与常量（队列合并状态机共享）。
 * 禁止本文件含业务副作用；消费者经 createMergeBatchController 组装。
 */
import type { QueueMessage } from "../bridge/file-queue.js";

/** collecting → ready → locked → dispatched/cancelled */
export type MergeBatchPhase =
  | "collecting"
  | "ready"
  | "locked"
  | "dispatched"
  | "cancelled";

export interface MergeBatch {
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

export type ClaimMergeResult =
  | { ok: true; text: string; message_ids: string[] }
  | { ok: false; error: string };

/** 静默窗口默认 2500ms；可用 MERGE_QUIET_MS 覆盖 */
export const MERGE_QUIET_MS =
  Number(process.env.MERGE_QUIET_MS) > 0 ? Number(process.env.MERGE_QUIET_MS) : 2500;
export const MERGE_MIN_COUNT = 2;
export const MERGE_CARD_MAX_ITEMS = 20;
export const MERGE_EDIT_MAX_CHARS = 30000;

/** 多条未认领消息合并为 Agent 正文 */
export function formatMergeBody(messages: Array<{ text: string }>): string {
  if (messages.length === 0) return "";
  if (messages.length === 1) return messages[0].text.trim();
  return messages.map((m, i) => `【消息 ${i + 1}】\n${m.text.trim()}`).join("\n\n");
}

export function isTerminalMergePhase(phase: MergeBatchPhase | string): boolean {
  return phase === "dispatched" || phase === "cancelled";
}

/** poll/claim 时若存在 overrideText 则折叠为单条 */
export function applyMergeOverrideForPoll(
  mergeBatchBySession: ReadonlyMap<string, MergeBatch>,
  sessionKey: string,
  messages: QueueMessage[],
): QueueMessage[] {
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
