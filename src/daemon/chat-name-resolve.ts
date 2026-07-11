/**
 * 按 chat_type 解析会话/对方名称（入队拼尾、launch 透传共用）。
 * 复用与 /api/chat-names、/api/user-names 相同的 Lark client 调用；失败由调用方 WARN 后 omit。
 */

import { parseChatKey } from "../shared/channel-types.js";

/** 仅需 im.chat.get / contact.user.get 的最小 client 面 */
export type LarkNameClient = {
  im: { chat: { get: (opts: { path: { chat_id: string } }) => Promise<unknown> } };
  contact: {
    user: {
      get: (opts: {
        path: { user_id: string };
        params: { user_id_type: string };
      }) => Promise<unknown>;
    };
  };
};

/** 通道条目：与 daemon ChannelRuntime 的拉名相关字段对齐 */
export type FeishuNameChannel = {
  cfg: { type: string };
  client?: LarkNameClient;
};

export type ResolveLaunchChatNameOpts = {
  chatType: string;
  /** session 的 chatKey（可能含 ch_ 前缀） */
  chatId: string;
  senderOpenId?: string;
  /**
   * 全部通道（daemon `channels` Map）。
   * client 用宽松类型，避免与 Lark SDK 返回值精确对齐。
   */
  channels: {
    get(id: string): { cfg: { type: string }; client?: unknown } | undefined;
    values(): IterableIterator<{ cfg: { type: string }; client?: unknown }>;
  };
  /** WARN 回调；解析失败时调用，不抛错 */
  logWarn: (message: string) => void;
};

function isGroupChatType(chatType: string): boolean {
  const t = chatType.trim().toLowerCase();
  return t === "group" || t.includes("group");
}

function isP2pChatType(chatType: string): boolean {
  const t = chatType.trim().toLowerCase();
  return t === "p2p" || t.includes("p2p");
}

function pickFeishuClient(
  channels: ResolveLaunchChatNameOpts["channels"],
  chatKey: string,
): { client: LarkNameClient; rawChatId: string } | null {
  const { channelId, chatId: rawChatId } = parseChatKey(chatKey);
  const rt = channelId
    ? channels.get(channelId)
    : [...channels.values()].find((c) => c.cfg.type === "feishu" && c.client);
  const client = rt?.client as LarkNameClient | undefined;
  if (!client) return null;
  return { client, rawChatId: rawChatId || chatKey };
}

function feishuClients(
  channels: ResolveLaunchChatNameOpts["channels"],
): LarkNameClient[] {
  return [...channels.values()]
    .filter((c) => c.cfg.type === "feishu" && c.client)
    .map((c) => c.client as LarkNameClient);
}

/**
 * 按 chat_type 解析名称（群名 / 私聊对方显示名）。
 * 有名返回 trim 后字符串；无名/失败返回 undefined（调用方 omit 或不拼尾）。
 */
export async function resolveLaunchChatName(
  opts: ResolveLaunchChatNameOpts,
): Promise<string | undefined> {
  const { chatType, chatId, senderOpenId, channels, logWarn } = opts;

  try {
    if (isGroupChatType(chatType)) {
      const picked = pickFeishuClient(channels, chatId);
      if (!picked) return undefined;
      const r = (await picked.client.im.chat.get({
        path: { chat_id: picked.rawChatId },
      })) as { data?: { name?: string; chat?: { name?: string } } };
      const name = (r?.data?.name || r?.data?.chat?.name)?.trim();
      return name || undefined;
    }

    if (isP2pChatType(chatType)) {
      const oid = senderOpenId?.trim();
      if (!oid) return undefined;
      const clients = feishuClients(channels);
      if (clients.length === 0) return undefined;
      // 与 /api/user-names 一致：多 client 轮询；全部失败则 WARN 一次
      let lastErr: unknown;
      for (const client of clients) {
        try {
          const r = (await client.contact.user.get({
            path: { user_id: oid },
            params: { user_id_type: "open_id" },
          })) as { data?: { user?: { name?: string } } };
          const name = r?.data?.user?.name?.trim();
          if (name) return name;
          lastErr = undefined;
        } catch (e: unknown) {
          lastErr = e;
        }
      }
      if (lastErr) {
        logWarn(
          `chat_name_resolve user-get failed open_id=${oid}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
        );
      }
      return undefined;
    }

    return undefined;
  } catch (e: unknown) {
    logWarn(
      `chat_name_resolve failed chat_type=${chatType} chat_id=${chatId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
}
