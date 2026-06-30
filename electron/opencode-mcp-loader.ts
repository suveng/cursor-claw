/**
 * OpenCode 内联 MCP 加载器
 * 读 ~/.config/opencode/opencode.json（user）与项目级 opencode.json；合并后注入 createOpencode config。
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { McpServerEntry } from "./mcp-types"

type RawMcpEntry = Record<string, unknown>
export type OpencodeInlineConfig = Record<string, unknown>

/** 读取 JSON 文件中的 mcp / mcpServers 块 */
function readOpencodeJsonMcp(filePath: string, source: "global" | "project"): McpServerEntry[] {
  try {
    if (!fs.existsSync(filePath)) return []
    const cfg = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>
    const block = (cfg.mcpServers ?? cfg.mcp ?? cfg.servers ?? {}) as Record<string, RawMcpEntry>
    return Object.entries(block).map(([name, raw]) => buildEntry(name, raw, source))
  } catch {
    return []
  }
}

function buildEntry(name: string, raw: RawMcpEntry, source: "global" | "project"): McpServerEntry {
  const disabled = raw.enabled === false || raw.disabled === true
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

/** 用户级 opencode.json 路径（ponytail: 兼容 XDG 与 ~/.opencode） */
function resolveGlobalOpencodeJson(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) return path.join(xdg, "opencode", "opencode.json")
  return path.join(os.homedir(), ".config", "opencode", "opencode.json")
}

/** 读用户级 + 项目级 OpenCode MCP 配置 */
export function readOpencodeMcpServers(workspaceDir?: string): McpServerEntry[] {
  const globalEntries = readOpencodeJsonMcp(resolveGlobalOpencodeJson(), "global")
  const ws = (workspaceDir ?? "").trim()
  const projectEntries = ws
    ? readOpencodeJsonMcp(path.join(ws, "opencode.json"), "project")
    : []
  return mergeMcpJsonEntries(globalEntries, projectEntries)
}

/** 多源合并；同名以后出现的整条覆盖 */
export function mergeMcpJsonEntries(...entries: McpServerEntry[][]): McpServerEntry[] {
  const byName = new Map<string, McpServerEntry>()
  for (const list of entries) {
    for (const entry of list) byName.set(entry.name, entry)
  }
  return Array.from(byName.values())
}

function resolvePathLikeSegment(workspaceDir: string, segment: string): string {
  if (path.isAbsolute(segment)) return segment
  if (!segment.includes("/") && !segment.includes("\\") && !segment.startsWith("./") && !segment.startsWith("../")) {
    return segment
  }
  return path.resolve(workspaceDir, segment)
}

function entryToInline(entry: McpServerEntry, workspaceDir: string): RawMcpEntry | null {
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

/** 将 MCP 表注入 OpenCode inline config */
export function appendInlineMcpToOpencodeConfig(
  config: OpencodeInlineConfig,
  servers: McpServerEntry[],
  workspaceDir = "",
): OpencodeInlineConfig {
  const mcp: Record<string, RawMcpEntry> = {}
  for (const entry of servers) {
    const cfg = entryToInline(entry, workspaceDir)
    if (cfg) mcp[entry.name] = cfg
  }
  if (Object.keys(mcp).length === 0) return config
  return { ...config, mcp }
}
