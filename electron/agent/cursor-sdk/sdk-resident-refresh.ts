/**
 * 长驻 Agent 空闲刷新：先 create 成功再替换，失败保留旧实例。
 * 与 ContextRotation 安全顺序一致，供 sendWithRetry / opaque_retry 复用。
 */
import { Agent, type SDKAgent } from "@cursor/sdk"
import { ZERO_CONTEXT_USAGE } from "./context-usage"
import { bootstrapSdkPluginWorkspace, logSdkPluginConfig } from "../../mcp/loaders/plugin-sdk-bootstrap"
import type { SdkSessionAgent } from "./sdk-session-types"
import { SDK_SETTING_SOURCES } from "./sdk-setting-sources"
import { pushUiLog } from "../../app/ui-logger"

/** 长驻空闲超过该阈值则 dispatch 前重建（防 Connect/gRPC 僵死） */
export const RESIDENT_STALE_IDLE_MS = 15 * 60 * 1000

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
 * 安全重建 session.agent：先 Agent.create 成功 → 再替换 → best-effort close 旧实例。
 * 创建失败保留旧实例，返回 false。
 */
export async function recreateSessionAgent(
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
