/**
 * 主进程重启后 Codex Run 续接（对称 sdk-run-recover）
 */
import { ZERO_CONTEXT_USAGE } from "../cursor-sdk/context-usage"
import type { RecoverSummary } from "../cursor-sdk/sdk-session-types"
import { type ChatType } from "../shared/agent-launcher"
import { completeRunGuard, enterGuardWithLifecycle, releaseRunGuard } from "../shared/agent-run-guard"
import { createRunLifecycle } from "../shared/run-lifecycle"
import { classifyResumeFailure, notifyResumeFailure } from "../shared/run-resume-notify"
import { probeCodexRecoverTarget } from "./codex-run-probe"
import { pushUiLog } from "../../app/ui-logger"
import { loadCodexMcpServers } from "../../mcp/loaders/codex-mcp-loader"
import { CODEX_SESSIONS } from "./agent-codex-session-registry"
import { broadcastCodexSessionStatus } from "./agent-codex-stream"
import {
  checkCodexCliAvailable,
  codexResidentModeEnabled,
  f41Eligible,
} from "./agent-codex-utils"
import { isCodexSessionRunning, startCodexRun } from "./agent-codex-sdk"
import type { CodexSessionAgent } from "./agent-codex-types"
import { clearCodexActiveRun, listRecoverableCodexRuns, type CodexActiveRunRecord } from "./codex-run-persistence"

function parseRecordChatType(raw: string): ChatType {
  const allowed: ChatType[] = ["p2p", "group", "task", "temp", "workflow"]
  return (allowed as string[]).includes(raw) ? (raw as ChatType) : "p2p"
}

function buildCodexSessionFromRecord(record: CodexActiveRunRecord): CodexSessionAgent {
  const chatType = parseRecordChatType(record.chatType)
  return {
    sessionKey: record.sessionKey,
    activeThread: null,
    codexSessionId: record.codexSessionId ?? null,
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
    residentMode: codexResidentModeEnabled(),
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

function cleanupFailedCodexSession(sessionKey: string): void {
  const orphan = CODEX_SESSIONS.get(sessionKey)
  if (!orphan) return
  orphan.abortController.abort()
  if (orphan.runGuardToken) {
    completeRunGuard(sessionKey, orphan.runGuardToken)
    releaseRunGuard(sessionKey, orphan.runGuardToken)
  }
  CODEX_SESSIONS.delete(sessionKey)
  broadcastCodexSessionStatus([...CODEX_SESSIONS.values()])
}

/** CLI 缺失时逐条 notify + 清盘（清偿父变更静默早退债） */
async function failAllCodexRunsOnCliMissing(
  records: CodexActiveRunRecord[],
  cliError: string,
): Promise<RecoverSummary> {
  const summary: RecoverSummary = { resumed: 0, failed: 0, skipped: 0 }
  pushUiLog("Codex", "WARN", `[recover] CLI 不可用，清理 ${records.length} 条: ${cliError}`)
  for (const record of records) {
    await notifyResumeFailure(record.sessionKey, cliError, "unrecoverable")
    clearCodexActiveRun(record.sessionKey)
    summary.failed += 1
  }
  return summary
}

/** 主进程启动后批量续接 Codex 活跃 Run */
export async function recoverCodexActiveRuns(): Promise<RecoverSummary> {
  const cliCheck = checkCodexCliAvailable()
  const records = listRecoverableCodexRuns()

  if (!cliCheck.ok) {
    if (records.length === 0) {
      pushUiLog("Codex", "WARN", `[recover] recoverCodexActiveRuns CLI 缺失且无待续接: ${cliCheck.error}`)
      return { resumed: 0, failed: 0, skipped: 0 }
    }
    const summary = await failAllCodexRunsOnCliMissing(records, cliCheck.error)
    pushUiLog(
      "Codex",
      "INFO",
      `[recover] recoverCodexActiveRuns 完成 resumed=${summary.resumed} failed=${summary.failed} skipped=${summary.skipped}`,
    )
    return summary
  }
  const summary: RecoverSummary = { resumed: 0, failed: 0, skipped: 0 }

  if (records.length === 0) {
    pushUiLog("Codex", "INFO", "[recover] recoverCodexActiveRuns: 无可续接记录 resumed=0 failed=0 skipped=0")
    return summary
  }

  pushUiLog("Codex", "INFO", `[recover] recoverCodexActiveRuns: 扫描 ${records.length} 条待续接`)

  for (const record of records) {
    const { sessionKey } = record
    if (isCodexSessionRunning(sessionKey) || CODEX_SESSIONS.has(sessionKey)) {
      pushUiLog("Codex", "INFO", `[recover] sessionKey=${sessionKey} result=skipped reason=session_exists`)
      summary.skipped += 1
      continue
    }

    try {
      await probeCodexRecoverTarget(record)

      const session = buildCodexSessionFromRecord(record)
      CODEX_SESSIONS.set(sessionKey, session)
      broadcastCodexSessionStatus([...CODEX_SESSIONS.values()])

      const lifecycle = createRunLifecycle(session)
      lifecycle.resume()
      const guard = enterGuardWithLifecycle(session, lifecycle)
      if (!guard.acquired) {
        cleanupFailedCodexSession(sessionKey)
        const skipReason = guard.result === "stale_aborted" ? "stale_aborted" : "run_guard_busy"
        pushUiLog("Codex", "WARN", `[recover] sessionKey=${sessionKey} result=skipped reason=${skipReason}`)
        summary.skipped += 1
        continue
      }

      session.runGuardToken = guard.token
      session.runStartedAt = record.runStartedAt
      const workspaceDir = record.workspaceDir || process.cwd()
      const mcpInline = loadCodexMcpServers(workspaceDir)
      const prompt = record.lastTaskMessage?.trim() ? record.lastTaskMessage : ""
      session.pendingDispatch = true
      startCodexRun(session, prompt, guard.token, mcpInline)

      pushUiLog("Codex", "INFO", `[recover] sessionKey=${sessionKey} result=resumed codexSessionId=${record.codexSessionId ?? "new"}`)
      summary.resumed += 1
    } catch (e: unknown) {
      clearCodexActiveRun(sessionKey)
      const detail = e instanceof Error ? e.message : String(e)
      const { reason, category } = classifyResumeFailure("codex", detail)
      await notifyResumeFailure(sessionKey, reason, category)
      pushUiLog("Codex", "WARN", `[recover] sessionKey=${sessionKey} result=failed reason=${detail}`)
      summary.failed += 1
      cleanupFailedCodexSession(sessionKey)
    }
  }

  pushUiLog(
    "Codex",
    "INFO",
    `[recover] recoverCodexActiveRuns 完成 resumed=${summary.resumed} failed=${summary.failed} skipped=${summary.skipped}`,
  )
  return summary
}
