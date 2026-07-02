/**
 * 活跃 Run 快照写盘挂接（拆分自 agent-sdk.ts，避免 presentation/lifecycle 循环依赖）
 */
import type { Run } from "@cursor/sdk"
import { persistActiveSdkRun, type SdkActiveRunRecord } from "./sdk-run-persistence"
import type { SdkSessionAgent } from "./sdk-session-types"

/** 呈现游标变更写盘节流，避免每 delta 刷盘 */
const PERSIST_PRESENTATION_THROTTLE_MS = 3_000
/** 各 session 上次活跃 Run 快照写入时刻（内存节流） */
const lastPersistAtBySession = new Map<string, number>()

function buildActiveRunRecord(session: SdkSessionAgent, run: Run): SdkActiveRunRecord {
  return {
    sessionKey: session.sessionKey,
    agentId: session.agentId,
    runId: run.id,
    apiKey: session.apiKey ?? "",
    workspaceDir: session.workspaceDir ?? process.cwd(),
    chatType: session.chatType,
    runStartedAt: session.runStartedAt ?? Date.now(),
    streamId: session.streamId,
    outboundMessageId: session.outboundMessageId,
    inboundMessageIds: session.inboundMessageIds,
    updatedAt: Date.now(),
  }
}

export function clearPersistThrottle(sessionKey: string): void {
  lastPersistAtBySession.delete(sessionKey)
}

/** Run 启动/呈现游标变化时 upsert；写入失败不阻断（sdk-run-persistence WARN） */
export function persistActiveRunSnapshot(session: SdkSessionAgent, run: Run, force = false): void {
  const key = session.sessionKey
  const now = Date.now()
  if (!force) {
    const last = lastPersistAtBySession.get(key) ?? 0
    if (now - last < PERSIST_PRESENTATION_THROTTLE_MS) return
  }
  lastPersistAtBySession.set(key, now)
  persistActiveSdkRun(buildActiveRunRecord(session, run))
}
