import type * as Lark from "@larksuiteoapi/node-sdk";

/** 流式 / 工具 / 思考等 CardKit 实体的通用句柄 */
export interface PresentationCardState {
  cardEntityId: string;
  cardMessageId: string;
  cardSequence: number;
}

/** 合并批次卡展示视图（标题 / Markdown 正文 / 页脚） */
export interface MergeBatchCardView {
  title: string;
  bodyMarkdown: string;
  footerText: string;
}

/** 合并批次卡实体状态 */
export interface MergeBatchCardState {
  cardEntityId: string;
  cardMessageId: string;
  cardSequence: number;
}

/** LarkSender 构造选项 */
export interface LarkSenderOptions {
  client: Lark.Client;
  chatId: string;
  messagePrefix: string;
  log: (level: string, ...args: unknown[]) => void;
}

/** 子模块委托用的运行时上下文（与 LarkSender 实例字段对齐） */
export interface LarkSenderCtx {
  client: Lark.Client;
  log: (level: string, ...args: unknown[]) => void;
  messagePrefix: string;
  /** 当前默认 chatId，与 LarkSender.chatId 同步读取 */
  chatId: string | null;
}

/** 入站解析后的文本与图片 key */
export interface ParsedMessage {
  text: string;
  imageKeys: { messageId: string; imageKey: string }[];
}

/** 飞书 @ 提及 */
export interface LarkMention {
  key: string;
  id: string;
  name: string;
}

/** 飞书入站消息事件（供 daemon 消费） */
export interface LarkMessageEvent {
  text: string;
  messageId: string;
  chatId: string;
  chatType: string;
  messageType: string;
  rawContent: string;
  senderOpenId?: string;
  /** "user" | "app"（app = 其他机器人发送） */
  senderType?: string;
  parentId?: string;
  mentions: LarkMention[];
}

/** 飞书自定义菜单点击事件（application.bot.menu_v6） */
export interface FeishuMenuEvent {
  eventKey: string;
  openId: string;
  /** 部分场景无 chat_id，由 daemon 回退解析 */
  chatId: string;
}

/** 用户进入机器人私聊事件（bot_p2p_chat_entered_v1） */
export interface FeishuP2pEnteredEvent {
  openId: string;
  chatId: string;
}

/** 卡片按钮点击事件（card.action.trigger） */
export interface FeishuCardActionEvent {
  /** 按钮 value.action，如 merge_send_now */
  action: string;
  openId: string;
  openChatId: string;
  /** 按钮原始 value 对象，供上层扩展字段 */
  rawValue?: Record<string, unknown>;
}

/** 飞书 card.action.trigger 回调响应（toast 等，由 EventDispatcher handler 透传回 SDK） */
export interface FeishuCardActionToastResponse {
  toast: { type: string; content: string };
}

/** startConnection 可选事件回调 */
export interface FeishuConnectionCallbacks {
  onMenuV6?: (event: FeishuMenuEvent) => void | Promise<void>;
  onP2pEntered?: (event: FeishuP2pEnteredEvent) => void | Promise<void>;
  onCardAction?: (
    event: FeishuCardActionEvent,
  ) => FeishuCardActionToastResponse | void | Promise<FeishuCardActionToastResponse | void>;
}
