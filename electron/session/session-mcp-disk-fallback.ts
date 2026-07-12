/**
 * 无活跃 session 时按 engineType 读盘 fallback（Codex / OpenCode / CC）
 * 从 session-mcp-status 拆出，保持主文件 ≤300 行。
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { loadInlineCcMcpServers, readCcProjectApproval } from "../mcp/loaders/cc-mcp-loader"
import { readCodexMcpServers } from "../mcp/loaders/codex-mcp-loader"
import { readOpencodeMcpServers } from "../mcp/loaders/opencode-mcp-loader"
import type { McpServerEntry } from "../mcp/mcp-types"
import type { AgentMcpStatusResult } from "./session-mcp-status"

/** config 是否为空（缺字段或空对象） */
function isEmptyConfig(cfg: unknown): boolean {
  return !cfg || (typeof cfg === "object" && Object.keys(cfg as object).length === 0)
}

/** 磁盘条目通用字段提取（与 session-mcp-status.toEntry 语义对齐） */
function toDiskEntry(
  name: string,
  cfg: Record<string, unknown>,
  source: "global" | "project",
  approved?: boolean,
): McpServerEntry {
  const type: "command" | "url" = cfg.url ? "url" : "command"
  const entry: McpServerEntry = {
    name,
    type,
    source,
    authenticated: false,
    rawConfig: cfg,
    enabled: approved !== false,
  }
  if (cfg.url) entry.url = cfg.url as string
  else entry.command = (cfg.command as string | undefined) ?? ""
  if (cfg.args) entry.args = cfg.args as string[]
  if (cfg.env) entry.env = cfg.env as Record<string, string>
  return entry
}

/** 读 {ws}/.mcp.json 的 server names（CC project scope 判定） */
function readProjectMcpNames(workspaceDir: string): Set<string> {
  try {
    const p = path.join(workspaceDir, ".mcp.json")
    if (!fs.existsSync(p)) return new Set()
    const cfg = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>
    const servers = (cfg.mcpServers ?? cfg.servers ?? {}) as Record<string, unknown>
    return new Set(Object.keys(servers))
  } catch {
    return new Set()
  }
}

/** CC project scope 审批门控（inline，与 session-mcp-status 口径对齐） */
function buildApprovedMap(
  names: string[],
  workspaceDir: string,
  approval: { enabled: string[]; disabled: string[]; enableAll: boolean },
): Map<string, boolean> {
  const projectNames = readProjectMcpNames(workspaceDir)
  const result = new Map<string, boolean>()
  for (const name of names) {
    if (!projectNames.has(name)) {
      result.set(name, true)
      continue
    }
    if (approval.enableAll) result.set(name, true)
    else if (approval.disabled.includes(name)) result.set(name, false)
    else if (approval.enabled.includes(name)) result.set(name, true)
    else result.set(name, false)
  }
  return result
}

function mapInjectedToEntries(
  cfgs: Record<string, Record<string, unknown>>,
  approvedMap?: Map<string, boolean>,
): McpServerEntry[] {
  return Object.entries(cfgs).map(([name, cfg]) =>
    toDiskEntry(name, cfg ?? {}, "project", approvedMap?.get(name)),
  )
}

function buildDiskStatusMap(approvedMap: Map<string, boolean>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [name, approved] of approvedMap) if (!approved) map[name] = "disabled"
  return map
}

/**
 * 无 session 时按 engineType 读盘；无匹配或 CC 缺 workspace 返回 null。
 * workspaceDir 空时 Codex/OpenCode 仍可读 global 配置（loader 已支持）。
 */
export function tryNoSessionDiskMcpFallback(
  engineType?: string,
  workspaceDir?: string,
): AgentMcpStatusResult | null {
  const ws = (workspaceDir ?? "").trim()

  if (engineType === "codex") {
    return {
      servers: readCodexMcpServers(ws || undefined),
      statusMap: {},
      source: "disk",
    }
  }

  if (engineType === "opencode") {
    return {
      servers: readOpencodeMcpServers(ws || undefined),
      statusMap: {},
      source: "disk",
    }
  }

  if (engineType === "claude-code" && ws) {
    const cfgs = loadInlineCcMcpServers(ws) as Record<string, Record<string, unknown>>
    const approvedMap = buildApprovedMap(Object.keys(cfgs), ws, readCcProjectApproval(ws))
    return {
      servers: mapInjectedToEntries(cfgs, approvedMap),
      statusMap: buildDiskStatusMap(approvedMap),
      source: "disk",
    }
  }

  return null
}
