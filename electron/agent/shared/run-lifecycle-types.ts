/**
 * RunLifecycle / AgentEnginePort 类型 SSOT（四引擎共用，无运行时副作用）
 */

/** Run 生命周期阶段 */
export type RunPhase = "guarding" | "streaming" | "watching" | "completing" | "notifying"

/** 失败归因枚举（对齐 crash-log-archiver FailureArchiveType 语义扩展） */
export type RunFailureReason =
  | "dispatch_failed"
  | "run_error"
  | "timeout"
  | "user_cancelled"
  | "context_exhausted"
  | "stale_aborted"
  | "session_abnormal"

/** 终态收尾上下文（Lifecycle / complete 模板共用） */
export interface RunTerminalContext {
  source: "success" | "failure" | "cancelled" | "watchdog"
  assistantText?: string
  failure?: { reason: RunFailureReason; detail?: string }
  /** 引擎预组装失败 IM（如 SDK context footer）；优先于 formatter 默认句 */
  failureText?: string
}

/** HTTP launch 请求切片（Port.launch 入参） */
export interface LaunchRequest {
  sessionKey: string
  taskText: string
  chatType?: string
  messageIds?: string[]
  workspaceDir?: string
  useMainWorkspace?: boolean
  senderOpenId?: string
  chatName?: string
}

/** watchdog 配置切片 */
export interface WatchdogConfig {
  idleTimeoutMs?: number
  absoluteTimeoutMs?: number
  neverCancelOnDuration?: boolean
}

// —— RunEvent 载荷 ——

export interface RunStartedEvent {
  type: "run_started"
  runId?: string
}

export interface StreamDeltaEvent {
  type: "stream_delta"
  delta: string
}

export interface ToolRunEvent {
  type: "tool"
  toolName: string
  status: string
}

export interface ThinkingRunEvent {
  type: "thinking"
  delta?: string
  status?: "started" | "ended"
}

export interface TaskRunEvent {
  type: "task"
  status?: string
  text?: string
  seq?: number
}

export interface RunSucceededEvent {
  type: "run_succeeded"
  result?: string
}

export interface RunFailedEvent {
  type: "run_failed"
  reason?: RunFailureReason
  detail?: string
}

export interface RunCancelledEvent {
  type: "run_cancelled"
  reason?: string
}

export interface WatchdogTimeoutEvent {
  type: "watchdog_timeout"
  trigger?: string
}

export interface DispatchRejectedEvent {
  type: "dispatch_rejected"
  reason: string
}

/** 统一 Run 事件联合类型（引擎 adapter 映射目标） */
export type RunEvent =
  | RunStartedEvent
  | StreamDeltaEvent
  | ToolRunEvent
  | ThinkingRunEvent
  | TaskRunEvent
  | RunSucceededEvent
  | RunFailedEvent
  | RunCancelledEvent
  | WatchdogTimeoutEvent
  | DispatchRejectedEvent

/**
 * Lifecycle / complete 模板所需 session 字段切片（禁止 import 各引擎全量 Session 类型）
 */
export interface RunLifecycleSessionSlice {
  sessionKey: string
  errorNotified?: boolean
  runFinalizing?: boolean
  f41Stream?: boolean
  streamBuffer?: string
  outboundMessageId?: string
  inboundMessageIds?: string[]
  abortController?: { signal: { aborted: boolean } }
  failureArchiveDone?: boolean
  /** 通道类型（feishu 等），供 plain assistant 收尾判定 */
  channelType?: string
}

/** 四引擎统一执行 Port（实现归各引擎 adapter，注册表见 agent-engine-port.ts） */
export interface AgentEnginePort {
  launch(req: LaunchRequest): Promise<{ ok: boolean; error?: string }>
  dispatch(sessionKey: string, taskText: string, messageIds?: string[]): Promise<{ ok: boolean; error?: string }>
  stop(sessionKey: string, source: "user" | "watchdog" | "stale"): Promise<void>
  stream(session: unknown): AsyncIterable<RunEvent> | void
  watchdog(session: unknown, config: WatchdogConfig): void
  complete(session: unknown, ctx: RunTerminalContext): Promise<void>
}
