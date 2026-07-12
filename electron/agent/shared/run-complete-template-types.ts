/**
 * completeRunFromTemplate 入参类型（拆文件控制行数）
 */
import type { RunFailureReason } from "./run-lifecycle-types.js"

export interface CompleteRunContext {
  assistantText?: string
  failure?: { reason: RunFailureReason; detail?: string }
  source: "success" | "failure" | "cancelled" | "watchdog"
  /** 引擎预组装失败 IM；有值时跳过 formatter 默认句 */
  failureText?: string
}
