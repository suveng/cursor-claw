/**
 * 活跃 Run 快照泛型 JSON 读写（对称 Cursor sdk-run-persistence 容错语义）
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { pushUiLog } from "../../app/ui-logger"

/** 各引擎 ActiveRunRecord 公共超集字段 */
export interface ActiveRunBase {
  sessionKey: string
  userStopped?: boolean
  updatedAt: number
}

/** 读盘原始 JSON；缺失或损坏返回空对象 */
function readRawJson(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {}
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 宽松校验：upsert/clear/mark 保留同文件其他引擎记录时过滤损坏项 */
function isLooseActiveRun(value: unknown): value is ActiveRunBase {
  if (typeof value !== "object" || value === null) return false
  const r = value as ActiveRunBase
  return typeof r.sessionKey === "string" && typeof r.updatedAt === "number"
}

/** 写全量快照；失败仅 WARN，不抛错 */
function writeAllRecords(filePath: string, records: Record<string, unknown>): void {
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf-8")
  } catch (e: unknown) {
    const name = path.basename(filePath)
    pushUiLog("Agent", "WARN", `${name} 写入失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 读全量快照；调用方传入 per-engine 校验函数 */
export function readActiveRunRecords<T extends ActiveRunBase>(
  filePath: string,
  isValid: (v: unknown) => v is T,
): Record<string, T> {
  const raw = readRawJson(filePath)
  const result: Record<string, T> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (isValid(value) && value.sessionKey === key) {
      result[key] = value
    }
  }
  return result
}

/** upsert 单条记录；同 sessionKey 仅保留最新一条 */
export function upsertActiveRunRecord<T extends ActiveRunBase>(filePath: string, record: T): void {
  const raw = readRawJson(filePath)
  const records: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (isLooseActiveRun(value) && value.sessionKey === key) records[key] = value
  }
  records[record.sessionKey] = { ...record, updatedAt: Date.now() }
  writeAllRecords(filePath, records)
}

/** 终态或 recover 失败后清除活跃记录 */
export function clearActiveRunRecord(filePath: string, sessionKey: string): void {
  const raw = readRawJson(filePath)
  if (!(sessionKey in raw)) return
  const records: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === sessionKey) continue
    if (isLooseActiveRun(value) && value.sessionKey === key) records[key] = value
  }
  writeAllRecords(filePath, records)
}

/** 启动恢复清单：排除 userStopped 记录 */
export function listRecoverableActiveRuns<T extends ActiveRunBase>(
  filePath: string,
  isValid: (v: unknown) => v is T,
): T[] {
  return Object.values(readActiveRunRecords(filePath, isValid)).filter((r) => r.userStopped !== true)
}

/** 用户主动停止：标记后重启不再续接 */
export function markActiveRunUserStopped<T extends ActiveRunBase>(
  filePath: string,
  sessionKey: string,
  isValid: (v: unknown) => v is T,
): void {
  const records = readActiveRunRecords(filePath, isValid)
  const existing = records[sessionKey]
  if (!existing) return
  records[sessionKey] = { ...existing, userStopped: true, updatedAt: Date.now() }
  writeAllRecords(filePath, records as Record<string, unknown>)
}
