/**
 * 长驻 Agent 空闲刷新 / 按 session 原地重建。
 * 与 ContextRotation 安全顺序一致，供 sendWithRetry / opaque_retry / slash-restart 复用。
 */
import { Agent, type SDKAgent } from "@cursor/sdk"
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { ZERO_CONTEXT_USAGE } from "./context-usage"
import { bootstrapSdkPluginWorkspace, logSdkPluginConfig } from "../../mcp/loaders/plugin-sdk-bootstrap"
import { cancelRunAndWait } from "./finalize-sdk-run"
import { clearPersistThrottle } from "./sdk-run-persist"
import { clearActiveSdkRun, markSdkRunUserStopped } from "./sdk-run-persistence"
import { resetStreamPostChain } from "./sdk-run-presentation"
import {
  broadcastSdkSessionStatus,
  failedCooldowns,
  getSdkSession,
  hasSdkSession,
  resetSdkRunPresentationState,
} from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"
import { SDK_SETTING_SOURCES } from "./sdk-setting-sources"
import { pushUiLog } from "../../app/ui-logger"

/** 长驻空闲超过该阈值则 dispatch 前 / 后台预热重建（防 Connect/gRPC 僵死） */
export const RESIDENT_STALE_IDLE_MS = 15 * 60 * 1000

/** 同 session 并发 recreate 合并为一趟（后台预热 ↔ 发前 refresh 双保险） */
const recreateInFlightByKey = new Map<string, Promise<boolean>>()

/** 从 session 组装 Agent.create 的 model 参数 */
function buildModelSelection(session: SdkSessionAgent): {
  id: string
  params?: { id: string; value: string }[]
} {
  const modelSelection: { id: string; params?: { id: string; value: string }[] } = {
    id: session.modelId ?? "composer-2",
  }
  if (session.modelParams?.trim()) {
    try {
      modelSelection.params = JSON.parse(session.modelParams)
    } catch {
      /* 忽略非法模型参数 */
    }
  }
  return modelSelection
}

/**
 * 实际执行重建（无闩）；仅由 recreateSessionAgent 调用。
 * 先 Agent.create 成功 → 再替换 → best-effort close 旧实例；失败保留旧实例。
 */
async function recreateSessionAgentUnlocked(
  session: SdkSessionAgent,
  reason: string,
): Promise<boolean> {
  const previousAgent = session.agent
  const previousAgentId = session.agentId
  const cwd = session.workspaceDir ?? process.cwd()
  const pluginBoot = bootstrapSdkPluginWorkspace(cwd)
  logSdkPluginConfig(cwd, pluginBoot, (level, msg) => pushUiLog("SDK", level, msg), {
    detailed: true,
  })
  const injected = pluginBoot.mcpServers
  let nextAgent: SDKAgent
  try {
    nextAgent = await Agent.create({
      apiKey: session.apiKey ?? "",
      model: buildModelSelection(session),
      mcpServers: injected,
      local: {
        cwd,
        settingSources: [...SDK_SETTING_SOURCES],
        sandboxOptions: { enabled: false },
      },
    })
  } catch (err: unknown) {
    pushUiLog(
      "SDK",
      "WARN",
      `[${session.sessionKey}] ${reason} skipped: ${err instanceof Error ? err.message : String(err)}`,
    )
    session.agent = previousAgent
    session.agentId = previousAgentId
    return false
  }
  session.agent = nextAgent
  session.agentId = nextAgent.agentId
  session.lastInjectedMcpServers = injected
  session.lastActivityAt = Date.now()
  try {
    previousAgent.close()
  } catch {
    /* best-effort */
  }
  session.contextUsage = { ...ZERO_CONTEXT_USAGE }
  session.contextUsagePeakTokens = undefined
  return true
}

/**
 * 安全重建 session.agent；同 sessionKey 并发调用 join 同一 Promise（inFlight 闩）。
 */
export async function recreateSessionAgent(
  session: SdkSessionAgent,
  reason: string,
): Promise<boolean> {
  const key = session.sessionKey
  const existing = recreateInFlightByKey.get(key)
  if (existing) {
    pushUiLog("SDK", "INFO", `[${key}] ${reason} join inFlight recreate`)
    return existing
  }
  const work = recreateSessionAgentUnlocked(session, reason).finally(() => {
    recreateInFlightByKey.delete(key)
  })
  recreateInFlightByKey.set(key, work)
  return work
}

/**
 * 按 sessionKey 原地重建当前 SDK Agent（含 idle 长驻；勿用 isSdkSessionRunning）。
 * 有进行中 Run 时先取消并置 run=null，避免 complete 路径与 recreate 竞态；保留 sessionKey。
 */
export async function restartSdkSessionInPlace(
  sessionKey: string,
  reason: string,
): Promise<boolean> {
  if (!hasSdkSession(sessionKey)) return false
  const session = getSdkSession(sessionKey)
  if (!session) return false

  if (session.run) {
    // 用户主动重建：不续接、抑制取消触发的失败 IM
    markSdkRunUserStopped(sessionKey)
    session.errorNotified = true
    const run = session.run
    session.run = null
    session.pendingDispatch = false
    void cancelRunAndWait(run)
    clearActiveSdkRun(sessionKey)
    clearPersistThrottle(sessionKey)
    resetStreamPostChain(session)
    if (session.runGuardToken) {
      completeRunGuard(sessionKey, session.runGuardToken)
      releaseRunGuard(sessionKey, session.runGuardToken)
      session.runGuardToken = undefined
    }
    void reportSessionAgentPhase(sessionKey, "idle")
  }

  const ok = await recreateSessionAgent(session, reason)
  if (ok) {
    failedCooldowns.delete(sessionKey)
    resetSdkRunPresentationState(session)
    broadcastSdkSessionStatus()
    pushUiLog("SDK", "INFO", `[${sessionKey}] ${reason} ok agentId=${session.agentId}`)
  }
  return ok
}

/**
 * 长驻空闲超阈值时重建 Agent；非长驻或未过期直接 false。
 * UI 日志：`[sessionKey] resident-refresh idle=…ms`
 */
export async function maybeRefreshStaleResidentAgent(session: SdkSessionAgent): Promise<boolean> {
  if (!session.residentMode) return false
  const idleMs = Date.now() - session.lastActivityAt
  if (idleMs < RESIDENT_STALE_IDLE_MS) return false
  pushUiLog("SDK", "WARN", `[${session.sessionKey}] resident-refresh idle=${idleMs}ms`)
  const ok = await recreateSessionAgent(session, "resident-refresh")
  if (ok) {
    pushUiLog("SDK", "INFO", `[${session.sessionKey}] resident-refresh ok agentId=${session.agentId}`)
  }
  return ok
}
