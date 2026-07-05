/**
 * SDK 插件 bootstrap：inline MCP（路径解析）+ 清理历史 workspace 同步残留 + 可观测日志。
 * skills/commands/agents/hooks 由 SDK settingSources:plugins + importThirdPartyPlugins patch 原生加载。
 */
import * as fs from "node:fs"
import * as path from "node:path"
import type { AgentDefinition, McpServerConfig } from "@cursor/sdk"
import { formatSdkSettingSourcesLabel } from "../../agent/cursor-sdk/sdk-setting-sources"
import { ensureSdkThirdPartyPluginPatch } from "../../agent/cursor-sdk/ensure-sdk-plugin-patch"
import { loadInlineMcpServersForSdk } from "./mcp-sdk-loader"
import { listPluginMcpServerNames } from "./plugin-mcp-loader"
import { buildPluginResourceInventory } from "./plugin-inventory"
import { resolveEnabledPluginInstalls } from "./plugin-resolve"

export interface SdkPluginBootstrapResult {
  mcpServers: Record<string, McpServerConfig>
  agents?: Record<string, AgentDefinition>
  pluginIds: string[]
}

/** 移除旧版 plugin-sdk-sync 写入的工作区 symlink（一次性清理） */
function cleanupLegacyWorkspacePluginSync(workspaceDir: string): void {
  const ws = workspaceDir.trim()
  if (!ws) return
  const cursorDir = path.join(ws, ".cursor")
  const manifestPath = path.join(cursorDir, ".plugin-sync-manifest.json")
  if (!fs.existsSync(manifestPath)) return
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as { links?: string[] }
    for (const rel of manifest.links ?? []) {
      const abs = path.join(cursorDir, rel)
      try {
        if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true })
        // 若父目录已空则一并删除（skills/commands/agents）
        const parent = path.dirname(abs)
        if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
          fs.rmdirSync(parent)
        }
      } catch { /* best-effort */ }
    }
    fs.rmSync(manifestPath, { force: true })
  } catch { /* best-effort */ }
}

/** 加载 inline MCP；插件非 MCP 能力交给 SDK plugins 层 */
export function bootstrapSdkPluginWorkspace(workspaceDir: string): SdkPluginBootstrapResult {
  cleanupLegacyWorkspacePluginSync(workspaceDir)
  const pluginIds = resolveEnabledPluginInstalls(workspaceDir).map((p) => p.pluginId)
  return {
    mcpServers: loadInlineMcpServersForSdk(workspaceDir),
    pluginIds,
  }
}

/** 格式化资源列表（日志用，过长则截断） */
function formatResourceList(items: string[], max = 8): string {
  if (items.length === 0) return "-"
  if (items.length <= max) return items.join(",")
  return `${items.slice(0, max).join(",")}+${items.length - max}`
}

/** 输出 [config] 摘要 + [plugin-load] 明细（会话创建时 detailed=true） */
export function logSdkPluginConfig(
  workspaceDir: string,
  bootstrap: SdkPluginBootstrapResult,
  log: (level: "INFO" | "WARN", msg: string) => void,
  options?: { detailed?: boolean },
): void {
  const detailed = options?.detailed ?? false
  const pluginMcp = listPluginMcpServerNames(workspaceDir)
  const inlineNames = Object.keys(bootstrap.mcpServers)
  const pluginShort = bootstrap.pluginIds.map((id) => id.split("@")[0]).join(",")
  const patched = ensureSdkThirdPartyPluginPatch()

  const parts = [
    `settingSources=${formatSdkSettingSourcesLabel()}`,
    `importThirdPartyPlugins=${patched ? "on" : "off"}`,
    `cwd=${workspaceDir}`,
    `inlineMcp=${inlineNames.join(",") || "-"}`,
  ]
  if (pluginShort) parts.push(`plugins=${pluginShort}`)
  if (pluginMcp.length) parts.push(`pluginMcp=${pluginMcp.join(",")}`)
  log("INFO", `[config] ${parts.join(" ")}`)

  if (!detailed) return

  const inventories = buildPluginResourceInventory(workspaceDir)
  if (inventories.length === 0) {
    log("INFO", "[plugin-load] 无已启用 Claude Code 第三方插件")
    return
  }

  for (const inv of inventories) {
    const label = inv.displayName ?? inv.pluginId.split("@")[0]
    const ver = inv.version ? `@${inv.version}` : ""
    log(
      "INFO",
      `[plugin-load] ${label}${ver} skills=${formatResourceList(inv.skills)} commands=${formatResourceList(inv.commands)} agents=${formatResourceList(inv.agents)} hooks=${formatResourceList(inv.hooks)} mcp=${formatResourceList(inv.mcp)} path=${inv.installPath}`,
    )
  }
}
