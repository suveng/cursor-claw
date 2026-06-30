/**
 * Codex SDK 公共类型定义
 * 会话状态、LaunchOptions 与 SDK 事件类型别名；不 import 其他 agent-codex-* 模块。
 */
import type { Thread, ThreadEvent, ThreadItem, Usage } from "@openai/codex-sdk"
import type { ChatType, LaunchMeta } from "./agent-launcher"
import type { ContextUsageState } from "./context-usage"

/** launchCodexAgent 所需参数 */
export interface CodexLaunchOptions {
  sessionKey: string
  chatType: ChatType
  meta?: LaunchMeta
  workspaceDir: string
  useMainWorkspace?: boolean
  senderOpenId?: string
  chatName?: string
  taskMessage?: string
  apiKey: string
  baseUrl?: string
  /** 可选模型覆盖；空则使用 CODEX_DEFAULT_MODEL_ID，再回退 SDK 内置默认 */
  model?: string
  /** 内联 MCP 表（由 codex-mcp-loader 注入） */
  mcpServers?: Record<string, Record<string, unknown>>
}

/**
 * Codex 官方文档示例模型（硬编码，不做运行时拉取；仿 CLAUDE_CODE_MODEL_LIST）
 * @see https://developers.openai.com/codex/models
 */
export const CODEX_MODEL_LIST: Array<{ id: string; label: string }> = [
  { id: "gpt-5.5", label: "GPT-5.5（推荐）" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  { id: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
]

/** 清单首项为推荐默认；Profile `model?` 非空时覆盖 */
export const CODEX_DEFAULT_MODEL_ID = CODEX_MODEL_LIST[0]?.id ?? "gpt-5.5"

/** 单个 Codex 会话的运行时状态（字段对齐 CcSessionAgent） */
export interface CodexSessionAgent {
  sessionKey: string
  /** 当前活跃 Thread（null = 无会话实例） */
  activeThread: Thread | null
  /** thread.started 写入的 thread_id，供 resumeThread 续接 */
  codexSessionId: string | null
  startedAt: number
  lastActivityAt: number
  chatType: ChatType
  workspaceDir?: string
  senderOpenId?: string
  chatName?: string
  apiKey: string
  baseUrl?: string
  /** Profile 可选覆盖；空则 launch 时使用 CODEX_DEFAULT_MODEL_ID */
  model?: string
  meta?: LaunchMeta
  useMainWorkspace?: boolean
  abortController: AbortController
  f41Stream: boolean
  streamBuffer: string
  outboundMessageId?: string
  toolPresentationOutboundIds?: Map<string, string>
  streamId?: string
  streamLastPostAt?: number
  streamPostTimer?: ReturnType<typeof setTimeout>
  streamPostChain?: Promise<void>
  errorNotified?: boolean
  lastStatus?: { status: string; message?: string }
  lastTool?: { name: string; status: string }
  residentMode: boolean
  pendingDispatch: boolean
  runStartedAt?: number
  seenProcessEvent?: boolean
  presentationDeferStream?: boolean
  thinkingOpen?: boolean
  contextUsage: ContextUsageState
  contextUsagePeakTokens?: number
  contextUsageFromRunTotal?: number
  contextUsageFinalized?: boolean
  contextLimitTokens?: number
  modelId?: string
  compressionNotified?: boolean
  inboundMessageIds?: string[]
  runFinalizing?: boolean
  failureArchiveDone?: boolean
  runGuardToken?: string
  watchdogState: "running" | "draining" | "cancelling"
  watchdogStateAt: number
  watchdogTimedOut?: boolean
  lastMcpServersSnapshot?: Array<{ name: string; status: string }>
  logAgg: { kind: "thinking" | "text" | null; buf: string }
  /** item.id → 展示用 tool 名（command_execution / mcp_tool_call） */
  itemToolNames?: Map<string, string>
}

/** SDK 事件与 ThreadItem 类型别名（便于 events 模块引用） */
export type CodexThreadEvent = ThreadEvent
export type CodexThreadItem = ThreadItem
export type CodexUsage = Usage

/** 设计稿称 thread.error；SDK 实际 type 为 error，events 层兼容二者 */
export type CodexThreadErrorEvent = { type: "error" | "thread.error"; message: string }
