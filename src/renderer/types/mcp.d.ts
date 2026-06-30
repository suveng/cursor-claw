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
  enabled?: boolean
}

/** agent:mcp-status IPC 返回结构：按 sessionKey 取运行时 MCP 状态（与 electron/session-mcp-status 对齐） */
interface AgentMcpStatusResult {
  servers: McpServerEntry[]
  statusMap: Record<string, string>
  source: "runtime" | "snapshot" | "disk"
}
