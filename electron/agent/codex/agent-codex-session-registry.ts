/**
 * Codex session 注册表与对外查询导出
 * 维护 sessionKey → CodexSessionAgent 的 Map，供 agent-codex-sdk 生命周期与 Dashboard 查询。
 */
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { resolveSessionChatName } from "../shared/agent-launcher"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { clearCodexStreamPostTimer, broadcastCodexSessionStatus } from "./agent-codex-stream"
import type { CodexSessionAgent } from "./agent-codex-types"

/** 活跃 Codex 会话缓存（launch/dispatch/stop 由 agent-codex-sdk 读写） */
export const CODEX_SESSIONS = new Map<string, CodexSessionAgent>()
/** 启动中的 sessionKey（防并发 launch） */
export const CODEX_PENDING_LAUNCHES = new Set<string>()
/** 失败冷却截止时间（sessionKey → timestamp） */
export const CODEX_FAILED_COOLDOWNS = new Map<string, number>()

/** 供 daemon/session-dispatcher 列举 Codex 会话列表 */
export function getCodexSessionList(): Array<{
  sessionKey: string
  chatType: string
  startedAt: number
  lastActivityAt: number
  chatName?: string
  pid: number
  workspaceDir?: string
  senderOpenId?: string
}> {
  return [...CODEX_SESSIONS.values()].map((s) => ({
    sessionKey: s.sessionKey,
    chatType: s.chatType as string,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    chatName: resolveSessionChatName(s.sessionKey, s.chatName, s.senderOpenId),
    pid: 0,
    workspaceDir: s.workspaceDir,
    senderOpenId: s.senderOpenId,
  }))
}

/** 会话是否正在执行（含 launch 进行中） */
export function isCodexSessionRunning(sessionKey: string): boolean {
  return CODEX_PENDING_LAUNCHES.has(sessionKey) || !!CODEX_SESSIONS.get(sessionKey)?.pendingDispatch
}

/** 停止单条 Codex 会话：abort Turn、释放 runGuard、清理注册表 */
export function stopCodexSession(sessionKey: string): void {
  const s = CODEX_SESSIONS.get(sessionKey)
  if (!s) return
  s.abortController.abort()
  clearCodexStreamPostTimer(s)
  s.streamPostChain = Promise.resolve()
  s.activeThread = null
  if (s.runGuardToken) {
    completeRunGuard(sessionKey, s.runGuardToken)
    releaseRunGuard(sessionKey, s.runGuardToken)
    s.runGuardToken = undefined
  }
  s.pendingDispatch = false
  CODEX_SESSIONS.delete(sessionKey)
  CODEX_PENDING_LAUNCHES.delete(sessionKey)
  void reportSessionAgentPhase(sessionKey, "idle")
  broadcastCodexSessionStatus([...CODEX_SESSIONS.values()])
}

/** 停止全部 Codex 会话（应用退出 / Dashboard 一键停止） */
export function stopAllCodexSessions(): void {
  for (const key of [...CODEX_SESSIONS.keys()]) stopCodexSession(key)
  CODEX_FAILED_COOLDOWNS.clear()
  CODEX_PENDING_LAUNCHES.clear()
}
