/** MCP 服务器列表条目（来自 global/project mcp.json） */
export interface McpServerEntry {
  name: string
  type: "command" | "url"
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  source: "global" | "project"
  authenticated?: boolean
  rawConfig?: Record<string, unknown>
  /**
   * 启用状态（审批门控语义，与展示层「未启用」标签双通道）：
   * - false = 审批未启用/被禁用（project scope 未在审批白名单或显式 disabled，未注入运行）
   * - true  = 审批启用，或 user/local scope（不经审批，始终 true）
   * - undefined = 历史数据/未标记，向后兼容按 true 处理
   */
  enabled?: boolean
}

/** MCP 工具元信息（tools/list 结果） */
export interface McpToolInfo {
  name: string
  description?: string
  params?: { name: string; type?: string; description?: string; required?: boolean }[]
}
