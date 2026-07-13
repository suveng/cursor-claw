/**
 * CardKit 流式实体：create / 发送 interactive / PATCH 正文 / 关闭 streaming_mode。
 * 由 LarkSender 门面委托；失败须可判（返回 null/false），不吞错。
 */
import { randomUUID } from "node:crypto";
import type { LarkSenderCtx } from "./lark-types.js";
import { containsAtTag } from "./lark-sender-outbound.js";

/** 流式正文元素固定 id */
export const STREAM_ELEMENT_ID = "stream_content";

/** CardKit 流式：创建 streaming_mode 卡片实体，返回 card_id 与固定 element_id */
export async function createStreamingCardEntity(
  ctx: LarkSenderCtx,
  title?: string,
): Promise<{ cardId: string; elementId: string } | null> {
  try {
    const card: Record<string, unknown> = {
      schema: "2.0",
      config: {
        streaming_mode: true,
        update_multi: true,
        wide_screen_mode: true,
        summary: { content: "" },
      },
      body: {
        elements: [{ tag: "markdown", element_id: STREAM_ELEMENT_ID, content: "" }],
      },
    };
    if (title) {
      card.header = { title: { tag: "plain_text", content: title }, template: "turquoise" };
    }
    const res = await ctx.client.request({
      method: "POST",
      url: "/open-apis/cardkit/v1/cards",
      data: { type: "card_json", data: JSON.stringify(card) },
    }) as { code?: number; msg?: string; data?: { card_id?: string } };
    if (res?.code !== 0) {
      ctx.log("WARN", `CardKit 创建卡片失败: code=${res?.code}, msg=${res?.msg}`);
      return null;
    }
    const cardId = res?.data?.card_id;
    if (!cardId) {
      ctx.log("WARN", "CardKit 创建卡片失败: 无 card_id");
      return null;
    }
    return { cardId, elementId: STREAM_ELEMENT_ID };
  } catch (e: unknown) {
    ctx.log("WARN", `CardKit 创建卡片异常: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** CardKit 流式：发送引用 card_id 的 interactive 消息（可选 reply 到 inbound） */
export async function sendStreamingCardMessage(
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
        ctx.log("WARN", `CardKit reply 发送失败: code=${res?.code}, msg=${res?.msg}`);
        return null;
      }
      return res?.data?.message_id ?? null;
    }
    const res = await ctx.client.im.message.create({
      params: { receive_id_type: "chat_id" as any },
      data: { receive_id: chatId, content, msg_type: "interactive" },
    }) as { code?: number; msg?: string; data?: { message_id?: string } };
    if (res?.code !== 0) {
      ctx.log("WARN", `CardKit 发送卡片消息失败: code=${res?.code}, msg=${res?.msg}`);
      return null;
    }
    return res?.data?.message_id ?? null;
  } catch (e: unknown) {
    ctx.log("WARN", `CardKit 发送卡片消息异常: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** CardKit 流式：更新元素全文（sequence 递增）；含 @ 标签时不支持，返回 false 供降级 */
export async function updateStreamingCardText(
  ctx: LarkSenderCtx,
  cardId: string,
  elementId: string,
  text: string,
  sequence: number,
): Promise<boolean> {
  try {
    const fullText = `${ctx.messagePrefix}${text}`;
    if (containsAtTag(fullText)) return false;
    const content = fullText.replace(/\\/g, "\\\\");
    const res = await ctx.client.request({
      method: "PUT",
      url: `/open-apis/cardkit/v1/cards/${cardId}/elements/${elementId}/content`,
      data: { content, sequence, uuid: randomUUID() },
    }) as { code?: number; msg?: string };
    if (res?.code !== 0) {
      ctx.log("WARN", `CardKit 流式更新失败: code=${res?.code}, msg=${res?.msg}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    ctx.log("WARN", `CardKit 流式更新异常: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/** CardKit 流式：关闭 streaming_mode（final 时调用） */
export async function closeStreamingCardMode(
  ctx: LarkSenderCtx,
  cardId: string,
  sequence: number,
): Promise<boolean> {
  try {
    const res = await ctx.client.request({
      method: "PATCH",
      url: `/open-apis/cardkit/v1/cards/${cardId}/settings`,
      data: {
        settings: JSON.stringify({ config: { streaming_mode: false } }),
        sequence,
        uuid: randomUUID(),
      },
    }) as { code?: number; msg?: string };
    if (res?.code !== 0) {
      ctx.log("WARN", `CardKit 关闭流式模式失败: code=${res?.code}, msg=${res?.msg}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    ctx.log("WARN", `CardKit 关闭流式模式异常: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/**
 * CardKit 静默续期：PATCH settings 保持 streaming_mode=true（不改正文、不刷屏）。
 * sequence 须严格递增；失败返回 false 供 daemon 降级轻量里程碑。
 */
export async function renewStreamingCardSettings(
  ctx: LarkSenderCtx,
  cardId: string,
  sequence: number,
): Promise<boolean> {
  try {
    const res = await ctx.client.request({
      method: "PATCH",
      url: `/open-apis/cardkit/v1/cards/${cardId}/settings`,
      data: {
        settings: JSON.stringify({ config: { streaming_mode: true } }),
        sequence,
        uuid: randomUUID(),
      },
    }) as { code?: number; msg?: string };
    if (res?.code !== 0) {
      ctx.log("WARN", `CardKit 续期失败: code=${res?.code}, msg=${res?.msg}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    ctx.log("WARN", `CardKit 续期异常: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
