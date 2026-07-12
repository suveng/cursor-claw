/**
 * Codex Run 收尾：代际校验、失败 notify、guard 释放与会话清理。
 * 终态 IM 委托 engine-port-adapter → RunLifecycle + shared 模板。
 */
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { pushUiLog } from "../../app/ui-logger"
import { appendContextFooter, formatContextFooter } from "../cursor-sdk/context-usage"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import type { CodexSessionAgent } from "./agent-codex-types"
import {
  flushCodexLog,
  flushCodexStreamPost,
  clearCodexStreamPostTimer,
  maybeRotateCodexSessionContext,
  broadcastCodexSessionStatus,
} from "./agent-codex-stream"
import {
  completeCodexViaLifecycle,
  notifyCodexRunFailure,
  notifyCodexWatchdogTimeout,
} from "./engine-port-adapter"
import { clearCodexActiveRun } from "./codex-run-persistence"
import { clearCodexPersistThrottle } from "./codex-run-persist"

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

  // Rev2 end-only：含过程 defer 场景下 flushCodexStreamPost(true) 为唯一 assistant IM 出站（禁止 mid-run release）
  clearCodexStreamPostTimer(session)
  if (session.f41Stream && (session.streamBuffer.trim() || session.outboundMessageId)) {
    await flushCodexStreamPost(session, true)
  } else if (session.streamBuffer.trim()) {
    const footer = formatContextFooter(
      session.contextUsage,
      session.contextLimitTokens ?? null,
      session.contextUsagePeakTokens,
      session.contextUsageFromRunTotal,
    )
    await completeCodexViaLifecycle(session, {
      source: "success",
      assistantText: appendContextFooter(session.streamBuffer, footer),
    })
  }
  // 收尾后丢弃 in-flight 链，避免下一 Run 串到旧 POST（对称 OpenCode resetStreamPostChain）
  session.streamPostChain = undefined

  const isWatchdogTimeout = session.watchdogTimedOut === true
  const isError = session.lastStatus?.status === "ERROR" || (exitCode !== null && exitCode !== 0)

  if (isWatchdogTimeout) {
    await notifyCodexWatchdogTimeout(session)
  } else if (isError && !session.errorNotified) {
    await notifyCodexRunFailure(session, exitCode)
    setFailedCooldown(sessionKey, Date.now() + failCooldownMs)
  }

  if (isStaleCodexRunCompletion(session, epoch)) {
    pushUiLog("Codex", "INFO", `[${sessionKey}] completeCodexRun 收尾前跳过（run 代际不匹配）`)
    session.runFinalizing = false
    return
  }

  session.activeThread = null
  clearCodexActiveRun(sessionKey)
  clearCodexPersistThrottle(sessionKey)

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
