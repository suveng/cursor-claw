/**
 * Claude Code 第三方插件 MCP 加载（对齐 Cursor IDE / @cursor/sdk loadClaudePlugin 语义）。
 * 插件 MCP 定义在 {installPath}/.mcp.json，使用 ${CLAUDE_PLUGIN_ROOT} 变量；
 * headless SDK 须 inline 注入并解析绝对路径。
 */
import * as path from "node:path"
import type { McpServerConfig } from "@cursor/sdk"
import {
  expandPluginRoot,
  readPluginJsonFile,
  resolveEnabledPluginInstalls,
} from "./plugin-resolve"

type RawMcpEntry = Record<string, unknown>

/** 插件 stdio MCP 配置（CC / Cursor SDK 结构兼容） */
export interface PluginStdioMcpConfig {
  type: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

/** 读插件目录下 .mcp.json / mcp.json */
export function readPluginMcpBlock(installPath: string): Record<string, RawMcpEntry> {
  for (const name of [".mcp.json", "mcp.json"]) {
    const filePath = path.join(installPath, name)
    const cfg = readPluginJsonFile<{ mcpServers?: Record<string, RawMcpEntry>; servers?: Record<string, RawMcpEntry> }>(filePath)
    if (cfg) return (cfg.mcpServers ?? cfg.servers ?? {}) as Record<string, RawMcpEntry>
  }
  return {}
}

/** 单条插件 MCP → stdio 配置（解析 CLAUDE_PLUGIN_ROOT，对齐 Claude Code 文档） */
function toPluginStdioConfig(
  raw: RawMcpEntry,
  installPath: string,
  workspaceDir: string,
): PluginStdioMcpConfig | null {
  if (raw.disabled === true || raw.url) return null
  const command = raw.command as string | undefined
  if (!command) return null

  const ws = workspaceDir.trim()
  const expand = (s: string) => expandPluginRoot(s, installPath)
  const args = (raw.args as string[] | undefined)?.map(expand)
  const rawEnv = raw.env as Record<string, string> | undefined
  const env: Record<string, string> = {
    CLAUDE_PLUGIN_ROOT: installPath,
  }
  if (rawEnv) {
    for (const [k, v] of Object.entries(rawEnv)) env[k] = expand(v)
  }
  if (ws) {
    env.CLAUDE_PROJECT_DIR = ws
    env.CURSOR_WORKSPACE = ws
  }

  return {
    type: "stdio",
    command: expand(command),
    args,
    env,
    cwd: ws || installPath,
  }
}

/** 加载已启用插件 MCP（引擎无关 stdio 配置） */
export function loadPluginStdioMcpServers(workspaceDir: string): Record<string, PluginStdioMcpConfig> {
  const result: Record<string, PluginStdioMcpConfig> = {}
  for (const { installPath } of resolveEnabledPluginInstalls(workspaceDir)) {
    for (const [name, raw] of Object.entries(readPluginMcpBlock(installPath))) {
      const cfg = toPluginStdioConfig(raw, installPath, workspaceDir)
      if (cfg) result[name] = cfg
    }
  }
  return result
}

/** 合并插件 MCP 到目标表（插件层覆盖同名，不受 project 审批门控） */
export function mergePluginMcpServers<T extends Record<string, PluginStdioMcpConfig>>(
  target: T,
  workspaceDir: string,
): T {
  return Object.assign(target, loadPluginStdioMcpServers(workspaceDir))
}

/** 加载已启用 Claude Code 插件的 MCP，供 Cursor SDK inline 注入 */
export function loadPluginMcpServersForSdk(workspaceDir: string): Record<string, McpServerConfig> {
  return loadPluginStdioMcpServers(workspaceDir) as Record<string, McpServerConfig>
}

/** 插件 MCP 名称列表（展示层标注「插件层」） */
export function listPluginMcpServerNames(workspaceDir: string): string[] {
  const names: string[] = []
  for (const { installPath } of resolveEnabledPluginInstalls(workspaceDir)) {
    names.push(...Object.keys(readPluginMcpBlock(installPath)))
  }
  return [...new Set(names)]
}
