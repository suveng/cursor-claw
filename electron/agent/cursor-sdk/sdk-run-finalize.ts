/**
 * SDK Run 失败通知与超时 finalizer（拆分自 agent-sdk.ts）
 */
import type { Run } from "@cursor/sdk"
import {
  appendContextFooter,
  formatContextFooter,
  resolveDisplayContextTokens,
} from "./context-usage"
import { archiveAgentFailureLogs, type FailureArchiveType } from "../shared/crash-log-archiver"
import { formatUserSdkFailureMessage } from "./sdk-failure-messages"
import {
  finalizeSdkRunOnTimeout as finalizeSdkRunOnTimeoutImpl,
  isRunTimeoutFailure as isRunTimeoutFailureImpl,
  type FinalizerContext,
} from "./finalize-sdk-run"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { clearActiveSdkRun } from "./sdk-run-persistence"
import { notifySessionChat } from "../../daemon/sdk-daemon-notify"
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

function formatSdkStreamFailure(
  status?: string,
  message?: string,
  ctx?: {
    lastTool?: { name: string; status: string }
    durationMs?: number
    errorCode?: string
    runResult?: string
    contextUsed?: number
    contextLimit?: number | null
    preSendUsedTokens?: number
    preSendUsageRatio?: number
    isTimeoutFailure?: boolean
  },
): string {
  return formatUserSdkFailureMessage({
    status,
    message,
    errorCode: ctx?.errorCode,
    runResult: ctx?.runResult,
    lastTool: ctx?.lastTool,
    durationMs: ctx?.durationMs,
    contextUsed: ctx?.contextUsed,
    contextLimit: ctx?.contextLimit,
    preSendUsedTokens: ctx?.preSendUsedTokens,
    preSendUsageRatio: ctx?.preSendUsageRatio,
    isTimeoutFailure: ctx?.isTimeoutFailure ?? false,
  })
}

/** 失败 IM 通知（含崩溃归档） */
export async function notifySdkFailure(
  session: SdkSessionAgent,
  override?: string,
  run?: Run | null,
  failureType?: FailureArchiveType,
): Promise<void> {
  if (session.errorNotified || session.abortController.signal.aborted) return
  session.errorNotified = true
  const resolvedType: FailureArchiveType =
    failureType ??
    (session.lastStatus?.status === "CANCELLED" ? "sdk_cancelled" : "sdk_run_error")
  archiveAgentFailureLogs({
    sessionKey: session.sessionKey,
    failureType: resolvedType,
    session,
    agentId: session.agentId,
    runStatus: run?.status ?? session.run?.status,
  })
  const last = session.lastStatus
  const contextUsed = resolveDisplayContextTokens(
    session.contextUsage,
    session.contextUsagePeakTokens,
  )
  let text = override ?? formatSdkStreamFailure(last?.status, last?.message, {
    lastTool: session.lastTool,
    durationMs: resolveRunDurationMs(session, run),
    errorCode: extractErrorCode(run) ?? extractErrorCode(last),
    runResult: run?.result ?? session.run?.result,
    contextUsed,
    contextLimit: session.contextLimitTokens ?? null,
    preSendUsedTokens: session.lastPreSendUsedTokens,
    preSendUsageRatio: session.lastPreSendUsageRatio,
    isTimeoutFailure: run ? isRunTimeoutFailure(session, run, last) : false,
  })
  const footer = formatContextFooter(
    session.contextUsage,
    session.contextLimitTokens ?? null,
    session.contextUsagePeakTokens,
    session.contextUsageFromRunTotal,
  )
  text = appendContextFooter(text, footer)
  await notifySessionChat(session.sessionKey, text, true)
}

/** pre-send 上下文已满阻断：即时 IM，复用 T4 文案器 */
export async function notifyPreSendContextFailure(session: SdkSessionAgent): Promise<void> {
  if (session.errorNotified || session.abortController.signal.aborted) return
  session.errorNotified = true
  let text = formatUserSdkFailureMessage({
    preSendUsedTokens: session.lastPreSendUsedTokens,
    preSendUsageRatio: session.lastPreSendUsageRatio,
    contextLimit: session.contextLimitTokens ?? null,
    isTimeoutFailure: false,
  })
  const footer = formatContextFooter(
    session.contextUsage,
    session.contextLimitTokens ?? null,
    session.contextUsagePeakTokens,
    session.contextUsageFromRunTotal,
  )
  text = appendContextFooter(text, footer)
  await notifySessionChat(session.sessionKey, text, true)
}

export async function notifyDispatchFailure(sessionKey: string, reason: string): Promise<void> {
  pushUiLog("SDK", "ERROR", `[${sessionKey}] dispatch_failed: ${reason}`)
  archiveAgentFailureLogs({
    sessionKey,
    failureType: "dispatch_failed",
    detail: reason,
  })
  await notifySessionChat(sessionKey, "⚠️ 消息投递失败，请稍后重试。", true)
}

/** finalizer 上下文：绑定 sdkSessions 等依赖 */
const finalizerCtx: FinalizerContext = {
  sdkSessions,
  resetStreamPostChain: (session) => resetStreamPostChain(session as SdkSessionAgent),
  notifySdkFailure: (session, override, run) =>
    notifySdkFailure(session as SdkSessionAgent, override, run),
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
