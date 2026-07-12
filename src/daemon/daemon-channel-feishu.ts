/**
 * 飞书通道启动：WS 长连接、@ 过滤、入队与菜单/合并卡接线。
 */
import {
  createLarkClient,
  LarkSender,
  type LarkMessageEvent,
  type FeishuMenuEvent,
  type FeishuP2pEnteredEvent,
} from "../bridge/lark-core.js";
import { makeChatKey } from "../shared/channel-types.js";
import type { QueueMessageMeta } from "../bridge/file-queue.js";
import { onFeishuMenuV6, onFeishuP2pEntered } from "./feishu-event-handlers.js";
import { onFeishuCardAction } from "./feishu-card-action.js";
import type { ChannelRuntime } from "./daemon-channel.js";

export interface FeishuChannelDeps {
  log: (level: string, ...args: unknown[]) => void;
  messagePrefix: string;
  encryptKey: string;
  channels: Map<string, ChannelRuntime>;
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
  completeBind: (rt: ChannelRuntime, chatId: string, messageId?: string) => void;
}

function isBotMentioned(rt: ChannelRuntime, ev: LarkMessageEvent): boolean {
  if (!rt.botOpenId) return ev.mentions.length > 0;
  return ev.mentions.some((m) => m.id === rt.botOpenId || m.key === "@_all");
}

/**
 * 将 `@_user_N` 占位符还原为可读形式：
 * - @自己 → 删除；@其他人 → `@名字(open_id=ou_xxx)`
 */
function resolveMentionTags(
  text: string,
  mentions: LarkMessageEvent["mentions"],
  selfOpenId?: string,
): string {
  let out = text;
  for (const m of mentions) {
    if (!m.key) continue;
    const replacement =
      (selfOpenId && m.id === selfOpenId) || m.key === "@_all"
        ? ""
        : m.id
          ? `@${m.name}(open_id=${m.id})`
          : `@${m.name}`;
    out = out.split(m.key).join(replacement);
  }
  return out.replace(/@_user_\d+/g, "").replace(/\s{2,}/g, " ").trim();
}

/** 同实例其他飞书机器人名册（互相感知） */
function buildBotRoster(channels: Map<string, ChannelRuntime>, self: ChannelRuntime): string {
  const peers: string[] = [];
  for (const rt of channels.values()) {
    if (rt.cfg.type !== "feishu" || rt === self || !rt.botOpenId) continue;
    peers.push(`${rt.botName ?? rt.cfg.name}=${rt.botOpenId}`);
  }
  return peers.join(", ");
}

