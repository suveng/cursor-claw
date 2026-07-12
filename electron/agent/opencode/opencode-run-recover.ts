/**
 * 主进程重启后 OpenCode Run 续接（对称 sdk-run-recover）
 */
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { AgentResource } from "../../../src/shared/channel-types"
import { ZERO_CONTEXT_USAGE } from "../cursor-sdk/context-usage"
import type { RecoverSummary } from "../cursor-sdk/sdk-session-types"
import { type ChatType } from "../shared/agent-launcher"
import { completeRunGuard, enterGuardWithLifecycle, releaseRunGuard } from "../shared/agent-run-guard"
import { createRunLifecycle } from "../shared/run-lifecycle"
import { notifyResumeFailure } from "../shared/run-resume-notify"
import { pushUiLog } from "../../app/ui-logger"
import { appendInlineMcpToOpencodeConfig, readOpencodeMcpServers } from "../../mcp/loaders/opencode-mcp-loader"
import { OPENCODE_SESSIONS } from "./agent-opencode-session-registry"
import { broadcastOpencodeSessionStatus, initOpencodeStreamState } from "./agent-opencode-stream"
import {
  f41Eligible,
  opencodeResidentModeEnabled,
  resolveOpencodeClient,
} from "./agent-opencode-utils"
import { isOpencodeSessionRunning, startOpencodeRun } from "./agent-opencode-sdk"
import type { OpencodeLaunchOptions, OpencodeSessionAgent } from "./agent-opencode-types"
import {
  clearOpencodeActiveRun,
  listRecoverableOpencodeRuns,
  type OpencodeActiveRunRecord,
} from "./opencode-run-persistence"

function parseRecordChatType(raw: string): ChatType {
  const allowed: ChatType[] = ["p2p", "group", "task", "temp", "workflow"]
  return (allowed as string[]).includes(raw) ? (raw as ChatType) : "p2p"
}

function buildProfileFromRecord(record: OpencodeActiveRunRecord): AgentResource {
  return {
    id: record.profileResourceId ?? record.sessionKey,
    type: "opencode",
    name: "runtime",
    apiKey: record.apiKey,
    providerId: record.providerId,
    model: record.model,
    deployMode: record.deployMode,
    opencodeHostname: record.opencodeHostname,
    opencodePort: record.opencodePort,
    baseUrl: undefined,
  }
}

function buildLaunchOptsFromRecord(record: OpencodeActiveRunRecord): OpencodeLaunchOptions {
  const chatType = parseRecordChatType(record.chatType)
  return {
    sessionKey: record.sessionKey,
    chatType,
    workspaceDir: record.workspaceDir || process.cwd(),
    providerId: record.providerId,
    apiKey: record.apiKey,
    model: record.model,
    deployMode: record.deployMode,
    opencodeHostname: record.opencodeHostname,
    opencodePort: record.opencodePort,
    profileResourceId: record.profileResourceId,
    taskMessage: record.lastTaskMessage,
  }
}

function buildOpencodeSessionFromRecord(record: OpencodeActiveRunRecord): OpencodeSessionAgent {
  const chatType = parseRecordChatType(record.chatType)
  const session: OpencodeSessionAgent = {
    sessionKey: record.sessionKey,
    opencodeSessionId: record.opencodeSessionId ?? null,
    activeClient: null,
    deployMode: record.deployMode,
    providerId: record.providerId,
    apiKey: record.apiKey,
    model: record.model,
    profileResourceId: record.profileResourceId,
    opencodeHostname: record.opencodeHostname,
    opencodePort: record.opencodePort,
    startedAt: record.runStartedAt,
    lastActivityAt: Date.now(),
    chatType,
    workspaceDir: record.workspaceDir || process.cwd(),
    abortController: new AbortController(),
    f41Stream: f41Eligible(record.sessionKey, chatType),
    streamBuffer: "",
    residentMode: opencodeResidentModeEnabled(),
    pendingDispatch: false,
    contextUsage: { ...ZERO_CONTEXT_USAGE },
    watchdogState: "running",
    watchdogStateAt: Date.now(),
    logAgg: { kind: null, buf: "" },
    inboundMessageIds: record.inboundMessageIds,
    streamId: record.streamId,
    outboundMessageId: record.outboundMessageId,
    runStartedAt: record.runStartedAt,
    lastTaskMessage: record.lastTaskMessage,
  }
  initOpencodeStreamState(session)
  return session
}

