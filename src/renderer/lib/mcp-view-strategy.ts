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
    title: "插件层 MCP（只读说明）",
    body: "Cursor IDE 插件市场安装的 MCP/工具依赖 settingSources 中的插件层配置。headless SDK 会话未必加载全部 IDE 插件；保存 mcp.json 或 Rules 不等于 IM 路径已生效。",
    verificationSteps: [
      "发起一条 SDK 会话（飞书/微信触发或 Dashboard 测试）",
      "打开 Dashboard 对应会话的 MCP 面板，确认列表与工具状态",
      "查看 UI 日志中的 [config] 行：核对 cwd、settingSources 与 inlineMcp 名称",
      "插件层条目应标注「插件层」，勿与 inline 注入混淆",
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
  "插件层 MCP 由 settingSources 加载，未必出现在 inline 列表；请以 [config] 日志与工具可用性为准。"

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
        title: "MCP",
        supported: false,
        unsupportedMessage: "该引擎 MCP 查看尚未支持",
        emptyHint: () => "",
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
