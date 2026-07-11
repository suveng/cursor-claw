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

/** 从正文提取 group_name 值（Daemon 入队拼尾或历史首行格式） */
export function extractGroupNameFromPrompt(text: string): string | undefined {
  const m = text.match(/group_name:\s*([^\n]+)/)
  return m?.[1]?.trim() || undefined
}

/** Prompt 可观测日志回调（由 initSessionDispatcher 注入 pushUiLog） */
export type PromptObservabilityLogger = (ctx: {
  sessionKey: string
  injected: boolean
  groupName?: string
  preview: string
}) => void

let promptObservabilityLogger: PromptObservabilityLogger | null = null

export function setPromptObservabilityLogger(fn: PromptObservabilityLogger | null): void {
  promptObservabilityLogger = fn
}

const PROMPT_PREVIEW_MAX = 300

/**
 * 构建 Agent 启动/续派 Prompt（四引擎共用）。
 * 直接透传 taskMessage 正文；不在此首行注入 group_name（入队拼尾由 Daemon 负责）。
 * 不注入 rules、分隔线或其他 session 元数据包装。
 * 保留未使用的兼容参数位，避免四引擎调用方大面积改签名。
 */
export function buildPrompt(
  _meta?: LaunchMeta,
  taskMessage?: string,
  sessionKey?: string,
  // 保留参数以兼容既有调用方；workspace 路由仍由 session-dispatcher / SDK 负责
  _useMainWorkspace?: boolean,
): string {
  const result = taskMessage?.trim() ? taskMessage! : ""
  const sk = sessionKey?.trim()
  // 四引擎 launch/dispatch 共用：打印是否含 group_name 及正文预览，便于验收
  if (promptObservabilityLogger && sk && result) {
    const groupName = extractGroupNameFromPrompt(result)
    const preview = result.length > PROMPT_PREVIEW_MAX
      ? `${result.slice(0, PROMPT_PREVIEW_MAX)}…`
      : result
    promptObservabilityLogger({
      sessionKey: sk,
      injected: !!groupName,
      groupName,
      preview,
    })
  }
  return result
}
