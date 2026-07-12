/**
 * 微信群聊入队门控纯函数（SSOT）。
 * ponytail: iLink WeixinMessage 无 mention 元数据，首版用正文 @ 启发式；
 * 联调后可扩展为协议层 mention 字段或 sender 白名单。
 */

/** 群聊入队策略（与 DaemonChannelConfig.wechatGroupEnqueueMode 对齐） */
export type WechatGroupEnqueueMode = "mention_required" | "all";

/** 从通道 name + 可选显示名拼 @ 匹配别名（大小写不敏感去重） */
export function buildWechatBotAliases(name: string, displayName?: string): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const raw of [name, displayName]) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(trimmed);
  }
  return aliases;
}

/** 群聊消息是否应入队（私聊不经此函数） */
export function shouldEnqueueWechatGroupMessage(opts: {
  text: string;
  mode: WechatGroupEnqueueMode;
  botAliases: string[];
}): boolean {
  const { text, mode, botAliases } = opts;
  if (mode === "all") return true;

  const body = text.trim();
  if (!body) return false;

  // @所有人 / @all 视为命中（群管理广播场景）
  if (/@(所有人|all)(?:\s|$|[，,。.!！?？])/i.test(body)) return true;

  // 启发式：正文含 @ + 机器人别名（大小写不敏感）
  for (const alias of botAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`@${escaped}(?:\\s|$|[，,。.!！?？])`, "i");
    if (re.test(body)) return true;
  }
  return false;
}
