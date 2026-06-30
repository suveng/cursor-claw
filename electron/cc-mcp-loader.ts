/**
 * Claude Agent SDK 内联 MCP 加载器（CC 路径）
 * 读 Claude Code 原生配置源：~/.claude.json(user scope 顶层 mcpServers + local scope projects[ws].mcpServers)
 *   + {ws}/.mcp.json(project scope)；合并后供 query() 每次重传。
 * 合并优先级：project > local > user（团队 .mcp.json 权威）；与 mcp-sdk-loader.ts 的 .cursor/mcp.json 路径相互独立。
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

/**
 * 读 ~/.claude.json 提取 Claude Code 原生 MCP scope：
 * - user scope：顶层 mcpServers（跨项目）
 * - local scope：projects[ws].mcpServers（当前项目私有）
 * 合并：local 覆盖 user（同名 server 取 local 整条，字段不跨 scope 合并）。
 * 文件缺失或解析失败返回空对象（沿用 readMcpServersBlock 容错策略）。
 *
 * ponytail: 与官方 Claude Code precedence（local > project > user）不一致——本注入层由
 *   mergeMcpJsonEntries 再叠加 project .mcp.json 且令 project 最高，团队共享 .mcp.json 为权威源，
 *   适 cursor-claw 团队机器人场景；升级路径：需还原官方优先级时在 mergeMcpJsonEntries 调整覆盖顺序。
 * ponytail: 未实现 project scope 审批门控（projects[ws].enabledMcpjsonServers/disabledMcpjsonServers），
 *   首版信任 workspace 全量加载 .mcp.json；升级路径：按两数组过滤 project 条目。
 */
export function readClaudeJsonMcpServers(workspaceDir: string): Record<string, RawMcpEntry> {
  try {
    const claudeJsonPath = path.join(os.homedir(), ".claude.json")
    if (!fs.existsSync(claudeJsonPath)) return {}
    const cfg = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8")) as Record<string, unknown>
    const merged: Record<string, RawMcpEntry> = {
      ...((cfg.mcpServers as Record<string, RawMcpEntry> | undefined) ?? {}),
    }
    const ws = workspaceDir.trim()
    if (ws) {
      const projects =
        (cfg.projects as Record<string, { mcpServers?: Record<string, RawMcpEntry> }> | undefined) ?? {}
      const localServers = projects[ws]?.mcpServers ?? {}
      Object.assign(merged, localServers)
    }
    return merged
  } catch {
    return {}
  }
}

/**
 * 合并 Claude Code 原生 MCP 配置源；同名 server 以高优先级 scope 整条覆盖（字段不合并）。
 * 优先级：project({ws}/.mcp.json) > local+user(~/.claude.json，local 覆盖 user)。
 * 签名不变；不再读任何 .cursor/mcp.json 路径。
 */
function mergeMcpJsonEntries(workspaceDir: string): Record<string, RawMcpEntry> {
  const merged: Record<string, RawMcpEntry> = { ...readClaudeJsonMcpServers(workspaceDir) }
  const ws = workspaceDir.trim()
  if (ws) Object.assign(merged, readMcpServersBlock(path.join(ws, ".mcp.json")))
  return merged
}

/**
 * 从 Cursor mcp-auth.json 解析 OAuth access_token（兼容 plugin-* 别名键）。
 * ponytail: CC 路径改读 Claude 原生源后，HTTP/sse OAuth token 仍暂留 Cursor store，
 *   与 Claude Code 原生 OAuth 凭据不兼容；首版 CC MCP 以 stdio-only 为已知上限。
 *   升级路径：接入 Claude 原生 OAuth 凭据存储后替换 authStore 来源。
 */
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
