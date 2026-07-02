/**
 * CC watchdog 超时 Run 收尾 IM 通知（与 Cursor SDK finalizeSdkRunOnTimeout 对称）
 */
import type { CcSessionAgent } from "./agent-cc-types"
import { formatUserSdkFailureMessage } from "../cursor-sdk/sdk-failure-messages"

/** watchdog 超时 IM 收尾：一次 notify + stop_progress，不写 failedCooldowns */
export async function finalizeCcRunOnWatchdogTimeout(
  session: CcSessionAgent,
  notify: (sessionKey: string, text: string, stopProgress?: boolean) => Promise<void>,
): Promise<void> {
  if (session.errorNotified) return
  session.errorNotified = true
  session.watchdogTimedOut = false
  const msg = formatUserSdkFailureMessage({ isTimeoutFailure: true })
  await notify(session.sessionKey, msg, true)
}
