/**
 * 通道注册表：ChannelRuntime、resolve/pick/status、bind 与 warmup。
 * 飞书/微信启动分别在 daemon-channel-feishu|wechat；禁止 import queue/presentation。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createLarkClient, LarkSender } from "../bridge/lark-core.js";
import { WeChatManager } from "../bridge/wechat-manager.js";
import {
  makeChatKey,
  parseChatKey,
  type DaemonChannelConfig,
  type ChannelStatusInfo,
} from "../shared/channel-types.js";
import { startFeishuChannel as startFeishuChannelImpl } from "./daemon-channel-feishu.js";
import { initWeChatChannel as initWeChatChannelImpl } from "./daemon-channel-wechat.js";
import type { QueueMessageMeta } from "../bridge/file-queue.js";

export interface ChannelRuntime {
  cfg: DaemonChannelConfig;
  client?: ReturnType<typeof createLarkClient>;
  sender?: LarkSender;
  botOpenId?: string;
  /** 机器人应用名（bot/v3/info 的 app_name），用于协作名册 */
  botName?: string;
  feishuConnected?: boolean;
  wechat?: WeChatManager;
  /** 该通道最近一次私聊的原始 chatId */
  lastP2pChatId: string | null;
  /** 主用户绑定模式：下一条私聊消息绑定为主用户 */
  bindArmed: boolean;
}

export type ResolvedChannel =
  | { type: "wechat"; rt: ChannelRuntime; chatId: string }
  | { type: "feishu"; rt: ChannelRuntime; chatId?: string }
  | { type: "error"; message: string };

