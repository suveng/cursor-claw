/** 消息队列共享类型定义（入队 meta、领取体、管理面视图） */

/** 入队时附带的会话/发送者上下文 */
export interface QueueMessageMeta {
  chatType?: string;
  senderOpenId?: string;
  senderType?: string;
  botOpenId?: string;
  botName?: string;
  botRoster?: string;
  quotedContent?: string;
}

/** 领取/解析后的队列消息体 */
export interface QueueMessage {
  text: string;
  messageId: string;
  sessionKey: string;
  /** 入队时间戳（毫秒），按此升序投递；Agent 合并回复时取最大者确认整批 */
  timestamp: number;
  /** 消息上下文：会话类型、发送者、机器人身份/名册、引用原文 */
  meta?: QueueMessageMeta;
}

/** 管理面队列列表单项 */
export interface QueueMessageView {
  index: number;
  fileId: string;
  preview: string;
  sessionKey?: string;
  chatType?: string;
  timestamp?: number;
  senderOpenId?: string;
}

/** 去重会话摘要（管理面/路由用） */
export interface QueueSessionInfo {
  sessionKey: string;
  chatType: string;
  senderOpenId?: string;
}
