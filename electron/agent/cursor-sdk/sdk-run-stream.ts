/**
 * SDK Run 事件流消费 SSOT（对称 agent-cc-events.ts）
 * 运行期间仅经 `for await (run.stream())` 驱动呈现与活跃时钟。
 */
import type { Run, SDKMessage } from "@cursor/sdk"
import { resolveSdkToolPresentationTier } from "../../../src/shared/sdk-tool-presentation-tier.js"
import {
  extractShellPresentationFields,
  extractTaskPresentationFields,
  formatToolCallLogSuffix,
  TOOL_MILESTONE_TEXT_MAX,
} from "../../../src/shared/tool-presentation"
import { finalizeContextUsageAtRunEnd } from "./context-usage-run-end"
import { pushUiLog } from "../../app/ui-logger"
import { guardSdkPromise } from "./sdk-async-guard"
import {
  finalizeSdkRunOnTimeout,
  isRunTimeoutFailure,
  notifySdkFailure,
} from "./sdk-run-finalize"
import {
  appendAssistantStreamDelta,
  closeThinkingIfOpen,
  flushStreamPost,
  mapToolPresentationStatus,
  markProcessEventSeen,
  maybeReleaseDeferredAssistant,
  postPresentationEvent,
} from "./sdk-run-presentation"
import { markSessionActivity } from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"

const LOG_FLUSH_LEN = 400

function flushSdkLog(session: SdkSessionAgent): void {
  const agg = session.logAgg
  const text = agg.buf.trim()
  if (agg.kind && text) {
    if (agg.kind === "thinking") {
      pushUiLog("SDK", "DEBUG", `[${session.sessionKey}] [thinking] ${text}`)
    } else {
      pushUiLog("SDK", "INFO", `[${session.sessionKey}] ${text}`)
    }
  }
  agg.kind = null
  agg.buf = ""
}

function appendSdkLog(session: SdkSessionAgent, kind: "thinking" | "text", delta: string): void {
  const agg = session.logAgg
  if (agg.kind && agg.kind !== kind) flushSdkLog(session)
  agg.kind = kind
  agg.buf += delta
  if (agg.buf.length >= LOG_FLUSH_LEN) flushSdkLog(session)
}

/** 里程碑文案截断（与 shared/tool-presentation truncateText 口径一致） */
function truncateMilestoneText(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)} …(+${compact.length - max} chars)`
}

/** SDK task 事件 status/text → 用户可见里程碑文案；taskSeq 用于无 text 时区分步骤 */
function mapTaskMilestoneText(status?: string, text?: string, taskSeq?: number): string {
  const normalized = (status ?? "").toLowerCase()
  const trimmed = (text ?? "").trim()
  if (!normalized || normalized === "started") {
    if (trimmed) {
      return `正在执行：${truncateMilestoneText(trimmed, TOOL_MILESTONE_TEXT_MAX)}`
    }
    if (taskSeq != null) return `子任务 #${taskSeq} 已开始`
    return "子任务已开始"
  }
  if (normalized === "completed") {
    return trimmed ? `已完成：${truncateMilestoneText(trimmed, TOOL_MILESTONE_TEXT_MAX)}` : "子任务已完成"
  }
  if (normalized === "failed") {
    return trimmed
      ? `子任务失败：${truncateMilestoneText(trimmed, TOOL_MILESTONE_TEXT_MAX)}`
      : "子任务失败"
  }
  return trimmed || `子任务更新（${status}）`
}

/** SDK status 事件 best-effort 推断 runPhase */
function applyRunPhaseFromStatus(
  session: SdkSessionAgent,
  status: string,
  message?: string,
): void {
  const msg = (message ?? "").toLowerCase()
  if (
    msg.includes("awaiting") ||
    msg.includes("waiting for user") ||
    msg.includes("等待用户") ||
    msg.includes("need user")
  ) {
    session.runPhase = "awaiting_user"
    return
  }
  if (status === "RUNNING" || status === "CREATING") {
    session.runPhase = "executing"
  }
}

