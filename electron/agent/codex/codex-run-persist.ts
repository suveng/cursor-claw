/**
 * Codex 活跃 Run 快照写盘挂接（3s 节流）
 */
import { persistCodexActiveRun, type CodexActiveRunRecord } from "./codex-run-persistence"
import type { CodexSessionAgent } from "./agent-codex-types"

const PERSIST_PRESENTATION_THROTTLE_MS = 3_000
const lastPersistAtBySession = new Map<string, number>()

function buildCodexActiveRunRecord(session: CodexSessionAgent): CodexActiveRunRecord {
  return {
    sessionKey: session.sessionKey,
    engine: "codex",
    apiKey: session.apiKey,
    workspaceDir: session.workspaceDir ?? process.cwd(),
    chatType: session.chatType,
    runStartedAt: session.runStartedAt ?? Date.now(),
    streamId: session.streamId,
    outboundMessageId: session.outboundMessageId,
    inboundMessageIds: session.inboundMessageIds,
    codexSessionId: session.codexSessionId,
    model: session.model,
    baseUrl: session.baseUrl,
    lastTaskMessage: session.lastTaskMessage,
    updatedAt: Date.now(),
  }
}

export function clearCodexPersistThrottle(sessionKey: string): void {
  lastPersistAtBySession.delete(sessionKey)
}

export function persistCodexActiveRunSnapshot(session: CodexSessionAgent, force = false): void {
  const key = session.sessionKey
  const now = Date.now()
  if (!force) {
    const last = lastPersistAtBySession.get(key) ?? 0
    if (now - last < PERSIST_PRESENTATION_THROTTLE_MS) return
  }
  lastPersistAtBySession.set(key, now)
  persistCodexActiveRun(buildCodexActiveRunRecord(session))
}
