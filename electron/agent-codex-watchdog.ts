/**
 * Codex Run 看门狗：空闲/绝对超时检测并 abort Turn。
 */
import { pushUiLog } from "./ui-logger"
import { watchRunGuard } from "./agent-run-guard"
import { formatCodexFailureMessage } from "./codex-failure-messages"
import type { CodexSessionAgent } from "./agent-codex-types"
import { setCodexWatchdogState } from "./agent-codex-utils"

export type ArmCodexWatchdogOptions = {
  idleTimeoutMs: number
  tickMs: number
  absoluteTimeoutMs: number
  neverCancelOnDuration: boolean
  getSession: (k: string) => CodexSessionAgent | undefined
  setWatchdogState: typeof setCodexWatchdogState
}

/** 空闲/绝对超时看门狗；超时 abort Turn 供 completeCodexRun 归因 */
export function armCodexWatchdog(session: CodexSessionAgent, token: string, opts: ArmCodexWatchdogOptions): void {
  void watchRunGuard({
    sessionKey: session.sessionKey, token, tickMs: opts.tickMs,
    timeoutMs: opts.neverCancelOnDuration ? Number.MAX_SAFE_INTEGER : opts.absoluteTimeoutMs,
    onTick: () => {
      const s = opts.getSession(session.sessionKey)
      if (!s || s.runGuardToken !== token) return "cancelled"
      if (!s.pendingDispatch) return "completed"
      const now = Date.now()
      if (s.watchdogState === "running" && now - s.lastActivityAt >= opts.idleTimeoutMs) {
        opts.setWatchdogState(s, "draining", `idle ${now - s.lastActivityAt}ms`); return undefined
      }
      if (s.watchdogState === "draining" && now - s.watchdogStateAt > 15_000) {
        opts.setWatchdogState(s, "cancelling", "drain_grace_exceeded"); return "timeout"
      }
      if (!opts.neverCancelOnDuration && s.runStartedAt != null && now - s.runStartedAt >= opts.absoluteTimeoutMs) {
        opts.setWatchdogState(s, "cancelling", "duration_limit"); return "timeout"
      }
      return undefined
    },
    onTimeout: async () => {
      const s = opts.getSession(session.sessionKey)
      if (!s?.pendingDispatch) return
      s.watchdogTimedOut = true
      s.lastStatus = { status: "ERROR", message: formatCodexFailureMessage({ isTimeoutFailure: true }) }
      pushUiLog("Codex", "WARN", `[${session.sessionKey}] watchdog 超时，中止 Turn`)
      try { s.abortController.abort() } catch { /* best-effort */ }
    },
  }).then((r) => pushUiLog("Codex", "INFO", `[${session.sessionKey}] watchdog 结束: ${r}`))
}
