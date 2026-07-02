/**
 * Claude Agent SDK 公共类型定义
 * 对外接口、常量与内部 session 结构体；不 import 其他 agent-cc-* 模块。
 */
import type { Query } from "@anthropic-ai/claude-agent-sdk"
import type { ChatType, LaunchMeta } from "../shared/agent-launcher"
import type { ContextUsageState } from "../cursor-sdk/context-usage"

/** launchClaudeCodeAgent 所需参数 */
export interface ClaudeCodeLaunchOptions {
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
  model?: string
}

/** Claude 模型硬编码列表 */
export const CLAUDE_CODE_MODEL_LIST: Array<{ id: string; label: string }> = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
]

/** 单个 Claude Agent 会话的运行时状态 */
export interface CcSessionAgent {
  sessionKey: string
  /** 当前活跃的 SDK Query（null = idle resident） */
  activeQuery: Query | null
  /** SDK init/result 写入的 session_id，供 resume 续接上下文 */
  ccSessionId: string | null
  startedAt: number
  lastActivityAt: number
  chatType: ChatType
  workspaceDir?: string
  senderOpenId?: string
  chatName?: string
  apiKey: string
  baseUrl?: string
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
  /** Presentation 时序：daemon 返回 deferred 或已见过程事件 */
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
  /** watchdog 空闲/绝对超时触发时为 true；由 armCcWatchdog.onTimeout 置位，completeCcRun 消费 */
  watchdogTimedOut?: boolean
  /**
   * system/init 上报的 MCP server 状态快照；只在 init 时覆写，idle/complete 不清空，
   * 供 Dashboard idle 会话展示 MCP 列表（与 SDK 路径 lastInjectedMcpServers 对称）。
   */
  lastMcpServersSnapshot?: Array<{ name: string; status: string; config?: unknown; scope?: string; tools?: unknown[] }>
  logAgg: { kind: "thinking" | "text" | null; buf: string }
  /**
   * 本轮 assistant 正文是否已由 stream_event/text_delta 写入 f41 流；
   * 为 true 时跳过 assistant text block 的重复 append，assistant 收尾或 reset 清零。
   */
  ccTextFromPartialStream?: boolean
}
