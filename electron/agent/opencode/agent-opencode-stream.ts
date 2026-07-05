/**
 * OpenCode 流式推送与 presentation 出站（仿 agent-codex-stream）。
 */
import { readLockFile, httpPost } from "../../daemon/daemon-client"
import { isFeishuProcessPresentationSuppressed as feishuSuppressesProcessKind } from "../../../src/shared/feishu-presentation-gate"
import { pushUiLog, broadcastSessionStatus } from "../../app/ui-logger"
import { appendContextFooter, formatContextFooter, resolveDisplayContextTokens, resetContextUsagePeak } from "../cursor-sdk/context-usage"
import { resolveSessionChatName } from "../shared/agent-launcher"
import {
  isFeishuPlainAssistantReply,
  flushFeishuPlainAssistantIfNeeded,
} from "../shared/feishu-plain-assistant-reply"
import { maybeRotateContext } from "../cursor-sdk/context-rotation-lite"
import type { OpencodeSessionAgent } from "./agent-opencode-types"
import { resolveSessionChannelType } from "./agent-opencode-utils"

const LOG_FLUSH_LEN = 400
const STREAM_POST_INTERVAL_MS = 400

export interface StreamTextPayload {
  session_key: string
  text: string
  stream_id?: string
  outbound_message_id?: string
  message_id?: string
  final?: boolean
}

export function initOpencodeStreamState(session: OpencodeSessionAgent): void {
  session.streamBuffer = ""
  session.streamId = undefined
  session.outboundMessageId = undefined
  session.streamLastPostAt = undefined
  session.streamPostChain = undefined
  clearOpencodeStreamPostTimer(session)
}

export function resetOpencodeStreamState(session: OpencodeSessionAgent): void {
  initOpencodeStreamState(session)
  session.logAgg = { kind: null, buf: "" }
  session.thinkingOpen = false
  session.seenProcessEvent = false
  session.presentationDeferStream = false
}

export function flushOpencodeLog(session: OpencodeSessionAgent): void {
  const agg = session.logAgg
  const text = agg.buf.trim()
  if (agg.kind && text) {
    const level = agg.kind === "thinking" ? "DEBUG" : "INFO"
    const prefix = agg.kind === "thinking" ? "[thinking] " : ""
    pushUiLog("OpenCode", level, `[${session.sessionKey}] ${prefix}${text}`)
  }
  agg.kind = null
  agg.buf = ""
}

export function appendOpencodeLog(session: OpencodeSessionAgent, kind: "thinking" | "text", delta: string): void {
  const agg = session.logAgg
  if (agg.kind && agg.kind !== kind) flushOpencodeLog(session)
  agg.kind = kind
  agg.buf += delta
  if (agg.buf.length >= LOG_FLUSH_LEN) flushOpencodeLog(session)
}