/** 单条 SDK 事件分派（全分支刷新活跃时钟） */
export function handleSdkEvent(session: SdkSessionAgent, event: SDKMessage): void {
  switch (event.type) {
    case "assistant":
      markSessionActivity(session, "assistant")
      session.runPhase = "executing"
      closeThinkingIfOpen(session)
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          if (session.f41Stream) {
            appendAssistantStreamDelta(session, block.text)
          } else {
            appendSdkLog(session, "text", block.text)
          }
        }
      }
      break
    case "thinking":
      markSessionActivity(session, "thinking")
      session.runPhase = "executing"
      if (event.text) {
        appendSdkLog(session, "thinking", event.text)
        markProcessEventSeen(session, "thinking")
        session.thinkingOpen = true
        guardSdkPromise(
          postPresentationEvent(session, { kind: "thinking", delta: event.text }),
          session.sessionKey,
          "presentation-event:thinking",
        )
      }
      break
    case "tool_call": {
      markSessionActivity(session, "tool_call")
      flushSdkLog(session)
      closeThinkingIfOpen(session)
      session.lastTool = { name: event.name, status: event.status }
      session.runPhase = event.status === "running" ? "tool_running" : "executing"
      const toolDetail = formatToolCallLogSuffix(event.status, event.args, event.result, event.truncated)
      pushUiLog("SDK", "INFO", `[${session.sessionKey}] [tool] ${event.name}: ${event.status}${toolDetail}`)
      const tier = resolveSdkToolPresentationTier(event.name)
      if (tier === "notify") {
        markProcessEventSeen(session, "tool")
        if (event.status === "running") session.toolPresentationOutboundIds?.delete(event.name)
        guardSdkPromise(
          postPresentationEvent(session, {
            kind: "tool",
            tool_name: event.name,
            tool_status: mapToolPresentationStatus(event.status),
            final: event.status !== "running",
            ...extractShellPresentationFields(event.name, event.status, event.args, event.result),
            ...extractTaskPresentationFields(event.name, event.status, event.args),
          }),
          session.sessionKey,
          "presentation-event:tool",
        )
        if (event.status !== "running") {
          maybeReleaseDeferredAssistant(session)
        }
      }
      break
    }
    case "status": {
      markSessionActivity(session, "status")
      applyRunPhaseFromStatus(session, event.status, event.message)
      flushSdkLog(session)
      const isErr = event.status === "ERROR" || event.status === "EXPIRED"
      if (isErr || event.status === "CANCELLED") {
        session.lastStatus = { status: event.status, message: event.message }
        if (!session.abortController.signal.aborted && session.run) {
          if (isRunTimeoutFailure(session, session.run, session.lastStatus)) {
            guardSdkPromise(
              finalizeSdkRunOnTimeout(session, session.run, "status"),
              session.sessionKey,
              "finalizeSdkRunOnTimeout:status",
              "ERROR",
            )
          } else if (event.status === "CANCELLED") {
            guardSdkPromise(
              notifySdkFailure(session, undefined, session.run, "sdk_cancelled"),
              session.sessionKey,
              "notifySdkFailure:cancelled",
              "ERROR",
            )
          }
        }
      }
      const lvl = isErr ? "ERROR" as const : "INFO" as const
      pushUiLog("SDK", lvl, `[${session.sessionKey}] [status] ${event.status}${event.message ? ` - ${event.message}` : ""}`)
    }
      break
    case "request":
      markSessionActivity(session, "request")
      session.runPhase = "awaiting_user"
      break
    case "task": {
      markSessionActivity(session, "task")
      const normalizedStatus = (event.status ?? "").toLowerCase()
      // Run 级递增序号：无 text 的 started 里程碑可区分步骤
      if (!normalizedStatus || normalizedStatus === "started") {
        session.taskSeq = (session.taskSeq ?? 0) + 1
      }
      const mappedText = mapTaskMilestoneText(event.status, event.text, session.taskSeq)
      // task 里程碑参与 ordering defer，与 thinking/tool 对称置闩（不单独 release）
      markProcessEventSeen(session, "task")
      // task_text 传映射后全文，daemon 直接用于里程碑展示（非 SDK 原始 text）
      guardSdkPromise(
        postPresentationEvent(session, {
          kind: "task",
          task_status: event.status,
          task_text: mappedText,
        }),
        session.sessionKey,
        "presentation-event:task",
      )
      pushUiLog("SDK", "INFO", `[${session.sessionKey}] [task] ${mappedText}`)
      break
    }
    case "usage":
    case "system":
    case "user":
      markSessionActivity(session, event.type)
      break
  }
}

/** Run 结束：读 run.usage（必要时 wait），对照 turn-ended 打日志 */
async function finalizeRunContextUsage(session: SdkSessionAgent, run: Run): Promise<void> {
  if (session.contextUsageFinalized) return
  let runUsage = run.usage
  if (!runUsage) {
    try {
      const result = await run.wait()
      runUsage = result.usage
    } catch {
      // wait 失败仍用 turn-ended 快照
    }
  }
  finalizeContextUsageAtRunEnd(session, runUsage, pushUiLog)
}

/**
 * Run 事件流消费 SSOT：`run.wait()` 仅允许出现在 finalizeRunContextUsage / completeSdkRun 收尾路径。
 */
export async function streamRunEvents(session: SdkSessionAgent, run: Run): Promise<void> {
  try {
    for await (const event of run.stream()) {
      if (session.abortController.signal.aborted) break
      markSessionActivity(session, `stream:${event.type}`)
      handleSdkEvent(session, event)
    }
    flushSdkLog(session)
    closeThinkingIfOpen(session)
    // Run 收尾仅 final flush，避免 non-final+final 双 POST（08-verify-issue）
    await finalizeRunContextUsage(session, run)
    // Rev2：ordering+含过程场景 assistant IM 唯一出站路径（mid-run release 已由 shouldEndOnlyAssistantDefer 禁止）
    if (session.f41Stream && (session.streamBuffer.trim() || session.outboundMessageId)) {
      await flushStreamPost(session, true)
    }
    if (
      (run.status === "error" || run.status === "cancelled") &&
      isRunTimeoutFailure(session, run) &&
      !session.runFinalizing
    ) {
      await finalizeSdkRunOnTimeout(session, run, "stream")
    }
  } catch (e: unknown) {
    flushSdkLog(session)
    if (!session.abortController.signal.aborted) {
      const msg = e instanceof Error ? `[${e.constructor.name}] ${e.message}` : String(e)
      const stack = e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" | ") : ""
      const cause = e instanceof Error && "cause" in e && e.cause ? JSON.stringify(e.cause) : ""
      pushUiLog("SDK", "ERROR", `[${session.sessionKey}] 流处理异常: ${msg}${stack ? ` stack=${stack}` : ""}${cause ? ` cause=${cause}` : ""}`)
      await finalizeRunContextUsage(session, run)
      await notifySdkFailure(session, undefined, run, "sdk_stream_exception")
    }
  }
}
