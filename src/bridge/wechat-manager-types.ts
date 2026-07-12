/** WeChatManager 对外类型（与实现分文件以满足 ≤300） */

export interface WeChatIncomingMessage {
  text: string;
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderOpenId: string;
  senderName?: string;
}

export type WeChatStatus = "disconnected" | "qr_pending" | "logging_in" | "connected" | "error";

export interface WeChatManagerOptions {
  dataDir: string;
  log: (level: string, ...args: unknown[]) => void;
  onMessage: (msg: WeChatIncomingMessage) => void;
  onQrCode?: (dataUrl: string) => void;
  onStatusChange?: (status: WeChatStatus) => void;
}

export interface WeChatSendOptions {
  /** 默认 true：不绑定 typing 生命周期，由 daemon 进度状态机驱动 */
  skipTyping?: boolean;
}

/** 微信出站结果；outboundId 形如 wxc_<clientId>，供 daemon trackMessageSession */
export interface WeChatSendResult {
  ok: boolean;
  outboundId?: string;
}
