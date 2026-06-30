/** MCP 相关全局 ambient 类型（由 env.d.ts 经 triple-slash reference 引入） */

interface McpServerEntry {
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

/** agent:mcp-status IPC 返回结构：按 sessionKey 取运行时 MCP 状态（与 electron/session-mcp-status 对齐） */
interface AgentMcpStatusResult {
  servers: McpServerEntry[]
  statusMap: Record<string, string>
  source: "runtime" | "snapshot" | "disk"
}
