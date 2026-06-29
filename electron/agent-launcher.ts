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

/** 统一构建 Agent 启动 Prompt（SDK / Claude Code 共用；仅任务内容与会话元数据，不含工作流前缀） */
export function buildPrompt(
  meta?: LaunchMeta,
  taskMessage?: string,
  sessionKey?: string,
  // 保留参数以兼容既有调用方；workspace 路由仍由 session-dispatcher / SDK 负责
  _useMainWorkspace?: boolean,
): string {
  const prompts: string[] = []

  if (taskMessage) {
    prompts.push("---")
    prompts.push("任务内容:")
    prompts.push(taskMessage)
  }

  // 仅有元数据时不加 leading ---；有任务内容时在元数据前插入分隔线
  if (prompts.length > 0) {
    prompts.push("---")
  }
  prompts.push("会话元数据:")
  if (sessionKey) {
    prompts.push(`[session_key=${sessionKey}]`)
  }
  prompts.push(`[chat_type=${meta?.chatType}]`)

  return prompts.join("\n")
}
