/**
 * Claude Agent SDK 插件 bootstrap：解析已启用 installPath → query options.plugins。
 * MCP 仍由 cc-mcp-loader inline 注入（strictMcpConfig + skipMcpDiscovery）。
 */
import * as path from "node:path"
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk"
import { buildPluginResourceInventory } from "./plugin-inventory"
import { listPluginMcpServerNames } from "./plugin-mcp-loader"
import { resolveEnabledPluginInstalls } from "./plugin-resolve"

/** 格式化资源列表（日志用，过长则截断） */
function formatResourceList(items: string[], max = 8): string {
  if (items.length === 0) return "-"
  if (items.length <= max) return items.join(",")
  return `${items.slice(0, max).join(",")}+${items.length - max}`
}

/** 构建 query() 的 plugins 选项（skipMcpDiscovery 避免与 inline MCP 重复） */
export function buildCcSdkPluginConfigs(workspaceDir: string): SdkPluginConfig[] {
  return resolveEnabledPluginInstalls(workspaceDir).map(({ installPath }) => ({
    type: "local" as const,
    path: installPath,
    skipMcpDiscovery: true,
  }))
}

/** 输出 [config] 摘要 + [plugin-load] 明细（会话 query 创建时 detailed=true） */
export function logCcPluginConfig(
  workspaceDir: string,
  plugins: SdkPluginConfig[],
  log: (level: "INFO" | "WARN", msg: string) => void,
  options?: { detailed?: boolean; inlineMcpNames?: string[]; sessionKey?: string },
): void {
  const detailed = options?.detailed ?? false
  const prefix = options?.sessionKey ? `[${options.sessionKey}] ` : ""
  const pluginMcp = listPluginMcpServerNames(workspaceDir)
  const pluginShort = plugins.map((p) => path.basename(p.path)).join(",")
  const parts = [
    `plugins=${pluginShort || "-"}`,
    `skipMcpDiscovery=true`,
    `cwd=${workspaceDir}`,
  ]
  if (options?.inlineMcpNames?.length) parts.push(`inlineMcp=${options.inlineMcpNames.join(",")}`)
  if (pluginMcp.length) parts.push(`pluginMcp=${pluginMcp.join(",")}`)
  log("INFO", `${prefix}[config] ${parts.join(" ")}`)

  if (!detailed) return

  const inventories = buildPluginResourceInventory(workspaceDir)
  if (inventories.length === 0) {
    log("INFO", `${prefix}[plugin-load] 无已启用 Claude Code 第三方插件`)
    return
  }

  for (const inv of inventories) {
    const label = inv.displayName ?? inv.pluginId.split("@")[0]
    const ver = inv.version ? `@${inv.version}` : ""
    log(
      "INFO",
      `${prefix}[plugin-load] ${label}${ver} skills=${formatResourceList(inv.skills)} commands=${formatResourceList(inv.commands)} agents=${formatResourceList(inv.agents)} hooks=${formatResourceList(inv.hooks)} mcp=${formatResourceList(inv.mcp)} path=${inv.installPath}`,
    )
  }
}
