/**
 * Claude Code AgentEnginePort adapter（二期 T10）
 * launch/dispatch 供 agent-sdk-http 注册表；终态 notify 经 RunLifecycle + shared 模板。
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { registerEnginePort } from "../shared/agent-engine-port.js"
import { createRunLifecycle } from "../shared/run-lifecycle.js"
import type {
  AgentEnginePort,
  LaunchRequest,
  RunEvent,
  RunLifecycleSessionSlice,
  RunTerminalContext,
  WatchdogConfig,
} from "../shared/run-lifecycle-types.js"
import { launchCcAgentFromHttp } from "./agent-cc-http.js"
import type { CcSessionAgent } from "./agent-cc-types.js"
import { resolveSessionChannelType } from "./agent-cc-utils.js"

/** session → Lifecycle 切片（补 channelType，禁止 import 全量类型进 shared） */
function toLifecycleSlice(session: CcSessionAgent): RunLifecycleSessionSlice {
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

/** 经 RunLifecycle 发送终态 IM（失败 / 超时 / 取消 / 成功 plain） */
export async function completeCcViaLifecycle(
  session: CcSessionAgent,
  ctx: RunTerminalContext,
): Promise<void> {
  const lifecycle = createRunLifecycle(toLifecycleSlice(session))
  await lifecycle.enterNotifying(ctx)
}

/** watchdog 超时终态：委托 shared complete + formatRunFailureMessage */
export async function notifyCcWatchdogTimeout(session: CcSessionAgent): Promise<void> {
  if (session.errorNotified) return
  session.watchdogTimedOut = false
  await completeCcViaLifecycle(session, {
    source: "watchdog",
    failure: { reason: "timeout" },
  })
}

/** watchdog 超时 IM 收尾别名（供 completeCcRun 调用） */
export async function finalizeCcRunOnWatchdogTimeout(session: CcSessionAgent): Promise<void> {
  await notifyCcWatchdogTimeout(session)
}

/** Query 异常退出终态 notify */
export async function notifyCcRunFailure(
  session: CcSessionAgent,
  exitCode: number | null,
): Promise<void> {
  if (session.errorNotified) return
  const detail =
    session.lastStatus?.message ?? `Agent Run 失败（退出码 ${exitCode ?? "unknown"}）`
  await completeCcViaLifecycle(session, {
    source: "failure",
    failure: { reason: "run_error", detail },
  })
}

/** SDKMessage result 分支 → RunEvent */
export function mapCcSdkMessageToRunEvent(msg: SDKMessage): RunEvent | null {
  if (msg.type !== "result") return null
  if (msg.is_error || msg.subtype === "error") {
    const detail =
      "errors" in msg && Array.isArray(msg.errors)
        ? msg.errors.join("; ")
        : (msg.result ?? "unknown error")
    return { type: "run_failed", reason: "run_error", detail }
  }
  return { type: "run_succeeded", result: typeof msg.result === "string" ? msg.result : undefined }
}

/** Query 流结束时映射终态 RunEvent（阶段转移，实际 IM 由 completeCcRun 触发） */
export function emitCcQueryTerminalRunEvent(session: CcSessionAgent, exitCode: number | null): void {
  const lifecycle = createRunLifecycle(toLifecycleSlice(session))
  if (session.watchdogTimedOut) {
    lifecycle.onWatchdog({ type: "watchdog_timeout", trigger: "cc_query_exit" })
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

/** LaunchRequest → HTTP body（复用 launchCcAgentFromHttp 解析链） */
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

/** Claude Code Engine Port 六能力实现 */
export const ccEnginePortAdapter: AgentEnginePort = {
  async launch(req: LaunchRequest): Promise<{ ok: boolean; error?: string }> {
    return launchCcAgentFromHttp(launchRequestToBody(req))
  },

  async dispatch(
    sessionKey: string,
    taskText: string,
    messageIds?: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    const { dispatchToClaudeCodeAgent } = await import("./agent-claude-sdk.js")
    return dispatchToClaudeCodeAgent(sessionKey, taskText, messageIds)
  },

  async stop(sessionKey: string, _source: "user" | "watchdog" | "stale"): Promise<void> {
    const { stopClaudeCodeSession } = await import("./agent-claude-sdk.js")
    stopClaudeCodeSession(sessionKey)
  },

  /** 过程流由 agent-cc-events 驱动；此处供 Port 契约占位 */
  stream(_session: unknown): void {
    return undefined
  },

  /** watchdog 由 startCcQuery → armCcWatchdog 挂接；Port 层不重复 arm */
  watchdog(_session: unknown, _config: WatchdogConfig): void {
    return undefined
  },

  async complete(session: unknown, ctx: RunTerminalContext): Promise<void> {
    await completeCcViaLifecycle(session as CcSessionAgent, ctx)
  },
}

/** 注册至 agent-sdk-http 引擎 Port 注册表 */
export function registerCcEnginePort(): void {
  registerEnginePort("claude-code", ccEnginePortAdapter)
}
