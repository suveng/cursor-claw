/** MCP 面板按 engineType 差异化展示策略 */

export type McpEngineType = "sdk" | "claude-code" | "codex" | "opencode"

/** SDK 运行时加载方式（展示层标注，存于 rawConfig.__sdkLoadVia） */
export type SdkMcpLoadVia = "inline" | "settingSources" | "plugin"

export interface McpViewConfig {
  /** 区块标题 */
  title: string
  /** 是否支持加载 MCP 列表 */
  supported: boolean
  /** 未支持引擎占位文案 */
  unsupportedMessage?: string
  /** 空态引导 */
  emptyHint: (effectiveWs: string, usingFallback: boolean) => string
  /** SDK 插件层脚注（Session 面板空态等） */
  pluginFootnote?: string
}

/** 插件层 MCP 只读说明（Settings Plugin 区与 Session 脚注复用） */
export interface McpPluginNotice {
  title: string
  body: string
  verificationSteps: string[]
}

/** 插件层边界说明 SSOT */
export function getMcpPluginNotice(): McpPluginNotice {
  return {
    title: "Claude Code 第三方插件 MCP",
    body:
      "已启用插件的 MCP 经 settingSources:plugins 加载；含 ${CLAUDE_PLUGIN_ROOT} 路径变量的条目另经 inline 注入兜底。" +
      "Settings → MCP 可查看插件清单；会话创建时 UI 日志输出 [plugin-load] 明细。",
    verificationSteps: [
      "在 Settings → MCP 查看「Claude Code 第三方插件层」清单",
      "发起 SDK 会话，在 UI 日志核对 [config] 与 [plugin-load] 行",
      "Dashboard 会话 MCP 面板确认插件层条目标注「插件层」",
    ],
  }
}

/** 从 entry.rawConfig 读取 SDK 加载方式标注 */
export function resolveSdkMcpLoadVia(entry: McpServerEntry): SdkMcpLoadVia | undefined {
  const via = entry.rawConfig?.__sdkLoadVia
  if (via === "inline" || via === "settingSources" || via === "plugin") return via
  return undefined
}

/** 列表行来源标签：区分用户级/项目级/inline/settingSources/插件层 */
export function formatMcpScopeLabel(entry: McpServerEntry, engineType: McpEngineType): string {
  if (engineType === "sdk") {
    const loadVia = resolveSdkMcpLoadVia(entry)
    if (loadVia === "plugin") return "插件层"
    const scope = entry.source === "global" ? "用户级" : "项目级"
    if (loadVia === "inline") return `${scope}·inline`
    if (loadVia === "settingSources") return `${scope}·settingSources`
  }
  return entry.source === "global" ? "用户级" : "项目级"
}

/** runtime/snapshot/disk 三态中文标签 */
export function formatMcpStatusSourceLabel(source: AgentMcpStatusResult["source"]): string {
  switch (source) {
    case "runtime": return "运行时"
    case "snapshot": return "会话缓存"
    case "disk": return "磁盘配置"
    default: return source
  }
}

const SDK_PLUGIN_FOOTNOTE =
  "插件 MCP 经 settingSources:plugins 或 inline 注入；以 UI 日志 [config]/[plugin-load] 与 Dashboard MCP 面板为准。"

/** 按 engineType 返回展示配置 */
export function getMcpViewConfig(engineType: McpEngineType): McpViewConfig {
  switch (engineType) {
    case "sdk":
      return {
        title: "Cursor SDK MCP",
        supported: true,
        pluginFootnote: SDK_PLUGIN_FOOTNOTE,
        emptyHint: (ws, usingFallback) =>
          usingFallback
            ? `暂无 MCP。用户级 ~/.cursor/mcp.json 或主工作区 ${ws}/.cursor/mcp.json；插件层需在会话 Dashboard 验证。`
            : `暂无 MCP。可编辑 ~/.cursor/mcp.json 或 ${ws}/.cursor/mcp.json；插件层 MCP 需在会话 Dashboard 验证。`,
      }
    case "claude-code":
      return {
        title: "Claude Agent 内联 MCP",
        supported: true,
        emptyHint: (ws, usingFallback) =>
          usingFallback
            ? `暂无 MCP 配置。可编辑 ~/.claude.json，或在主工作区 ${ws}/.mcp.json 添加。`
            : `暂无 MCP 配置。可编辑 ~/.claude.json 或 ${ws}/.mcp.json。`,
      }
    case "codex":
      return {
        title: "Codex MCP",
        supported: true,
        unsupportedMessage: "设置页不提供 TOML 编辑，请直接修改配置文件",
        emptyHint: (ws, usingFallback) =>
          usingFallback
            ? `暂无 MCP 配置。可编辑 ~/.codex/config.toml，或在主工作区 ${ws}/.codex/config.toml 添加。`
            : `暂无 MCP 配置。可编辑 ~/.codex/config.toml 或 ${ws}/.codex/config.toml。`,
      }
    case "opencode":
      return {
        title: "OpenCode 内联 MCP",
        supported: true,
        emptyHint: (ws, usingFallback) =>
          usingFallback
            ? `暂无 MCP 配置。可编辑 ~/.config/opencode/opencode.json，或在主工作区 ${ws}/opencode.json 添加。`
            : `暂无 MCP 配置。可编辑 ~/.config/opencode/opencode.json 或 ${ws}/opencode.json。`,
      }
    default:
      return {
        title: "MCP",
        supported: false,
        unsupportedMessage: "未知引擎",
        emptyHint: () => "",
      }
  }
}
