/**
 * 飞书 menu_v6 / p2p_entered 事件接线（从 daemon.ts 抽出，避免枢纽继续膨胀）。
 */

import type { LarkSender, FeishuMenuEvent, FeishuP2pEnteredEvent } from "../bridge/lark-core.js";
import { handleMenuClick, handleP2pEntered } from "../bridge/feishu-menu.js";

/** 接线所需通道运行时字段（避免 import daemon 内部 ChannelRuntime） */
export interface FeishuHandlerRuntime {
  cfg: {
    id: string;
    name: string;
    mainUserEnabled?: boolean;
    mainUserChatId?: string;
  };
  lastP2pChatId: string | null;
}

/** 由 daemon 注入的依赖（避免循环 import） */
export interface FeishuEventHandlerDeps {
  log: (level: string, ...args: unknown[]) => void;
  pushCommandToQueue: (
    command: string,
    messageId: string,
    source: string,
    chatId?: string,
    chatType?: string,
  ) => boolean;
  makeChatKey: (channelId: string, rawChatId: string) => string;
}

/** menu_v6 无 chat_id 时回退：最近私聊 → sender 默认（不回退主用户 chat） */
function resolveMenuChatId(
  rt: FeishuHandlerRuntime,
  sender: LarkSender,
  hintedChatId?: string,
): string {
  const hinted = hintedChatId?.trim();
  if (hinted) return hinted;
  if (rt.lastP2pChatId?.trim()) return rt.lastP2pChatId.trim();
  return sender.chatId?.trim() ?? "";
}

/** 处理 application.bot.menu_v6：映射斜杠 → fcmd 或文本回复 */
export async function onFeishuMenuV6(
  rt: FeishuHandlerRuntime,
  sender: LarkSender,
  ev: FeishuMenuEvent,
  deps: FeishuEventHandlerDeps,
): Promise<void> {
  const chatId = resolveMenuChatId(rt, sender, ev.chatId);
  if (!chatId) {
    deps.log("WARN", `[${rt.cfg.name}] menu_v6 无法解析 chatId (openId=${ev.openId}, key=${ev.eventKey})`);
    return;
  }

  deps.log("INFO", `[${rt.cfg.name}] 菜单点击 key=${ev.eventKey} openId=${ev.openId} chat=${chatId}`);

  const result = await handleMenuClick({
    eventKey: ev.eventKey,
    openId: ev.openId,
    chatId,
  });

  if (result.action === "reply") {
    await sender.sendMessage(result.text, undefined, chatId);
    return;
  }

  const chatKey = deps.makeChatKey(rt.cfg.id, result.chatId);
  const enqueued = deps.pushCommandToQueue(
    result.command,
    result.messageId,
    `daemon-${process.pid}`,
    chatKey,
    result.chatType,
  );
  if (!enqueued) {
    deps.log("WARN", `[${rt.cfg.name}] 菜单指令入队失败: ${result.command}`);
  }
}

/** 处理 bot_p2p_chat_entered_v1：节流后推送帮助 plain text */
export async function onFeishuP2pEntered(
  rt: FeishuHandlerRuntime,
  sender: LarkSender,
  ev: FeishuP2pEnteredEvent,
  deps: FeishuEventHandlerDeps,
): Promise<void> {
  deps.log("INFO", `[${rt.cfg.name}] 进入私聊 openId=${ev.openId} chat=${ev.chatId}`);

  const result = await handleP2pEntered({
    openId: ev.openId,
    chatId: ev.chatId,
  });

  if (result.action === "skip") {
    deps.log("DEBUG", `[${rt.cfg.name}] 帮助卡节流跳过 openId=${ev.openId}`);
    return;
  }

  const msgId = await sender.sendHelpCard(ev.chatId, result.helpMarkdown);
  if (!msgId) {
    deps.log("WARN", `[${rt.cfg.name}] 帮助卡发送失败 chat=${ev.chatId}`);
  }
}
