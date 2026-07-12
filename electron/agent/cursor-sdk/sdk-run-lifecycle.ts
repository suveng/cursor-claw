/**
 * SDK Run 生命周期：start / complete（委托 engine-port-adapter + RunLifecycle）
 */
import type { Run } from "@cursor/sdk"
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { cancelRunAndWait } from "./finalize-sdk-run"
import { clearActiveSdkRun, markSdkRunUserStopped } from "./sdk-run-persistence"
import { notifySessionChat, stopSessionChatProgress } from "../shared/run-notify"
import { completeSdkFailureViaTemplate } from "./sdk-run-finalize"
import { persistActiveRunSnapshot, clearPersistThrottle } from "./sdk-run-persist"
import { resetStreamPostChain } from "./sdk-run-presentation"
import { streamRunEvents } from "./sdk-run-stream"
import {
  completeSdkRunViaPort,
  cursorEnginePort,
  getOrCreateSdkRunLifecycle,
} from "./engine-port-adapter"
import {
  broadcastSdkSessionStatus,
  clearSdkDispatchState,
  markSessionActivity,
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

/** 启动 Run：adapter watchdog + Lifecycle + 事件流 */
export async function startSdkRun(session: SdkSessionAgent, run: Run): Promise<void> {
  const sessionKey = session.sessionKey
  session.failureArchiveDone = false
  session.run = run
  session.runStartedAt = Date.now()
  session.runPhase = "executing"
  markSessionActivity(session, "run_start")
  persistActiveRunSnapshot(session, run, true)

  const lifecycle = getOrCreateSdkRunLifecycle(session)
  lifecycle.enterGuard()
  cursorEnginePort.watchdog(session, {})

  await notifySessionChat(session.sessionKey, NOTIFY_PROCESSING)
  await reportSessionAgentPhase(session.sessionKey, "processing")

  streamRunEvents(session, run, lifecycle)
    .then(() => completeSdkRun(session, run))
    .catch((err: unknown) => {
      logSdkRunChainError(sessionKey, "stream→complete", err)
      if (session.abortController.signal.aborted || session.errorNotified) return
      if (isSdkNetworkOrTimeoutError(err)) {
        guardSdkPromise(
          completeSdkFailureViaTemplate(session, "sdk_stream_exception", undefined, run),
          sessionKey,
          "completeSdkFailureViaTemplate",
          "ERROR",
        )
      }
    })
}

/** Run 终态收尾（幂等）— 委托 Port adapter */
export async function completeSdkRun(session: SdkSessionAgent, run: Run): Promise<void> {
  await completeSdkRunViaPort(session, run)
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
  // 用户取消不发 IM，但须停 typing（R4 终态必停）
  stopSessionChatProgress(sessionKey)
  void reportSessionAgentPhase(sessionKey, "idle")
  broadcastSdkSessionStatus()
}

export function stopAllSdkSessions(): void {
  for (const key of [...sdkSessions.keys()]) stopSdkSession(key)
  clearSdkDispatchState()
}
