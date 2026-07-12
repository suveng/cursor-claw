/**
 * 主进程重启后 Claude Code Run 续接（对称 sdk-run-recover）
 */
import { ZERO_CONTEXT_USAGE } from "../cursor-sdk/context-usage"
import type { RecoverSummary } from "../cursor-sdk/sdk-session-types"
import { type ChatType } from "../shared/agent-launcher"
import { completeRunGuard, enterGuardWithLifecycle, releaseRunGuard } from "../shared/agent-run-guard"
import { createRunLifecycle } from "../shared/run-lifecycle"
import { notifyResumeFailure } from "../shared/run-resume-notify"
import { pushUiLog } from "../../app/ui-logger"
import { CC_SESSIONS } from "./agent-cc-session-registry"
import { broadcastCcSessionStatus, clearStreamPostTimer } from "./agent-cc-stream"
import { ensureCcAgentBinaryPaths, f41Eligible, ccResidentModeEnabled } from "./agent-cc-utils"
import { isClaudeCodeSessionRunning, startCcQuery } from "./agent-claude-sdk"
import type { CcSessionAgent } from "./agent-cc-types"
import { clearCcActiveRun, listRecoverableCcRuns, type CcActiveRunRecord } from "./cc-run-persistence"

function parseRecordChatType(raw: string): ChatType {
  const allowed: ChatType[] = ["p2p", "group", "task", "temp", "workflow"]
  return (allowed as string[]).includes(raw) ? (raw as ChatType) : "p2p"
}

/** 从磁盘快照重建内存 session */
function buildCcSessionFromRecord(record: CcActiveRunRecord): CcSessionAgent {
  const chatType = parseRecordChatType(record.chatType)
  return {
    sessionKey: record.sessionKey,
    activeQuery: null,
    ccSessionId: record.ccSessionId ?? null,
    lastTaskMessage: record.lastTaskMessage,
    startedAt: record.runStartedAt,
    lastActivityAt: Date.now(),
    chatType,
    workspaceDir: record.workspaceDir || process.cwd(),
    apiKey: record.apiKey,
    baseUrl: record.baseUrl,
    model: record.model,
    abortController: new AbortController(),
    f41Stream: f41Eligible(record.sessionKey, chatType),
    streamBuffer: "",
    residentMode: ccResidentModeEnabled(),
    pendingDispatch: false,
    contextUsage: { ...ZERO_CONTEXT_USAGE },
    watchdogState: "running",
    watchdogStateAt: Date.now(),
    logAgg: { kind: null, buf: "" },
    inboundMessageIds: record.inboundMessageIds,
    streamId: record.streamId,
    outboundMessageId: record.outboundMessageId,
    runStartedAt: record.runStartedAt,
  }
}

/** 失败路径清理孤儿 session */
function cleanupFailedCcSession(sessionKey: string): void {
  const orphan = CC_SESSIONS.get(sessionKey)
  if (!orphan) return
  clearStreamPostTimer(orphan)
  if (orphan.activeQuery) {
    try { orphan.activeQuery.close() } catch { /* best-effort */ }
  }
  if (orphan.runGuardToken) {
    completeRunGuard(sessionKey, orphan.runGuardToken)
    releaseRunGuard(sessionKey, orphan.runGuardToken)
  }
  CC_SESSIONS.delete(sessionKey)
  broadcastCcSessionStatus([...CC_SESSIONS.values()])
}

/** 主进程启动后批量续接 CC 活跃 Run */
export async function recoverCcActiveRuns(): Promise<RecoverSummary> {
  ensureCcAgentBinaryPaths()
  const records = listRecoverableCcRuns()
  const summary: RecoverSummary = { resumed: 0, failed: 0, skipped: 0 }

  if (records.length === 0) {
    pushUiLog("CC", "INFO", "[recover] recoverCcActiveRuns: 无可续接记录 resumed=0 failed=0 skipped=0")
    return summary
  }

  pushUiLog("CC", "INFO", `[recover] recoverCcActiveRuns: 扫描 ${records.length} 条待续接`)

  for (const record of records) {
    const { sessionKey } = record
    if (isClaudeCodeSessionRunning(sessionKey) || CC_SESSIONS.has(sessionKey)) {
      pushUiLog("CC", "INFO", `[recover] sessionKey=${sessionKey} result=skipped reason=session_exists`)
      summary.skipped += 1
      continue
    }

    try {
      const session = buildCcSessionFromRecord(record)
      CC_SESSIONS.set(sessionKey, session)
      broadcastCcSessionStatus([...CC_SESSIONS.values()])

      const lifecycle = createRunLifecycle(session)
      lifecycle.resume()
      const guard = enterGuardWithLifecycle(session, lifecycle)
      if (!guard.acquired) {
        cleanupFailedCcSession(sessionKey)
        const skipReason = guard.result === "stale_aborted" ? "stale_aborted" : "run_guard_busy"
        pushUiLog("CC", "WARN", `[recover] sessionKey=${sessionKey} result=skipped reason=${skipReason}`)
        summary.skipped += 1
        continue
      }

      session.runGuardToken = guard.token
      session.runStartedAt = record.runStartedAt
      const prompt = record.lastTaskMessage?.trim() ? record.lastTaskMessage : ""
      startCcQuery(session, prompt, guard.token)

      pushUiLog("CC", "INFO", `[recover] sessionKey=${sessionKey} result=resumed ccSessionId=${record.ccSessionId ?? "new"}`)
      summary.resumed += 1
    } catch (e: unknown) {
      clearCcActiveRun(sessionKey)
      const detail = e instanceof Error ? e.message : String(e)
      await notifyResumeFailure(sessionKey, "会话恢复失败")
      pushUiLog("CC", "WARN", `[recover] sessionKey=${sessionKey} result=failed reason=${detail}`)
      summary.failed += 1
      cleanupFailedCcSession(sessionKey)
    }
  }

  pushUiLog(
    "CC",
    "INFO",
    `[recover] recoverCcActiveRuns 完成 resumed=${summary.resumed} failed=${summary.failed} skipped=${summary.skipped}`,
  )
  return summary
}
