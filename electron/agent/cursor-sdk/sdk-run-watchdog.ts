/**
 * SDK Run watchdog（idle/absolute 解耦，对称 agent-cc-events armCcWatchdog）
 */
import type { Run } from "@cursor/sdk"
import { PLATFORM_RUN_LIMIT_MS, cancelRunAndWait } from "./finalize-sdk-run"
import { getRunGuardHeldMs, watchRunGuard } from "../shared/agent-run-guard"
import { finalizeSdkRunOnTimeout } from "./sdk-run-finalize"
import { setWatchdogState } from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"
import { pushUiLog } from "../../app/ui-logger"
import { logSdkRunChainError } from "./sdk-async-guard"

const LEGACY_RUN_WATCHDOG_TIMEOUT_MS = Number(process.env.SDK_RUN_WATCHDOG_MS || PLATFORM_RUN_LIMIT_MS)
const RUN_WATCHDOG_IDLE_TIMEOUT_MS = Number(
  process.env.SDK_IDLE_TIMEOUT_MS
  || process.env.sdk_idle_timeout_ms
  || LEGACY_RUN_WATCHDOG_TIMEOUT_MS,
)
const RUN_WATCHDOG_DRAIN_GRACE_MS = Number(process.env.SDK_DRAIN_GRACE_MS || process.env.sdk_drain_grace_ms || 12_000)
export const NEVER_CANCEL_ON_DURATION = (() => {
  const raw = (process.env.NEVER_CANCEL_ON_DURATION ?? process.env.never_cancel_on_duration ?? "true").trim().toLowerCase()
  return raw !== "0" && raw !== "false"
})()
const RUN_WATCHDOG_TICK_MS = 800

function resolveSafeTimeoutMs(raw: number, fallback: number): number {
  if (Number.isFinite(raw) && raw > 0) return raw
  return fallback
}

const WATCHDOG_IDLE_TIMEOUT_MS = resolveSafeTimeoutMs(RUN_WATCHDOG_IDLE_TIMEOUT_MS, LEGACY_RUN_WATCHDOG_TIMEOUT_MS)
const WATCHDOG_DRAIN_GRACE_MS = resolveSafeTimeoutMs(RUN_WATCHDOG_DRAIN_GRACE_MS, 12_000)
const WATCHDOG_ABSOLUTE_TIMEOUT_MS = resolveSafeTimeoutMs(LEGACY_RUN_WATCHDOG_TIMEOUT_MS, PLATFORM_RUN_LIMIT_MS)

function isRunActiveNonTerminal(run: Run): boolean {
  const st = run.status
  return st !== "finished" && st !== "cancelled" && st !== "error"
}

/**
 * watchdog idle 取消豁免：长工具/等待用户时墙钟 idle 不应进入 cancelling。
 * 判定顺序：run 终态 → runPhase → lastTool.running。
 */
function shouldExemptWatchdogIdleCancel(session: SdkSessionAgent, run: Run): boolean {
  if (!isRunActiveNonTerminal(run)) return false
  if (session.runPhase === "tool_running" || session.runPhase === "awaiting_user") return true
  return session.lastTool?.status?.toLowerCase() === "running"
}

/** watchdog 统一超时入口：触发 run.cancel + run.wait 收敛，再进入超时 finalizer */
export function armRunWatchdog(session: SdkSessionAgent, run: Run, token: string): void {
  session.watchdogState = "running"
  session.watchdogStateAt = Date.now()
  void watchRunGuard({
    sessionKey: session.sessionKey,
    token,
    timeoutMs: NEVER_CANCEL_ON_DURATION ? Number.MAX_SAFE_INTEGER : WATCHDOG_ABSOLUTE_TIMEOUT_MS,
    tickMs: RUN_WATCHDOG_TICK_MS,
    onTick: () => {
      if (session.run !== run) return "completed"
      const st = run.status
      if (st === "finished" || st === "cancelled" || st === "error") return "completed"
      const now = Date.now()
      const idleMs = now - session.lastActivityAt
      const idleExempt = shouldExemptWatchdogIdleCancel(session, run)
      if (idleExempt) {
        if (session.watchdogState !== "running") {
          setWatchdogState(
            session,
            "running",
            `activity_exempt:phase=${session.runPhase ?? "-"} tool=${session.lastTool?.name ?? "-"}:${session.lastTool?.status ?? "-"}`,
          )
        }
        if (
          !NEVER_CANCEL_ON_DURATION &&
          session.runStartedAt != null &&
          now - session.runStartedAt >= WATCHDOG_ABSOLUTE_TIMEOUT_MS
        ) {
          setWatchdogState(session, "cancelling", "duration_limit")
          return "timeout"
        }
        return undefined
      }
      if (idleMs >= WATCHDOG_IDLE_TIMEOUT_MS && session.watchdogState === "running") {
        setWatchdogState(session, "draining", `idle:${idleMs}ms`)
      }
      if (session.watchdogState === "draining") {
        const drainingMs = now - session.watchdogStateAt
        if (drainingMs >= WATCHDOG_DRAIN_GRACE_MS) {
          setWatchdogState(session, "cancelling", `grace_elapsed:${drainingMs}ms`)
          return "timeout"
        }
      }
      if (
        !NEVER_CANCEL_ON_DURATION &&
        session.runStartedAt != null &&
        now - session.runStartedAt >= WATCHDOG_ABSOLUTE_TIMEOUT_MS
      ) {
        setWatchdogState(session, "cancelling", "duration_limit")
        return "timeout"
      }
      return undefined
    },
    onTimeout: async () => {
      const heldMs = getRunGuardHeldMs(session.sessionKey)
      if (session.run !== run || session.runFinalizing) return
      const idleMs = Date.now() - session.lastActivityAt
      if (shouldExemptWatchdogIdleCancel(session, run)) {
        setWatchdogState(session, "running", `skip_timeout_activity_exempt:idleMs=${idleMs}`)
        return
      }
      if (idleMs < WATCHDOG_IDLE_TIMEOUT_MS) {
        setWatchdogState(session, "running", `skip_timeout_idle_recovered:${idleMs}ms`)
        return
      }
      setWatchdogState(session, "cancelling", `timeout_cb_idle:${idleMs}ms`)
      pushUiLog(
        "SDK",
        "WARN",
        `[${session.sessionKey}] watchdog 超时，开始收尾 heldMs=${heldMs ?? -1} idleMs=${idleMs} state=${session.watchdogState}`,
      )
      await cancelRunAndWait(run)
      if (!session.runFinalizing && session.run === run) {
        await finalizeSdkRunOnTimeout(session, run, "watchdog")
      }
    },
  })
    .then((result) => {
      pushUiLog("SDK", "INFO", `[${session.sessionKey}] watchdog 结束: ${result}`)
    })
    .catch((err: unknown) => {
      logSdkRunChainError(session.sessionKey, "watchdog", err, "WARN")
    })
}
