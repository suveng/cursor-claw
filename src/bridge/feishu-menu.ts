/**
 * 飞书自定义菜单点击与进入私聊帮助的业务骨架。
 * 事件注册与 pushCommandToQueue 接线由 daemon/lark-core（T5）完成。
 */

import { FEISHU_MENU_EVENT_MAP } from "../shared/feishu-addons.js";
import { buildHelpText } from "../shared/feishu-help-text.js";

/** 进入私聊帮助卡推送间隔（24 小时） */
export const HELP_CARD_INTERVAL_MS = 86_400_000;

/** 非管理员点击管理员菜单项时的回复文案（与 daemon-manager denyNonAdmin 一致） */
const DENY_NON_ADMIN_TEXT = "🔒 该指令仅管理员可用";

/** 未知 event_key 时的回复文案 */
const UNKNOWN_MENU_TEXT = "❓ 未知菜单项";

/** openId → 上次推送帮助卡时间戳（进程内内存，重启后重置） */
const helpThrottleMap = new Map<string, number>();

/** 菜单点击事件上下文（由 lark-core/daemon 解析 payload 后传入） */
export interface MenuClickContext {
  eventKey: string;
  openId: string;
  chatId: string;
  /** 回复锚点或 fcmd 入队 messageId，由 T5 从事件 payload 传入 */
  messageId?: string;
  isAdmin: boolean;
}

/** 菜单点击处理结果：入队斜杠指令或直接文本回复 */
export type MenuHandleResult =
  | {
      action: "enqueue";
      command: string;
      messageId: string;
      chatId: string;
      chatType: "p2p";
    }
  | { action: "reply"; text: string };

/** 用户进入机器人私聊事件上下文 */
export interface P2pEnteredContext {
  openId: string;
  chatId: string;
  isAdmin: boolean;
}

/** 进入私聊处理结果：发卡或节流跳过 */
export type P2pHandleResult =
  | { action: "send_help_card"; helpMarkdown: string }
  | { action: "skip"; reason: "throttled" };

/** resolveMenuCommand 成功分支 */
export type MenuCommandResolved = { ok: true; command: string };

/** resolveMenuCommand 失败分支（需直接 reply） */
export type MenuCommandDenied = { ok: false; replyText: string };

export type MenuCommandResult = MenuCommandResolved | MenuCommandDenied;

/**
 * 将飞书菜单 event_key 解析为斜杠指令。
 * 未知 key 或权限不足时返回可理解的 reply 文案，不抛错。
 */
export function resolveMenuCommand(
  eventKey: string,
  isAdmin: boolean,
): MenuCommandResult {
  const entry = FEISHU_MENU_EVENT_MAP[eventKey];
  if (!entry) {
    return { ok: false, replyText: UNKNOWN_MENU_TEXT };
  }
  if (entry.adminOnly && !isAdmin) {
    return { ok: false, replyText: DENY_NON_ADMIN_TEXT };
  }
  return { ok: true, command: entry.command };
}

/**
 * 处理 application.bot.menu_v6 菜单点击。
 * 成功映射时返回 enqueue（等价 pushCommandToQueue 语义），否则 reply。
 */
export async function handleMenuClick(
  ctx: MenuClickContext,
): Promise<MenuHandleResult> {
  const resolved = resolveMenuCommand(ctx.eventKey, ctx.isAdmin);
  if (!resolved.ok) {
    return { action: "reply", text: resolved.replyText };
  }

  // fcmd 队列需要 messageId；T5 应从事件传入，缺失时用合成 id 避免静默失败
  const messageId =
    ctx.messageId?.trim() ||
    `menu_${ctx.eventKey}_${Date.now()}`;

  return {
    action: "enqueue",
    command: resolved.command,
    messageId,
    chatId: ctx.chatId,
    chatType: "p2p",
  };
}

/**
 * 处理 im.chat.access_event.bot_p2p_chat_entered_v1。
 * 同一 openId 在 HELP_CARD_INTERVAL_MS 内仅推送一次帮助卡正文。
 */
export async function handleP2pEntered(
  ctx: P2pEnteredContext,
): Promise<P2pHandleResult> {
  const now = Date.now();
  const lastHelpAt = helpThrottleMap.get(ctx.openId);
  if (lastHelpAt !== undefined && now - lastHelpAt < HELP_CARD_INTERVAL_MS) {
    return { action: "skip", reason: "throttled" };
  }

  helpThrottleMap.set(ctx.openId, now);
  return {
    action: "send_help_card",
    helpMarkdown: buildHelpText(ctx.isAdmin),
  };
}
