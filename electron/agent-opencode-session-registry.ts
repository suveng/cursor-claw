/**
 * OpenCode 会话注册表与 stop/list API（仿 agent-codex-session-registry）。
 */
import { reportSessionAgentPhase } from "./daemon-client"
import { resolveSessionChatName } from "./agent-launcher"
import { completeRunGuard, releaseRunGuard } from "./agent-run-guard"
import { clearOpencodeStreamPostTimer, broadcastOpencodeSessionStatus } from "./agent-opencode-stream"
import { closeAllEmbeddedOpencodeServers } from "./agent-opencode-utils"
import type { OpencodeSessionAgent } from "./agent-opencode-types"

export const OPENCODE_SESSIONS = new Map<string, OpencodeSessionAgent>()
export const OPENCODE_PENDING_LAUNCHES = new Set<string>()
export const OPENCODE_FAILED_COOLDOWNS = new Map<string, number>()

export function getOpencodeSessionList(): Array<{
  sessionKey: string
  chatType: string
  startedAt: number
  lastActivityAt: number
  chatName?: string
  pid: number
  workspaceDir?: string
  senderOpenId?: string
}> {
  return [...OPENCODE_SESSIONS.values()].map((s) => ({
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

export function isOpencodeSessionRunning(sessionKey: string): boolean {
  return OPENCODE_PENDING_LAUNCHES.has(sessionKey) || !!OPENCODE_SESSIONS.get(sessionKey)?.pendingDispatch
}

export function stopOpencodeSession(sessionKey: string): void {
  const s = OPENCODE_SESSIONS.get(sessionKey)
  if (!s) return
  s.abortController.abort()
  clearOpencodeStreamPostTimer(s)
  s.streamPostChain = Promise.resolve()
  s.activeClient = null
  s.eventLoopRunning = false
  if (s.runGuardToken) {
    completeRunGuard(sessionKey, s.runGuardToken)
    releaseRunGuard(sessionKey, s.runGuardToken)
    s.runGuardToken = undefined
  }
  s.pendingDispatch = false
  OPENCODE_SESSIONS.delete(sessionKey)
  OPENCODE_PENDING_LAUNCHES.delete(sessionKey)
  void reportSessionAgentPhase(sessionKey, "idle")
  broadcastOpencodeSessionStatus([...OPENCODE_SESSIONS.values()])
}

export function stopAllOpencodeSessions(): void {
  for (const key of [...OPENCODE_SESSIONS.keys()]) stopOpencodeSession(key)
  OPENCODE_FAILED_COOLDOWNS.clear()
  OPENCODE_PENDING_LAUNCHES.clear()
  closeAllEmbeddedOpencodeServers()
}
