/**
 * Codex SDK 内联 MCP 加载器（Codex 路径）
 * 读 Codex CLI 原生配置源：~/.codex/config.toml（global）
 *   + {ws}/.codex/config.toml（project scope，trusted 项目）；
 * 合并后供 launchCodexAgent 每次启动注入。
 * 合并优先级：project > global（与 Codex CLI 一致）；与 cc-mcp-loader / mcp-sdk-loader 路径相互独立。
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { McpServerEntry } from "../mcp-types"
import type { CodexLaunchOptions } from "../../agent/codex/agent-codex-types"

/** config.toml 单条 MCP server 原始字段 */
type RawMcpEntry = Record<string, unknown>

/** 解析 TOML 标量/数组/内联表（仅覆盖 MCP 配置常见形态，非通用 TOML 解析器） */
function parseTomlValue(raw: string): unknown {
  const s = raw.trim()
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"')
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1)
  if (s === "true") return true
  if (s === "false") return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim()
    if (!inner) return []
    return splitTomlArrayItems(inner).map((item) => parseTomlValue(item.trim()))
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const table: Record<string, unknown> = {}
    for (const part of splitTomlInlineTableItems(s.slice(1, -1))) {
      const eq = part.indexOf("=")
      if (eq < 0) continue
      const k = part.slice(0, eq).trim()
      table[k] = parseTomlValue(part.slice(eq + 1).trim())
    }
    return table
  }
  return s
}

/** 按顶层逗号拆分 TOML 数组项（忽略引号内逗号） */
function splitTomlArrayItems(inner: string): string[] {
  const items: string[] = []
  let buf = ""
  let inQuote: '"' | "'" | null = null
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (inQuote) {
      buf += ch
      if (ch === inQuote && inner[i - 1] !== "\\") inQuote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch
      buf += ch
      continue
    }
    if (ch === ",") {
      items.push(buf)
      buf = ""
      continue
    }
    buf += ch
  }
  if (buf.trim()) items.push(buf)
  return items
}

/** 按顶层逗号拆分内联表键值对 */
function splitTomlInlineTableItems(inner: string): string[] {
  return splitTomlArrayItems(inner)
}

/**
 * 从 config.toml 文本提取 [mcp_servers.*] 表块。
 * ponytail: 仅解析顶层 mcp_servers 与 env/http_headers 子表；plugins.*.mcp_servers 首版跳过；
 *   升级路径：按需扩展 plugins 命名空间解析。
 */
function parseMcpServersTomlContent(content: string): Record<string, RawMcpEntry> {
  const servers: Record<string, RawMcpEntry> = {}
  let serverName: string | null = null
  let subPath: string[] = []

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const tableMatch = /^\[mcp_servers\.([^\]]+)\]$/.exec(trimmed)
    if (tableMatch) {
      const segments = tableMatch[1]!.split(".")
      serverName = segments[0]!
      subPath = segments.slice(1)
      if (!servers[serverName]) servers[serverName] = {}
      continue
    }

    // 非 mcp_servers 表则重置上下文
    if (trimmed.startsWith("[")) {
      serverName = null
      subPath = []
      continue
    }
    if (!serverName) continue

    const kv = /^([^=]+)=(.*)$/.exec(trimmed)
    if (!kv) continue
    const key = kv[1]!.trim()
    const value = parseTomlValue(kv[2]!.trim())
    const entry = servers[serverName]!

    if (subPath.length === 0) {
      entry[key] = value
    } else if (subPath.length === 1 && subPath[0] === "env") {
      const env = (entry.env as Record<string, unknown> | undefined) ?? {}
      env[key] = value
      entry.env = env
    } else if (subPath.length === 1 && subPath[0] === "http_headers") {
      const headers = (entry.http_headers as Record<string, unknown> | undefined) ?? {}
      headers[key] = value
      entry.http_headers = headers
    } else {
      // tools.* 等嵌套表保留在 raw 树，供 Codex CLI 透传
      let node: Record<string, unknown> = entry
      for (let i = 0; i < subPath.length - 1; i++) {
        const seg = subPath[i]!
        const next = (node[seg] as Record<string, unknown> | undefined) ?? {}
        node[seg] = next
        node = next
      }
      node[subPath[subPath.length - 1]!] = { ...(node[subPath[subPath.length - 1]!] as object), [key]: value }
    }
  }
  return servers
}

/** 读取单个 config.toml 的 mcp_servers 块；缺失或解析失败返回空数组 */
function readCodexTomlMcpServers(filePath: string, source: "global" | "project"): McpServerEntry[] {
  try {
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, "utf-8")
    const rawMap = parseMcpServersTomlContent(content)
    return Object.entries(rawMap).map(([name, raw]) => buildEntry(name, raw, source))
  } catch {
    return []
  }
}

