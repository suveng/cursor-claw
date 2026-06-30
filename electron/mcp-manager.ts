import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { shell } from "electron"
import { getConfig } from "./config-store"
import { findCursorProjectDir } from "./mcp-project-dir"
import { fetchMcpStatusMap, invalidateMcpStatusCache } from "./mcp-status-map"
import { queryToolsViaHttp, queryToolsViaProtocol } from "./mcp-tools-probe"
import type { McpServerEntry, McpToolInfo } from "./mcp-types"

export type { McpServerEntry, McpToolInfo } from "./mcp-types"

// ── OAuth 审批辅助 ────────────────────────────────────────

/** 读取 mcp-approvals.json 中已批准的 OAuth 服务器名 */
function readApprovedServers(workspaceDir: string): Set<string> {
  const dir = findCursorProjectDir(workspaceDir)
  if (!dir) return new Set()
  const approvalPath = path.join(dir, "mcp-approvals.json")
  try {
    if (!fs.existsSync(approvalPath)) return new Set()
    const entries: string[] = JSON.parse(fs.readFileSync(approvalPath, "utf-8"))
    const approved = new Set<string>()
    for (const entry of entries) {
      const match = entry.match(/^(.+)-[0-9a-f]{16}$/)
      if (match) approved.add(match[1])
    }
    return approved
  } catch { /* ignore */ }
  return new Set()
}

/** 解析 MCP 查询用工作区；省略时回退 config.workspaceDir */
function resolveMcpWorkspace(workspaceDir?: string): string {
  return (workspaceDir ?? getConfig().workspaceDir ?? "").trim()
}

/** 按名称查找 MCP 条目；同名时 project 优先于 global（可选 workspace 上下文） */
function findMcpEntry(serverName: string, workspaceDir?: string): McpServerEntry | undefined {
  const list = workspaceDir !== undefined
    ? getMcpServerListForWorkspace(workspaceDir)
    : getMcpServerList()
  return list.find((s) => s.name === serverName && s.source === "project")
    ?? list.find((s) => s.name === serverName)
}

// ── Public API: Enabled / Status ─────────────────────────

/** 从 mcp.json 读取各服务器 enabled 状态（disabled !== true），不依赖 CLI */
export async function getMcpEnabledMap(_force = false): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {}
  for (const entry of getMcpServerList()) {
    map[entry.name] = entry.enabled !== false
  }
  return map
}

/** 通过 HTTP/stdio 探测各服务器健康状态，保留 30s 缓存；可选 workspaceDir 绑定会话工作区 */
export async function getMcpStatusMap(force = false, workspaceDir?: string): Promise<Record<string, string>> {
  const ws = resolveMcpWorkspace(workspaceDir)
  const servers = ws ? getMcpServerListForWorkspace(ws) : getMcpServerList()
  return fetchMcpStatusMap(force, servers, ws || undefined)
}

export function invalidateMcpEnabledCache(): void {
  invalidateMcpStatusCache()
}

// ── Public API: Toggle ─────────────────────────────────────

/** 写入 mcp.json 的 disabled 字段以启用/禁用 MCP 服务器 */
export async function toggleMcpServer(
  serverName: string,
  enabled: boolean,
  _workspaceDirOverride?: string,
): Promise<{ ok: boolean; output: string }> {
  const target = findMcpEntry(serverName)
  if (!target) return { ok: false, output: `找不到 MCP 服务器: ${serverName}` }

  const raw = { ...(target.rawConfig ?? {}) }
  if (enabled) {
    delete raw.disabled
  } else {
    raw.disabled = true
  }

  const result = saveMcpServer(serverName, raw, target.source)
  if (result.ok) invalidateMcpStatusCache()
  return result.ok
    ? { ok: true, output: `${serverName} 已${enabled ? "启用" : "禁用"}` }
    : { ok: false, output: result.error ?? "操作失败" }
}

// ── Public API: CRUD ─────────────────────────────────────

/** 读取 mcp.json servers 块；文件缺失或解析失败返回空对象 */
function readMcpServersBlock(filePath: string): Record<string, Record<string, unknown>> {
  try {
    if (!fs.existsSync(filePath)) return {}
    const cfg = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>
    return (cfg.mcpServers ?? cfg.servers ?? {}) as Record<string, Record<string, unknown>>
  } catch {
    return {}
  }
}

/**
 * 按工作区合并 global ~/.cursor/mcp.json 与 project .cursor/mcp.json。
 * 同名 server 以 project 为准（与 mcp-sdk-loader.mergeMcpJsonEntries 规则一致）。
 */
export function getMcpServerListForWorkspace(workspaceDir: string): McpServerEntry[] {
  const ws = resolveMcpWorkspace(workspaceDir)
  const approved = ws ? readApprovedServers(ws) : new Set<string>()

  const globalPath = path.join(os.homedir(), ".cursor", "mcp.json")
  const globalServers = readMcpServersBlock(globalPath)
  const merged = { ...globalServers }

  const projectNames = new Set<string>()
  if (ws) {
    const projectPath = path.join(ws, ".cursor", "mcp.json")
    const projectServers = readMcpServersBlock(projectPath)
    for (const [name, raw] of Object.entries(projectServers)) {
      merged[name] = raw
      projectNames.add(name)
    }
  }

  return Object.entries(merged).map(([name, raw]) => {
    const source: "global" | "project" = projectNames.has(name) ? "project" : "global"
    return buildEntry(name, raw, source, approved)
  })
}

