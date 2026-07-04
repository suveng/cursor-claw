/**
 * SDK 异步链 fire-and-forget 守卫：消化 rejection，禁止冒泡 unhandledRejection。
 */
import { formatUnknownError } from "../../../src/shared/format-unknown-error.js"
import { pushUiLog } from "../../app/ui-logger"

/** 网络/超时类 rejection 探测（ConnectError、ETIMEDOUT、gRPC UNAVAILABLE） */
export function isSdkNetworkOrTimeoutError(err: unknown): boolean {
  if (err instanceof Error && err.name === "ConnectError") return true
  const text = formatUnknownError(err).toLowerCase()
  return /etimedout|econnreset|econnrefused|enotfound|network|unavailable|timeout|deadline_exceeded/.test(text)
}

/** SDK Run 异步链 rejection 统一记 UI 日志 */
export function logSdkRunChainError(
  sessionKey: string,
  phase: string,
  err: unknown,
  level: "ERROR" | "WARN" = "ERROR",
): void {
  const detail = formatUnknownError(err)
  pushUiLog("SDK", level, `[${sessionKey}] SDK 异步链异常 (${phase}): ${detail}`)
}

/**
 * fire-and-forget Promise 包装：catch 内记日志，禁止 rejection 冒泡。
 * @param level WARN 用于 watchdog 等非致命链；ERROR 用于流收尾/notify 等
 */
export function guardSdkPromise(
  promise: Promise<unknown>,
  sessionKey: string,
  phase: string,
  level: "ERROR" | "WARN" = "WARN",
): void {
  promise.catch((err: unknown) => {
    const detail = formatUnknownError(err)
    pushUiLog("SDK", level, `[${sessionKey}] SDK 异步链异常 (${phase}): ${detail}`)
  })
}
