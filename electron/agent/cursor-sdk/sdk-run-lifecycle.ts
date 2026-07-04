/**
 * SDK Run 生命周期：start / complete（拆分自 agent-sdk.ts）
 */
import type { Run } from "@cursor/sdk"
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { cancelRunAndWait } from "./finalize-sdk-run"
import { clearActiveSdkRun, markSdkRunUserStopped } from "./sdk-run-persistence"
import { notifySessionChat } from "../../daemon/sdk-daemon-notify"
import {
  finalizeSdkRunOnTimeout,
  isRunTimeoutFailure,
  notifySdkFailure,
} from "./sdk-run-finalize"
import { persistActiveRunSnapshot, clearPersistThrottle } from "./sdk-run-persist"
import { resetStreamPostChain } from "./sdk-run-presentation"
import { streamRunEvents } from "./sdk-run-stream"
import { armRunWatchdog } from "./sdk-run-watchdog"
import {
  broadcastSdkSessionStatus,
  extractErrorCode,
  failedCooldowns,
  FAIL_COOLDOWN_MS,
  markSessionActivity,
  pendingLaunches,
  resetSdkRunPresentationState,
  sdkSessions,
} from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"
import { pushUiLog } from "../../app/ui-logger"
import {
  guardSdkPromise,
  isSdkNetworkOrTimeoutError,
  logSdkRunChainError,
} from "./sdk-async-guard"

export const NOTIFY_PROCESSING = "Agent 处理中…"

/** 启动 Run：挂 watchdog + 事件流 SSOT */
export async function startSdkRun(session: SdkSessionAgent, run: Run): Promise<void> {
  const sessionKey = session.sessionKey
  session.failureArchiveDone = false
  session.run = run
  session.runStartedAt = Date.now()
  session.runPhase = "executing"
  markSessionActivity(session, "run_start")
  persistActiveRunSnapshot(session, run, true)
  if (session.runGuardToken) {
    armRunWatchdog(session, run, session.runGuardToken)
  }
  await notifySessionChat(session.sessionKey, NOTIFY_PROCESSING)
  await reportSessionAgentPhase(session.sessionKey, "processing")
  streamRunEvents(session, run)
    .then(() => completeSdkRun(session, run))
    .catch((err: unknown) => {
      logSdkRunChainError(sessionKey, "stream→complete", err)
      if (session.abortController.signal.aborted || session.errorNotified) return
      if (isSdkNetworkOrTimeoutError(err)) {
        guardSdkPromise(
          notifySdkFailure(session, undefined, run, "sdk_stream_exception"),
          sessionKey,
          "notifySdkFailure",
          "ERROR",
        )
      }
    })
}

/** Run 终态收尾（幂等） */
export async function completeSdkRun(session: SdkSessionAgent, run: Run): Promise<void> {
  const sessionKey = session.sessionKey

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
    const parts = [
      `sessionKey=${sessionKey}`,
      `agentId=${session.agentId}`,
      last && `lastStatus=${last.status}${last.message ? ` msg=${last.message}` : ""}`,
      run.result && `run.result=${run.result}`,
      run.durationMs != null && `durationMs=${run.durationMs}`,
      errorCode && `errorCode=${errorCode}`,
      lt && `lastTool=${lt.name}:${lt.status}`,
      `waitResult=${detail}`,
    ].filter(Boolean)
    pushUiLog("SDK", "ERROR", `[${sessionKey}] agent_failed 运行错误详情: ${parts.join(" ")}`)
    if (!isRunTimeoutFailure(session, run)) {
      failedCooldowns.set(sessionKey, Date.now() + FAIL_COOLDOWN_MS)
    }
    if (!session.errorNotified) {
      await notifySdkFailure(session, undefined, run)
    }
  }

  const summary = [
    run.result && `result=${run.result}`,
    run.durationMs != null && `duration=${run.durationMs}ms`,
  ].filter(Boolean).join(", ")
  pushUiLog("SDK", level, `[${sessionKey}] Agent 运行结束 (status=${run.status}${summary ? `, ${summary}` : ""})`)

  if (session.runFinalizing || session.run === null || session.run !== run) {
    pushUiLog(
      "SDK",
      "INFO",
      `[${sessionKey}] completeSdkRun 收尾前跳过（finalizing=${!!session.runFinalizing} runNull=${session.run === null} runMismatch=${session.run !== null && session.run !== run}）`,
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

/** 用户主动停止：标记不续接并清除活跃快照 */
export function stopSdkSession(sessionKey: string): void {
  const s = sdkSessions.get(sessionKey)
  if (!s) return
  markSdkRunUserStopped(sessionKey)
  clearActiveSdkRun(sessionKey)
  clearPersistThrottle(sessionKey)
  s.abortController.abort()
  resetStreamPostChain(s)
  if (s.run) void cancelRunAndWait(s.run)
  if (s.runGuardToken) {
    completeRunGuard(sessionKey, s.runGuardToken)
    releaseRunGuard(sessionKey, s.runGuardToken)
    s.runGuardToken = undefined
  }
  s.agent.close()
  sdkSessions.delete(sessionKey)
  void reportSessionAgentPhase(sessionKey, "idle")
  broadcastSdkSessionStatus()
}

export function stopAllSdkSessions(): void {
  for (const key of [...sdkSessions.keys()]) stopSdkSession(key)
  failedCooldowns.clear()
  pendingLaunches.clear()
}
