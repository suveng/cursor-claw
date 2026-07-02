/**
 * Codex Run 收尾：代际校验、失败 notify、guard 释放与会话清理。
 */
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { pushUiLog } from "../../app/ui-logger"
import { appendContextFooter, formatContextFooter } from "../cursor-sdk/context-usage"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { archiveAgentFailureLogs } from "../shared/crash-log-archiver"
import type { CodexSessionAgent } from "./agent-codex-types"
import { maskCodexApiKey } from "./agent-codex-utils"
import {
  flushCodexLog,
  flushCodexStreamPost,
  notifyCodexSessionChat,
  maybeRotateCodexSessionContext,
  broadcastCodexSessionStatus,
} from "./agent-codex-stream"

/** IM 失败兜底文案（上游未写入 lastStatus 时直出，不经 formatCodexFailureMessage 二次归因） */
const CODEX_FAILURE_FALLBACK_MSG = "⚠️ Agent 处理失败，建议精简输入后重新发送；若仍失败请稍后重试。"

export interface CompleteCodexRunOptions {
  deleteSession: (key: string) => void
  getAllSessions: () => CodexSessionAgent[]
  setFailedCooldown: (key: string, until: number) => void
  resetPresentationState: (session: CodexSessionAgent) => void
}

/** Run 代际快照：stream 启动时捕获，收尾时与 session 比对防旧 run 覆盖新 run */
export interface CodexRunEpoch {
  runStartedAt?: number
  runGuardToken?: string
}

/** 旧 run 收尾是否应 no-op（仿 completeSdkRun run 归属校验） */
function isStaleCodexRunCompletion(session: CodexSessionAgent, epoch?: CodexRunEpoch): boolean {
  if (!epoch) return false
  if (epoch.runGuardToken != null && session.runGuardToken !== epoch.runGuardToken) return true
  if (epoch.runStartedAt != null && session.runStartedAt !== epoch.runStartedAt) return true
  return false
}

/** Run 结束后清理、推送最终流式内容与失败 notify */
export async function completeCodexRun(
  session: CodexSessionAgent,
  exitCode: number | null,
  opts: CompleteCodexRunOptions,
  failCooldownMs: number,
  epoch?: CodexRunEpoch,
): Promise<void> {
  const { deleteSession, getAllSessions, setFailedCooldown, resetPresentationState } = opts
  const sessionKey = session.sessionKey

  if (isStaleCodexRunCompletion(session, epoch)) {
    pushUiLog("Codex", "INFO", `[${sessionKey}] completeCodexRun 跳过（run 代际不匹配）`)
    return
  }
  if (session.runFinalizing) return
  session.runFinalizing = true

  flushCodexLog(session)
  session.thinkingOpen = false

  if (session.f41Stream && (session.streamBuffer.trim() || session.outboundMessageId)) {
    await flushCodexStreamPost(session, true)
  } else if (session.streamBuffer.trim()) {
    const footer = formatContextFooter(session.contextUsage, session.contextLimitTokens ?? null, session.contextUsagePeakTokens)
    await notifyCodexSessionChat(sessionKey, appendContextFooter(session.streamBuffer, footer), true)
  }

  const isWatchdogTimeout = session.watchdogTimedOut === true
  const isError = session.lastStatus?.status === "ERROR" || (exitCode !== null && exitCode !== 0)
  const footer = formatContextFooter(session.contextUsage, session.contextLimitTokens ?? null, session.contextUsagePeakTokens)

  if (isWatchdogTimeout) {
    if (!session.errorNotified) {
      session.errorNotified = true
      session.watchdogTimedOut = false
      const userMsg = session.lastStatus?.message ?? CODEX_FAILURE_FALLBACK_MSG
      await notifyCodexSessionChat(sessionKey, appendContextFooter(userMsg, footer), true)
      archiveAgentFailureLogs({
        sessionKey,
        failureType: "sdk_timeout",
        session,
        detail: `apiKey=${maskCodexApiKey(session.apiKey)} watchdog=1`,
      })
    }
  } else if (isError && !session.errorNotified) {
    session.errorNotified = true
    const userMsg = session.lastStatus?.message ?? CODEX_FAILURE_FALLBACK_MSG
    await notifyCodexSessionChat(sessionKey, appendContextFooter(userMsg, footer), true)
    archiveAgentFailureLogs({
      sessionKey,
      failureType: "sdk_run_error",
      session,
      detail: `apiKey=${maskCodexApiKey(session.apiKey)} status=${session.lastStatus?.status ?? "ERROR"}`,
    })
    setFailedCooldown(sessionKey, Date.now() + failCooldownMs)
  }

  if (isStaleCodexRunCompletion(session, epoch)) {
    pushUiLog("Codex", "INFO", `[${sessionKey}] completeCodexRun 收尾前跳过（run 代际不匹配）`)
    session.runFinalizing = false
    return
  }

  session.activeThread = null

  if (session.runGuardToken) {
    completeRunGuard(sessionKey, session.runGuardToken)
    releaseRunGuard(sessionKey, session.runGuardToken)
    session.runGuardToken = undefined
  }
  session.pendingDispatch = false
  await reportSessionAgentPhase(sessionKey, "idle")

  if (session.residentMode) {
    maybeRotateCodexSessionContext(session)
    resetPresentationState(session)
    broadcastCodexSessionStatus(getAllSessions())
    return
  }
  deleteSession(sessionKey)
  broadcastCodexSessionStatus(getAllSessions())
}
