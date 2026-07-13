/**
 * MergeBatch 合并卡视图构建与飞书渲染（经 deps.resolveChannel，禁止 import presentation/orchestrator）。
 */
import type { MergeBatchCardState, MergeBatchCardView } from "../bridge/lark-core.js";
import {
  MERGE_CARD_MAX_ITEMS,
  type MergeBatch,
} from "./daemon-queue-types.js";

/** 合并卡渲染所需最小通道形态（避免依赖 ChannelRuntime） */
export type MergeCardChannel =
  | {
      type: "feishu";
      chatId?: string;
      sender?: {
        renderMergeBatchCard: (
          chatId: string,
          view: MergeBatchCardView,
          existing?: MergeBatchCardState,
          replyMessageId?: string,
        ) => Promise<MergeBatchCardState | null>;
      };
    }
  | { type: string };

export interface MergeCardDeps {
  log: (level: string, ...args: unknown[]) => void;
  isMergeBatchEligible: (sessionKey: string) => boolean;
  listUnclaimedMessages: (sessionKey: string) => Array<{ text: string }>;
  getSessionAgentPhase: (sessionKey: string) => string | undefined;
  buildEnqueueStatusText: (sessionKey: string, pending: number) => string;
  resolveChannel: (sessionKey: string) => MergeCardChannel;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  mergeCardRegistry: Map<string, { sessionKey: string; batchId: string }>;
}

/** 注册 outbound 合并卡 messageId → batch，供预览回复编辑定位 */
export function registerMergeCardMessage(
  registry: Map<string, { sessionKey: string; batchId: string }>,
  sessionKey: string,
  batchId: string,
  cardMessageId: string,
): void {
  registry.set(cardMessageId, { sessionKey, batchId });
}

export function buildMergeBatchCardView(
  deps: MergeCardDeps,
  batch: MergeBatch,
  sessionKey: string,
): MergeBatchCardView {
  const messages = deps.listUnclaimedMessages(sessionKey);
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
    // 与 buildEnqueueStatusText(processing) 用词对齐：已排队 + 当前任务结束后…
    footerText = deps.getSessionAgentPhase(sessionKey) === "processing"
      ? "已排队，当前任务结束后发送"
      : "即将发送";
  } else if (batch.phase === "locked") {
    footerText = "发送中…";
  } else {
    footerText = deps.buildEnqueueStatusText(sessionKey, count);
  }

  return {
    title: `待发送 · ${count} 条消息`,
    bodyMarkdown: displayItems.join("\n") || "（无内容）",
    footerText,
  };
}

/** 飞书合并预览卡 PATCH/首发；非飞书或未 eligible 时静默跳过 */
export async function renderMergeBatchCardForSession(
  deps: MergeCardDeps,
  batch: MergeBatch,
): Promise<void> {
  if (!deps.isMergeBatchEligible(batch.sessionKey)) return;

  const ch = deps.resolveChannel(batch.sessionKey);
  if (ch.type !== "feishu") return;
  const feishu = ch as Extract<MergeCardChannel, { type: "feishu" }>;
  if (!feishu.sender || !feishu.chatId) return;

  const view = buildMergeBatchCardView(deps, batch, batch.sessionKey);
  const existing: MergeBatchCardState | undefined = batch.cardMessageId
    ? {
        cardEntityId: batch.cardEntityId ?? "",
        cardMessageId: batch.cardMessageId,
        cardSequence: batch.cardSequence ?? 0,
      }
    : undefined;

  const result = await feishu.sender.renderMergeBatchCard(
    feishu.chatId,
    view,
    existing,
    existing ? undefined : batch.lastInboundMessageId,
  );
  if (!result) {
    deps.log("WARN", `合并预览 text 渲染失败: session=${batch.sessionKey} batch=${batch.batchId}`);
    return;
  }

  batch.cardEntityId = result.cardEntityId;
  batch.cardSequence = result.cardSequence;
  if (result.cardMessageId !== batch.cardMessageId) {
    if (batch.cardMessageId) deps.mergeCardRegistry.delete(batch.cardMessageId);
    batch.cardMessageId = result.cardMessageId;
    registerMergeCardMessage(deps.mergeCardRegistry, batch.sessionKey, batch.batchId, result.cardMessageId);
    deps.trackMessageSession(result.cardMessageId, batch.sessionKey);
  }
  batch.updatedAt = Date.now();
}
