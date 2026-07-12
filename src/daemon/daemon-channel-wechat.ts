/**
 * 微信通道启动与群聊 gate 接线（经 deps 注入 pushMessage/handleCommand）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { WeChatManager } from "../bridge/wechat-manager.js";
import { makeChatKey } from "../shared/channel-types.js";
import { buildWechatBotAliases, shouldEnqueueWechatGroupMessage } from "./wechat-group-enqueue-gate.js";
import type { ChannelRuntime } from "./daemon-channel.js";

export interface WeChatChannelDeps {
  log: (level: string, ...args: unknown[]) => void;
  appDataDir: string;
  pushMessage: (
    content: string,
    messageId?: string,
    chatId?: string,
    chatType?: string,
    senderOpenId?: string,
  ) => Promise<void>;
  handleCommand: (
    text: string,
    messageId: string,
    chatId?: string,
    chatType?: string,
  ) => Promise<void>;
  isCommand: (text: string) => boolean;
  completeBind: (rt: ChannelRuntime, chatId: string, messageId?: string) => void;
}

function wechatDataDir(appDataDir: string, channelId: string): string {
  return path.join(appDataDir, "wechat-data", channelId);
}

function wechatStateFile(appDataDir: string, channelId: string): string {
  return path.join(wechatDataDir(appDataDir, channelId), "state.json");
}

function loadWechatState(
  deps: WeChatChannelDeps,
  rt: ChannelRuntime,
): void {
  try {
    const file = wechatStateFile(deps.appDataDir, rt.cfg.id);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (data.lastChatId) {
        rt.lastP2pChatId = data.lastChatId;
        deps.log("INFO", `[WeChat:${rt.cfg.name}] 已恢复 context 绑定: chatId=${rt.lastP2pChatId}`);
      }
    }
  } catch {
    /* ignore */
  }
}

function saveWechatState(deps: WeChatChannelDeps, rt: ChannelRuntime): void {
  try {
    const file = wechatStateFile(deps.appDataDir, rt.cfg.id);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ lastChatId: rt.lastP2pChatId }));
  } catch {
    /* ignore */
  }
}

/** 创建 WeChatManager 并接线入队 / 斜杠 / gate */
export function initWeChatChannel(rt: ChannelRuntime, deps: WeChatChannelDeps): WeChatManager {
  loadWechatState(deps, rt);
  const channelId = rt.cfg.id;
  return new WeChatManager({
    dataDir: wechatDataDir(deps.appDataDir, channelId),
    log: (level: string, ...args: unknown[]) => deps.log(level, `[${rt.cfg.name}]`, ...args),
    onMessage: (msg) => {
      const chatKey = makeChatKey(channelId, msg.chatId);
      const firstMessage = !rt.lastP2pChatId;
      if (msg.chatType === "p2p" && msg.chatId) {
        rt.lastP2pChatId = msg.chatId;
        saveWechatState(deps, rt);
      }
      if (rt.bindArmed && msg.chatType === "p2p" && msg.chatId) {
        deps.completeBind(rt, msg.chatId, msg.messageId);
        return;
      }
      if (firstMessage) {
        deps.log(
          "INFO",
          `[WeChat:${rt.cfg.name}] 首条消息已收到，context_token 已绑定（chatId=${msg.chatId}），不入队`,
        );
        return;
      }
      if (deps.isCommand(msg.text)) {
        deps.handleCommand(msg.text, msg.messageId, chatKey, msg.chatType).catch((e: unknown) =>
          deps.log(
            "ERROR",
            `[WeChat:${rt.cfg.name}] 指令处理失败: ${e instanceof Error ? e.message : e}`,
          ),
        );
        return;
      }
      // 群聊 @ 过滤（对齐飞书 isBotMentioned 位置）
      if (msg.chatType === "group") {
        const mode = rt.cfg.wechatGroupEnqueueMode ?? "mention_required";
        const aliases = buildWechatBotAliases(rt.cfg.name, rt.cfg.wechatBotDisplayName);
        if (!shouldEnqueueWechatGroupMessage({ text: msg.text, mode, botAliases: aliases })) {
          deps.log("INFO", `[WeChat:${rt.cfg.name}] wechat_group_skip chat=${msg.chatId}`);
          return;
        }
      }
      deps.pushMessage(msg.text, msg.messageId, chatKey, msg.chatType, msg.senderOpenId).catch(
        (e: unknown) =>
          deps.log(
            "WARN",
            `[WeChat:${rt.cfg.name}] 入队失败: ${e instanceof Error ? e.message : e}`,
          ),
      );
    },
    onQrCode: (dataUrl) => {
      process.stdout.write(`__WECHAT_QR__:${channelId}:${dataUrl}\n`);
    },
    onStatusChange: (status) => {
      process.stdout.write(`__WECHAT_STATUS__:${channelId}:${status}\n`);
    },
  });
}
