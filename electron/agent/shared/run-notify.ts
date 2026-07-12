/**
 * 四引擎终态 IM 唯一出站（POST daemon /api/send-text）
 * 仅依赖 daemon-client，禁止 import session-dispatcher（防循环 import）
 */
import { readLockFile, httpPost } from "../../daemon/daemon-client"
import { broadcastLog } from "../../app/ui-logger"

export interface NotifySessionChatOptions {
  stop_progress?: boolean
  chat_type?: string
}

/** 解析第三参：兼容历史 boolean stopProgress 与 opts 对象 */
function resolveNotifyOpts(
  opts?: NotifySessionChatOptions | boolean,
): NotifySessionChatOptions | undefined {
  if (typeof opts === "boolean") return { stop_progress: opts }
  return opts
}

/**
 * 四引擎终态飞书 IM 唯一出站；幂等由调用方 errorNotified 闩保证
 */
export async function notifySessionChat(
  sessionKey: string,
  text: string,
  opts?: NotifySessionChatOptions | boolean,
): Promise<void> {
  const resolved = resolveNotifyOpts(opts)
  const lock = readLockFile()
  if (!lock?.port) return
  try {
    await httpPost(`http://127.0.0.1:${lock.port}/api/send-text`, {
      text,
      session_key: sessionKey,
      ...(resolved?.stop_progress && { stop_progress: true }),
      ...(resolved?.chat_type && { chat_type: resolved.chat_type }),
    }, 5000)
  } catch (e: unknown) {
    broadcastLog(
      `[Run Notify] 发送通知失败 (${sessionKey}): ${e instanceof Error ? e.message : String(e)}`,
      "WARN",
    )
  }
}

/**
 * 用户取消等无 IM 文案场景：仅停会话进度（typing），不发正文。
 * Daemon `/api/send-text` 允许 empty text + stop_progress。
 */
export function stopSessionChatProgress(sessionKey: string): void {
  const lock = readLockFile()
  if (!lock?.port) return
  void httpPost(
    `http://127.0.0.1:${lock.port}/api/send-text`,
    { session_key: sessionKey, stop_progress: true },
    5000,
  ).catch((e: unknown) => {
    broadcastLog(
      `[Run Notify] 停进度失败 (${sessionKey}): ${e instanceof Error ? e.message : String(e)}`,
      "WARN",
    )
  })
}
