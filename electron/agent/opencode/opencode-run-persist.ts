/**
 * OpenCode 活跃 Run 快照写盘挂接（3s 节流）
 */
import { persistOpencodeActiveRun, type OpencodeActiveRunRecord } from "./opencode-run-persistence"
import type { OpencodeSessionAgent } from "./agent-opencode-types"

const PERSIST_PRESENTATION_THROTTLE_MS = 3_000
const lastPersistAtBySession = new Map<string, number>()

function buildOpencodeActiveRunRecord(session: OpencodeSessionAgent): OpencodeActiveRunRecord {
  return {
    sessionKey: session.sessionKey,
    engine: "opencode",
    apiKey: session.apiKey,
    workspaceDir: session.workspaceDir ?? process.cwd(),
    chatType: session.chatType,
    runStartedAt: session.runStartedAt ?? Date.now(),
    streamId: session.streamId,
    outboundMessageId: session.outboundMessageId,
    inboundMessageIds: session.inboundMessageIds,
    opencodeSessionId: session.opencodeSessionId,
    providerId: session.providerId,
    model: session.model,
    deployMode: session.deployMode,
    opencodeHostname: session.opencodeHostname,
    opencodePort: session.opencodePort,
    profileResourceId: session.profileResourceId,
    lastTaskMessage: session.lastTaskMessage,
    updatedAt: Date.now(),
  }
}

export function clearOpencodePersistThrottle(sessionKey: string): void {
  lastPersistAtBySession.delete(sessionKey)
}

export function persistOpencodeActiveRunSnapshot(session: OpencodeSessionAgent, force = false): void {
  const key = session.sessionKey
  const now = Date.now()
  if (!force) {
    const last = lastPersistAtBySession.get(key) ?? 0
    if (now - last < PERSIST_PRESENTATION_THROTTLE_MS) return
  }
  lastPersistAtBySession.set(key, now)
  persistOpencodeActiveRun(buildOpencodeActiveRunRecord(session))
}
