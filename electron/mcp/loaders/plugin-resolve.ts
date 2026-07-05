/**
 * Claude Code 插件解析 SSOT：installed_plugins + enabledPlugins → installPath 列表。
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

interface InstalledPluginsFile {
  plugins?: Record<string, Array<{
    scope?: string
    projectPath?: string
    installPath?: string
  }>>
}

interface ClaudeSettingsFile {
  enabledPlugins?: Record<string, boolean>
}

/** 路径归一化（与 SDK vt() 一致） */
export function normalizePluginPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "") || "/"
}

/** 读 JSON 文件，失败返回 null */
export function readPluginJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

/** 合并项目与用户 enabledPlugins */
export function readEnabledPluginsMap(workspaceDir: string): Record<string, boolean> {
  const enabled: Record<string, boolean> = {}
  const userSettings = readPluginJsonFile<ClaudeSettingsFile>(
    path.join(os.homedir(), ".claude", "settings.json"),
  )
  if (userSettings?.enabledPlugins) Object.assign(enabled, userSettings.enabledPlugins)

  const ws = workspaceDir.trim()
  if (!ws) return enabled

  for (const name of ["settings.json", "settings.local.json"]) {
    const project = readPluginJsonFile<ClaudeSettingsFile>(path.join(ws, ".claude", name))
    if (project?.enabledPlugins) Object.assign(enabled, project.enabledPlugins)
  }
  return enabled
}

/** 解析当前工作区应启用的插件 installPath（对齐 SDK loadAllEnabledPlugins） */
export function resolveEnabledPluginInstalls(
  workspaceDir: string,
): Array<{ pluginId: string; installPath: string }> {
  const installed = readPluginJsonFile<InstalledPluginsFile>(
    path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json"),
  )
  if (!installed?.plugins) return []

  const enabledMap = readEnabledPluginsMap(workspaceDir)
  const wsNorm = workspaceDir.trim() ? normalizePluginPath(path.resolve(workspaceDir.trim())) : undefined
  const seen = new Set<string>()
  const result: Array<{ pluginId: string; installPath: string }> = []

  for (const [pluginId, entries] of Object.entries(installed.plugins)) {
    if (!Array.isArray(entries) || entries.length === 0) continue
    if (wsNorm !== undefined && enabledMap[pluginId] === false) continue

    let match: (typeof entries)[number] | undefined
    if (wsNorm !== undefined && enabledMap[pluginId] === true) {
      match = entries.find(
        (e) =>
          (e.scope === "project" || e.scope === "local") &&
          e.projectPath &&
          normalizePluginPath(path.resolve(e.projectPath)) === wsNorm,
      )
    }
    if (!match && enabledMap[pluginId] === true) {
      match = entries.find((e) => e.scope === "user")
    }
    const installPath = match?.installPath?.trim()
    if (!installPath || seen.has(pluginId)) continue
    seen.add(pluginId)
    result.push({ pluginId, installPath: path.resolve(installPath) })
  }
  return result
}

/** 展开插件根目录占位符 */
export function expandPluginRoot(value: string, pluginRoot: string): string {
  return value
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
    .replace(/\$\{CURSOR_PLUGIN_ROOT\}/g, pluginRoot)
}
