/**
 * Cursor SDK Port 生命周期辅助：RunLifecycle 缓存、流式终态路由、complete 收尾
 */
import type { Run } from "@cursor/sdk"
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { formatRunFailureMessage } from "../shared/run-failure-formatter"
import { createRunLifecycle, type RunLifecycle } from "../shared/run-lifecycle"
import type { RunEvent, RunTerminalContext } from "../shared/run-lifecycle-types"
import { notifySessionChat } from "../shared/run-notify"
import { clearActiveSdkRun } from "./sdk-run-persistence"
import {
  completeSdkFailureViaTemplate,
  finalizeSdkRunOnTimeout,
  isRunTimeoutFailure,
} from "./sdk-run-finalize"
import { clearPersistThrottle } from "./sdk-run-persist"
import { resetStreamPostChain } from "./sdk-run-presentation"
import {
  broadcastSdkSessionStatus,
  extractErrorCode,
  failedCooldowns,
  FAIL_COOLDOWN_MS,
  resetSdkRunPresentationState,
  sdkSessions,
} from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"
import { isOpaqueEarlyRunFailure, resendAfterOpaqueFailure } from "./sdk-opaque-retry"
import { pushUiLog } from "../../app/ui-logger"

const lifecycleBySession = new WeakMap<SdkSessionAgent, RunLifecycle>()

/** 获取或创建 session 级 RunLifecycle（单次 Run 复用） */
export function getOrCreateSdkRunLifecycle(session: SdkSessionAgent): RunLifecycle {
  let lc = lifecycleBySession.get(session)
  if (!lc) {
    lc = createRunLifecycle(session)
    lifecycleBySession.set(session, lc)
  }
  return lc
}

/** processing 早退：经 shared formatter + notify（S8 / R4） */
export async function notifySdkProcessingBusy(session: SdkSessionAgent): Promise<void> {
  if (session.errorNotified) return
  session.errorNotified = true
  const text = formatRunFailureMessage({
    reason: "session_abnormal",
    detail: "agent_busy",
    sessionKey: session.sessionKey,
  })
  await notifySessionChat(session.sessionKey, text, { stop_progress: true })
}

/** 流式终态 RunEvent 路由：更新 Lifecycle 阶段，失败/超时委托 finalize 或 template */
export async function applySdkStreamRunEvent(
  session: SdkSessionAgent,
  lifecycle: RunLifecycle,
  event: RunEvent,
  run: Run,
): Promise<boolean> {
  lifecycle.onStreamEvent(event)
  if (session.watchdogTimedOut || session.runFinalizing) return false

  if (event.type === "watchdog_timeout") {
    return finalizeSdkRunOnTimeout(session, run, event.trigger ?? "stream")
  }
  if (event.type === "run_cancelled") {
    if (!session.errorNotified) {
      await completeSdkFailureViaTemplate(session, "sdk_cancelled", undefined, run)
    }
    return false
  }
  if (event.type === "run_failed" && isRunTimeoutFailure(session, run, session.lastStatus)) {
    return finalizeSdkRunOnTimeout(session, run, "status")
  }
  return false
}

