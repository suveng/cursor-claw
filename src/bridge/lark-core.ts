/**
 * 飞书 Lark 门面：LarkSender 委托子模块；域外稳定 re-export 类型与工具。
 * 域外仍 `import from '../bridge/lark-core.js'`；禁止 barrel index.ts。
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import type { ShellToolDetail } from "../shared/tool-presentation.js";
import type {
  FeishuConnectionCallbacks,
  LarkMessageEvent,
  LarkSenderCtx,
  LarkSenderOptions,
  MergeBatchCardState,
  MergeBatchCardView,
  ParsedMessage,
  PresentationCardState,
} from "./lark-types.js";
import {
  addReaction as outboundAddReaction,
  containsAtTag,
  downloadImage as outboundDownloadImage,
  sendFile as outboundSendFile,
  sendImage as outboundSendImage,
  sendMessage as outboundSendMessage,
  sendStreamMessage as outboundSendStreamMessage,
  updateMessageContent as outboundUpdateMessageContent,
  replyMessage as outboundReplyMessage,
} from "./lark-sender-outbound.js";
import {
  closeStreamingCardMode as streamClose,
  createStreamingCardEntity as streamCreate,
  sendStreamingCardMessage as streamSend,
  updateStreamingCardText as streamUpdate,
} from "./lark-sender-stream.js";
import {
  createMergeBatchCardEntity as mergeCreate,
  renderMergeBatchCard as mergeRender,
  sendMergeBatchCardMessage as mergeSend,
  updateMergeBatchCardBody as mergeUpdate,
} from "./lark-sender-merge.js";
import {
  createToolProgressCardEntity as toolCreate,
  createThinkingCardEntity as thinkingCreate,
  renderThinkingCard as thinkingRender,
  renderToolProgressCard as toolRender,
  updateThinkingCardBody as thinkingUpdate,
  updateToolProgressCardBody as toolUpdate,
} from "./lark-sender-progress.js";
import {
  createHelpCardEntity as helpCreate,
  sendHelpCard as helpSend,
} from "./lark-sender-help.js";
import {
  parseMessageContent as parseContent,
  processIncomingMessage as parseProcess,
} from "./lark-sender-parse.js";
import { startConnection as connStart } from "./lark-sender-connection.js";

// 域外稳定入口：类型与工具仍从 lark-core 再导出
export type {
  PresentationCardState,
  MergeBatchCardView,
  MergeBatchCardState,
  LarkSenderOptions,
  LarkSenderCtx,
  ParsedMessage,
  LarkMention,
  LarkMessageEvent,
  FeishuMenuEvent,
  FeishuP2pEnteredEvent,
  FeishuCardActionEvent,
  FeishuCardActionToastResponse,
  FeishuConnectionCallbacks,
} from "./lark-types.js";
export {
  MEDIA_CACHE_DIR,
  cleanupMediaCache,
  stripProxyEnv,
  localTimestamp,
  createLarkClient,
} from "./lark-utils.js";

/** 飞书发送门面：公开实例方法签名不变，实现委托子模块 */
export class LarkSender {
  private client: Lark.Client;
  private messagePrefix: string;
  private log: (level: string, ...args: unknown[]) => void;

  chatId: string | null = null;

  constructor(opts: LarkSenderOptions) {
    this.client = opts.client;
    this.messagePrefix = opts.messagePrefix;
    this.log = opts.log;
    if (opts.chatId) this.chatId = opts.chatId;
  }

  /** 组装子模块上下文（chatId 每次读取以反映外部赋值） */
  private ctx(): LarkSenderCtx {
    return {
      client: this.client,
      log: this.log,
      messagePrefix: this.messagePrefix,
      chatId: this.chatId,
    };
  }

  async fetchMessageContent(messageId: string): Promise<string | null> {
    try {
      const res = await this.client.im.message.get({
        path: { message_id: messageId },
        params: { card_msg_content_type: "user_card_content" } as any,
      });
      const item = (res as any)?.data?.items?.[0];
      const content = item?.body?.content;
      if (!content) return null;
      const msgType: string = item?.msg_type ?? "text";
      this.log("DEBUG", `fetchMessageContent(${messageId}) type=${msgType} content=${content.substring(0, 200)}`);
      const result = await this.processIncomingMessage(messageId, msgType, content);
      return result ? result.replace(/@_user_\d+\s?/g, "").trim() || null : null;
    } catch (e: any) {
      this.log("WARN", `拉取消息内容失败 (${messageId}): ${e?.message ?? e}`);
      return null;
    }
  }

  /** 含 `<at user_id=` 时需用 text 消息才能产生真实 mention */
  static containsAtTag(text: string): boolean {
    return containsAtTag(text);
  }

  async sendStreamMessage(text: string, chatId?: string, title?: string): Promise<string | undefined> {
    return outboundSendStreamMessage(this.ctx(), text, chatId, title);
  }

  async updateMessageContent(messageId: string, text: string, title?: string): Promise<boolean> {
    return outboundUpdateMessageContent(this.ctx(), messageId, text, title);
  }

  async createStreamingCardEntity(title?: string): Promise<{ cardId: string; elementId: string } | null> {
    return streamCreate(this.ctx(), title);
  }

