/**
 * Claude Code 活跃 Run 磁盘快照（userData/cc-active-runs.json）
 */
import * as path from "node:path"
import { app } from "electron"
import {
  clearActiveRunRecord,
  listRecoverableActiveRuns,
  markActiveRunUserStopped,
  upsertActiveRunRecord,
} from "../shared/active-run-store"

const ACTIVE_RUNS_FILE = "cc-active-runs.json"

/** CC 活跃 Run 快照：供 recoverCcActiveRuns 续接 */
export interface CcActiveRunRecord {
  sessionKey: string
  engine: "claude-code"
  apiKey: string
  workspaceDir: string
  chatType: string
  runStartedAt: number
  streamId?: string
  outboundMessageId?: string
  inboundMessageIds?: string[]
  userStopped?: boolean
  updatedAt: number
  ccSessionId?: string | null
  model?: string
  baseUrl?: string
  /** 最后一次用户 prompt，供 recover 重发 */
  lastTaskMessage?: string
}

function resolveCcActiveRunsPath(): string {
  return path.join(app.getPath("userData"), ACTIVE_RUNS_FILE)
}

/** 校验单条 CC 记录必填字段 */
function isValidCcRecord(value: unknown): value is CcActiveRunRecord {
  if (typeof value !== "object" || value === null) return false
  const r = value as CcActiveRunRecord
  return (
    r.engine === "claude-code" &&
    typeof r.sessionKey === "string" &&
    typeof r.apiKey === "string" &&
    typeof r.workspaceDir === "string" &&
    typeof r.chatType === "string" &&
    typeof r.runStartedAt === "number" &&
    typeof r.updatedAt === "number"
  )
}

/** Run 启动/进度时 upsert */
export function persistCcActiveRun(record: CcActiveRunRecord): void {
  upsertActiveRunRecord(resolveCcActiveRunsPath(), { ...record, updatedAt: Date.now() })
}

/** 终态或 recover 失败后清除 */
export function clearCcActiveRun(sessionKey: string): void {
  clearActiveRunRecord(resolveCcActiveRunsPath(), sessionKey)
}

/** 启动恢复清单 */
export function listRecoverableCcRuns(): CcActiveRunRecord[] {
  return listRecoverableActiveRuns(resolveCcActiveRunsPath(), isValidCcRecord)
}

/** 用户主动停止后不再续接 */
export function markCcRunUserStopped(sessionKey: string): void {
  markActiveRunUserStopped(resolveCcActiveRunsPath(), sessionKey, isValidCcRecord)
}