export interface ChannelRegistryDeps {
  log: (level: string, ...args: unknown[]) => void;
  workspaceDir: string;
  appDataDir: string;
  messagePrefix: string;
  encryptKey: string;
  httpJson: <T = unknown>(url: string, body?: unknown, timeoutMs?: number) => Promise<T>;
  resolveRawChatId: (sessionKey?: string) => string | undefined;
  pushMessage: (
    content: string,
    messageId?: string,
    chatId?: string,
    chatType?: string,
    senderOpenId?: string,
    replyMessageId?: string,
    meta?: QueueMessageMeta,
  ) => Promise<void>;
  handleCommand: (
    text: string,
    messageId: string,
    chatId?: string,
    chatType?: string,
    source?: string,
  ) => Promise<void>;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
  isCommand: (text: string) => boolean;
  handleMergeBatchAction: (
    sessionKey: string,
    action: string,
    text?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  tryHandleMergePreviewReply: (
    parentId: string | undefined,
    text: string,
    messageId: string,
    chatKey: string,
    chatType: string,
    senderOpenId?: string,
    meta?: QueueMessageMeta,
  ) => Promise<boolean>;
}

export async function replyViaResolvedChannel(
  log: (level: string, ...args: unknown[]) => void,
  resolveChannel: (sessionKey?: string) => ResolvedChannel,
  messageId: string,
  text: string,
  chatId?: string,
): Promise<void> {
  const ch = resolveChannel(chatId);
  if (ch.type === "error") { log("WARN", `回复失败: ${ch.message}`); return; }
  if (ch.type === "wechat") {
    try {
      const result = await ch.rt.wechat!.sendText(ch.chatId, text, { skipTyping: true });
      if (!result.ok) log("WARN", "微信回复失败");
    } catch (e: unknown) {
      log("WARN", `微信回复失败: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }
  if (ch.chatId) await ch.rt.sender!.sendMessage(text, undefined, ch.chatId);
  else await ch.rt.sender!.replyMessage(messageId, text);
}

export function isWechatChatId(rawChatId?: string): rawChatId is string {
  if (!rawChatId) return false;
  return (
    rawChatId.startsWith("wxid_") ||
    rawChatId.startsWith("wx_") ||
    rawChatId.includes("@chatroom") ||
    rawChatId.includes("@im.wechat")
  );
}

export function isFeishuChatId(rawChatId?: string): rawChatId is string {
  if (!rawChatId) return false;
  return rawChatId.startsWith("oc_");
}

/** 创建通道注册表并暴露 start/resolve API */
export function createChannelRegistry(deps: ChannelRegistryDeps) {
  const channels = new Map<string, ChannelRuntime>();

  function channelWorkspaceDir(rt: ChannelRuntime): string {
    return rt.cfg.workspaceDir?.trim() || deps.workspaceDir;
  }

  function isChannelConnected(rt: ChannelRuntime): boolean {
    if (rt.cfg.type === "feishu") return !!rt.feishuConnected && !!rt.sender;
    return rt.wechat?.isConnected() ?? false;
  }

  function getChannelStatusList(): ChannelStatusInfo[] {
    return [...channels.values()].map((rt) => ({
      id: rt.cfg.id,
      name: rt.cfg.name,
      type: rt.cfg.type,
      connected: isChannelConnected(rt),
      status: rt.cfg.type === "wechat"
        ? (rt.wechat?.getStatus() ?? "disconnected")
        : (rt.feishuConnected ? "connected" : "connecting"),
      mainUserBound: !!(rt.cfg.mainUserEnabled && rt.cfg.mainUserChatId),
      botName: rt.botName,
    }));
  }

  function channelDefaultChatId(rt: ChannelRuntime): string | null {
    if (rt.cfg.mainUserEnabled && rt.cfg.mainUserChatId) return rt.cfg.mainUserChatId;
    return rt.lastP2pChatId;
  }

  function pickChannel(channelId?: string): ChannelRuntime | null {
    if (channelId) {
      const rt = channels.get(channelId);
      if (rt) return rt;
    }
    for (const rt of channels.values()) {
      if (isChannelConnected(rt)) return rt;
    }
    return channels.values().next().value ?? null;
  }

  /** bind 成功后请求 Electron SDK 预热（fire-and-forget） */
  function postSdkWarmupRequest(rt: ChannelRuntime, source: string): void {
    if (!deps.appDataDir) return;
    try {
      const portFile = path.join(deps.appDataDir, "agent-api-port.json");
      if (!fs.existsSync(portFile)) return;
      const data = JSON.parse(fs.readFileSync(portFile, "utf-8")) as { port?: number };
      const port = data.port ?? 0;
      if (!port) return;
      void deps.httpJson(`http://127.0.0.1:${port}/api/sdk-warmup`, {
        source,
        channel_id: rt.cfg.id,
        workspace_dir: channelWorkspaceDir(rt),
      }, 5000).catch((e: unknown) => {
        deps.log("WARN", `[sdk_warmup] ${source} 请求失败: ${e instanceof Error ? e.message : String(e)}`);
      });
    } catch (e: unknown) {
      deps.log("WARN", `[sdk_warmup] ${source} 跳过: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function completeBind(rt: ChannelRuntime, chatId: string, messageId?: string): void {
    rt.bindArmed = false;
    rt.cfg.mainUserEnabled = true;
    rt.cfg.mainUserChatId = chatId;
    if (rt.sender) rt.sender.chatId = chatId;
    process.stdout.write(`__BIND_RESULT__:${JSON.stringify({ channelId: rt.cfg.id, chatId })}\n`);
    deps.log("INFO", `[Bind] 通道「${rt.cfg.name}」主用户绑定成功: ${chatId}`);
    void postSdkWarmupRequest(rt, "bind-daemon");
    if (messageId) {
      deps.replyToMessage(messageId, "✅ 主用户绑定成功！", makeChatKey(rt.cfg.id, chatId)).catch(() => {});
    }
  }

  function resolveChannel(sessionKey?: string): ResolvedChannel {
    const rawKey = deps.resolveRawChatId(sessionKey);
    if (rawKey) {
      const { channelId, chatId } = parseChatKey(rawKey);
      if (channelId) {
        const rt = channels.get(channelId);
        if (rt) {
          if (rt.cfg.type === "wechat") {
            return rt.wechat?.isConnected()
              ? { type: "wechat", rt, chatId }
              : { type: "error", message: `微信通道「${rt.cfg.name}」未连接` };
          }
          if (rt.sender) return { type: "feishu", rt, chatId };
          return { type: "error", message: `飞书通道「${rt.cfg.name}」未连接` };
        }
      }
      for (const rt of channels.values()) {
        if (rt.cfg.type === "wechat" && isWechatChatId(rawKey) && rt.wechat?.isConnected()) {
          return { type: "wechat", rt, chatId: rawKey };
        }
        if (rt.cfg.type === "feishu" && isFeishuChatId(rawKey) && rt.sender) {
          return { type: "feishu", rt, chatId: rawKey };
        }
      }
    }
    for (const rt of channels.values()) {
      const target = channelDefaultChatId(rt);
      if (!target || !isChannelConnected(rt)) continue;
      if (rt.cfg.type === "wechat") return { type: "wechat", rt, chatId: target };
      return { type: "feishu", rt, chatId: target };
    }
    for (const rt of channels.values()) {
      if (rt.cfg.type === "feishu" && rt.sender) return { type: "feishu", rt };
    }
    return { type: "error", message: "无可用消息通道" };
  }

  function resolveChannelRuntime(sessionKey: string): {
    rt: ChannelRuntime;
    rawKey: string;
    chatId: string;
  } | null {
    const rawKey = deps.resolveRawChatId(sessionKey);
    if (!rawKey) return null;
    const { channelId, chatId: raw } = parseChatKey(rawKey);
    let rt: ChannelRuntime | undefined;
    if (channelId) {
      rt = channels.get(channelId);
    } else {
      for (const c of channels.values()) {
        if (isWechatChatId(rawKey) && c.cfg.type === "wechat") { rt = c; break; }
        if (isFeishuChatId(rawKey) && c.cfg.type === "feishu") { rt = c; break; }
      }
    }
    if (!rt) return null;
    return { rt, rawKey, chatId: raw || rawKey };
  }

  async function startFeishuChannel(rt: ChannelRuntime): Promise<void> {
    return startFeishuChannelImpl(rt, {
      log: deps.log,
      messagePrefix: deps.messagePrefix,
      encryptKey: deps.encryptKey,
      channels,
      pushMessage: deps.pushMessage,
      handleCommand: deps.handleCommand,
      replyToMessage: deps.replyToMessage,
      isCommand: deps.isCommand,
      handleMergeBatchAction: deps.handleMergeBatchAction,
      tryHandleMergePreviewReply: deps.tryHandleMergePreviewReply,
      completeBind,
    });
  }

  function initWeChatChannel(rt: ChannelRuntime): WeChatManager {
    return initWeChatChannelImpl(rt, {
      log: deps.log,
      appDataDir: deps.appDataDir,
      pushMessage: deps.pushMessage,
      handleCommand: deps.handleCommand,
      isCommand: deps.isCommand,
      completeBind,
    });
  }

  return {
    channels,
    channelWorkspaceDir,
    isChannelConnected,
    getChannelStatusList,
    channelDefaultChatId,
    pickChannel,
    completeBind,
    postSdkWarmupRequest,
    resolveChannel,
    resolveChannelRuntime,
    startFeishuChannel,
    initWeChatChannel,
    isWechatChatId,
    isFeishuChatId,
  };
}
