/**
 * OpenCode AgentEnginePort adapter（三期 T13）
 * launch/dispatch 供 agent-sdk-http 注册表；终态 notify 经 RunLifecycle + shared 模板。
 */
import type { Part } from "@opencode-ai/sdk"
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
import { launchOpencodeAgentFromHttp } from "./agent-opencode-http.js"
import type { OpencodeSessionAgent } from "./agent-opencode-types.js"
import { maskOpencodeApiKey, resolveSessionChannelType } from "./agent-opencode-utils.js"

type OpencodeSseEvent = { type: string; properties?: Record<string, unknown> }

/** session → Lifecycle 切片（补 channelType，禁止 import 全量类型进 shared） */
function toLifecycleSlice(session: OpencodeSessionAgent): RunLifecycleSessionSlice {
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
export async function completeOpencodeViaLifecycle(
  session: OpencodeSessionAgent,
  ctx: RunTerminalContext,
): Promise<void> {
  const lifecycle = createRunLifecycle(toLifecycleSlice(session))
  await lifecycle.enterNotifying(ctx)
}

/** watchdog 超时终态：委托 shared complete + formatRunFailureMessage */
export async function notifyOpencodeWatchdogTimeout(
  session: OpencodeSessionAgent,
  failureText?: string,
): Promise<void> {
  if (session.errorNotified) return
  session.watchdogTimedOut = false
  await completeOpencodeViaLifecycle(session, {
    source: "watchdog",
    failure: {
      reason: "timeout",
      detail: `apiKey=${maskOpencodeApiKey(session.apiKey)} watchdog=1`,
    },
    failureText,
  })
}

/** SSE 流异常或 session.error 终态 notify */
export async function notifyOpencodeRunFailure(
  session: OpencodeSessionAgent,
  exitCode: number | null,
  failureText?: string,
): Promise<void> {
  if (session.errorNotified) return
  const detail =
    session.lastStatus?.message ?? `Agent Run 失败（退出码 ${exitCode ?? "unknown"}）`
  await completeOpencodeViaLifecycle(session, {
    source: "failure",
    failure: {
      reason: "run_error",
      detail: `apiKey=${maskOpencodeApiKey(session.apiKey)} status=${session.lastStatus?.status ?? "ERROR"}`,
    },
    failureText: failureText ?? detail,
  })
}

/** OpenCode SSE 单条事件 → RunEvent（过程流由 agent-opencode-events 驱动，此处供 Port 契约与阶段映射） */
export function mapOpencodeSseToRunEvent(event: unknown): RunEvent | null {
  const ev = event as OpencodeSseEvent
  if (!ev?.type) return null

  if (ev.type === "message.part.updated") {
    const props = ev.properties as { part?: Part; delta?: string } | undefined
    const part = props?.part
    if (!part) return null
    if (part.type === "text") {
      const text = props?.delta ?? part.text ?? ""
      return text ? { type: "stream_delta", delta: text } : null
    }
    if (part.type === "reasoning") {
      const text = props?.delta ?? part.text ?? ""
      return text ? { type: "thinking", delta: text, status: "started" } : null
    }
    if (part.type === "tool") {
      const toolName = part.tool || "tool"
      const st = part.state?.status
      if (st === "running" || st === "pending") {
        return { type: "tool", toolName, status: "started" }
      }
      if (st === "completed" || st === "error") {
        return { type: "tool", toolName, status: st === "error" ? "failed" : "completed" }
      }
      return null
    }
    return null
  }

  if (ev.type === "session.error") {
    const err = (ev.properties as { error?: { data?: { message?: string } } } | undefined)?.error
    return { type: "run_failed", reason: "run_error", detail: err?.data?.message }
  }

  if (ev.type === "session.idle") {
    return { type: "run_succeeded" }
  }

  if (ev.type === "session.created") {
    const id = (ev.properties as { info?: { id?: string } } | undefined)?.info?.id
    return { type: "run_started", runId: id }
  }

  return null
}

/** SSE 流结束时映射终态 RunEvent（阶段转移，实际 IM 由 completeOpencodeRun 触发） */
export function emitOpencodeStreamTerminalRunEvent(
  session: OpencodeSessionAgent,
  exitCode: number | null,
): void {
  const lifecycle = createRunLifecycle(toLifecycleSlice(session))
  if (session.watchdogTimedOut) {
    lifecycle.onWatchdog({ type: "watchdog_timeout", trigger: "opencode_sse_exit" })
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
      session.lastStatus?.message ?? `SSE 流异常（退出码 ${exitCode ?? "unknown"}）`
    lifecycle.onStreamEvent({ type: "run_failed", reason: "run_error", detail })
    return
  }
  lifecycle.onStreamEvent({ type: "run_succeeded" })
}

/** LaunchRequest → HTTP body（复用 launchOpencodeAgentFromHttp 解析链） */
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

/** OpenCode Engine Port 六能力实现 */
export const opencodeEnginePortAdapter: AgentEnginePort = {
  async launch(req: LaunchRequest): Promise<{ ok: boolean; error?: string }> {
    return launchOpencodeAgentFromHttp(launchRequestToBody(req))
  },

  async dispatch(
    sessionKey: string,
    taskText: string,
    messageIds?: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    const { dispatchToOpencodeAgent } = await import("./agent-opencode-sdk.js")
    return dispatchToOpencodeAgent(sessionKey, taskText, messageIds)
  },

  async stop(sessionKey: string, _source: "user" | "watchdog" | "stale"): Promise<void> {
    const { stopOpencodeSession } = await import("./agent-opencode-session-registry.js")
    stopOpencodeSession(sessionKey)
  },

  /** 过程流由 agent-opencode-events 驱动；此处供 Port 契约占位 */
  stream(_session: unknown): void {
    return undefined
  },

  /** watchdog 由 startOpencodeRun → watchOpencodeRunGuard 挂接；Port 层不重复 arm */
  watchdog(_session: unknown, _config: WatchdogConfig): void {
    return undefined
  },

  async complete(session: unknown, ctx: RunTerminalContext): Promise<void> {
    await completeOpencodeViaLifecycle(session as OpencodeSessionAgent, ctx)
  },
}

/** 注册至 agent-sdk-http 引擎 Port 注册表 */
export function registerOpencodeEnginePort(): void {
  registerEnginePort("opencode", opencodeEnginePortAdapter)
}
