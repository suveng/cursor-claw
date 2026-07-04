/**
 * SDK tool_call / task 事件去重：防 tool_call+task 双路径与 SDK 重复 tool_call 刷屏。
 */
import {
  stringifyToolPayload,
  TOOL_MILESTONE_TEXT_MAX,
} from "../../../src/shared/tool-presentation.js"
import type { SdkSessionAgent } from "./sdk-session-types"

/** 里程碑文案截断（与 shared/tool-presentation truncateText 口径一致） */
function truncateMilestoneText(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)} …(+${compact.length - max} chars)`
}

/** SDK task 事件 status/text → 用户可见里程碑文案；taskSeq 用于无 text 时区分步骤 */
export function mapTaskMilestoneText(status?: string, text?: string, taskSeq?: number): string {
  const normalized = (status ?? "").toLowerCase()
  const trimmed = (text ?? "").trim()
  if (!normalized || normalized === "started") {
    if (trimmed) {
      return `task开始：${truncateMilestoneText(trimmed, TOOL_MILESTONE_TEXT_MAX)}`
    }
    if (taskSeq != null) return `子任务 #${taskSeq} 已开始`
    return "子任务已开始"
  }
  if (normalized === "completed") {
    return trimmed ? `task完成：${truncateMilestoneText(trimmed, TOOL_MILESTONE_TEXT_MAX)}` : "task完成"
  }
  if (normalized === "failed") {
    return trimmed
      ? `task失败：${truncateMilestoneText(trimmed, TOOL_MILESTONE_TEXT_MAX)}`
      : "task失败"
  }
  return trimmed || `子任务更新（${status}）`
}

/** tool_call running 去重键（name + args 摘要） */
export function buildToolCallRunningDedupKey(name: string, args?: unknown): string {
  return `${name}:running:${stringifyToolPayload(args) ?? ""}`
}

/** 相邻同参 tool_call running 是否重复（命中则跳过日志与 IM 出站） */
export function isDuplicateToolCallRunning(
  session: SdkSessionAgent,
  name: string,
  args?: unknown,
): boolean {
  const key = buildToolCallRunningDedupKey(name, args)
  if (session.lastToolCallRunningDedupKey === key) return true
  session.lastToolCallRunningDedupKey = key
  return false
}

/** tool_call 非 running 时清 running 去重键，允许下一轮 started */
export function clearToolCallRunningDedup(session: SdkSessionAgent): void {
  session.lastToolCallRunningDedupKey = undefined
}

/**
 * task 里程碑事件是否与刚处理的 task tool_call 语义重复。
 * tool_call notify 已出站时，等价 task 事件不再日志/飞书二次推送。
 */
export function isRedundantTaskEventAfterToolCall(
  session: SdkSessionAgent,
  taskStatus?: string,
): boolean {
  const lt = session.lastTool
  if (!lt || lt.name !== "task") return false
  const norm = (taskStatus ?? "").toLowerCase()
  if (!norm || norm === "started") return lt.status === "running"
  if (norm === "completed") return lt.status === "completed"
  if (norm === "failed" || norm === "error") return lt.status === "error"
  return false
}
