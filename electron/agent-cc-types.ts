/**
 * Claude Code SDK 公共类型定义
 *
 * 包含对外暴露的接口、常量与内部 session 结构体。
 * 本模块不 import 其他 agent-cc-* 模块，仅依赖外部包。
 */
import type { ChildProcess } from "node:child_process"
import type { ChatType, LaunchMeta } from "./agent-launcher"
import type { ContextUsageState } from "./context-usage"

// ── 公共接口 ──────────────────────────────────────────────────────────────────

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

/** Claude 模型硬编码列表（后续可接 API 动态拉取） */
export const CLAUDE_CODE_MODEL_LIST: Array<{ id: string; label: string }> = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
]

// ── 内部 Session 结构 ─────────────────────────────────────────────────────────

/** 单个 Claude Code 会话的运行时状态 */
export interface CcSessionAgent {
  sessionKey: string
  /** 当前正在运行的 spawn 进程（null = 空闲） */
  child: ChildProcess | null
  /** Claude Code CLI session_id（用于 --resume 续接上下文） */
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
  /** dispatch 用：buildPrompt meta 上下文 */
  meta?: LaunchMeta
  /** dispatch 用：主工作区标志 */
  useMainWorkspace?: boolean
  abortController: AbortController
  /** f41 流式（主用户私聊 / 飞书群聊 allowOthers） */
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
  /** 保留 session（resident 模式：进程结束后保留 Map 条目以复用 ccSessionId） */
  residentMode: boolean
  pendingDispatch: boolean
  runStartedAt?: number
  seenProcessEvent?: boolean
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
  /** 聚合日志缓冲 */
  logAgg: { kind: "thinking" | "text" | null; buf: string }
}