/** 启动单通道飞书 WS；乐观置位 feishuConnected */
export async function startFeishuChannel(
  rt: ChannelRuntime,
  deps: FeishuChannelDeps,
): Promise<void> {
  const { appId, appSecret } = rt.cfg;
  if (!appId || !appSecret) {
    deps.log("ERROR", `[${rt.cfg.name}] 飞书凭据未配置`);
    return;
  }

  rt.client = createLarkClient(appId, appSecret);
  rt.sender = new LarkSender({
    client: rt.client,
    chatId: rt.cfg.mainUserEnabled ? rt.cfg.mainUserChatId : "",
    messagePrefix: deps.messagePrefix,
    log: (level: string, ...args: unknown[]) => deps.log(level, `[${rt.cfg.name}]`, ...args),
  });

  try {
    const botInfo = (await rt.client.request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
    })) as { bot?: { open_id?: string; app_name?: string } };
    rt.botOpenId = botInfo?.bot?.open_id;
    rt.botName = botInfo?.bot?.app_name || rt.cfg.name;
    if (rt.botOpenId) {
      deps.log("INFO", `[${rt.cfg.name}] 机器人 open_id: ${rt.botOpenId} (${rt.botName})`);
    } else {
      deps.log("WARN", `[${rt.cfg.name}] 未能获取机器人 open_id，群消息过滤将使用宽松模式`);
    }
  } catch (e: unknown) {
    deps.log(
      "WARN",
      `[${rt.cfg.name}] 获取机器人信息失败: ${e instanceof Error ? e.message : e}`,
    );
  }

  const sender = rt.sender;
  const feishuEventDeps = {
    log: deps.log,
    handleSlashCommand: deps.handleCommand,
    makeChatKey,
  };
  sender.startConnection(appId, appSecret, deps.encryptKey, (ev) => {
    rt.feishuConnected = true;
    const { text, messageId, chatId, chatType, messageType, rawContent, senderOpenId, parentId } = ev;
    const chatKey = makeChatKey(rt.cfg.id, chatId);

    if (chatType === "p2p" && chatId) {
      rt.lastP2pChatId = chatId;
      if (rt.bindArmed) {
        deps.completeBind(rt, chatId, messageId);
        return;
      }
      if (!sender.chatId) {
        sender.chatId = chatId;
        deps.log("INFO", `[${rt.cfg.name}] 自动绑定默认 chat_id: ${chatId}`);
      }
    }

    if (chatType === "group" && !isBotMentioned(rt, ev)) {
      return;
    }

    const cleanText =
      chatType === "group" ? resolveMentionTags(text, ev.mentions, rt.botOpenId) : text;
    deps.log(
      "INFO",
      `[${rt.cfg.name}] 收到消息 [${chatType}] chat=${chatId} sender=${senderOpenId ?? "?"}${ev.senderType === "app" ? "(bot)" : ""}${parentId ? ` reply=${parentId}` : ""}: ${cleanText.slice(0, 100)}`,
    );

    if (messageType === "text" && deps.isCommand(cleanText)) {
      deps.handleCommand(cleanText, messageId, chatKey, chatType).catch((e: unknown) =>
        deps.log("ERROR", `指令处理失败: ${e instanceof Error ? e.message : e}`),
      );
      return;
    }

    const enqueue = async (content: string) => {
      const meta: QueueMessageMeta = {
        senderType: ev.senderType === "app" ? "bot" : "user",
      };
      if (rt.botOpenId) {
        meta.botOpenId = rt.botOpenId;
        meta.botName = rt.botName ?? rt.cfg.name;
      }
      if (chatType === "group") {
        const roster = buildBotRoster(deps.channels, rt);
        if (roster) meta.botRoster = roster;
      }
      if (parentId) {
        const original = await sender.fetchMessageContent(parentId);
        if (original) meta.quotedContent = original;
      }
      if (messageType === "text") {
        const handled = await deps.tryHandleMergePreviewReply(
          parentId,
          content,
          messageId,
          chatKey,
          chatType,
          senderOpenId,
          meta,
        );
        if (handled) return;
      }
      await deps.pushMessage(content, messageId, chatKey, chatType, senderOpenId, parentId, meta);
    };

    if (messageType === "text") {
      void enqueue(cleanText);
    } else {
      sender
        .processIncomingMessage(messageId, messageType, rawContent)
        .then((result) => enqueue(result || cleanText))
        .catch(() => enqueue(cleanText));
    }
  }, {
    onMenuV6: (ev: FeishuMenuEvent) => {
      onFeishuMenuV6(rt, sender, ev, feishuEventDeps).catch((e: unknown) => {
        deps.log("ERROR", `[${rt.cfg.name}] menu_v6 处理失败: ${e instanceof Error ? e.message : e}`);
      });
    },
    onP2pEntered: (ev: FeishuP2pEnteredEvent) => {
      onFeishuP2pEntered(rt, sender, ev, feishuEventDeps).catch((e: unknown) => {
        deps.log(
          "ERROR",
          `[${rt.cfg.name}] p2p_entered 处理失败: ${e instanceof Error ? e.message : e}`,
        );
      });
    },
    onCardAction: (ev) =>
      onFeishuCardAction(rt, sender, ev, {
        log: deps.log,
        makeChatKey,
        handleMergeBatchAction: deps.handleMergeBatchAction,
        replyToMessage: deps.replyToMessage,
      }).catch((e: unknown) => {
        deps.log(
          "ERROR",
          `[${rt.cfg.name}] 合并卡按钮回调失败: ${e instanceof Error ? e.message : e}`,
        );
      }),
  });
  // WSClient.start 为异步建立；这里乐观置位，错误会在日志中体现
  rt.feishuConnected = true;
}
