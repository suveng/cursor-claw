/**
 * Codex Engine Port adapter（三期 T12）
 * launch/dispatch 供 agent-sdk-http 注册表；终态 notify 经 RunLifecycle + shared 模板。
 */
import type { ThreadItem } from "@openai/codex-sdk"
import { registerEnginePort } from "../shared/agent-engine-port"
import { createRunLifecycle } from "../shared/run-lifecycle"
import { formatRunFailureMessage } from "../shared/run-failure-formatter"
import type {
  AgentEnginePort,
  LaunchRequest,
  RunEvent,
  RunLifecycleSessionSlice,
  RunTerminalContext,
  WatchdogConfig,
} from "../shared/run-lifecycle-types"
import { appendContextFooter, formatContextFooter } from "../cursor-sdk/context-usage"
import { launchCodexAgentFromHttp } from "./agent-codex-http"
import type { CodexSessionAgent, CodexThreadEvent, CodexThreadErrorEvent } from "./agent-codex-types"
import { resolveSessionChannelType } from "./agent-codex-utils"

/** session → Lifecycle 切片（补 channelType，禁止 import 全量类型进 shared） */
function toLifecycleSlice(session: CodexSessionAgent): RunLifecycleSessionSlice {
  return {
    sessionKey: session.sessionKey,
    errorNotified: session.errorNotified,
    runFinalizing: session.runFinalizing,
    f41Stream: session.f41Stream,
    streamBuffer: session.streamBuffer,
    outboundMessageId: session.outboundMessageId,
    inboundMessageIds: session.inboundMessageIds,
    abortController: session.abortController,
    failureArchiveDone: session.failureArchiveDone,
    channelType: resolveSessionChannelType(session.sessionKey),
  }
}

/** 失败 IM 正文附加 context footer（对称现网 completeCodexRun） */
function codexFailureTextWithFooter(session: CodexSessionAgent, baseText: string): string {
  const footer = formatContextFooter(
    session.contextUsage,
    session.contextLimitTokens ?? null,
    session.contextUsagePeakTokens,
    session.contextUsageFromRunTotal,
  )
  return footer ? appendContextFooter(baseText, footer) : baseText
}

/** 经 RunLifecycle 发送终态 IM（失败 / 超时 / 取消 / 成功 plain） */
export async function completeCodexViaLifecycle(
  session: CodexSessionAgent,
  ctx: RunTerminalContext,
): Promise<void> {
  const lifecycle = createRunLifecycle(toLifecycleSlice(session))
  await lifecycle.enterNotifying(ctx)
}

/** watchdog 超时终态：委托 shared complete + formatRunFailureMessage */
export async function notifyCodexWatchdogTimeout(session: CodexSessionAgent): Promise<void> {
  if (session.errorNotified) return
  session.watchdogTimedOut = false
  const base =
    session.lastStatus?.message?.trim() ||
    formatRunFailureMessage({ reason: "timeout", sessionKey: session.sessionKey })
  await completeCodexViaLifecycle(session, {
    source: "watchdog",
    failure: { reason: "timeout" },
    failureText: codexFailureTextWithFooter(session, base),
  })
}

/** Turn 异常退出终态 notify */
export async function notifyCodexRunFailure(
  session: CodexSessionAgent,
  exitCode: number | null,
): Promise<void> {
  if (session.errorNotified) return
  const detail =
    session.lastStatus?.message ??
    `Agent Run 失败（退出码 ${exitCode ?? "unknown"}）`
  const base =
    session.lastStatus?.message?.trim() ||
    formatRunFailureMessage({ reason: "run_error", detail, sessionKey: session.sessionKey })
  await completeCodexViaLifecycle(session, {
    source: "failure",
    failure: { reason: "run_error", detail },
    failureText: codexFailureTextWithFooter(session, base),
  })
}

/** ThreadItem.started → RunEvent */
function mapCodexItemStartedToRunEvent(item: ThreadItem): RunEvent | null {
  if (item.type === "reasoning") return { type: "thinking", status: "started" }
  if (item.type === "command_execution") {
    return { type: "tool", toolName: item.command?.trim() || "shell", status: "started" }
  }
  if (item.type === "mcp_tool_call") {
    return { type: "tool", toolName: `${item.server}/${item.tool}`, status: "started" }
  }
  return null
}

