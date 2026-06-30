/** MCP 面板按 engineType 差异化展示策略 */

export type McpEngineType = "sdk" | "claude-code" | "codex"

export interface McpViewConfig {
  /** 区块标题 */
  title: string
  /** 是否支持加载 MCP 列表 */
  supported: boolean
  /** 未支持引擎占位文案 */
  unsupportedMessage?: string
  /** 空态引导 */
  emptyHint: (effectiveWs: string, usingFallback: boolean) => string
}

/** 按 engineType 返回展示配置 */
export function getMcpViewConfig(engineType: McpEngineType): McpViewConfig {
  switch (engineType) {
    case "sdk":
      return {
        title: "Cursor SDK 内联 MCP",
        supported: true,
        emptyHint: (ws, usingFallback) =>
          usingFallback
            ? `暂无 MCP 配置。可编辑 ~/.cursor/mcp.json，或在主工作区 ${ws}/.cursor/mcp.json 添加。`
            : `暂无 MCP 配置。可编辑 ~/.cursor/mcp.json 或 ${ws}/.cursor/mcp.json。`,
      }
    case "claude-code":
      return {
        title: "Claude Agent 内联 MCP",
        supported: true,
        emptyHint: (ws, usingFallback) =>
          usingFallback
            ? `暂无 MCP 配置。可编辑 ~/.cursor/mcp.json，或在主工作区 ${ws}/.cursor/mcp.json 添加。`
            : `暂无 MCP 配置。可编辑 ~/.cursor/mcp.json 或 ${ws}/.cursor/mcp.json。`,
      }
    case "codex":
    default:
      return {
        title: "MCP",
        supported: false,
        unsupportedMessage: "该引擎 MCP 查看尚未支持",
        emptyHint: () => "",
      }
  }
}
