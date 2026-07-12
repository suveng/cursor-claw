/**
 * SDK Run 失败通知与超时 finalizer（拆分自 agent-sdk.ts）
 */
import type { Run } from "@cursor/sdk"
import {
  appendContextFooter,
  formatContextFooter,
  resolveDisplayContextTokens,
} from "./context-usage"
import type { FailureArchiveType } from "../shared/crash-log-archiver"
import { formatRunFailureMessage } from "../shared/run-failure-formatter"
import { createRunLifecycle } from "../shared/run-lifecycle"
import type { RunFailureReason } from "../shared/run-lifecycle-types"
import {
  finalizeSdkRunOnTimeout as finalizeSdkRunOnTimeoutImpl,
  isRunTimeoutFailure as isRunTimeoutFailureImpl,
  type FinalizerContext,
} from "./finalize-sdk-run"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { clearActiveSdkRun } from "./sdk-run-persistence"
import { resetStreamPostChain } from "./sdk-run-presentation"
import { clearPersistThrottle } from "./sdk-run-persist"
import {
  broadcastSdkSessionStatus,
  extractErrorCode,
  resolveRunDurationMs,
  sdkSessions,
} from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"
import { pushUiLog } from "../../app/ui-logger"

/** FailureArchiveType → RunFailureReason */
function mapArchiveToReason(
  failureType: FailureArchiveType,
  isTimeout: boolean,
): RunFailureReason {
  if (isTimeout) return "timeout"
  switch (failureType) {
    case "dispatch_failed":
      return "dispatch_failed"
    case "sdk_cancelled":
      return "user_cancelled"
    case "sdk_timeout":
      return "timeout"
    default:
      return "run_error"
  }
}

/** 组装 SDK 失败 IM 正文（含 context footer） */
export function buildSdkFailureText(
  session: SdkSessionAgent,
  run: Run | null | undefined,
  override?: string,
  isTimeout = false,
): string {
  if (override) return override
  const last = session.lastStatus
  const contextUsed = resolveDisplayContextTokens(
    session.contextUsage,
    session.contextUsagePeakTokens,
  )
  return formatRunFailureMessage({
    reason: isTimeout ? "timeout" : "run_error",
    sessionKey: session.sessionKey,
    sdk: {
      status: last?.status,
      message: last?.message,
      errorCode: extractErrorCode(run) ?? extractErrorCode(last),
      runResult: run?.result ?? session.run?.result,
      contextUsed,
      contextLimit: session.contextLimitTokens ?? null,
      preSendUsedTokens: session.lastPreSendUsedTokens,
      preSendUsageRatio: session.lastPreSendUsageRatio,
      isTimeoutFailure: isTimeout,
    },
  })
}

/** pre-send 上下文已满阻断：经 RunLifecycle + shared 模板 */
export async function notifyPreSendContextFailure(session: SdkSessionAgent): Promise<void> {
  if (session.errorNotified || session.abortController.signal.aborted) return
  let failureText = formatRunFailureMessage({
    reason: "context_exhausted",
    sessionKey: session.sessionKey,
    sdk: {
      preSendUsedTokens: session.lastPreSendUsedTokens,
      preSendUsageRatio: session.lastPreSendUsageRatio,
      contextLimit: session.contextLimitTokens ?? null,
      isTimeoutFailure: false,
    },
  })
  const footer = formatContextFooter(
    session.contextUsage,
    session.contextLimitTokens ?? null,
    session.contextUsagePeakTokens,
    session.contextUsageFromRunTotal,
  )
  failureText = appendContextFooter(failureText, footer)
  const lifecycle = createRunLifecycle(session)
  lifecycle.onStreamEvent({ type: "run_failed", reason: "context_exhausted" })
  await lifecycle.enterNotifying({
    source: "failure",
    failure: { reason: "context_exhausted" },
    failureText,
  })
}

/** dispatch 失败：试点委托 completeRunFromTemplate + RunLifecycle */
export async function notifyDispatchFailure(sessionKey: string, reason: string): Promise<void> {
  pushUiLog("SDK", "ERROR", `[${sessionKey}] dispatch_failed: ${reason}`)
  const lifecycle = createRunLifecycle({ sessionKey })
  lifecycle.enterGuard()
  await lifecycle.enterNotifying({
    source: "failure",
    failure: { reason: "dispatch_failed", detail: reason },
  })
}

/**
 * SDK 失败收尾：经 RunLifecycle.enterNotifying 委托 completeRunFromTemplate
 * （SDK 富文案经 failureText 传入，归档由模板统一处理）
 */
export async function completeSdkFailureViaTemplate(
  session: SdkSessionAgent,
  failureType: FailureArchiveType,
  detail?: string,
  run?: Run | null,
): Promise<void> {
  if (session.errorNotified) return
  const isTimeout = failureType === "sdk_timeout"
  const resolvedRun = run ?? session.run
  const isTimeoutResolved =
    isTimeout || (resolvedRun ? isRunTimeoutFailure(session, resolvedRun) : false)
  let failureText = buildSdkFailureText(session, resolvedRun, detail, isTimeoutResolved)
  const footer = formatContextFooter(
    session.contextUsage,
    session.contextLimitTokens ?? null,
    session.contextUsagePeakTokens,
    session.contextUsageFromRunTotal,
  )
  failureText = appendContextFooter(failureText, footer)
  const lifecycle = createRunLifecycle(session)
  lifecycle.onStreamEvent({ type: isTimeout ? "watchdog_timeout" : "run_failed" })
  await lifecycle.enterNotifying({
    source: isTimeout ? "watchdog" : "failure",
    failure: {
      reason: mapArchiveToReason(failureType, isTimeout),
      detail,
    },
    failureText,
  })
}

/** finalizer 上下文：绑定 sdkSessions 等依赖（超时 notify 经 RunLifecycle） */
const finalizerCtx: FinalizerContext = {
  sdkSessions,
  resetStreamPostChain: (session) => resetStreamPostChain(session as SdkSessionAgent),
  notifySdkTimeoutFailure: (session, run) =>
    completeSdkFailureViaTemplate(session as SdkSessionAgent, "sdk_timeout", undefined, run),
  broadcastSdkSessionStatus,
}

/** 超时类终态判定 */
export function isRunTimeoutFailure(
  session: SdkSessionAgent,
  run: Run,
  lastStatus?: { status: string; message?: string },
): boolean {
  return isRunTimeoutFailureImpl(session, run, lastStatus)
}

/** 超时类终态主动收尾 */
export async function finalizeSdkRunOnTimeout(
  session: SdkSessionAgent,
  run: Run,
  trigger: string,
): Promise<boolean> {
  const finalized = await finalizeSdkRunOnTimeoutImpl(finalizerCtx, session, run, trigger)
  if (finalized) {
    clearActiveSdkRun(session.sessionKey)
    clearPersistThrottle(session.sessionKey)
    if (session.runGuardToken) {
      completeRunGuard(session.sessionKey, session.runGuardToken)
      releaseRunGuard(session.sessionKey, session.runGuardToken)
      session.runGuardToken = undefined
    }
  }
  return finalized
}
