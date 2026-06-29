/**
 * Claude Agent SDK 内联 MCP 加载器
 * 读取 ~/.cursor/mcp.json 与 workspace .cursor/mcp.json，合并 OAuth 后供 query() 每次重传。
 * 合并优先级与 mcp-sdk-loader.ts 一致：project 覆盖 global。
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk"
import { readMcpAuthStore, type McpAuthEntry } from "./mcp-project-dir"

/** mcp.json 单条原始配置 */
type RawMcpEntry = Record<string, unknown>

/** 读取 mcp.json servers 块；缺失或解析失败返回空对象 */
function readMcpServersBlock(filePath: string): Record<string, RawMcpEntry> {
  try {
    if (!fs.existsSync(filePath)) return {}
    const cfg = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>
    return (cfg.mcpServers ?? cfg.servers ?? {}) as Record<string, RawMcpEntry>
  } catch {
    return {}
  }
}

/** 合并 global 与 project mcp.json；同名 server 以 project 为准 */
function mergeMcpJsonEntries(workspaceDir: string): Record<string, RawMcpEntry> {
  const globalPath = path.join(os.homedir(), ".cursor", "mcp.json")
  const merged: Record<string, RawMcpEntry> = { ...readMcpServersBlock(globalPath) }
  const ws = workspaceDir.trim()
  if (ws) Object.assign(merged, readMcpServersBlock(path.join(ws, ".cursor", "mcp.json")))
  return merged
}

/** 从 mcp-auth.json 解析 OAuth access_token */
function resolveOAuthAccessToken(serverName: string, authStore: Record<string, McpAuthEntry>): string | undefined {
  for (const key of [serverName, `plugin-${serverName}-${serverName}`]) {
    const token = authStore[key]?.tokens?.access_token
    if (typeof token === "string" && token.trim()) return token.trim()
  }
  return undefined
}

/** 将路径型 segment 解析为绝对路径（bare 命令名不 resolve） */
function resolvePathLikeSegment(workspaceDir: string, segment: string): string {
  if (path.isAbsolute(segment)) return segment
  if (!segment.includes("/") && !segment.includes("\\") && !segment.startsWith("./") && !segment.startsWith("../")) {
    return segment
  }
  return path.resolve(workspaceDir, segment)
}

/** stdio 型 → Claude Agent SDK McpServerConfig */
function toStdioInlineConfig(raw: RawMcpEntry, workspaceDir: string): McpServerConfig | null {
  if (raw.disabled === true || raw.url) return null
  const command = raw.command as string | undefined
  if (!command) return null
  const ws = workspaceDir.trim()
  const cfg: McpServerConfig = {
    type: "stdio",
    command: ws ? resolvePathLikeSegment(ws, command) : command,
    args: raw.args as string[] | undefined,
    env: raw.env as Record<string, string> | undefined,
  }
  if (ws) {
    // 与 mcp-sdk-loader 一致：stdio 相对路径以 workspace 为 cwd
    cfg.cwd = ws
    if (cfg.args) {
      cfg.args = cfg.args.map((arg) => (arg.startsWith("--") ? arg : resolvePathLikeSegment(ws, arg)))
    }
  }
  return cfg
}

/** HTTP/sse 型 → remote 配置，合并 headers 与 OAuth Bearer */
function toHttpInlineConfig(
  raw: RawMcpEntry,
  serverName: string,
  authStore: Record<string, McpAuthEntry>,
): McpServerConfig | null {
  if (raw.disabled === true) return null
  const url = raw.url as string | undefined
  if (!url) return null
  const rawType = raw.type as string | undefined
  const type = rawType === "sse" ? "sse" : "http"
  const headers: Record<string, string> = { ...(raw.headers as Record<string, string> | undefined) }
  const accessToken = resolveOAuthAccessToken(serverName, authStore)
  if (accessToken && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  const cfg: McpServerConfig = { type, url }
  if (Object.keys(headers).length > 0) cfg.headers = headers
  return cfg
}

/**
 * 加载 inline MCP 表（stdio + HTTP/sse）。
 * 手动验证：disabled server 被跳过；HTTP OAuth 合并 Authorization；stdio 相对路径在 workspaceDir 下 resolve。
 */
export function loadInlineCcMcpServers(workspaceDir: string): Record<string, McpServerConfig> {
  const merged = mergeMcpJsonEntries(workspaceDir)
  const authStore = readMcpAuthStore(workspaceDir)
  const result: Record<string, McpServerConfig> = {}
  for (const [name, raw] of Object.entries(merged)) {
    const cfg = raw.url ? toHttpInlineConfig(raw, name, authStore) : toStdioInlineConfig(raw, workspaceDir)
    if (cfg) result[name] = cfg
  }
  return result
}

/** 合并 mcpServers 至 query options；resident 模式每次 query 须重传 */
export function appendInlineMcpToCcOptions<T extends { mcpServers?: Record<string, McpServerConfig> }>(
  options: T,
  workspaceDir?: string,
): T {
  return { ...options, mcpServers: loadInlineCcMcpServers(workspaceDir ?? "") }
}
