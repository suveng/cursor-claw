/** Claude Code 第三方插件资源清单（设置页只读展示 + SDK 加载日志） */
export interface PluginResourceInventory {
  pluginId: string
  installPath: string
  displayName?: string
  version?: string
  skills: string[]
  commands: string[]
  agents: string[]
  hooks: string[]
  mcp: string[]
}

/** 设置页插件层摘要 */
export interface PluginInventoryResult {
  workspaceDir: string
  settingSources: string[]
  importThirdPartyPluginsPatched: boolean
  plugins: PluginResourceInventory[]
}
