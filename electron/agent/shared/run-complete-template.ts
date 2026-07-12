/**
 * 共享 Run 收尾模板：幂等闩、plain/stream 分流、失败归档
 */
import type { CompleteRunContext } from "./run-complete-template-types.js"
import type { RunFailureReason, RunLifecycleSessionSlice } from "./run-lifecycle-types.js"
import { archiveAgentFailureLogs, type FailureArchiveType } from "./crash-log-archiver.js"
import { flushFeishuPlainAssistantIfNeeded } from "./feishu-plain-assistant-reply.js"
import { formatRunFailureMessage } from "./run-failure-formatter.js"
import { notifySessionChat } from "./run-notify.js"

export type { CompleteRunContext } from "./run-complete-template-types.js"

/** failureType 与 RunFailureReason 映射（归档 meta.json） */
function mapFailureArchiveType(reason: RunFailureReason): FailureArchiveType {
  switch (reason) {
    case "dispatch_failed":
      return "dispatch_failed"
    case "timeout":
      return "sdk_timeout"
    case "user_cancelled":
      return "sdk_cancelled"
    default:
      return "sdk_run_error"
  }
}

/**
 * 幂等收尾：footer 拼接、errorNotified 闩、失败归档 + IM
 * f41 stream-text 成功路径由引擎 stream 收尾，此处避免双写 assistant
 */
export async function completeRunFromTemplate(
  session: RunLifecycleSessionSlice,
  ctx: CompleteRunContext,
): Promise<void> {
  if (session.runFinalizing) return
  if (session.abortController?.signal.aborted && ctx.source !== "failure") return

  const isFailure = ctx.source === "failure" || ctx.source === "watchdog" || !!ctx.failure
  if (isFailure) {
    if (session.errorNotified) return
    session.errorNotified = true
    const reason = ctx.failure?.reason ?? (ctx.source === "watchdog" ? "timeout" : "run_error")
    archiveAgentFailureLogs({
      sessionKey: session.sessionKey,
      failureType: mapFailureArchiveType(reason),
      session,
      detail: ctx.failure?.detail,
    })
    const text =
      ctx.failureText?.trim() ||
      formatRunFailureMessage({
        reason,
        detail: ctx.failure?.detail,
        sessionKey: session.sessionKey,
      })
    await notifySessionChat(session.sessionKey, text, { stop_progress: true })
    return
  }

  if (ctx.source === "cancelled") {
    if (session.errorNotified) return
    session.errorNotified = true
    const text = formatRunFailureMessage({ reason: "user_cancelled", sessionKey: session.sessionKey })
    await notifySessionChat(session.sessionKey, text, { stop_progress: true })
    return
  }

  // 成功：f41 已由 stream 收尾则跳过 plain 双写
  const assistantText = ctx.assistantText?.trim() ?? session.streamBuffer?.trim() ?? ""
  if (!assistantText) return
  if (session.f41Stream && session.outboundMessageId) return

  const handled = await flushFeishuPlainAssistantIfNeeded(
    !!session.f41Stream,
    session.channelType,
    true,
    session.sessionKey,
    assistantText,
    session.inboundMessageIds,
    "RunComplete",
  )
  if (handled) return

  if (!session.f41Stream && assistantText) {
    await notifySessionChat(session.sessionKey, assistantText, { stop_progress: true })
  }
}
