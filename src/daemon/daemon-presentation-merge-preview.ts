/**
 * 合并预览卡回复编辑（从 daemon-presentation-handlers 切出）。
 */
import type { QueueMessageMeta } from "../bridge/file-queue.js";
import { MERGE_EDIT_MAX_CHARS } from "./daemon-presentation-types.js";

export interface MergePreviewDeps {
  log: (level: string, ...args: unknown[]) => void;
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
  getSessionPendingCount: (sessionKey: string) => number;
  getSessionUnclaimedCount: (sessionKey: string) => number;
  replaceSessionUnclaimedMessages: (
    sessionKey: string,
    text: string,
    meta: QueueMessageMeta,
  ) => { ok: boolean; error?: string };
  renderMergeBatchCardForSession: (batch: {
    sessionKey: string;
    phase: string;
    batchId: string;
    overrideText?: string;
    lastInboundMessageId?: string;
    updatedAt: number;
  }) => Promise<void>;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
}

/** 识别合并卡 outbound id 的回复编辑 */
export function createMergePreviewHandler(deps: MergePreviewDeps) {
  return async function tryHandleMergePreviewReply(
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
  };
}
