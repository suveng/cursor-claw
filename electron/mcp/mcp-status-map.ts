import { getConfig } from "../config/config-store"
import { readMcpAuthStore } from "./mcp-project-dir"
import type { McpServerEntry } from "./mcp-types"
import { queryToolsViaHttp, queryToolsViaProtocol } from "./mcp-tools-probe"

/** 状态缓存：按 `wsKey::engineType` 分桶，保留 30s TTL */
interface McpStatusCache { status: Record<string, string>; ts: number; ws: string }
const MCP_STATUS_CACHE_TTL_MS = 30_000
const mcpStatusCacheByWs = new Map<string, McpStatusCache>()
const mcpStatusInflightByWs = new Map<string, Promise<McpStatusCache>>()

/** 解析缓存键：`wsKey::engineType`；省略 engineType 默认 sdk 保持现网兼容 */
function resolveWorkspaceKey(workspaceDir?: string, engineType?: string): string {
  const ws = (workspaceDir ?? getConfig().workspaceDir ?? "").trim()
  const base = ws || "__default__"
  // ponytail: 缓存键加 engineType 后缀，防同 workspace 切 SDK/CC 会话时读盘 probe 与 SDK 配置源串台
  return `${base}::${engineType ?? "sdk"}`
}

/** 清除全部状态缓存（toggle/save 后调用） */
export function invalidateMcpStatusCache(): void {
  mcpStatusCacheByWs.clear()
}

/** 判断 URL 型 MCP 是否已有 OAuth 令牌 */
function hasOAuthToken(serverName: string, workspaceDir: string): boolean {
  const authStore = readMcpAuthStore(workspaceDir)
  const candidates = [serverName, `plugin-${serverName}-${serverName}`]
  for (const key of candidates) {
    const token = authStore[key]?.tokens?.access_token
    if (typeof token === "string" && token.trim()) return true
  }
  return false
}

/** 探测错误摘要，供 UI 展示 */
function summarizeProbeError(error?: string): string {
  if (!error) return "探测失败"
  const lower = error.toLowerCase()
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("auth")) return "needs_login"
  return error.length > 80 ? `${error.slice(0, 77)}...` : error
}

/** 单条 MCP 服务器状态：disabled / ready / needs_login / 错误摘要 */
async function probeMcpServerStatus(server: McpServerEntry, workspaceDir: string): Promise<string> {
  if (server.rawConfig?.disabled === true || server.enabled === false) return "disabled"

  if (server.type === "url" && server.url) {
    const needsAuth = !server.authenticated && !hasOAuthToken(server.name, workspaceDir)
    if (needsAuth) return "needs_login"
    const headers = server.rawConfig?.headers as Record<string, string> | undefined
    const result = await queryToolsViaHttp(server.url, headers)
    if (result.ok) return "ready"
    return summarizeProbeError(result.error)
  }

  if (server.type === "command" && server.command) {
    const result = await queryToolsViaProtocol(
      server.command,
      server.args ?? [],
      server.env,
      workspaceDir || undefined,
    )
    if (result.ok) return "ready"
    return summarizeProbeError(result.error)
  }

  return "配置无效"
}

/** 并行探测全部 MCP 服务器，带 per-workspace+engineType 30s 缓存 */
export async function fetchMcpStatusMap(
  force = false,
  servers: McpServerEntry[],
  workspaceDir?: string,
  engineType?: string,
): Promise<Record<string, string>> {
  const wsKey = resolveWorkspaceKey(workspaceDir, engineType)
  // probeCwd 用原始 workspace 路径，不含 engineType 缓存键后缀（探测 cwd 与引擎类型无关）
  const probeCwd = (workspaceDir ?? getConfig().workspaceDir ?? "").trim()

  if (!force) {
    const cached = mcpStatusCacheByWs.get(wsKey)
    if (cached && Date.now() - cached.ts < MCP_STATUS_CACHE_TTL_MS) {
      return cached.status
    }
  }

  const inflight = mcpStatusInflightByWs.get(wsKey)
  if (inflight) return (await inflight).status

  const p = (async (): Promise<McpStatusCache> => {
    const status: Record<string, string> = {}
    await Promise.all(servers.map(async (server) => {
      status[server.name] = await probeMcpServerStatus(server, probeCwd)
    }))
    const result: McpStatusCache = { status, ts: Date.now(), ws: wsKey }
    mcpStatusCacheByWs.set(wsKey, result)
    return result
  })()

  mcpStatusInflightByWs.set(wsKey, p)
  try {
    return (await p).status
  } finally {
    mcpStatusInflightByWs.delete(wsKey)
  }
}
