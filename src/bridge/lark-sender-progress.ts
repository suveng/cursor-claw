/**
 * 工具/思考进度卡：CardKit create/PATCH/render；shell 展示经 tool-presentation。
 * final/completed 时委托 closeStreamingCardMode。
 */
import { randomUUID } from "node:crypto";
import {
  buildShellToolCardMarkdown,
  type ShellToolDetail,
} from "../shared/tool-presentation.js";
import type { LarkSenderCtx, PresentationCardState } from "./lark-types.js";
import {
  closeStreamingCardMode,
  sendStreamingCardMessage,
} from "./lark-sender-stream.js";

/** 工具进度正文元素 id */
export const TOOL_PROGRESS_ELEMENT_ID = "tool_progress";
/** 思考摘要正文元素 id */
export const THINKING_ELEMENT_ID = "thinking_summary";

/** 可 PATCH 卡 config */
const PATCHABLE_CARD_CONFIG = {
  wide_screen_mode: true,
  update_multi: true,
  streaming_mode: true,
} as const;

function formatToolStatusLabel(status: "started" | "completed" | "failed"): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return "正在执行";
}

/** 工具 CardKit markdown：shell 用 ```shell 展示命令与输出 */
export function formatToolProgressCardMarkdown(
  toolName: string,
  status: "started" | "completed" | "failed",
  shellDetail?: ShellToolDetail,
): string {
  if (toolName === "shell" && shellDetail?.command) {
    return buildShellToolCardMarkdown(status, shellDetail);
  }
  const escapedName = toolName.replace(/\\/g, "\\\\");
  if (status === "started") {
    return `🔧 **正在执行：${escapedName}**`;
  }
  const statusLabel = formatToolStatusLabel(status);
  return `🔧 **${escapedName}**\n状态：${statusLabel}`;
}

