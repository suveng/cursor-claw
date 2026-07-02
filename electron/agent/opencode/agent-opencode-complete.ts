/**
 * OpenCode Run 收尾：代际校验、失败 notify、guard 释放（仿 agent-codex-complete）。
 */
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { pushUiLog } from "../../app/ui-logger"
import { appendContextFooter, formatContextFooter } from "../cursor-sdk/context-usage"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { archiveAgentFailureLogs } from "../shared/crash-log-archiver"
import type { OpencodeSessionAgent } from "./agent-opencode-types"
import { maskOpencodeApiKey } from "./agent-opencode-utils"
import {
  flushOpencodeLog,
  flushOpencodeStreamPost,
  notifyOpencodeSessionChat,
  maybeRotateOpencodeSessionContext,
  broadcastOpencodeSessionStatus,
} from "./agent-opencode-stream"

const FAILURE_FALLBACK = "⚠️ Agent 处理失败，建议精简输入后重新发送；若仍失败请稍后重试。"

export interface CompleteOpencodeRunOptions {
  deleteSession: (key: string) => void
  getAllSessions: () => OpencodeSessionAgent[]
  setFailedCooldown: (key: string, until: number) => void
  resetPresentationState: (session: OpencodeSessionAgent) => void
}

export interface OpencodeRunEpoch {
  runStartedAt?: number
  runGuardToken?: string
}

function isStaleRun(session: OpencodeSessionAgent, epoch?: OpencodeRunEpoch): boolean {
  if (!epoch) return false
  if (epoch.runGuardToken != null && session.runGuardToken !== epoch.runGuardToken) return true
  if (epoch.runStartedAt != null && session.runStartedAt !== epoch.runStartedAt) return true
  return false
}

/** Run 结束后清理、推送最终流式内容与失败 notify */
export async function completeOpencodeRun(
  session: OpencodeSessionAgent,
  exitCode: number | null,
  opts: CompleteOpencodeRunOptions,
  failCooldownMs: number,
  epoch?: OpencodeRunEpoch,
): Promise<void> {
  const { deleteSession, getAllSessions, setFailedCooldown, resetPresentationState } = opts
  const sessionKey = session.sessionKey

  if (isStaleRun(session, epoch)) {
    pushUiLog("OpenCode", "INFO", `[${sessionKey}] completeOpencodeRun 跳过（代际不匹配）`)
    return
  }
  if (session.runFinalizing) return
  session.runFinalizing = true
  session.eventLoopRunning = false

  flushOpencodeLog(session)
  session.thinkingOpen = false

  if (session.f41Stream && (session.streamBuffer.trim() || session.outboundMessageId)) {
    await flushOpencodeStreamPost(session, true)
  } else if (session.streamBuffer.trim()) {
    const footer = formatContextFooter(session.contextUsage, session.contextLimitTokens ?? null, session.contextUsagePeakTokens)
    await notifyOpencodeSessionChat(sessionKey, appendContextFooter(session.streamBuffer, footer), true)
  }

  const isWatchdogTimeout = session.watchdogTimedOut === true
  const isError = session.lastStatus?.status === "ERROR" || (exitCode !== null && exitCode !== 0)
  const footer = formatContextFooter(session.contextUsage, session.contextLimitTokens ?? null, session.contextUsagePeakTokens)

  if (isWatchdogTimeout) {
    if (!session.errorNotified) {
      session.errorNotified = true
      session.watchdogTimedOut = false
      await notifyOpencodeSessionChat(sessionKey, appendContextFooter(session.lastStatus?.message ?? FAILURE_FALLBACK, footer), true)
      archiveAgentFailureLogs({
        sessionKey,
        failureType: "sdk_timeout",
        session,
        detail: `apiKey=${maskOpencodeApiKey(session.apiKey)} watchdog=1`,
      })
    }
  } else if (isError && !session.errorNotified) {
    session.errorNotified = true
    await notifyOpencodeSessionChat(sessionKey, appendContextFooter(session.lastStatus?.message ?? FAILURE_FALLBACK, footer), true)
    archiveAgentFailureLogs({
      sessionKey,
      failureType: "sdk_run_error",
      session,
      detail: `apiKey=${maskOpencodeApiKey(session.apiKey)} status=${session.lastStatus?.status ?? "ERROR"}`,
    })
    setFailedCooldown(sessionKey, Date.now() + failCooldownMs)
  }

  if (isStaleRun(session, epoch)) {
    session.runFinalizing = false
    return
  }

  if (session.runGuardToken) {
    completeRunGuard(sessionKey, session.runGuardToken)
    releaseRunGuard(sessionKey, session.runGuardToken)
    session.runGuardToken = undefined
  }
  session.pendingDispatch = false
  await reportSessionAgentPhase(sessionKey, "idle")

  if (session.residentMode) {
    maybeRotateOpencodeSessionContext(session)
    resetPresentationState(session)
    broadcastOpencodeSessionStatus(getAllSessions())
  } else {
    deleteSession(sessionKey)
    broadcastOpencodeSessionStatus(getAllSessions())
  }
  session.runFinalizing = false
}

/** finalizeOpencodeRun 别名（T6 契约） */
export const finalizeOpencodeRun = completeOpencodeRun