/** Raw 配置 → McpServerEntry（与 mcp-manager.buildEntry 字段对齐） */
function buildEntry(name: string, raw: RawMcpEntry, source: "global" | "project"): McpServerEntry {
  const disabled = raw.enabled === false
  const type: "command" | "url" = raw.url ? "url" : "command"
  return {
    name,
    type,
    command: raw.command as string | undefined,
    args: raw.args as string[] | undefined,
    url: raw.url as string | undefined,
    env: raw.env as Record<string, string> | undefined,
    source,
    authenticated: false,
    rawConfig: raw,
    enabled: !disabled,
  }
}

/**
 * 读 ~/.codex/config.toml（global）与可选 project `.codex/config.toml`。
 * workspaceDir 省略时仅读 global。
 *
 * ponytail: OAuth 凭据由 Codex CLI bearer_token_env_var / mcp_oauth 管理，
 *   首版不读 Cursor mcp-auth.json；升级路径：按需桥接 Cursor OAuth store。
 */
export function readCodexMcpServers(workspaceDir?: string): McpServerEntry[] {
  const globalPath = path.join(os.homedir(), ".codex", "config.toml")
  const globalEntries = readCodexTomlMcpServers(globalPath, "global")
  const ws = (workspaceDir ?? "").trim()
  const projectEntries = ws
    ? readCodexTomlMcpServers(path.join(ws, ".codex", "config.toml"), "project")
    : []
  return mergeMcpJsonEntries(globalEntries, projectEntries)
}

/**
 * 合并多源 MCP 条目；同名 server 以后出现的整条覆盖（字段不跨源合并）。
 * 典型顺序：global → project（project 最高）。
 */
export function mergeMcpJsonEntries(...entries: McpServerEntry[][]): McpServerEntry[] {
  const byName = new Map<string, McpServerEntry>()
  for (const list of entries) {
    for (const entry of list) byName.set(entry.name, entry)
  }
  return Array.from(byName.values())
}

/** 将路径型 segment 解析为绝对路径（bare 命令名不 resolve） */
function resolvePathLikeSegment(workspaceDir: string, segment: string): string {
  if (path.isAbsolute(segment)) return segment
  if (!segment.includes("/") && !segment.includes("\\") && !segment.startsWith("./") && !segment.startsWith("../")) {
    return segment
  }
  return path.resolve(workspaceDir, segment)
}

/** McpServerEntry → Codex 内联注入配置（stdio 相对路径 resolve + cwd） */
function entryToInlineConfig(entry: McpServerEntry, workspaceDir: string): RawMcpEntry | null {
  if (entry.enabled === false) return null
  const raw = { ...(entry.rawConfig ?? {}) }
  const ws = workspaceDir.trim()

  if (entry.type === "url") {
    if (!entry.url) return null
    return { ...raw, url: entry.url }
  }

  const command = entry.command ?? (raw.command as string | undefined)
  if (!command) return null
  const cfg: RawMcpEntry = {
    ...raw,
    command: ws ? resolvePathLikeSegment(ws, command) : command,
  }
  if (entry.args ?? raw.args) {
    const args = (entry.args ?? raw.args) as string[]
    cfg.args = ws ? args.map((arg) => (arg.startsWith("--") ? arg : resolvePathLikeSegment(ws, arg))) : args
  }
  if (ws && !cfg.cwd) cfg.cwd = ws
  if (entry.env) cfg.env = entry.env
  return cfg
}

/**
 * 加载 inline MCP 表，供 launchCodexAgent / startThread 注入。
 * disabled（enabled=false）server 跳过；stdio 相对路径在 workspaceDir 下 resolve。
 */
export function loadCodexMcpServers(workspaceDir: string): Record<string, RawMcpEntry> {
  const merged = readCodexMcpServers(workspaceDir)
  const result: Record<string, RawMcpEntry> = {}
  for (const entry of merged) {
    const cfg = entryToInlineConfig(entry, workspaceDir)
    if (cfg) result[entry.name] = cfg
  }
  return result
}

/** 合并 mcpServers 至 CodexLaunchOptions；每次 launch 须重传（仿 appendInlineMcpToCcOptions） */
export function appendInlineMcpToCodexOptions(
  opts: CodexLaunchOptions,
  servers: McpServerEntry[],
): CodexLaunchOptions {
  const ws = opts.workspaceDir ?? ""
  const inline: Record<string, RawMcpEntry> = {}
  for (const entry of servers) {
    const cfg = entryToInlineConfig(entry, ws)
    if (cfg) inline[entry.name] = cfg
  }
  return { ...opts, mcpServers: inline }
}
