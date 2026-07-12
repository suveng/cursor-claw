/**
 * 共享失败 IM 文案格式化（归因 → 用户可见句）
 * 一期各 reason 分支委托 SDK 现有实现，保证文案不退化
 */
import type { RunFailureReason } from "./run-lifecycle-types.js"
import { formatUserSdkFailureMessage } from "../cursor-sdk/sdk-failure-messages.js"
import { formatOrchestratorFailure } from "../../../src/shared/orchestrator-failure-formatter.js"

export { formatOrchestratorFailure }

export interface RunFailureFormatContext {
  reason: RunFailureReason
  detail?: string
  sessionKey?: string
  engineLabel?: string
  /** SDK 富上下文（run_error / timeout 等分支可选传入） */
  sdk?: {
    status?: string
    message?: string
    errorCode?: string
    runResult?: string
    isTimeoutFailure?: boolean
    contextUsed?: number
    contextLimit?: number | null
    preSendUsedTokens?: number
    preSendUsageRatio?: number
  }
}

/** 按 RunFailureReason 映射默认 IM 文案 */
export function formatRunFailureMessage(ctx: RunFailureFormatContext): string {
  const { reason, detail, engineLabel } = ctx
  const label = engineLabel ?? "Agent"

  switch (reason) {
    case "dispatch_failed":
      return detail?.trim()
        ? `⚠️ 消息投递失败：${detail.trim()}`
        : "⚠️ 消息投递失败，请稍后重试。"
    case "user_cancelled":
      return `${label} 任务已取消。`
    case "stale_aborted":
      return "会话已过期或已中止，请重新发送消息继续对话。"
    case "context_exhausted":
      return "⚠️ 上下文窗口已接近或达到上限，请精简需求或开启新话题后重新发送。"
    case "session_abnormal":
      if (detail?.includes("agent_busy") || /busy/i.test(detail ?? "")) {
        return "Agent 正在处理上一条请求，系统会稍后重排，请耐心等待。"
      }
      return `${label} 会话异常，请重新发送消息继续对话。`
    case "timeout":
      return formatUserSdkFailureMessage({
        ...(ctx.sdk ?? {}),
        isTimeoutFailure: true,
      })
    case "run_error":
    default:
      if (ctx.sdk) {
        return formatUserSdkFailureMessage({
          ...ctx.sdk,
          isTimeoutFailure: ctx.sdk.isTimeoutFailure ?? false,
        })
      }
      if (detail?.trim() && !/[/\\]|\.ts:|at |stack/i.test(detail)) {
        return `⚠️ ${label} 处理失败：${detail.trim()}`
      }
      return "⚠️ Agent 处理遇到临时故障，请重新发送；若仍失败请稍后重试。"
  }
}
