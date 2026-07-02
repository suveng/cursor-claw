/**
 * SDK 会话 MCP 运行时条目构建（从 session-mcp-status 拆出，保持主文件 ≤300 行）。
 * 合并磁盘 mcp.json 与 lastInjectedMcpServers 快照，标注 __sdkLoadVia 供展示层区分来源。
 */
import { getMcpServerListForWorkspace } from "../mcp/mcp-manager"
import { readMcpAuthStore, type McpAuthEntry } from "../mcp/mcp-project-dir"
import type { McpServerEntry } from "../mcp/mcp-types"

type SdkLoadVia = "inline" | "settingSources" | "plugin"

/** 判定插件层 MCP：mcp-auth 仅存 plugin-* 别名键，或名称以 plugin- 开头 */
function isPluginLayerServer(name: string, authStore: Record<string, McpAuthEntry>): boolean {
  if (name.startsWith("plugin-")) return true
  const pluginKey = `plugin-${name}-${name}`
  return Boolean(authStore[pluginKey]?.tokens?.access_token) && !authStore[name]?.tokens?.access_token
}

/** 从 auth store 补全仅插件层可见、未写入 mcp.json 的 server 名 */
function collectPluginOnlyNames(authStore: Record<string, McpAuthEntry>, diskNames: Set<string>): string[] {
  const extras: string[] = []
  for (const key of Object.keys(authStore)) {
    const match = key.match(/^plugin-(.+)-\1$/)
    if (match && !diskNames.has(match[1])) extras.push(match[1])
  }
  return extras
}

/** SDK 路径：合并磁盘列表与 inline 快照，标注 rawConfig.__sdkLoadVia */
export function buildSdkRuntimeEntries(
  workspaceDir: string,
  injected: Record<string, unknown>,
): McpServerEntry[] {
  const ws = workspaceDir.trim()
  const authStore = readMcpAuthStore(ws)
  const diskList = getMcpServerListForWorkspace(ws)
  const inlineNames = new Set(Object.keys(injected))
  const diskNames = new Set(diskList.map((s) => s.name))

  const annotate = (entry: McpServerEntry, loadVia: SdkLoadVia): McpServerEntry => ({
    ...entry,
    rawConfig: { ...(entry.rawConfig ?? {}), __sdkLoadVia: loadVia },
  })

  const servers = diskList.map((entry) => {
    if (isPluginLayerServer(entry.name, authStore)) return annotate(entry, "plugin")
    if (inlineNames.has(entry.name)) return annotate(entry, "inline")
    return annotate(entry, "settingSources")
  })

  for (const name of collectPluginOnlyNames(authStore, diskNames)) {
    servers.push(
      annotate(
        {
          name,
          type: "url",
          source: "global",
          authenticated: true,
          enabled: true,
          rawConfig: {},
        },
        "plugin",
      ),
    )
  }
  return servers
}