/** ThreadItem.updated → RunEvent */
function mapCodexItemUpdatedToRunEvent(item: ThreadItem): RunEvent | null {
  if (item.type === "agent_message" && item.text) {
    return { type: "stream_delta", delta: item.text }
  }
  if (item.type === "reasoning" && item.text) {
    return { type: "thinking", delta: item.text, status: "started" }
  }
  if (item.type === "command_execution") {
    const name = item.command?.trim() || "shell"
    return { type: "tool", toolName: name, status: "running" }
  }
  return null
}

/** Codex ThreadEvent → RunEvent（供 Port.stream 与 events 层复用） */
export function mapCodexThreadEventToRunEvent(
  event: CodexThreadEvent | CodexThreadErrorEvent,
): RunEvent | null {
  if (event.type === "turn.started") return { type: "run_started" }
  if (event.type === "turn.completed") return { type: "run_succeeded" }
  if (event.type === "turn.failed") {
    const err = event.error
    const detail =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : typeof err === "object" && err != null && "message" in err
            ? String((err as { message: unknown }).message)
            : "turn failed"
    return { type: "run_failed", reason: "run_error", detail }
  }
  if (event.type === "error" || event.type === "thread.error") {
    return { type: "run_failed", reason: "run_error", detail: event.message }
  }
  if (event.type === "item.started") return mapCodexItemStartedToRunEvent(event.item)
  if (event.type === "item.updated") return mapCodexItemUpdatedToRunEvent(event.item)
  return null
}

/** 流结束时映射终态 RunEvent（阶段转移，实际 IM 由 completeCodexRun 触发） */
export function emitCodexStreamTerminalRunEvent(
  session: CodexSessionAgent,
  exitCode: number | null,
): void {
  const lifecycle = createRunLifecycle(toLifecycleSlice(session))
  if (session.watchdogTimedOut) {
    lifecycle.onWatchdog({ type: "watchdog_timeout", trigger: "codex_stream_exit" })
    return
  }
  if (session.abortController.signal.aborted) {
    lifecycle.onStreamEvent({ type: "run_cancelled" })
    return
  }
  const isError =
    session.lastStatus?.status === "ERROR" || (exitCode !== null && exitCode !== 0)
  if (isError) {
    const detail =
      session.lastStatus?.message ?? `Agent Run 失败（退出码 ${exitCode ?? "unknown"}）`
    lifecycle.onStreamEvent({ type: "run_failed", reason: "run_error", detail })
    return
  }
  lifecycle.onStreamEvent({ type: "run_succeeded" })
}

/** LaunchRequest → HTTP body（复用 launchCodexAgentFromHttp 解析链） */
function launchRequestToBody(req: LaunchRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    session_key: req.sessionKey,
    task_message: req.taskText,
  }
  if (req.chatType) body.chat_type = req.chatType
  if (req.messageIds?.length) body.message_ids = req.messageIds
  if (req.workspaceDir) body.workspace_dir = req.workspaceDir
  if (req.useMainWorkspace) body.use_main = true
  if (req.senderOpenId) body.sender_open_id = req.senderOpenId
  if (req.chatName) body.chat_name = req.chatName
  return body
}

/** Codex Engine Port 六能力实现 */
export const codexEnginePortAdapter: AgentEnginePort = {
  async launch(req: LaunchRequest): Promise<{ ok: boolean; error?: string }> {
    return launchCodexAgentFromHttp(launchRequestToBody(req))
  },

  async dispatch(
    sessionKey: string,
    taskText: string,
    messageIds?: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    const { dispatchToCodexAgent } = await import("./agent-codex-sdk.js")
    return dispatchToCodexAgent(sessionKey, taskText, messageIds)
  },

  async stop(sessionKey: string, _source: "user" | "watchdog" | "stale"): Promise<void> {
    const { stopCodexSession } = await import("./agent-codex-session-registry.js")
    stopCodexSession(sessionKey)
  },

  /** 过程流由 agent-codex-events 驱动；此处供 Port 契约占位 */
  stream(_session: unknown): void {
    return undefined
  },

  /** watchdog 由 startCodexTurn → armCodexWatchdog 挂接；Port 层不重复 arm */
  watchdog(_session: unknown, _config: WatchdogConfig): void {
    return undefined
  },

  async complete(session: unknown, ctx: RunTerminalContext): Promise<void> {
    await completeCodexViaLifecycle(session as CodexSessionAgent, ctx)
  },
}

/** 注册至 agent-sdk-http 引擎 Port 注册表 */
export function registerCodexEnginePort(): void {
  registerEnginePort("codex", codexEnginePortAdapter)
}
