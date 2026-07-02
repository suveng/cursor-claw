import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { McpServerConfig } from "@cursor/sdk"
import { readMcpAuthStore, type McpAuthEntry } from "./mcp-project-dir"

/** mcp.json 单条原始配置（与 mcp-manager buildEntry 对齐） */
type RawMcpEntry = Record<string, unknown>

/** 读取 mcp.json 中的 servers 块；文件缺失或解析失败返回空对象 */
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
 * 合并 global ~/.cursor/mcp.json 与 project .cursor/mcp.json。
 * 同名 server 以 project 为准（覆盖 global）。
 */
function mergeMcpJsonEntries(workspaceDir: string): Record<string, RawMcpEntry> {
  const globalPath = path.join(os.homedir(), ".cursor", "mcp.json")
  const merged: Record<string, RawMcpEntry> = { ...readMcpServersBlock(globalPath) }

  const ws = workspaceDir.trim()
  if (ws) {
    const projectPath = path.join(ws, ".cursor", "mcp.json")
    Object.assign(merged, readMcpServersBlock(projectPath))
  }
  return merged
}

/** 从 mcp-auth.json 解析 OAuth access_token（兼容 plugin-* 别名键） */
function resolveOAuthAccessToken(serverName: string, authStore: Record<string, McpAuthEntry>): string | undefined {
  const candidates = [serverName, `plugin-${serverName}-${serverName}`]
  for (const key of candidates) {
    const token = authStore[key]?.tokens?.access_token
    if (typeof token === "string" && token.trim()) return token.trim()
  }
  return undefined
}

/**
 * ponytail: 设为 1/true 可回滚 stdio/command 类 MCP 也走 inline（默认由 settingSources 加载，避免双份注册）。
 * 升级路径：确认 settingSources 无法加载某 stdio 服务后再临时开启。
 */
function stdioInlineRollbackEnabled(): boolean {
  const v = process.env.SDK_MCP_STDIO_INLINE?.trim().toLowerCase()
  return v === "1" || v === "true"
}

/** 判断条目是否须 inline 注入 SDK（HTTP/sse/OAuth 依赖；stdio 默认走 settingSources） */
function needsInlineInjection(
  serverName: string,
  raw: RawMcpEntry,
  authStore: Record<string, McpAuthEntry>,
): boolean {
  if (raw.disabled === true) return false
  // HTTP/sse：远程 settingSources 常无法加载，须 inline
  if (raw.url) return true
  // mcp.json 声明 OAuth/auth 或磁盘已有 token 依赖
  const auth = raw.auth
  if (auth && typeof auth === "object" && !Array.isArray(auth)) return true
  if (resolveOAuthAccessToken(serverName, authStore)) return true
  // stdio/command 默认不 inline，由 settingSources + cwd 加载
  return stdioInlineRollbackEnabled()
}

/**
 * 将路径型 segment 解析为绝对路径；bare 命令名（npx/node）与已是绝对路径则原样返回。
 * 无 shell 的 spawn 无法解析 ./scripts/...、node_modules/.bin/... 等相对路径。
 */
function resolvePathLikeSegment(workspaceDir: string, segment: string): string {
  if (path.isAbsolute(segment)) return segment
  if (!segment.includes("/") && !segment.includes("\\") && !segment.startsWith("./") && !segment.startsWith("../")) {
    return segment
  }
  return path.resolve(workspaceDir, segment)
}

/** command/stdio 型 → SDK stdio 配置 */
function toStdioInlineConfig(raw: RawMcpEntry, workspaceDir: string): McpServerConfig | null {
  if (raw.disabled === true) return null
  if (raw.url) return null
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
    cfg.cwd = ws
    if (cfg.args) {
      cfg.args = cfg.args.map((arg) => (arg.startsWith("--") ? arg : resolvePathLikeSegment(ws, arg)))
    }
  }
  return cfg
}

/** HTTP/sse 型 → SDK remote 配置；合并 mcp.json headers 与 mcp-auth OAuth */
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

  const headers: Record<string, string> = {
    ...(raw.headers as Record<string, string> | undefined),
  }
  const accessToken = resolveOAuthAccessToken(serverName, authStore)
  if (accessToken && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  const cfg: McpServerConfig = { type, url }
  if (Object.keys(headers).length > 0) cfg.headers = headers

  const auth = raw.auth
  if (auth && typeof auth === "object" && !Array.isArray(auth)) {
    cfg.auth = auth as Extract<McpServerConfig, { auth?: unknown }>["auth"]
  }
  return cfg
}

/**
 * 加载须 inline 注入 SDK 的 MCP 子集（HTTP/sse/OAuth；stdio 默认由 settingSources 加载）。
 * T2 三处注入点唯一读盘入口；同名 server 若 settingSources 与 inline 均存在，inline 覆盖 send 级配置。
 */
export function loadInlineMcpServersForSdk(workspaceDir: string): Record<string, McpServerConfig> {
  const merged = mergeMcpJsonEntries(workspaceDir)
  const authStore = readMcpAuthStore(workspaceDir)
  const result: Record<string, McpServerConfig> = {}
  for (const [name, raw] of Object.entries(merged)) {
    if (!needsInlineInjection(name, raw, authStore)) continue
    const cfg = raw.url
      ? toHttpInlineConfig(raw, name, authStore)
      : toStdioInlineConfig(raw, workspaceDir)
    if (cfg) result[name] = cfg
  }
  return result
}

/** @deprecated 请使用 loadInlineMcpServersForSdk，避免误用全量 inline */
export function loadInlineMcpServers(workspaceDir: string): Record<string, McpServerConfig> {
  return loadInlineMcpServersForSdk(workspaceDir)
}

/** agent.send 选项合并：在 createAgentSendOptions 返回值上追加筛选后 inline mcpServers（resident 每次 send 须重传） */
export function appendInlineMcpToSendOptions<T extends object>(
  sendOptions: T,
  workspaceDir?: string,
): T & { mcpServers: Record<string, McpServerConfig> } {
  return {
    ...sendOptions,
    mcpServers: loadInlineMcpServersForSdk(workspaceDir ?? ""),
  }
}
