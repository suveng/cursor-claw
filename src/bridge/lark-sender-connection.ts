/**
 * 飞书 WebSocket 连接：EventDispatcher 注册与 WSClient 启动。
 * card.action.trigger 须 return await onCardAction；未提供回调时 early return。
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import type {
  FeishuConnectionCallbacks,
  LarkMention,
  LarkMessageEvent,
  LarkSenderCtx,
} from "./lark-types.js";
import { parseMessageContent } from "./lark-sender-parse.js";

/** 启动飞书 WS 长连接并注册事件 handler */
export function startConnection(
  ctx: LarkSenderCtx,
  appId: string,
  appSecret: string,
  encryptKey: string,
  onMessage: (event: LarkMessageEvent) => void,
  callbacks?: FeishuConnectionCallbacks,
): void {
  const eventDispatcher = new Lark.EventDispatcher(encryptKey ? { encryptKey } : {}).register({
    // 入队 Get 表情会触发 reaction 回推；空 handler 避免 SDK 打 no handle WARN
    "im.message.reaction.created_v1": () => { /* ignore */ },
    // 自定义菜单点击（推送事件类菜单）
    "application.bot.menu_v6": (data) => {
      if (!callbacks?.onMenuV6) return;
      try {
        const raw = data as Record<string, unknown>;
        const operator = raw.operator as { operator_id?: { open_id?: string } } | undefined;
        const eventKey = String(raw.event_key ?? "");
        const openId = String(operator?.operator_id?.open_id ?? "");
        const chatId = String(raw.chat_id ?? "");
        if (!eventKey || !openId) {
          ctx.log("WARN", `menu_v6 事件缺少 event_key/openId: ${JSON.stringify(raw).slice(0, 200)}`);
          return;
        }
        void Promise.resolve(callbacks.onMenuV6({ eventKey, openId, chatId })).catch((e: unknown) => {
          ctx.log("ERROR", `menu_v6 回调异常: ${e instanceof Error ? e.message : e}`);
        });
      } catch (e: unknown) {
        ctx.log("ERROR", `menu_v6 事件处理异常: ${e instanceof Error ? e.message : e}`);
      }
    },
    // 用户进入机器人私聊
    "im.chat.access_event.bot_p2p_chat_entered_v1": (data) => {
      if (!callbacks?.onP2pEntered) return;
      try {
        const raw = data as Record<string, unknown>;
        const operatorId = raw.operator_id as { open_id?: string } | undefined;
        const openId = String(operatorId?.open_id ?? "");
        const chatId = String(raw.chat_id ?? "");
        if (!openId || !chatId) {
          ctx.log("WARN", `p2p_entered 事件缺少 openId/chatId: ${JSON.stringify(raw).slice(0, 200)}`);
          return;
        }
        void Promise.resolve(callbacks.onP2pEntered({ openId, chatId })).catch((e: unknown) => {
          ctx.log("ERROR", `p2p_entered 回调异常: ${e instanceof Error ? e.message : e}`);
        });
      } catch (e: unknown) {
        ctx.log("ERROR", `p2p_entered 事件处理异常: ${e instanceof Error ? e.message : e}`);
      }
    },
    // 卡片按钮点击；handler 须 return toast 载荷供 SDK 回传飞书
    "card.action.trigger": async (data: unknown) => {
      if (!callbacks?.onCardAction) return;
      try {
        const raw = data as Record<string, unknown>;
        const operator = raw.operator as { operator_id?: { open_id?: string } } | undefined;
        const openId = String(operator?.operator_id?.open_id ?? "");
        const openChatId = String(raw.open_chat_id ?? raw.chat_id ?? "");
        const actionObj = raw.action as { value?: Record<string, unknown> } | undefined;
        const rawValue = actionObj?.value;
        const action = String(rawValue?.action ?? "");
        if (!action || !openId || !openChatId) {
          ctx.log("WARN", `card.action.trigger 缺少 action/openId/openChatId: ${JSON.stringify(raw).slice(0, 200)}`);
          return;
        }
        return await callbacks.onCardAction({
          action,
          openId,
          openChatId,
          rawValue,
        });
      } catch (e: unknown) {
        ctx.log("ERROR", `card.action.trigger 回调异常: ${e instanceof Error ? e.message : e}`);
      }
    },
    "im.message.receive_v1": (data) => {
      try {
        const msg = (data as any)?.message;
        const senderObj = (data as any)?.sender;
        const messageId: string = msg?.message_id ?? "";
        const chatId: string = msg?.chat_id ?? "";
        const chatType: string = msg?.chat_type ?? "p2p";
        const rawContent: string = msg?.content ?? "";
        const messageType: string = msg?.message_type ?? "text";
        let text = rawContent;
        try {
          text = parseMessageContent(messageId, messageType, rawContent).text || rawContent;
        } catch { /* use raw */ }
        const senderOpenId = senderObj?.sender_id?.open_id;
        const senderType: string = senderObj?.sender_type ?? "user";
        ctx.log("DEBUG", `sender raw: ${JSON.stringify(senderObj)}`);
        const parentId: string = msg?.parent_id ?? "";
        const mentions: LarkMention[] = (msg?.mentions ?? []).map((m: any) => ({
          key: m.key ?? "",
          id: m.id?.open_id ?? "",
          name: m.name ?? "",
        }));
        onMessage({
          text, messageId, chatId, chatType, messageType, rawContent,
          senderOpenId, senderType, parentId: parentId || undefined, mentions,
        });
      } catch (e: any) {
        ctx.log("ERROR", `事件处理异常: ${e?.message ?? e}`);
      }
    },
  });
  const wsClient = new Lark.WSClient({ appId, appSecret, loggerLevel: Lark.LoggerLevel.error });
  wsClient.start({ eventDispatcher })
    .then(() => ctx.log("INFO", "飞书 WebSocket 连接建立成功"))
    .catch((e: any) => ctx.log("ERROR", `飞书 WebSocket 连接失败: ${e?.message ?? e}`));
}
