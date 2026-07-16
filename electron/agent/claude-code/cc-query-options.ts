/**
 * Claude Agent SDK query options 构建（MCP inline + 插件 + hooks）。
 */
import { pushUiLog } from "../../app/ui-logger"
import { appendInlineMcpToCcOptions } from "../../mcp/loaders/cc-mcp-loader"
import { buildCcSdkPluginConfigs, logCcPluginConfig } from "../../mcp/loaders/cc-plugin-bootstrap"
import type { CcSessionAgent } from "./agent-cc-types"
import { buildCcSdkHooks } from "./cc-sdk-hooks"
import { createCcSpawnClaudeCodeProcess } from "./cc-spawn-process"
import { ensureCcAgentBinaryPaths, markSessionActivity, resolveCcAgentBinaryPath } from "./agent-cc-utils"

/** 构建 query env（显式清除继承的 ANTHROPIC_BASE_URL） */
function buildQueryEnv(apiKey: string, baseUrl?: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...(process.env as Record<string, string>), ANTHROPIC_API_KEY: apiKey }
  if (baseUrl?.trim()) env.ANTHROPIC_BASE_URL = baseUrl.trim()
  else delete env.ANTHROPIC_BASE_URL
  return env
}

/** CC_LEGACY_QUERY 真值：trim 后 1/true/yes（大小写不敏感）→ 裸 query 后备，不注入 spawn */
function isCcLegacyQueryEnv(): boolean {
  const raw = process.env.CC_LEGACY_QUERY?.trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes"
}

/** 构建 query options（含 MCP inline、Claude Code 插件、resume、二进制路径、spawn hook） */
export function buildQueryOptions(session: CcSessionAgent) {
  ensureCcAgentBinaryPaths()
  const legacyQuery = isCcLegacyQueryEnv()
  if (legacyQuery) {
    pushUiLog(
      "CC",
      "WARN",
      `[${session.sessionKey}] legacy_query: CC_LEGACY_QUERY 已启用，使用 SDK 默认 spawn（非主路径）`,
    )
  }
  const plugins = buildCcSdkPluginConfigs(session.workspaceDir)
  const base = {
    model: session.model || "claude-sonnet-4-6",
    cwd: session.workspaceDir,
    env: buildQueryEnv(session.apiKey, session.baseUrl),
    pathToClaudeCodeExecutable: resolveCcAgentBinaryPath(),
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    // strictMcpConfig:true → SDK 只用 inline mcpServers；插件 MCP 由 cc-mcp-loader inline，skills 等走 plugins。
    strictMcpConfig: true,
    plugins,
    abortController: session.abortController,
    ...(session.ccSessionId ? { resume: session.ccSessionId } : {}),
    ...(legacyQuery ? {} : { spawnClaudeCodeProcess: createCcSpawnClaudeCodeProcess(session) }),
  }
  const withMcp = appendInlineMcpToCcOptions(base, session.workspaceDir)
  const serverNames = withMcp.mcpServers ? Object.keys(withMcp.mcpServers) : []
  logCcPluginConfig(
    session.workspaceDir,
    plugins,
    (level, msg) => pushUiLog("CC", level, msg),
    { detailed: true, inlineMcpNames: serverNames, sessionKey: session.sessionKey },
  )
  return {
    ...withMcp,
    hooks: buildCcSdkHooks({ session, markActivity: markSessionActivity }),
    includeHookEvents: true,
  }
}
