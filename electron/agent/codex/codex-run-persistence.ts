/**
 * Codex 活跃 Run 磁盘快照（userData/codex-active-runs.json）
 */
import * as path from "node:path"
import { app } from "electron"
import {
  clearActiveRunRecord,
  listRecoverableActiveRuns,
  markActiveRunUserStopped,
  upsertActiveRunRecord,
} from "../shared/active-run-store"

const ACTIVE_RUNS_FILE = "codex-active-runs.json"

/** Codex 活跃 Run 快照 */
export interface CodexActiveRunRecord {
  sessionKey: string
  engine: "codex"
  apiKey: string
  workspaceDir: string
  chatType: string
  runStartedAt: number
  streamId?: string
  outboundMessageId?: string
  inboundMessageIds?: string[]
  userStopped?: boolean
  updatedAt: number
  codexSessionId?: string | null
  model?: string
  baseUrl?: string
  lastTaskMessage?: string
}

function resolveCodexActiveRunsPath(): string {
  return path.join(app.getPath("userData"), ACTIVE_RUNS_FILE)
}

function isValidCodexRecord(value: unknown): value is CodexActiveRunRecord {
  if (typeof value !== "object" || value === null) return false
  const r = value as CodexActiveRunRecord
  return (
    r.engine === "codex" &&
    typeof r.sessionKey === "string" &&
    typeof r.apiKey === "string" &&
    typeof r.workspaceDir === "string" &&
    typeof r.chatType === "string" &&
    typeof r.runStartedAt === "number" &&
    typeof r.updatedAt === "number"
  )
}

export function persistCodexActiveRun(record: CodexActiveRunRecord): void {
  upsertActiveRunRecord(resolveCodexActiveRunsPath(), { ...record, updatedAt: Date.now() })
}

export function clearCodexActiveRun(sessionKey: string): void {
  clearActiveRunRecord(resolveCodexActiveRunsPath(), sessionKey)
}

export function listRecoverableCodexRuns(): CodexActiveRunRecord[] {
  return listRecoverableActiveRuns(resolveCodexActiveRunsPath(), isValidCodexRecord)
}

export function markCodexRunUserStopped(sessionKey: string): void {
  markActiveRunUserStopped(resolveCodexActiveRunsPath(), sessionKey, isValidCodexRecord)
}