export async function notifyOpencodeSessionChat(sessionKey: string, text: string, stopProgress = false): Promise<void> {
  const lock = readLockFile()
  if (!lock?.port) return
  try {
    await httpPost(`http://127.0.0.1:${lock.port}/api/send-text`, {
      text, session_key: sessionKey, ...(stopProgress && { stop_progress: true }),
    }, 5000)
  } catch (e: unknown) {
    pushUiLog("OpenCode", "WARN", `[${sessionKey}] notify 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function postOpencodePresentationEvent(
  session: OpencodeSessionAgent,
  event: Omit<import("./agent-sdk").PresentationEvent, "session_key">,
  resolveChannelType: (sessionKey: string) => string | undefined,
): Promise<void> {
  if (feishuSuppressesProcessKind(resolveChannelType(session.sessionKey), event.kind)) return
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
    }
    if (res?.outbound_message_id && event.kind === "tool" && event.tool_name) {
      if (!session.toolPresentationOutboundIds) session.toolPresentationOutboundIds = new Map()
      session.toolPresentationOutboundIds.set(event.tool_name, res.outbound_message_id)
    }
  } catch (e: unknown) {
    pushUiLog("OpenCode", "WARN", `[${session.sessionKey}] presentation-event 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function postOpencodeStreamText(session: OpencodeSessionAgent, payload: StreamTextPayload): Promise<void> {
  const lock = readLockFile()
  if (!lock?.port) return
  try {
    const res = (await httpPost(`http://127.0.0.1:${lock.port}/api/stream-text`, payload, 5000)) as {
      stream_id?: string
      outbound_message_id?: string
      deferred?: boolean
    }
    if (res?.stream_id) session.streamId = res.stream_id
    if (res?.deferred) { session.presentationDeferStream = true; return }
    if (res?.outbound_message_id) session.outboundMessageId = res.outbound_message_id
  } catch (e: unknown) {
    pushUiLog("OpenCode", "WARN", `[${session.sessionKey}] stream-text 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function clearOpencodeStreamPostTimer(session: OpencodeSessionAgent): void {
  if (session.streamPostTimer) {
    clearTimeout(session.streamPostTimer)
    session.streamPostTimer = undefined
  }
}

async function doFlushOpencodeStreamPost(session: OpencodeSessionAgent, final: boolean): Promise<void> {
  clearOpencodeStreamPostTimer(session)
  if (!session.f41Stream) return
  const channelType = resolveSessionChannelType(session.sessionKey)
  if (await flushFeishuPlainAssistantIfNeeded(
    session.f41Stream,
    channelType,
    final,
    session.sessionKey,
    session.streamBuffer,
    session.inboundMessageIds,
    "OpenCode",
    final
      ? (t) => {
          const footer = formatContextFooter(
            session.contextUsage,
            session.contextLimitTokens ?? null,
            session.contextUsagePeakTokens,
            session.contextUsageFromRunTotal,
          )
          return footer ? appendContextFooter(t, footer) : t
        }
      : undefined,
  )) {
    if (final) session.streamLastPostAt = Date.now()
    return
  }
  if (final) {
    const footer = formatContextFooter(
      session.contextUsage,
      session.contextLimitTokens ?? null,
      session.contextUsagePeakTokens,
      session.contextUsageFromRunTotal,
    )
    if (footer) session.streamBuffer = appendContextFooter(session.streamBuffer, footer)
  }
  const text = session.streamBuffer
  if (!text.trim() && !final) return
  const payload: StreamTextPayload = { session_key: session.sessionKey, text }
  if (session.streamId) payload.stream_id = session.streamId
  if (session.outboundMessageId) payload.outbound_message_id = session.outboundMessageId
  if (final) {
    payload.final = true
    const ids = session.inboundMessageIds
    const lastId = ids?.[ids.length - 1]
    if (lastId) payload.message_id = lastId
  }
  await postOpencodeStreamText(session, payload)
  session.streamLastPostAt = Date.now()
}

export function flushOpencodeStreamPost(session: OpencodeSessionAgent, final: boolean): Promise<void> {
  session.streamPostChain = (session.streamPostChain ?? Promise.resolve())
    .then(() => doFlushOpencodeStreamPost(session, final))
    .catch((e: unknown) => {
      pushUiLog("OpenCode", "WARN", `[${session.sessionKey}] stream chain 错误: ${e instanceof Error ? e.message : String(e)}`)
    })
  return session.streamPostChain
}

export function scheduleOpencodeStreamPost(session: OpencodeSessionAgent, final: boolean): void {
  if (!session.f41Stream) return
  if (final) { void flushOpencodeStreamPost(session, true); return }
  const now = Date.now()
  const elapsed = session.streamLastPostAt != null ? now - session.streamLastPostAt : STREAM_POST_INTERVAL_MS
  if (elapsed >= STREAM_POST_INTERVAL_MS) { void flushOpencodeStreamPost(session, false); return }
  if (session.streamPostTimer) return
  session.streamPostTimer = setTimeout(() => {
    session.streamPostTimer = undefined
    void flushOpencodeStreamPost(session, false)
  }, STREAM_POST_INTERVAL_MS - elapsed)
}

export function appendOpencodeStreamDelta(session: OpencodeSessionAgent, delta: string): void {
  session.streamBuffer += delta
  if (isFeishuPlainAssistantReply(session.f41Stream, resolveSessionChannelType(session.sessionKey))) {
    return
  }
  scheduleOpencodeStreamPost(session, false)
}

export function closeOpencodeThinkingIfOpen(
  session: OpencodeSessionAgent,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  if (!session.thinkingOpen) return
  session.thinkingOpen = false
  void postOpencodePresentationEvent(session, { kind: "thinking", final: true }, resolveChannelType)
}

export function markOpencodeProcessEventSeen(session: OpencodeSessionAgent): void {
  clearOpencodeStreamPostTimer(session)
  session.seenProcessEvent = true
}

/** 上下文轮转：清空 opencodeSessionId 以便下次 session.create */
export function maybeRotateOpencodeSessionContext(session: OpencodeSessionAgent): boolean {
  if (!session.opencodeSessionId || !session.contextLimitTokens) return false
  const used = resolveDisplayContextTokens(session.contextUsage, session.contextUsagePeakTokens)
  const ratio = session.contextLimitTokens > 0 ? used / session.contextLimitTokens : 0
  if (!maybeRotateContext({ sessionKey: session.sessionKey, usageRatio: ratio, nowMs: Date.now() }).rotated) return false
  pushUiLog("OpenCode", "INFO", `[${session.sessionKey}] 上下文轮转，清空 opencodeSessionId`)
  session.opencodeSessionId = null
  resetContextUsagePeak(session)
  return true
}

export function broadcastOpencodeSessionStatus(sessions: OpencodeSessionAgent[]): void {
  const list = sessions.map((s) => ({
    sessionKey: s.sessionKey,
    pid: 0,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    chatType: s.chatType as string,
    chatName: resolveSessionChatName(s.sessionKey, s.chatName, s.senderOpenId),
    workspaceDir: s.workspaceDir,
  }))
  broadcastSessionStatus(list, "opencode")
}
