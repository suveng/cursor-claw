/**
 * 帮助卡：createHelpCardEntity / sendHelpCard（plain text 一次性发送）。
 */
import type { LarkSenderCtx } from "./lark-types.js";
import { sendMessage } from "./lark-sender-outbound.js";

/** 帮助卡正文元素 id */
export const HELP_CARD_ELEMENT_ID = "help_body";

/** 帮助 CardKit：创建一次性卡片实体（schema 2.0，非 streaming） */
export async function createHelpCardEntity(
  ctx: LarkSenderCtx,
  markdown: string,
): Promise<{ cardId: string } | null> {
  try {
    const escaped = markdown.replace(/\\/g, "\\\\");
    const card: Record<string, unknown> = {
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: "使用帮助" }, template: "turquoise" },
      body: {
        elements: [{
          tag: "markdown",
          element_id: HELP_CARD_ELEMENT_ID,
          content: escaped,
        }],
      },
    };
    const res = await ctx.client.request({
      method: "POST",
      url: "/open-apis/cardkit/v1/cards",
      data: { type: "card_json", data: JSON.stringify(card) },
    }) as { code?: number; msg?: string; data?: { card_id?: string } };
    if (res?.code !== 0) {
      ctx.log("WARN", `帮助 CardKit 创建失败: code=${res?.code}, msg=${res?.msg}`);
      return null;
    }
    const cardId = res?.data?.card_id;
    if (!cardId) {
      ctx.log("WARN", "帮助 CardKit 创建失败: 无 card_id");
      return null;
    }
    return { cardId };
  } catch (e: unknown) {
    ctx.log("WARN", `帮助 CardKit 创建异常: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** 进入私聊帮助：plain text 一次性发送 */
export async function sendHelpCard(
  ctx: LarkSenderCtx,
  chatId: string,
  markdown: string,
): Promise<string | null> {
  const msgId = await sendMessage(ctx, markdown, undefined, chatId, "使用帮助");
  return msgId ?? null;
}
