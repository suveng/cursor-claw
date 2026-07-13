/**
 * 主进程重启后 SDK Run 续接（F4）
 */
import { Agent } from "@cursor/sdk"
import { ZERO_CONTEXT_USAGE, resolveContextLimitForSession } from "./context-usage"
import { type ChatType } from "../shared/agent-launcher"
import { completeRunGuard, enterGuardWithLifecycle, releaseRunGuard } from "../shared/agent-run-guard"
import { loadInlineMcpServersForSdk } from "../../mcp/loaders/mcp-sdk-loader"
import { bootstrapSdkPluginWorkspace, logSdkPluginConfig } from "../../mcp/loaders/plugin-sdk-bootstrap"
import { clearActiveSdkRun, listRecoverableSdkRuns } from "./sdk-run-persistence"
import { notifyResumeFailure } from "../shared/run-resume-notify"
import { startSdkRun } from "./sdk-run-lifecycle"
import { getOrCreateSdkRunLifecycle } from "./sdk-run-port-lifecycle"
import {
  broadcastSdkSessionStatus,
  f41Eligible,
  isSdkSessionRunning,
  sdkResidentModeEnabled,
  sdkSessions,
} from "./sdk-session-registry"
import type { RecoverSummary, SdkSessionAgent } from "./sdk-session-types"
import { SDK_SETTING_SOURCES } from "./sdk-setting-sources"
import { ensureSdkBinaryPaths } from "./sdk-binary-paths"
import { pushUiLog } from "../../app/ui-logger"

function parseRecordChatType(raw: string): ChatType {
  const allowed: ChatType[] = ["p2p", "group", "task", "temp", "workflow"]
  return (allowed as string[]).includes(raw) ? (raw as ChatType) : "p2p"
}

/** 主进程启动后批量续接活跃 Run（T6 在 initDaemonManager 挂接） */
export async function recoverSdkActiveRuns(): Promise<RecoverSummary> {
  ensureSdkBinaryPaths()

  const records = listRecoverableSdkRuns()
  const summary: RecoverSummary = { resumed: 0, failed: 0, skipped: 0 }

  if (records.length === 0) {
    pushUiLog("SDK", "INFO", "[recover] recoverSdkActiveRuns: 无可续接记录 resumed=0 failed=0 skipped=0")
    return summary
  }

  pushUiLog("SDK", "INFO", `[recover] recoverSdkActiveRuns: 扫描 ${records.length} 条待续接`)

  for (const record of records) {
    const { sessionKey, agentId, runId } = record
    if (isSdkSessionRunning(sessionKey) || sdkSessions.has(sessionKey)) {
      pushUiLog("SDK", "INFO", `[recover] sessionKey=${sessionKey} result=skipped reason=session_exists`)
      summary.skipped += 1
      continue
    }

    try {
      const workspaceDir = record.workspaceDir || process.cwd()
      const pluginBoot = bootstrapSdkPluginWorkspace(workspaceDir)
      logSdkPluginConfig(workspaceDir, pluginBoot, (level, msg) => pushUiLog("SDK", level, msg), { detailed: true })
      const injected = pluginBoot.mcpServers
      const agent = await Agent.resume(agentId, {
        apiKey: record.apiKey,
        mcpServers: injected,
        local: {
          cwd: workspaceDir,
          settingSources: [...SDK_SETTING_SOURCES],
          sandboxOptions: { enabled: false },
        },
      })

      const run = await Agent.getRun(runId, {
        runtime: "local",
        cwd: workspaceDir,
      })

      if (run.status === "finished" || run.status === "error" || run.status === "cancelled") {
        clearActiveSdkRun(sessionKey)
        await notifyResumeFailure(sessionKey, "运行已结束")
        pushUiLog("SDK", "WARN", `[recover] sessionKey=${sessionKey} result=failed reason=run_terminal status=${run.status}`)
        summary.failed += 1
        try { agent.close() } catch { /* best-effort */ }
        continue
      }

      const chatType = parseRecordChatType(record.chatType)
      const session: SdkSessionAgent = {
        sessionKey,
        agent,
        run: null,
        agentId: agent.agentId,
        startedAt: record.runStartedAt,
        lastActivityAt: Date.now(),
        chatType,
        workspaceDir,
        abortController: new AbortController(),
        logAgg: { kind: null, buf: "" },
        f41Stream: f41Eligible(sessionKey, chatType),
        streamBuffer: "",
        residentMode: sdkResidentModeEnabled(),
        pendingDispatch: false,
        presentationDeferStream: false,
        seenProcessEvent: false,
        thinkingOpen: false,
        contextUsage: { ...ZERO_CONTEXT_USAGE },
        apiKey: record.apiKey,
        inboundMessageIds: record.inboundMessageIds,
        streamId: record.streamId,
        outboundMessageId: record.outboundMessageId,
        runStartedAt: record.runStartedAt,
        lastInjectedMcpServers: injected,
        watchdogState: "running",
        watchdogStateAt: Date.now(),
      }

      sdkSessions.set(sessionKey, session)
      // stopAll 会停预热 timer；续接恢复 session 后幂等重启
      void import("./sdk-resident-bg-warmup").then((m) => m.startResidentBgWarmup())
      broadcastSdkSessionStatus()

      // S7：续接前重置 Lifecycle 闩与阶段，与 launch/dispatch 对称走 enterGuardWithLifecycle
      const lifecycle = getOrCreateSdkRunLifecycle(session)
      lifecycle.resume()
      const guard = enterGuardWithLifecycle(session, lifecycle)
      if (!guard.acquired) {
        try { agent.close() } catch { /* best-effort */ }
        sdkSessions.delete(sessionKey)
        broadcastSdkSessionStatus()
        const skipReason = guard.result === "stale_aborted" ? "stale_aborted" : "run_guard_busy"
        pushUiLog("SDK", "WARN", `[recover] sessionKey=${sessionKey} result=skipped reason=${skipReason}`)
        summary.skipped += 1
        continue
      }
      session.runGuardToken = guard.token

      await resolveContextLimitForSession(session)
      await startSdkRun(session, run)

      pushUiLog("SDK", "INFO", `[recover] sessionKey=${sessionKey} result=resumed runId=${runId} agentId=${agentId}`)
      summary.resumed += 1
    } catch (e: unknown) {
      clearActiveSdkRun(sessionKey)
      const detail = e instanceof Error ? e.message : String(e)
      await notifyResumeFailure(sessionKey, "会话恢复失败")
      pushUiLog("SDK", "WARN", `[recover] sessionKey=${sessionKey} result=failed reason=${detail}`)
      summary.failed += 1
      const orphan = sdkSessions.get(sessionKey)
      if (orphan) {
        if (orphan.runGuardToken) {
          completeRunGuard(sessionKey, orphan.runGuardToken)
          releaseRunGuard(sessionKey, orphan.runGuardToken)
        }
        try { orphan.agent.close() } catch { /* best-effort */ }
        sdkSessions.delete(sessionKey)
        broadcastSdkSessionStatus()
      }
    }
  }

  pushUiLog(
    "SDK",
    "INFO",
    `[recover] recoverSdkActiveRuns 完成 resumed=${summary.resumed} failed=${summary.failed} skipped=${summary.skipped}`,
  )
  return summary
}
