import * as fs from "node:fs"
import * as path from "node:path"
import { app } from "electron"
import { pushUiLog } from "./ui-logger"

/** 活跃 Run 磁盘快照：供主进程重启后 recoverSdkActiveRuns 续接 */
export interface SdkActiveRunRecord {
  sessionKey: string
  agentId: string
  runId: string
  /** 与通道资源一致；文件权限随 userData */
  apiKey: string
  workspaceDir: string
  chatType: string
  runStartedAt: number
  /** 呈现续接：stream-text 游标 */
  streamId?: string
  outboundMessageId?: string
  inboundMessageIds?: string[]
  /** 用户主动停止后不再续接 */
  userStopped?: boolean
  /** 最后一次持久化时间 */
  updatedAt: number
}

const ACTIVE_RUNS_FILE = "sdk-active-runs.json"

/** userData 下活跃 Run 快照路径（与 agent-api-port.json 同级） */
function resolveActiveRunsPath(): string {
  return path.join(app.getPath("userData"), ACTIVE_RUNS_FILE)
}

/** 校验单条记录必填字段，读盘容错用 */
function isValidRecord(value: unknown): value is SdkActiveRunRecord {
  if (typeof value !== "object" || value === null) return false
  const r = value as SdkActiveRunRecord
  return (
    typeof r.sessionKey === "string" &&
    typeof r.agentId === "string" &&
    typeof r.runId === "string" &&
    typeof r.apiKey === "string" &&
    typeof r.workspaceDir === "string" &&
    typeof r.chatType === "string" &&
    typeof r.runStartedAt === "number" &&
    typeof r.updatedAt === "number"
  )
}

/** 读全量快照；缺失或损坏时返回空对象，不抛错 */
function readAllRecords(): Record<string, SdkActiveRunRecord> {
  try {
    const file = resolveActiveRunsPath()
    if (!fs.existsSync(file)) return {}
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, SdkActiveRunRecord> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isValidRecord(value) && value.sessionKey === key) {
        result[key] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

/** 写全量快照；失败仅 WARN，不阻断调用方 */
function writeAllRecords(records: Record<string, SdkActiveRunRecord>): void {
  try {
    const file = resolveActiveRunsPath()
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(records, null, 2), "utf-8")
  } catch (e: unknown) {
    pushUiLog(
      "SDK",
      "WARN",
      `sdk-active-runs 写入失败: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/** Run 启动/进度时 upsert；同 sessionKey 仅保留最新一条 */
export function persistActiveSdkRun(record: SdkActiveRunRecord): void {
  const records = readAllRecords()
  const key = record.sessionKey
  records[key] = { ...record, updatedAt: Date.now() }
  writeAllRecords(records)
}

/** 终态收尾时清除活跃记录 */
export function clearActiveSdkRun(sessionKey: string): void {
  const records = readAllRecords()
  if (!(sessionKey in records)) return
  delete records[sessionKey]
  writeAllRecords(records)
}

/** 启动恢复清单：排除 userStopped 记录 */
export function listRecoverableSdkRuns(): SdkActiveRunRecord[] {
  return Object.values(readAllRecords()).filter((r) => r.userStopped !== true)
}

/** 用户主动停止：标记后重启不再续接 */
export function markSdkRunUserStopped(sessionKey: string): void {
  const records = readAllRecords()
  const existing = records[sessionKey]
  if (!existing) return
  records[sessionKey] = { ...existing, userStopped: true, updatedAt: Date.now() }
  writeAllRecords(records)
}
