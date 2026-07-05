/**
 * 飞书 assistant 出站：不做 CardKit 流式，Run 收尾一次性 send-text 并 reply 末条 inbound。
 */
import { readLockFile, httpPost } from "../../daemon/daemon-client"
import { pushUiLog } from "../../app/ui-logger"

/** 飞书 f41 会话：assistant 仅收尾 send-text，不走 stream-text */
export function isFeishuPlainAssistantReply(
  f41Stream: boolean,
  channelType: string | undefined,
): boolean {
  return f41Stream && channelType === "feishu"
}

/** Run 收尾：send-text + reply 末条 inbound + stop_progress */
export async function postFeishuPlainAssistantReply(
  sessionKey: string,
  text: string,
  inboundMessageIds: string[] | undefined,
  logTag: string,
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  const lock = readLockFile()
  if (!lock?.port) return
  const lastId = inboundMessageIds?.[inboundMessageIds.length - 1]
  try {
    await httpPost(`http://127.0.0.1:${lock.port}/api/send-text`, {
      session_key: sessionKey,
      text: trimmed,
      ...(lastId && { message_id: lastId }),
      stop_progress: true,
    }, 5000)
  } catch (e: unknown) {
    pushUiLog(
      logTag,
      "WARN",
      `[${sessionKey}] 飞书 send-text 失败: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/**
 * 飞书 plain 模式 flush：non-final 直接跳过；final 附加 footer 后 send-text。
 * @returns true 表示飞书 plain 已处理，调用方应 return
 */
export async function flushFeishuPlainAssistantIfNeeded(
  f41Stream: boolean,
  channelType: string | undefined,
  final: boolean,
  sessionKey: string,
  streamBuffer: string,
  inboundMessageIds: string[] | undefined,
  logTag: string,
  appendFooter?: (text: string) => string,
): Promise<boolean> {
  if (!isFeishuPlainAssistantReply(f41Stream, channelType)) return false
  if (!final) return true
  const text = appendFooter ? appendFooter(streamBuffer) : streamBuffer
  await postFeishuPlainAssistantReply(sessionKey, text, inboundMessageIds, logTag)
  return true
}
