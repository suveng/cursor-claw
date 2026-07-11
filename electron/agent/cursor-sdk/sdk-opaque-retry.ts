/**
 * 静默早期 ERROR 判定与一次重建重试（opaque_retry）。
 * 覆盖：send 表面成功但 Run 数秒内无 message/result/tool 的僵死连接失败。
 * 注意：不 import lifecycle，避免与 completeSdkRun 循环依赖；由调用方 startSdkRun。
 */
import type { Run } from "@cursor/sdk"
import { recreateSessionAgent } from "./sdk-resident-refresh"
import { sendWithRetry } from "./sdk-run-dispatch"
import { resetSdkRunPresentationState, resolveRunDurationMs } from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"
import { pushUiLog } from "../../app/ui-logger"

/** 静默早期失败：duration 低于该阈值才视为可恢复僵死 */
const OPAQUE_EARLY_DURATION_MS = 15_000

/** 与 failure-messages 同等：空或含路径/stack 视为不可展示 */
function isUnsafeOrEmptyMessage(msg?: string): boolean {
  const t = msg?.trim()
  return !t || /[/\\]|\.ts:|at |stack|Error:|ENOENT|spawn|EACCES|EPERM/i.test(t)
}

/**
 * 静默早期 Run 失败：error 态、无可用详情、无业务 tool、短 duration、本 turn usage≈0。
 */
export function isOpaqueEarlyRunFailure(
  session: SdkSessionAgent,
  run: Run,
  opts?: { errorCode?: string },
): boolean {
  const statusError =
    run.status === "error" || session.lastStatus?.status?.toUpperCase() === "ERROR"
  if (!statusError) return false

  const msg = session.lastStatus?.message
  // 有可安全展示的 message 则非 opaque
  if (msg?.trim() && !isUnsafeOrEmptyMessage(msg)) return false

  if (run.result != null && String(run.result).trim() !== "") return false
  if (opts?.errorCode?.trim()) return false

  // 已真正执行过业务 tool 则非「早期静默」
  if (session.lastTool) return false

  const durationMs = resolveRunDurationMs(session, run)
  if (durationMs != null && durationMs >= OPAQUE_EARLY_DURATION_MS) return false

  // 本 turn usage 基本为 0（若可得）
  const u = session.contextUsage
  const turnTokens =
    (u?.inputTokens ?? 0) +
    (u?.outputTokens ?? 0) +
    (session.contextUsageFromRunTotal ?? 0)
  if (turnTokens > 0) return false

  return true
}

/**
 * 重建 Agent 并用 lastSendText 再 send 一次。
 * 成功返回新 Run；失败返回 null（调用方走原有 notify）。
 * 不 notify、不写 failedCooldowns、不 startSdkRun。
 */
export async function resendAfterOpaqueFailure(
  session: SdkSessionAgent,
  failedRun: Run,
): Promise<Run | null> {
  const sessionKey = session.sessionKey
  const retryText = session.lastSendText?.trim()
  if (!retryText) return null

  pushUiLog(
    "SDK",
    "WARN",
    `[${sessionKey}] opaque_retry start agentId=${session.agentId} durationMs=${failedRun.durationMs ?? "n/a"}`,
  )

  const rebuilt = await recreateSessionAgent(session, "opaque_retry")
  pushUiLog(
    "SDK",
    rebuilt ? "INFO" : "WARN",
    `[${sessionKey}] opaque_retry recreate ${rebuilt ? "ok" : "keep_old"} agentId=${session.agentId}`,
  )

  // 清呈现态；保留 lastSendText，闩住 opaqueRetryDone
  resetSdkRunPresentationState(session)
  session.opaqueRetryDone = true
  session.lastSendText = retryText

  let sendResult: Awaited<ReturnType<typeof sendWithRetry>>
  try {
    sendResult = await sendWithRetry(session, retryText)
  } catch (err: unknown) {
    pushUiLog(
      "SDK",
      "WARN",
      `[${sessionKey}] opaque_retry send exception: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }

  if (!sendResult.run) {
    pushUiLog(
      "SDK",
      "WARN",
      `[${sessionKey}] opaque_retry send failed reason=${sendResult.finalReason ?? "unknown"}`,
    )
    return null
  }

  pushUiLog("SDK", "INFO", `[${sessionKey}] opaque_retry send ok`)
  return sendResult.run
}
