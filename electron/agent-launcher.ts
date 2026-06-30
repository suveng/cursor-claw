/**
 * SDK / Claude Code 共享：会话类型、Prompt 构建、会话名解析。
 * CLI spawn 路径已移除（T7）；执行由 session-dispatcher → SDK/CC 负责。
 */

export type ChatType = "p2p" | "group" | "task" | "temp" | "workflow"

let chatNameResolver: ((chatId: string) => string | undefined) | null = null

export function setChatNameResolver(fn: (chatId: string) => string | undefined): void {
  chatNameResolver = fn
}

/** 广播时实时解析会话名：优先会话自带名，否则按 chatId / senderOpenId 查缓存 */
export function resolveSessionChatName(
  sessionKey: string,
  chatName?: string,
  senderOpenId?: string,
): string | undefined {
  if (chatName) return chatName
  const chatId = sessionKey.includes("::") ? sessionKey.split("::")[0] : sessionKey
  return chatNameResolver?.(chatId) || (senderOpenId ? chatNameResolver?.(senderOpenId) : undefined)
}

export interface LaunchMeta {
  messageIds?: string[]
  chatId?: string
  chatType?: string
}

/**
 * 构建 Agent 启动 Prompt（SDK / Claude Code 共用）。
 * 仅透传用户任务文本，不注入 rules、分隔线或 session 元数据包装。
 */
export function buildPrompt(
  _meta?: LaunchMeta,
  taskMessage?: string,
  _sessionKey?: string,
  // 保留参数以兼容既有调用方；workspace 路由仍由 session-dispatcher / SDK 负责
  _useMainWorkspace?: boolean,
): string {
  const text = taskMessage?.trim()
  return text ? taskMessage! : ""
}
