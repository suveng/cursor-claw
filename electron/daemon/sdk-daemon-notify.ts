/**
 * SDK 路径 daemon 通知（避免与 session-dispatcher 循环 import）
 */
import { readLockFile, httpPost } from "./daemon-client"
import { broadcastLog } from "../app/ui-logger"

/** 经 daemon /api/send-text 下发 IM 通知 */
export async function notifySessionChat(sessionKey: string, text: string, stopProgress = false): Promise<void> {
  const lock = readLockFile()
  if (!lock?.port) return
  try {
    await httpPost(`http://127.0.0.1:${lock.port}/api/send-text`, {
      text, session_key: sessionKey, ...(stopProgress && { stop_progress: true }),
    }, 5000)
  } catch (e: unknown) {
    broadcastLog(`[SDK Notify] 发送通知失败 (${sessionKey}): ${e instanceof Error ? e.message : String(e)}`, "WARN")
  }
}
