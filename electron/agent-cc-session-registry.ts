/**
 * CC session 注册表与对外查询导出
 * 维护 sessionKey → CcSessionAgent 的 Map，供 agent-claude-sdk 生命周期与外部模块（Dashboard/MCP 面板）查询。
 */
import type { Query } from "@anthropic-ai/claude-agent-sdk"
import { resolveSessionChatName } from "./agent-launcher"
import type { CcSessionAgent } from "./agent-cc-types"

/** 活跃 CC 会话缓存（launch/dispatch/stop 由 agent-claude-sdk 读写） */
export const CC_SESSIONS = new Map<string, CcSessionAgent>()

/** 供 daemon/session-dispatcher 列举 CC 会话列表 */
export function getClaudeCodeSessionList(): Array<{
  sessionKey: string
  chatType: string
  startedAt: number
  chatName?: string
  pid: number
  workspaceDir?: string
}> {
  return [...CC_SESSIONS.values()].map((s) => ({
    sessionKey: s.sessionKey,
    chatType: s.chatType as string,
    startedAt: s.startedAt,
    chatName: resolveSessionChatName(s.sessionKey, s.chatName, s.senderOpenId),
    pid: 0,
    // CC 会话工作区：供 Dashboard MCP 面板绑定 project mcp.json
    workspaceDir: s.workspaceDir,
  }))
}

/** 供外部模块（如 MCP 面板）按 sessionKey 取 CC session 缓存（含 lastMcpServersSnapshot） */
export function getCcSession(sessionKey: string): CcSessionAgent | undefined {
  return CC_SESSIONS.get(sessionKey)
}

/** 供外部模块按 sessionKey 取活跃 Query（idle 返回 null），用于调 query.mcpServerStatus() */
export function getCcActiveQuery(sessionKey: string): Query | null {
  return CC_SESSIONS.get(sessionKey)?.activeQuery ?? null
}
