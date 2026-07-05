/**
 * SDK Session 类型定义（供 agent-sdk 拆分模块共享）
 */
import type { SDKAgent, Run, McpServerConfig } from "@cursor/sdk"
import type { ContextUsageState } from "./context-usage"
import type { ChatType } from "../shared/agent-launcher"

/** SDK 长驻会话实体 */
export interface SdkSessionAgent {
  sessionKey: string
  agent: SDKAgent
  run: Run | null
  agentId: string
  startedAt: number
  lastActivityAt: number
  chatType: ChatType
  workspaceDir?: string
  senderOpenId?: string
  chatName?: string
  abortController: AbortController
  /** 流式日志聚合缓冲：连续同类型(thinking/text)增量合并成一条打印 */
  logAgg: { kind: "thinking" | "text" | null; buf: string }
  /** SDK 流式桥接 eligible（f41Eligible：主用户私聊或飞书群聊 allowOthers） */
  f41Stream: boolean
  streamBuffer: string
  outboundMessageId?: string
  /** 工具进度 CardKit message_id（按 tool_name，供并发工具各自 PATCH） */
  toolPresentationOutboundIds?: Map<string, string>
  streamId?: string
  streamLastPostAt?: number
  streamPostTimer?: ReturnType<typeof setTimeout>
  /** stream-text POST 串行链，避免并发首包 */
  streamPostChain?: Promise<void>
  errorNotified?: boolean
  /** 最近一次终态状态事件（ERROR/EXPIRED/CANCELLED），用于结束时还原真实错误原因 */
  lastStatus?: { status: string; message?: string }
  /** 末次 tool 事件快照，供 error 日志与保活失败分类 */
  lastTool?: { name: string; status: string; filePath?: string }
  /** 相邻 tool_call running 去重键（防 SDK 重复 tool_call 日志/飞书） */
  lastToolCallRunningDedupKey?: string
  /** 运行阶段：供 watchdog 区分长工具/等待用户 */
  runPhase?: "executing" | "awaiting_user" | "tool_running"
  /** Feature flag SDK_RESIDENT_AGENT：Run 结束后保持 Agent 实例 */
  residentMode: boolean
  /** 二次 send 进行中，防并发 dispatch */
  pendingDispatch: boolean
  /** 当前 Run 启动时刻，供 error 时 durationMs 未就绪的兜底 */
  runStartedAt?: number
  /** daemon 曾返回 deferred 或本地已见过程，延迟 POST stream-text */
  presentationDeferStream?: boolean
  /** 本 Run 是否出现过 tool/thinking */
  seenProcessEvent?: boolean
  /** 本 Run thinking 过程尚未 final */
  thinkingOpen?: boolean
  /** 当前 turn token 快照（onDelta turn-ended replace） */
  contextUsage: ContextUsageState
  /** session 级 prompt 侧 peak（跨 Run 保留；压缩后清零；footer 取 max(peak, 当前)） */
  contextUsagePeakTokens?: number
  /** Run 结束时 run.usage.totalTokens，footer 优先使用 */
  contextUsageFromRunTotal?: number
  /** 本 Run 是否已从 run.usage finalize */
  contextUsageFinalized?: boolean
  /** 模型上下文上限（session 级缓存，跨 Run 复用） */
  contextLimitTokens?: number
  /**
   * send 前最后一次压力评估 used tokens；轮转清零 peak 后仍供失败归因。
   * 每次 dispatch pre-send 覆盖，不清零至下次 pre-send。
   */
  lastPreSendUsedTokens?: number
  /** send 前最后一次 used/limit 比例，可 >1 表示 ≥100% 占用；语义同 lastPreSendUsedTokens */
  lastPreSendUsageRatio?: number
  /** 当前模型 id，供 resolveModelContextLimit */
  modelId?: string
  /** 当前模型参数，供 context rotation 重建 agent */
  modelParams?: string
  /** 通道 SDK API Key，供 models.list */
  apiKey?: string
  /** 本 Run 是否已下发压缩进度通知（防重复） */
  compressionNotified?: boolean
  /** 当次 dispatch claim 的 inbound message_ids，final stream-text 末条 id 用于 ack */
  inboundMessageIds?: string[]
  /** 本 Run 正在执行超时/终态收尾，防 completeSdkRun 重复 */
  runFinalizing?: boolean
  /** 本 Run task started 递增序号（无 text 时里程碑区分步骤） */
  taskSeq?: number
  /** 本 Run 单次失败是否已归档崩溃日志 */
  failureArchiveDone?: boolean
  /** RunGuard 单飞 token（同 session 仅允许一个活跃 run） */
  runGuardToken?: string
  /** 最近一次调度重试次数（用于可观测） */
  lastDispatchAttempts?: number
  /** watchdog 状态机：running -> draining -> cancelling */
  watchdogState: "running" | "draining" | "cancelling"
  /** watchdog 状态切换时间戳（ms） */
  watchdogStateAt: number
  /**
   * watchdog 空闲/绝对超时触发时为 true（对称 CC）。
   * 由 armRunWatchdog.onTimeout 在取消前置位；resetSdkRunPresentationState 清零；
   * 用户主动 stopSdkSession 不置闩。
   */
  watchdogTimedOut?: boolean
  /** 最近一次注入 SDK 的 inline mcpServers 快照（SDK 无 list/status API，展示侧据此渲染） */
  lastInjectedMcpServers?: Record<string, McpServerConfig>
}

export type PresentationKind = "assistant" | "thinking" | "tool" | "diff" | "merge_batch" | "task"

export interface PresentationEvent {
  session_key: string
  kind: PresentationKind
  delta?: string
  tool_name?: string
  tool_status?: "started" | "completed" | "failed"
  /** shell 工具：具体命令（CardKit ```shell 渲染） */
  tool_shell_command?: string
  tool_shell_cwd?: string
  tool_shell_output?: string
  /** task 工具 tool_call：子代理任务描述（飞书里程碑摘要） */
  tool_task_description?: string
  /** edit/write/delete 工具：目标文件路径（完成态里程碑） */
  tool_file_path?: string
  /** task 里程碑状态（如 in_progress / completed） */
  task_status?: string
  /** task 里程碑展示文案 */
  task_text?: string
  final?: boolean
  outbound_message_id?: string
}

export interface SdkLaunchOptions {
  sessionKey: string
  chatType: ChatType
  meta?: import("./agent-launcher").LaunchMeta
  workspaceDir: string
  useMainWorkspace?: boolean
  senderOpenId?: string
  chatName?: string
  taskMessage?: string
  /** 该会话所属通道绑定的 SDK 资源 API Key */
  apiKey: string
  /** 调用方解析好的模型（空 = composer-2） */
  model?: string
  modelParams?: string
}

export interface RecoverSummary {
  resumed: number
  failed: number
  skipped: number
}

export interface SdkModelOption {
  id: string
  label: string
  params: string
  current: boolean
}
