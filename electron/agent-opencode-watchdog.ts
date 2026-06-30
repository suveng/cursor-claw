/**
 * OpenCode Run 看门狗（仿 agent-codex-watchdog）。
 */
import { pushUiLog } from "./ui-logger"
import { watchRunGuard } from "./agent-run-guard"
import { formatOpencodeFailureMessage } from "./opencode-failure-messages"
import type { OpencodeSessionAgent } from "./agent-opencode-types"
import { setOpencodeWatchdogState } from "./agent-opencode-utils"

export type ArmOpencodeWatchdogOptions = {
  idleTimeoutMs: number
  tickMs: number
  absoluteTimeoutMs: number
  neverCancelOnDuration: boolean
  getSession: (k: string) => OpencodeSessionAgent | undefined
  setWatchdogState: typeof setOpencodeWatchdogState
}

/** 空闲/绝对超时看门狗 */
export function watchOpencodeRunGuard(session: OpencodeSessionAgent, token: string, opts: ArmOpencodeWatchdogOptions): void {
  void watchRunGuard({
    sessionKey: session.sessionKey,
    token,
    tickMs: opts.tickMs,
    timeoutMs: opts.neverCancelOnDuration ? Number.MAX_SAFE_INTEGER : opts.absoluteTimeoutMs,
    onTick: () => {
      const s = opts.getSession(session.sessionKey)
      if (!s || s.runGuardToken !== token) return "cancelled"
      if (!s.pendingDispatch) return "completed"
      const now = Date.now()
      if (s.watchdogState === "running" && now - s.lastActivityAt >= opts.idleTimeoutMs) {
        opts.setWatchdogState(s, "draining", `idle ${now - s.lastActivityAt}ms`)
        return undefined
      }
      if (s.watchdogState === "draining" && now - s.watchdogStateAt > 15_000) {
        opts.setWatchdogState(s, "cancelling", "drain_grace_exceeded")
        return "timeout"
      }
      if (!opts.neverCancelOnDuration && s.runStartedAt != null && now - s.runStartedAt >= opts.absoluteTimeoutMs) {
        opts.setWatchdogState(s, "cancelling", "duration_limit")
        return "timeout"
      }
      return undefined
    },
    onTimeout: async () => {
      const s = opts.getSession(session.sessionKey)
      if (!s?.pendingDispatch) return
      s.watchdogTimedOut = true
      s.lastStatus = { status: "ERROR", message: formatOpencodeFailureMessage({ isTimeoutFailure: true }) }
      pushUiLog("OpenCode", "WARN", `[${session.sessionKey}] watchdog 超时`)
      try { s.abortController.abort() } catch { /* best-effort */ }
    },
  }).then((r) => pushUiLog("OpenCode", "INFO", `[${session.sessionKey}] watchdog 结束: ${r}`))
}
