/**
 * 扫描已启用 Claude Code 插件 installPath 下的 skills/commands/agents/hooks/MCP 清单。
 */
import * as fs from "node:fs"
import * as path from "node:path"
import type { PluginInventoryResult, PluginResourceInventory } from "../../../src/shared/plugin-inventory-types"
import { ensureSdkThirdPartyPluginPatch } from "../../agent/cursor-sdk/ensure-sdk-plugin-patch"
import { SDK_SETTING_SOURCES } from "../../agent/cursor-sdk/sdk-setting-sources"
import { readPluginJsonFile, resolveEnabledPluginInstalls } from "./plugin-resolve"
import { readPluginMcpBlock } from "./plugin-mcp-loader"

/** 读插件 manifest（.claude-plugin/plugin.json） */
function readPluginManifest(installPath: string): { name?: string; version?: string } {
  return readPluginJsonFile<{ name?: string; version?: string }>(
    path.join(installPath, ".claude-plugin", "plugin.json"),
  ) ?? {}
}

/** 列出目录下 .md 文件名（不含扩展名） */
function listMdBasenames(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name.replace(/\.md$/, ""))
    .sort()
}

/** 列出 skills/ 下含 SKILL.md 的子目录名 */
function listPluginSkills(installPath: string): string[] {
  const skillsDir = path.join(installPath, "skills")
  if (!fs.existsSync(skillsDir)) return []
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort()
}

/** 解析 hooks.json 顶层 event 键名 */
function listPluginHooks(installPath: string): string[] {
  for (const rel of ["hooks/hooks.json", "hooks.json"]) {
    const cfg = readPluginJsonFile<Record<string, unknown>>(path.join(installPath, rel))
    if (cfg && typeof cfg === "object") {
      return Object.keys(cfg).filter((k) => !k.startsWith("$")).sort()
    }
  }
  return []
}

/** 单插件资源扫描 */
function scanPluginInstall(pluginId: string, installPath: string): PluginResourceInventory {
  const manifest = readPluginManifest(installPath)
  return {
    pluginId,
    installPath,
    displayName: manifest.name,
    version: manifest.version,
    skills: listPluginSkills(installPath),
    commands: listMdBasenames(path.join(installPath, "commands")),
    agents: listMdBasenames(path.join(installPath, "agents")),
    hooks: listPluginHooks(installPath),
    mcp: Object.keys(readPluginMcpBlock(installPath)).sort(),
  }
}

/** 构建当前工作区插件资源清单（设置 IPC + 日志复用） */
export function buildPluginResourceInventory(workspaceDir: string): PluginResourceInventory[] {
  return resolveEnabledPluginInstalls(workspaceDir).map(({ pluginId, installPath }) =>
    scanPluginInstall(pluginId, installPath),
  )
}

/** 设置页完整结果（含 patch 状态与 settingSources） */
export function buildPluginInventoryResult(workspaceDir: string): PluginInventoryResult {
  return {
    workspaceDir: workspaceDir.trim(),
    settingSources: [...SDK_SETTING_SOURCES],
    importThirdPartyPluginsPatched: ensureSdkThirdPartyPluginPatch(),
    plugins: buildPluginResourceInventory(workspaceDir),
  }
}