  async sendStreamingCardMessage(chatId: string, cardId: string, replyMessageId?: string): Promise<string | null> {
    return streamSend(this.ctx(), chatId, cardId, replyMessageId);
  }

  async updateStreamingCardText(cardId: string, elementId: string, text: string, sequence: number): Promise<boolean> {
    return streamUpdate(this.ctx(), cardId, elementId, text, sequence);
  }

  async createMergeBatchCardEntity(view: MergeBatchCardView): Promise<{ cardId: string; elementId: string } | null> {
    return mergeCreate(this.ctx(), view);
  }

  async sendMergeBatchCardMessage(chatId: string, cardId: string, replyMessageId?: string): Promise<string | null> {
    return mergeSend(this.ctx(), chatId, cardId, replyMessageId);
  }

  async updateMergeBatchCardBody(
    cardId: string, elementId: string, view: MergeBatchCardView, sequence: number,
  ): Promise<boolean> {
    return mergeUpdate(this.ctx(), cardId, elementId, view, sequence);
  }

  async renderMergeBatchCard(
    chatId: string, view: MergeBatchCardView, existing?: MergeBatchCardState, replyMessageId?: string,
  ): Promise<MergeBatchCardState | null> {
    return mergeRender(this.ctx(), chatId, view, existing, replyMessageId);
  }

  async createHelpCardEntity(markdown: string): Promise<{ cardId: string } | null> {
    return helpCreate(this.ctx(), markdown);
  }

  async sendHelpCard(chatId: string, markdown: string): Promise<string | null> {
    return helpSend(this.ctx(), chatId, markdown);
  }

  async createToolProgressCardEntity(
    toolName: string, status: "started" | "completed" | "failed", shellDetail?: ShellToolDetail,
  ): Promise<{ cardId: string; elementId: string } | null> {
    return toolCreate(this.ctx(), toolName, status, shellDetail);
  }

  async updateToolProgressCardBody(
    cardId: string, elementId: string, toolName: string,
    status: "started" | "completed" | "failed", sequence: number, shellDetail?: ShellToolDetail,
  ): Promise<boolean> {
    return toolUpdate(this.ctx(), cardId, elementId, toolName, status, sequence, shellDetail);
  }

  async renderToolProgressCard(
    chatId: string, toolName: string, status: "started" | "completed" | "failed",
    existing?: PresentationCardState, replyMessageId?: string, shellDetail?: ShellToolDetail,
  ): Promise<PresentationCardState | null> {
    return toolRender(this.ctx(), chatId, toolName, status, existing, replyMessageId, shellDetail);
  }

  async createThinkingCardEntity(summary: string): Promise<{ cardId: string; elementId: string } | null> {
    return thinkingCreate(this.ctx(), summary);
  }

  async updateThinkingCardBody(
    cardId: string, elementId: string, summary: string, sequence: number,
  ): Promise<boolean> {
    return thinkingUpdate(this.ctx(), cardId, elementId, summary, sequence);
  }

  async renderThinkingCard(
    chatId: string, summary: string, existing?: PresentationCardState,
    replyMessageId?: string, final?: boolean,
  ): Promise<PresentationCardState | null> {
    return thinkingRender(this.ctx(), chatId, summary, existing, replyMessageId, final);
  }

  async closeStreamingCardMode(cardId: string, sequence: number): Promise<boolean> {
    return streamClose(this.ctx(), cardId, sequence);
  }

  async replyMessage(messageId: string, text: string, title?: string): Promise<string | undefined> {
    return outboundReplyMessage(this.ctx(), messageId, text, title);
  }

  async sendMessage(text: string, replyMessageId?: string, chatId?: string, title?: string): Promise<string | undefined> {
    return outboundSendMessage(this.ctx(), text, replyMessageId, chatId, title);
  }

  async addReaction(messageId: string, emojiType: string = "Get"): Promise<boolean> {
    return outboundAddReaction(this.ctx(), messageId, emojiType);
  }

  async sendImage(imagePath: string, replyMessageId?: string, chatId?: string): Promise<void> {
    return outboundSendImage(this.ctx(), imagePath, replyMessageId, chatId);
  }

  async sendFile(filePath: string, replyMessageId?: string, chatId?: string): Promise<void> {
    return outboundSendFile(this.ctx(), filePath, replyMessageId, chatId);
  }

  async downloadImage(messageId: string, imageKey: string): Promise<string | null> {
    return outboundDownloadImage(this.ctx(), messageId, imageKey);
  }

  static parseMessageContent(messageId: string, messageType: string, content: string): ParsedMessage {
    return parseContent(messageId, messageType, content);
  }

  async processIncomingMessage(messageId: string, messageType: string, content: string): Promise<string> {
    return parseProcess(this.ctx(), messageId, messageType, content);
  }

  startConnection(
    appId: string, appSecret: string, encryptKey: string,
    onMessage: (event: LarkMessageEvent) => void, callbacks?: FeishuConnectionCallbacks,
  ): void {
    connStart(this.ctx(), appId, appSecret, encryptKey, onMessage, callbacks);
  }
}
