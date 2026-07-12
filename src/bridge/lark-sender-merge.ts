/**
 * 合并批次卡：CardKit 实体 create/send/PATCH 与 plain text renderMergeBatchCard。
 * 按钮 schema（merge_send_now / merge_edit / merge_split）保持不变。
 */
import { randomUUID } from "node:crypto";
import type {
  LarkSenderCtx,
  MergeBatchCardState,
  MergeBatchCardView,
} from "./lark-types.js";
import {
  sendMessage,
  updateMessageContent,
} from "./lark-sender-outbound.js";
import { sendStreamingCardMessage } from "./lark-sender-stream.js";

/** 合并卡正文元素 id */
export const MERGE_BATCH_ELEMENT_ID = "merge_body";

/** 可 PATCH 卡 config（elements/content PUT 要求 streaming_mode true） */
const PATCHABLE_CARD_CONFIG = {
  wide_screen_mode: true,
  update_multi: true,
  streaming_mode: true,
} as const;

/** 合并批次 plain text 正文 */
export function formatMergeBatchPlainText(view: MergeBatchCardView): string {
  return `${view.title}\n\n${view.bodyMarkdown}\n\n— ${view.footerText}`;
}

/** 合并批次 CardKit：创建 streaming_mode 可 PATCH 卡片实体（含按钮占位） */
export async function createMergeBatchCardEntity(
  ctx: LarkSenderCtx,
  view: MergeBatchCardView,
): Promise<{ cardId: string; elementId: string } | null> {
  try {
    const escapedBody = view.bodyMarkdown.replace(/\\/g, "\\\\");
    const escapedFooter = view.footerText.replace(/\\/g, "\\\\");
    const card: Record<string, unknown> = {
      schema: "2.0",
      config: { ...PATCHABLE_CARD_CONFIG },
      header: { title: { tag: "plain_text", content: view.title }, template: "blue" },
      body: {
        elements: [
          {
            tag: "markdown",
            element_id: MERGE_BATCH_ELEMENT_ID,
            content: `${escapedBody}\n\n---\n*${escapedFooter}*`,
          },
          {
            tag: "action",
            actions: [
              { tag: "button", text: { tag: "plain_text", content: "立即发送" }, type: "primary", value: { action: "merge_send_now" } },
              { tag: "button", text: { tag: "plain_text", content: "编辑" }, type: "default", value: { action: "merge_edit" } },
              { tag: "button", text: { tag: "plain_text", content: "拆开逐条" }, type: "default", value: { action: "merge_split" } },
            ],
          },
        ],
      },
    };
    const res = await ctx.client.request({
      method: "POST",
      url: "/open-apis/cardkit/v1/cards",
      data: { type: "card_json", data: JSON.stringify(card) },
    }) as { code?: number; msg?: string; data?: { card_id?: string } };
    if (res?.code !== 0) {
      ctx.log("WARN", `合并 CardKit 创建失败: code=${res?.code}, msg=${res?.msg}`);
      return null;
    }
    const cardId = res?.data?.card_id;
    if (!cardId) {
      ctx.log("WARN", "合并 CardKit 创建失败: 无 card_id");
      return null;
    }
    return { cardId, elementId: MERGE_BATCH_ELEMENT_ID };
  } catch (e: unknown) {
    ctx.log("WARN", `合并 CardKit 创建异常: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** 合并批次 CardKit：发送卡片消息（可选 reply 到 inbound） */
export async function sendMergeBatchCardMessage(
  ctx: LarkSenderCtx,
  chatId: string,
  cardId: string,
  replyMessageId?: string,
): Promise<string | null> {
  try {
    const content = JSON.stringify({ type: "card", data: { card_id: cardId } });
    if (replyMessageId && !replyMessageId.startsWith("internal_")) {
      const res = await ctx.client.im.message.reply({
        path: { message_id: replyMessageId },
        data: { content, msg_type: "interactive" },
      }) as { code?: number; msg?: string; data?: { message_id?: string } };
      if (res?.code !== 0) {
        ctx.log("WARN", `合并 CardKit reply 失败: code=${res?.code}, msg=${res?.msg}`);
        return null;
      }
      return res?.data?.message_id ?? null;
    }
    return sendStreamingCardMessage(ctx, chatId, cardId);
  } catch (e: unknown) {
    ctx.log("WARN", `合并 CardKit 发送异常: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** 合并批次 CardKit：PATCH 更新正文元素 */
export async function updateMergeBatchCardBody(
  ctx: LarkSenderCtx,
  cardId: string,
  elementId: string,
  view: MergeBatchCardView,
  sequence: number,
): Promise<boolean> {
  try {
    const escapedBody = view.bodyMarkdown.replace(/\\/g, "\\\\");
    const escapedFooter = view.footerText.replace(/\\/g, "\\\\");
    const content = `${escapedBody}\n\n---\n*${escapedFooter}*`;
    const res = await ctx.client.request({
      method: "PUT",
      url: `/open-apis/cardkit/v1/cards/${cardId}/elements/${elementId}/content`,
      data: { content, sequence, uuid: randomUUID() },
    }) as { code?: number; msg?: string };
    if (res?.code !== 0) {
      ctx.log("WARN", `合并 CardKit PATCH 失败: code=${res?.code}, msg=${res?.msg}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    ctx.log("WARN", `合并 CardKit PATCH 异常: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/**
 * 合并批次：plain text 首包 + update 增量（保留 cardMessageId 字段名兼容 daemon）。
 */
export async function renderMergeBatchCard(
  ctx: LarkSenderCtx,
  chatId: string,
  view: MergeBatchCardView,
  existing?: MergeBatchCardState,
  replyMessageId?: string,
): Promise<MergeBatchCardState | null> {
  const text = formatMergeBatchPlainText(view);
  if (existing?.cardMessageId) {
    const ok = await updateMessageContent(ctx, existing.cardMessageId, text);
    if (ok) {
      return { ...existing, cardSequence: (existing.cardSequence ?? 0) + 1 };
    }
    ctx.log("WARN", "合并预览 text update 失败，保留旧消息");
    return existing;
  }

  const msgId = replyMessageId
    ? await sendMessage(ctx, text, replyMessageId)
    : await sendMessage(ctx, text, undefined, chatId);
  if (!msgId) return null;
  return { cardEntityId: "", cardMessageId: msgId, cardSequence: 1 };
}
