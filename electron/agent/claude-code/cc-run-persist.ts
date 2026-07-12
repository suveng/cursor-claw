/**
 * CC 活跃 Run 快照写盘挂接（呈现游标 3s 节流，对称 sdk-run-persist）
 */
import { persistCcActiveRun, type CcActiveRunRecord } from "./cc-run-persistence"
import type { CcSessionAgent } from "./agent-cc-types"

const PERSIST_PRESENTATION_THROTTLE_MS = 3_000
const lastPersistAtBySession = new Map<string, number>()

function buildCcActiveRunRecord(session: CcSessionAgent): CcActiveRunRecord {
  return {
    sessionKey: session.sessionKey,
    engine: "claude-code",
    apiKey: session.apiKey,
    workspaceDir: session.workspaceDir ?? process.cwd(),
    chatType: session.chatType,
    runStartedAt: session.runStartedAt ?? Date.now(),
    streamId: session.streamId,
    outboundMessageId: session.outboundMessageId,
    inboundMessageIds: session.inboundMessageIds,
    ccSessionId: session.ccSessionId,
    model: session.model,
    baseUrl: session.baseUrl,
    lastTaskMessage: session.lastTaskMessage,
    updatedAt: Date.now(),
  }
}

export function clearCcPersistThrottle(sessionKey: string): void {
  lastPersistAtBySession.delete(sessionKey)
}

/** Run 启动/呈现游标变化时 upsert；写入失败不阻断（cc-run-persistence WARN） */
export function persistCcActiveRunSnapshot(session: CcSessionAgent, force = false): void {
  const key = session.sessionKey
  const now = Date.now()
  if (!force) {
    const last = lastPersistAtBySession.get(key) ?? 0
    if (now - last < PERSIST_PRESENTATION_THROTTLE_MS) return
  }
  lastPersistAtBySession.set(key, now)
  persistCcActiveRun(buildCcActiveRunRecord(session))
}