/** 探活 embedded/external server 与 session id 是否仍有效 */
async function validateOpencodeSessionId(client: OpencodeClient, sessionId: string): Promise<boolean> {
  const res = await client.session.get({ path: { id: sessionId } })
  return !res.error && !!res.data?.id
}

/** 续接前校验 server 与 opencodeSessionId */
async function probeOpencodeRecoverTarget(record: OpencodeActiveRunRecord): Promise<void> {
  const workspaceDir = record.workspaceDir || process.cwd()
  const inlineConfig = appendInlineMcpToOpencodeConfig({}, readOpencodeMcpServers(workspaceDir), workspaceDir)
  const bundle = await resolveOpencodeClient(buildProfileFromRecord(record), inlineConfig)
  if (!record.opencodeSessionId) return
  const valid = await validateOpencodeSessionId(bundle.client, record.opencodeSessionId)
  if (!valid) throw new Error("OpenCode session 已失效")
}

function cleanupFailedOpencodeSession(sessionKey: string): void {
  const orphan = OPENCODE_SESSIONS.get(sessionKey)
  if (!orphan) return
  orphan.abortController.abort()
  if (orphan.runGuardToken) {
    completeRunGuard(sessionKey, orphan.runGuardToken)
    releaseRunGuard(sessionKey, orphan.runGuardToken)
  }
  OPENCODE_SESSIONS.delete(sessionKey)
  broadcastOpencodeSessionStatus([...OPENCODE_SESSIONS.values()])
}

/** 主进程启动后批量续接 OpenCode 活跃 Run */
export async function recoverOpencodeActiveRuns(): Promise<RecoverSummary> {
  const records = listRecoverableOpencodeRuns()
  const summary: RecoverSummary = { resumed: 0, failed: 0, skipped: 0 }

  if (records.length === 0) {
    pushUiLog("OpenCode", "INFO", "[recover] recoverOpencodeActiveRuns: 无可续接记录 resumed=0 failed=0 skipped=0")
    return summary
  }

  pushUiLog("OpenCode", "INFO", `[recover] recoverOpencodeActiveRuns: 扫描 ${records.length} 条待续接`)

  for (const record of records) {
    const { sessionKey } = record
    if (isOpencodeSessionRunning(sessionKey) || OPENCODE_SESSIONS.has(sessionKey)) {
      pushUiLog("OpenCode", "INFO", `[recover] sessionKey=${sessionKey} result=skipped reason=session_exists`)
      summary.skipped += 1
      continue
    }

    try {
      await probeOpencodeRecoverTarget(record)

      const session = buildOpencodeSessionFromRecord(record)
      OPENCODE_SESSIONS.set(sessionKey, session)
      broadcastOpencodeSessionStatus([...OPENCODE_SESSIONS.values()])

      const lifecycle = createRunLifecycle(session)
      lifecycle.resume()
      const guard = enterGuardWithLifecycle(session, lifecycle)
      if (!guard.acquired) {
        cleanupFailedOpencodeSession(sessionKey)
        const skipReason = guard.result === "stale_aborted" ? "stale_aborted" : "run_guard_busy"
        pushUiLog("OpenCode", "WARN", `[recover] sessionKey=${sessionKey} result=skipped reason=${skipReason}`)
        summary.skipped += 1
        continue
      }

      session.runGuardToken = guard.token
      session.runStartedAt = record.runStartedAt
      session.pendingDispatch = true
      const launchOpts = buildLaunchOptsFromRecord(record)
      const prompt = record.lastTaskMessage?.trim() ? record.lastTaskMessage : ""
      await startOpencodeRun(session, prompt, guard.token, launchOpts)

      pushUiLog("OpenCode", "INFO", `[recover] sessionKey=${sessionKey} result=resumed opencodeSessionId=${record.opencodeSessionId ?? "new"}`)
      summary.resumed += 1
    } catch (e: unknown) {
      clearOpencodeActiveRun(sessionKey)
      const detail = e instanceof Error ? e.message : String(e)
      const reason = detail.includes("失效") ? "会话已失效" : "会话恢复失败"
      await notifyResumeFailure(sessionKey, reason)
      pushUiLog("OpenCode", "WARN", `[recover] sessionKey=${sessionKey} result=failed reason=${detail}`)
      summary.failed += 1
      cleanupFailedOpencodeSession(sessionKey)
    }
  }

  pushUiLog(
    "OpenCode",
    "INFO",
    `[recover] recoverOpencodeActiveRuns 完成 resumed=${summary.resumed} failed=${summary.failed} skipped=${summary.skipped}`,
  )
  return summary
}