/** Run 终态收尾（幂等）：opaque_retry + Lifecycle 失败/成功 + session 清理 */
export async function completeSdkRunViaPort(session: SdkSessionAgent, run: Run): Promise<void> {
  const sessionKey = session.sessionKey
  const lifecycle = getOrCreateSdkRunLifecycle(session)

  if (session.runFinalizing || session.run === null || session.run !== run) {
    pushUiLog(
      "SDK",
      "INFO",
      `[${sessionKey}] completeSdkRun 跳过（幂等 finalizing=${!!session.runFinalizing} runNull=${session.run === null} runMismatch=${session.run !== null && session.run !== run}）`,
    )
    return
  }

  if (
    run.status === "cancelled" &&
    !session.errorNotified &&
    !session.watchdogTimedOut &&
    isRunTimeoutFailure(session, run)
  ) {
    await finalizeSdkRunOnTimeout(session, run, "complete")
    return
  }

  const level = run.status === "error" ? "ERROR" : "INFO"

  if (run.status === "error") {
    const wr = await run.wait().catch((e: unknown) => e)
    const detail = wr instanceof Error ? `${wr.constructor.name}: ${wr.message}` : JSON.stringify(wr)
    const last = session.lastStatus
    const lt = session.lastTool
    const errorCode = extractErrorCode(wr) ?? extractErrorCode(last)
    pushUiLog(
      "SDK",
      "ERROR",
      `[${sessionKey}] agent_failed 运行错误详情: ${[
        `sessionKey=${sessionKey}`,
        `agentId=${session.agentId}`,
        last && `lastStatus=${last.status}${last.message ? ` msg=${last.message}` : ""}`,
        run.result && `run.result=${run.result}`,
        run.durationMs != null && `durationMs=${run.durationMs}`,
        errorCode && `errorCode=${errorCode}`,
        lt && `lastTool=${lt.name}:${lt.status}`,
        `waitResult=${detail}`,
      ].filter(Boolean).join(" ")}`,
    )

    const canOpaque =
      !session.opaqueRetryDone &&
      !!session.lastSendText?.trim() &&
      !isRunTimeoutFailure(session, run) &&
      isOpaqueEarlyRunFailure(session, run, { errorCode })
    if (canOpaque) {
      const retryRun = await resendAfterOpaqueFailure(session, run)
      if (retryRun) {
        resetStreamPostChain(session)
        clearActiveSdkRun(sessionKey)
        clearPersistThrottle(sessionKey)
        session.run = null
        session.pendingDispatch = false
        session.opaqueRetryDone = true
        const { startSdkRun } = await import("./sdk-run-lifecycle.js")
        await startSdkRun(session, retryRun)
        pushUiLog("SDK", "INFO", `[${sessionKey}] opaque_retry complete→new run`)
        return
      }
      pushUiLog("SDK", "WARN", `[${sessionKey}] opaque_retry exhausted, fallback notify`)
    }

    if (!isRunTimeoutFailure(session, run)) {
      failedCooldowns.set(sessionKey, Date.now() + FAIL_COOLDOWN_MS)
    }
    if (!session.errorNotified) {
      await completeSdkFailureViaTemplate(session, "sdk_run_error", undefined, run)
    }
  } else if (run.status === "finished") {
    lifecycle.onStreamEvent({ type: "run_succeeded", result: run.result })
    const ctx: RunTerminalContext = { source: "success", assistantText: session.streamBuffer }
    await lifecycle.enterCompleting(ctx)
  }

  const summary = [
    run.result && `result=${run.result}`,
    run.durationMs != null && `duration=${run.durationMs}ms`,
  ].filter(Boolean).join(", ")
  pushUiLog("SDK", level, `[${sessionKey}] Agent 运行结束 (status=${run.status}${summary ? `, ${summary}` : ""})`)

  if (session.run === null || session.run !== run) {
    pushUiLog(
      "SDK",
      "INFO",
      `[${sessionKey}] completeSdkRun 收尾前跳过（runNull=${session.run === null} runMismatch=${session.run !== null && session.run !== run}）`,
    )
    return
  }

  resetStreamPostChain(session)
  if (session.runGuardToken) {
    completeRunGuard(sessionKey, session.runGuardToken)
    releaseRunGuard(sessionKey, session.runGuardToken)
    session.runGuardToken = undefined
  }
  clearActiveSdkRun(sessionKey)
  clearPersistThrottle(sessionKey)
  session.run = null
  session.pendingDispatch = false
  await reportSessionAgentPhase(sessionKey, "idle")

  if (session.residentMode) {
    resetSdkRunPresentationState(session)
    broadcastSdkSessionStatus()
    return
  }

  try { session.agent.close() } catch { /* best-effort */ }
  sdkSessions.delete(sessionKey)
  broadcastSdkSessionStatus()
}