export function getMcpServerList(): McpServerEntry[] {
  const config = getConfig()
  const ws = config.workspaceDir || ""
  const approved = ws ? readApprovedServers(ws) : new Set<string>()
  const result: McpServerEntry[] = []

  const globalPath = path.join(os.homedir(), ".cursor", "mcp.json")
  try {
    if (fs.existsSync(globalPath)) {
      const cfg = JSON.parse(fs.readFileSync(globalPath, "utf-8"))
      const servers = cfg.mcpServers ?? cfg.servers ?? {}
      for (const [name, raw] of Object.entries(servers) as [string, Record<string, unknown>][]) {
        result.push(buildEntry(name, raw, "global", approved))
      }
    }
  } catch { /* ignore */ }

  if (ws) {
    const projectPath = path.join(ws, ".cursor", "mcp.json")
    try {
      if (fs.existsSync(projectPath)) {
        const cfg = JSON.parse(fs.readFileSync(projectPath, "utf-8"))
        const servers = cfg.mcpServers ?? cfg.servers ?? {}
        for (const [name, raw] of Object.entries(servers) as [string, Record<string, unknown>][]) {
          result.push(buildEntry(name, raw, "project", approved))
        }
      }
    } catch { /* ignore */ }
  }

  return result
}

function buildEntry(name: string, raw: Record<string, unknown>, source: "global" | "project", approved: Set<string>): McpServerEntry {
  const type: "command" | "url" = raw.url ? "url" : "command"
  return {
    name,
    type,
    command: raw.command as string | undefined,
    args: raw.args as string[] | undefined,
    url: raw.url as string | undefined,
    env: raw.env as Record<string, string> | undefined,
    source,
    authenticated: approved.has(name),
    rawConfig: raw,
    enabled: raw.disabled !== true,
  }
}

export function getMcpJsonPath(scope: "global" | "project"): string | null {
  if (scope === "global") return path.join(os.homedir(), ".cursor", "mcp.json")
  const ws = getConfig().workspaceDir
  if (!ws) return null
  return path.join(ws, ".cursor", "mcp.json")
}

export function readMcpJson(scope: "global" | "project"): Record<string, unknown> | null {
  const p = getMcpJsonPath(scope)
  if (!p) return null
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"))
  } catch { /* ignore */ }
  return null
}

export function writeMcpJson(scope: "global" | "project", data: Record<string, unknown>): boolean {
  const p = getMcpJsonPath(scope)
  if (!p) return false
  try {
    const dir = path.dirname(p)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8")
    return true
  } catch { return false }
}

export function saveMcpServer(name: string, config: Record<string, unknown>, scope: "global" | "project"): { ok: boolean; error?: string } {
  const existing = readMcpJson(scope) ?? { mcpServers: {} }
  const servers = (existing.mcpServers ?? existing.servers ?? {}) as Record<string, unknown>
  servers[name] = config
  existing.mcpServers = servers
  if (existing.servers) delete existing.servers
  const success = writeMcpJson(scope, existing)
  if (success) invalidateMcpStatusCache()
  return success ? { ok: true } : { ok: false, error: "写入失败" }
}

export function deleteMcpServer(name: string, scope: "global" | "project"): { ok: boolean; error?: string } {
  const existing = readMcpJson(scope)
  if (!existing) return { ok: false, error: "配置文件不存在" }
  const servers = (existing.mcpServers ?? existing.servers ?? {}) as Record<string, unknown>
  if (!(name in servers)) return { ok: false, error: `${name} 不存在` }
  delete servers[name]
  existing.mcpServers = servers
  if (existing.servers) delete existing.servers
  const success = writeMcpJson(scope, existing)
  if (success) invalidateMcpStatusCache()
  return success ? { ok: true } : { ok: false, error: "写入失败" }
}

// ── Public API: OAuth login ──────────────────────────────

/** 返回 OAuth 手动配置说明；可选 workspaceDir 绑定 OAuth store 路径 */
export async function loginMcpServer(serverName: string, workspaceDir?: string): Promise<{ ok: boolean; output: string }> {
  const ws = resolveMcpWorkspace(workspaceDir)
  if (!ws) return { ok: false, output: "工作目录未配置" }

  const server = findMcpEntry(serverName, ws)
  if (!server) return { ok: false, output: `找不到 MCP 服务器: ${serverName}` }

  const projectDir = findCursorProjectDir(ws)
  const authPath = projectDir ? path.join(projectDir, "mcp-auth.json") : "~/.cursor/projects/<工作区>/mcp-auth.json"

  const lines = [
    `MCP「${serverName}」需手动完成 OAuth 配置：`,
    "",
    "1. 在浏览器完成该 MCP 提供商的 OAuth 授权",
    `2. 将 access_token 写入 ${authPath}`,
    "3. 或在 Cursor IDE 中对该 MCP 执行授权后刷新本页",
  ]

  if (server.type === "url" && server.url) {
    lines.push("", `服务端点：${server.url}`)
    try { await shell.openExternal(server.url) } catch { /* ignore */ }
  }

  return { ok: false, output: lines.join("\n") }
}

// ── Public API: Tools Query ────────────────────────────────

/** 通过 HTTP/stdio 直连查询 MCP 工具列表；stdio cwd 绑定 workspaceDir */
export async function getMcpServerTools(
  serverName: string,
  workspaceDir?: string,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  const ws = resolveMcpWorkspace(workspaceDir)
  const server = findMcpEntry(serverName, ws || undefined)
  if (!server) return { ok: false, tools: [], error: "MCP 服务器未找到" }

  const workspaceCwd = ws || undefined

  if (server.type === "url" && server.url) {
    const headers = server.rawConfig?.headers as Record<string, string> | undefined
    return queryToolsViaHttp(server.url, headers)
  }

  if (server.type === "command" && server.command) {
    return queryToolsViaProtocol(server.command, server.args ?? [], server.env, workspaceCwd)
  }

  return { ok: false, tools: [], error: "服务器配置无效" }
}
