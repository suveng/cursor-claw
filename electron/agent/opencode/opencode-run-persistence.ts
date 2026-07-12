/**
 * OpenCode 活跃 Run 磁盘快照（userData/opencode-active-runs.json）
 */
import * as path from "node:path"
import { app } from "electron"
import {
  clearActiveRunRecord,
  listRecoverableActiveRuns,
  markActiveRunUserStopped,
  upsertActiveRunRecord,
} from "../shared/active-run-store"

const ACTIVE_RUNS_FILE = "opencode-active-runs.json"

/** OpenCode 活跃 Run 快照 */
export interface OpencodeActiveRunRecord {
  sessionKey: string
  engine: "opencode"
  apiKey: string
  workspaceDir: string
  chatType: string
  runStartedAt: number
  streamId?: string
  outboundMessageId?: string
  inboundMessageIds?: string[]
  userStopped?: boolean
  updatedAt: number
  opencodeSessionId?: string | null
  providerId: string
  model?: string
  deployMode: "embedded" | "external"
  opencodeHostname?: string
  opencodePort?: number
  profileResourceId?: string
  lastTaskMessage?: string
}

function resolveOpencodeActiveRunsPath(): string {
  return path.join(app.getPath("userData"), ACTIVE_RUNS_FILE)
}

function isValidOpencodeRecord(value: unknown): value is OpencodeActiveRunRecord {
  if (typeof value !== "object" || value === null) return false
  const r = value as OpencodeActiveRunRecord
  return (
    r.engine === "opencode" &&
    typeof r.sessionKey === "string" &&
    typeof r.apiKey === "string" &&
    typeof r.workspaceDir === "string" &&
    typeof r.chatType === "string" &&
    typeof r.runStartedAt === "number" &&
    typeof r.providerId === "string" &&
    (r.deployMode === "embedded" || r.deployMode === "external") &&
    typeof r.updatedAt === "number"
  )
}

export function persistOpencodeActiveRun(record: OpencodeActiveRunRecord): void {
  upsertActiveRunRecord(resolveOpencodeActiveRunsPath(), { ...record, updatedAt: Date.now() })
}

export function clearOpencodeActiveRun(sessionKey: string): void {
  clearActiveRunRecord(resolveOpencodeActiveRunsPath(), sessionKey)
}

export function listRecoverableOpencodeRuns(): OpencodeActiveRunRecord[] {
  return listRecoverableActiveRuns(resolveOpencodeActiveRunsPath(), isValidOpencodeRecord)
}

export function markOpencodeRunUserStopped(sessionKey: string): void {
  markActiveRunUserStopped(resolveOpencodeActiveRunsPath(), sessionKey, isValidOpencodeRecord)
}
