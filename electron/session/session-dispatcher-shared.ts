/**
 * 会话调度 — 跨子模块共享工具（无 launch/chat 依赖，避免循环 import）
 */
import { getChannel } from "../config/config-store"
import { parseChatKey } from "../../src/shared/channel-types"

/** 会话展示名缓存（chatId / openId → 名称） */
export const chatNameCache = new Map<string, string>()

/** chatId 为 chatKey（`channelId|rawChatId`）；按所属通道的主用户绑定判断 */
export function isMainUser(chatId?: string, chatType?: string): boolean {
  if (chatType !== "p2p" || !chatId) return false
  const { channelId, chatId: raw } = parseChatKey(chatId)
  const channel = getChannel(channelId)
  if (!channel?.mainUserEnabled || !channel.mainUserChatId?.trim()) return false
  return raw === channel.mainUserChatId.trim()
}

/** 从 sessionKey 提取 chatId（`::` 前缀） */
export function extractChatId(sessionKey: string): string {
  const idx = sessionKey.indexOf("::")
  return idx > 0 ? sessionKey.slice(0, idx) : sessionKey
}

/** 格式化运行时长（供 /chat ls 等展示） */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  return `${Math.floor(m / 60)}h${m % 60}m`
}
