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
 * 构建 Agent 启动/续派 Prompt（四引擎共用）。
 * 有群名时首行注入 `group_name: <名>`；无则省略该行（不写空占位）。
 * 不注入 rules、分隔线或其他 session 元数据包装。
 */
export function buildPrompt(
  _meta?: LaunchMeta,
  taskMessage?: string,
  sessionKey?: string,
  // 保留参数以兼容既有调用方；workspace 路由仍由 session-dispatcher / SDK 负责
  _useMainWorkspace?: boolean,
  /** 显式群名；缺省时按 sessionKey 查 chatNameCache */
  chatName?: string,
): string {
  const body = taskMessage?.trim() ? taskMessage! : ""
  // 优先显式名，其次缓存解析；trim 后仍空则不注入
  const name = (
    chatName?.trim() ||
    (sessionKey ? resolveSessionChatName(sessionKey) : undefined)
  )?.trim()
  if (!name) return body
  return `group_name: ${name}\n${body}`
}