/** 工具进度 CardKit：创建可 PATCH 卡片实体 */
export async function createToolProgressCardEntity(
  ctx: LarkSenderCtx,
  toolName: string,
  status: "started" | "completed" | "failed",
  shellDetail?: ShellToolDetail,
): Promise<{ cardId: string; elementId: string } | null> {
  try {
    const content = formatToolProgressCardMarkdown(toolName, status, shellDetail);
    const card: Record<string, unknown> = {
      schema: "2.0",
      config: { ...PATCHABLE_CARD_CONFIG },
      header: { title: { tag: "plain_text", content: "工具执行" }, template: "wathet" },
      body: {
        elements: [{
          tag: "markdown",
          element_id: TOOL_PROGRESS_ELEMENT_ID,
          content,
        }],
      },
    };
    const res = await ctx.client.request({
      method: "POST",
      url: "/open-apis/cardkit/v1/cards",
      data: { type: "card_json", data: JSON.stringify(card) },
    }) as { code?: number; msg?: string; data?: { card_id?: string } };
    if (res?.code !== 0) {
      ctx.log("WARN", `工具 CardKit 创建失败: code=${res?.code}, msg=${res?.msg}`);
      return null;
    }
    const cardId = res?.data?.card_id;
    if (!cardId) {
      ctx.log("WARN", "工具 CardKit 创建失败: 无 card_id");
      return null;
    }
    return { cardId, elementId: TOOL_PROGRESS_ELEMENT_ID };
  } catch (e: unknown) {
    ctx.log("WARN", `工具 CardKit 创建异常: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** 工具进度 CardKit：PATCH 更新 */
export async function updateToolProgressCardBody(
  ctx: LarkSenderCtx,
  cardId: string,
  elementId: string,
  toolName: string,
  status: "started" | "completed" | "failed",
  sequence: number,
  shellDetail?: ShellToolDetail,
): Promise<boolean> {
  try {
    const content = formatToolProgressCardMarkdown(toolName, status, shellDetail);
    const res = await ctx.client.request({
      method: "PUT",
      url: `/open-apis/cardkit/v1/cards/${cardId}/elements/${elementId}/content`,
      data: { content, sequence, uuid: randomUUID() },
    }) as { code?: number; msg?: string };
    if (res?.code !== 0) {
      ctx.log("WARN", `工具 CardKit PATCH 失败: code=${res?.code}, msg=${res?.msg}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    ctx.log("WARN", `工具 CardKit PATCH 异常: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/** 工具进度：创建或 PATCH 单卡 */
export async function renderToolProgressCard(
  ctx: LarkSenderCtx,
  chatId: string,
  toolName: string,
  status: "started" | "completed" | "failed",
  existing?: PresentationCardState,
  replyMessageId?: string,
  shellDetail?: ShellToolDetail,
): Promise<PresentationCardState | null> {
  if (existing?.cardEntityId && existing.cardMessageId) {
    const seq = (existing.cardSequence ?? 0) + 1;
    const ok = await updateToolProgressCardBody(
      ctx, existing.cardEntityId, TOOL_PROGRESS_ELEMENT_ID, toolName, status, seq, shellDetail,
    );
    if (ok) {
      let cardSequence = seq;
      if (status === "completed" || status === "failed") {
        if (await closeStreamingCardMode(ctx, existing.cardEntityId, seq + 1)) {
          cardSequence = seq + 1;
        }
      }
      return { ...existing, cardSequence };
    }
    ctx.log("WARN", "工具 CardKit PATCH 失败，保留旧卡状态");
    return existing;
  }
  const entity = await createToolProgressCardEntity(ctx, toolName, status, shellDetail);
  if (!entity) return null;
  const msgId = await sendStreamingCardMessage(ctx, chatId, entity.cardId, replyMessageId);
  if (!msgId) return null;
  let cardSequence = 1;
  if (status === "completed" || status === "failed") {
    if (await closeStreamingCardMode(ctx, entity.cardId, 2)) {
      cardSequence = 2;
    }
  }
  return { cardEntityId: entity.cardId, cardMessageId: msgId, cardSequence };
}

/** 思考摘要 CardKit：创建可 PATCH 卡片实体 */
export async function createThinkingCardEntity(
  ctx: LarkSenderCtx,
  summary: string,
): Promise<{ cardId: string; elementId: string } | null> {
  try {
    const escaped = summary.replace(/\\/g, "\\\\");
    const card: Record<string, unknown> = {
      schema: "2.0",
      config: { ...PATCHABLE_CARD_CONFIG },
      header: { title: { tag: "plain_text", content: "思考中" }, template: "grey" },
      body: {
        elements: [{
          tag: "markdown",
          element_id: THINKING_ELEMENT_ID,
          content: escaped || "…",
        }],
      },
    };
    const res = await ctx.client.request({
      method: "POST",
      url: "/open-apis/cardkit/v1/cards",
      data: { type: "card_json", data: JSON.stringify(card) },
    }) as { code?: number; msg?: string; data?: { card_id?: string } };
    if (res?.code !== 0) {
      ctx.log("WARN", `思考 CardKit 创建失败: code=${res?.code}, msg=${res?.msg}`);
      return null;
    }
    const cardId = res?.data?.card_id;
    if (!cardId) {
      ctx.log("WARN", "思考 CardKit 创建失败: 无 card_id");
      return null;
    }
    return { cardId, elementId: THINKING_ELEMENT_ID };
  } catch (e: unknown) {
    ctx.log("WARN", `思考 CardKit 创建异常: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** 思考摘要 CardKit：PATCH 更新正文 */
export async function updateThinkingCardBody(
  ctx: LarkSenderCtx,
  cardId: string,
  elementId: string,
  summary: string,
  sequence: number,
): Promise<boolean> {
  try {
    const content = summary.replace(/\\/g, "\\\\") || "…";
    const res = await ctx.client.request({
      method: "PUT",
      url: `/open-apis/cardkit/v1/cards/${cardId}/elements/${elementId}/content`,
      data: { content, sequence, uuid: randomUUID() },
    }) as { code?: number; msg?: string };
    if (res?.code !== 0) {
      ctx.log("WARN", `思考 CardKit PATCH 失败: code=${res?.code}, msg=${res?.msg}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    ctx.log("WARN", `思考 CardKit PATCH 异常: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/** 思考摘要：创建或 PATCH 单卡 */
export async function renderThinkingCard(
  ctx: LarkSenderCtx,
  chatId: string,
  summary: string,
  existing?: PresentationCardState,
  replyMessageId?: string,
  final?: boolean,
): Promise<PresentationCardState | null> {
  if (existing?.cardEntityId && existing.cardMessageId) {
    const seq = (existing.cardSequence ?? 0) + 1;
    const ok = await updateThinkingCardBody(ctx, existing.cardEntityId, THINKING_ELEMENT_ID, summary, seq);
    if (ok) {
      let cardSequence = seq;
      if (final && await closeStreamingCardMode(ctx, existing.cardEntityId, seq + 1)) {
        cardSequence = seq + 1;
      }
      return { ...existing, cardSequence };
    }
    ctx.log("WARN", "思考 CardKit PATCH 失败，保留旧卡状态");
    return existing;
  }
  const entity = await createThinkingCardEntity(ctx, summary);
  if (!entity) return null;
  const msgId = await sendStreamingCardMessage(ctx, chatId, entity.cardId, replyMessageId);
  if (!msgId) return null;
  let cardSequence = 1;
  if (final && await closeStreamingCardMode(ctx, entity.cardId, 2)) {
    cardSequence = 2;
  }
  return { cardEntityId: entity.cardId, cardMessageId: msgId, cardSequence };
}
