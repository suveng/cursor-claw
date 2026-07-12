/**
 * Claude Code → Daemon 出站通知（从 agent-cc-stream 拆出，控制单文件行数）。
 */
import { readLockFile, httpPost } from "../../daemon/daemon-client"
import { pushUiLog } from "../../app/ui-logger"
import type { CcSessionAgent } from "./agent-cc-types"

/** stream-text API 请求体结构 */
export interface StreamTextPayload {
  session_key: string
  text: string
  stream_id?: string
  outbound_message_id?: string
  message_id?: string
  final?: boolean
}

/** 向 Daemon 发送普通文本通知（send-text，委托 shared run-notify） */
export { notifySessionChat } from "../shared/run-notify.js"

/** 向 Daemon 推送 PresentationEvent（presentation-event） */
export async function postPresentationEvent(
  session: CcSessionAgent,
  event: Omit<import("./agent-sdk").PresentationEvent, "session_key">,
  _resolveChannelType: (sessionKey: string) => string | undefined,
): Promise<void> {
  const lock = readLockFile()
  if (!lock?.port) return
  const payload = { session_key: session.sessionKey, ...event }
  if (event.kind === "tool" && event.tool_name && !event.outbound_message_id) {
    const id = session.toolPresentationOutboundIds?.get(event.tool_name)
    if (id) (payload as Record<string, unknown>).outbound_message_id = id
  }
  try {
    const res = (await httpPost(`http://127.0.0.1:${lock.port}/api/presentation-event`, payload, 5000)) as {
      ok?: boolean
      outbound_message_id?: string
      error?: string
    }
    if (res?.outbound_message_id && event.kind === "tool" && event.tool_name) {
      if (!session.toolPresentationOutboundIds) session.toolPresentationOutboundIds = new Map()
      session.toolPresentationOutboundIds.set(event.tool_name, res.outbound_message_id)
    }
  } catch (e: unknown) {
    pushUiLog("CC", "WARN", `[${session.sessionKey}] presentation-event 推送失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 向 Daemon 推送流式文本片段（stream-text） */
export async function postStreamText(session: CcSessionAgent, payload: StreamTextPayload): Promise<void> {
  const lock = readLockFile()
  if (!lock?.port) return
  try {
    const res = (await httpPost(`http://127.0.0.1:${lock.port}/api/stream-text`, payload, 5000)) as {
      ok?: boolean
      stream_id?: string
      outbound_message_id?: string
      deferred?: boolean
      error?: string
    }
    if (res?.stream_id) session.streamId = res.stream_id
    if (res?.deferred) {
      session.presentationDeferStream = true
      return
    }
    if (res?.outbound_message_id) session.outboundMessageId = res.outbound_message_id
  } catch (e: unknown) {
    pushUiLog("CC", "WARN", `[${session.sessionKey}] stream-text 推送失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}
