/**
 * SDK stream-text / presentation-event 出站（对称 agent-cc-stream）
 */
import { readLockFile, httpPost } from "../../daemon/daemon-client"
import {
  isFeishuProcessPresentationSuppressed as feishuSuppressesProcessKind,
} from "../../../src/shared/feishu-presentation-gate"
import { appendContextFooter, formatContextFooter } from "./context-usage"
import { pushUiLog } from "../../app/ui-logger"
import { persistActiveRunSnapshot } from "./sdk-run-persist"
import {
  presentationOrderingEligible,
  resolveSessionChannelType,
} from "./sdk-session-registry"
import type { PresentationEvent, PresentationKind, SdkSessionAgent } from "./sdk-session-types"

/** stream-text 节流间隔（与 AGENTS f41 约定一致） */
export const STREAM_POST_INTERVAL_MS = 400

interface StreamTextPayload {
  session_key: string
  text: string
  stream_id?: string
  outbound_message_id?: string
  /** final 包携带末条 inbound id，daemon handleStreamText → ackOnReply */
  message_id?: string
  final?: boolean
}

export function mapToolPresentationStatus(status: "running" | "completed" | "error"): PresentationEvent["tool_status"] {
  if (status === "running") return "started"
  if (status === "completed") return "completed"
  return "failed"
}

/** 出站 presentation-event；飞书抑制由 daemon 降级为里程碑文本，electron 侧仍 POST */
export async function postPresentationEvent(
  session: SdkSessionAgent,
  event: Omit<PresentationEvent, "session_key">,
): Promise<void> {
  const lock = readLockFile()
  if (!lock?.port) return
  const payload: PresentationEvent = {
    session_key: session.sessionKey,
    ...event,
  }
  if (payload.kind === "tool" && payload.tool_name && !payload.outbound_message_id) {
    const id = session.toolPresentationOutboundIds?.get(payload.tool_name)
    if (id) payload.outbound_message_id = id
  }
  try {
    const res = (await httpPost(`http://127.0.0.1:${lock.port}/api/presentation-event`, payload, 5000)) as {
      ok?: boolean
      outbound_message_id?: string
      error?: string
    }
    if (res?.outbound_message_id && payload.kind === "tool" && payload.tool_name) {
      if (!session.toolPresentationOutboundIds) session.toolPresentationOutboundIds = new Map()
      session.toolPresentationOutboundIds.set(payload.tool_name, res.outbound_message_id)
    }
    if (res?.ok === false && res.error) {
      pushUiLog("SDK", "WARN", `[${session.sessionKey}] presentation-event 拒绝: ${res.error}`)
    }
  } catch (e: unknown) {
    pushUiLog("SDK", "WARN", `[${session.sessionKey}] presentation-event 推送失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function postStreamText(session: SdkSessionAgent, payload: StreamTextPayload): Promise<void> {
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
    // 呈现游标变更时节流 upsert，供重启续接恢复 stream-text 偏移
    if (session.run) persistActiveRunSnapshot(session, session.run)
    if (res?.ok === false && res.error) {
      pushUiLog("SDK", "WARN", `[${session.sessionKey}] stream-text 拒绝: ${res.error}`)
    }
  } catch (e: unknown) {
    pushUiLog("SDK", "WARN", `[${session.sessionKey}] stream-text 推送失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function clearStreamPostTimer(session: SdkSessionAgent): void {
  if (session.streamPostTimer) {
    clearTimeout(session.streamPostTimer)
    session.streamPostTimer = undefined
  }
}

export function resetStreamPostChain(session: SdkSessionAgent): void {
  clearStreamPostTimer(session)
  session.streamPostChain = undefined
}

/** final flush 前将上下文 footer 写入 streamBuffer（幂等） */
export function applyContextFooterToBuffer(session: SdkSessionAgent): void {
  const footer = formatContextFooter(
    session.contextUsage,
    session.contextLimitTokens ?? null,
    session.contextUsagePeakTokens,
    session.contextUsageFromRunTotal,
  )
  if (!footer) return
  session.streamBuffer = appendContextFooter(session.streamBuffer, footer)
}

async function doFlushStreamPost(session: SdkSessionAgent, final: boolean): Promise<void> {
  clearStreamPostTimer(session)
  if (!session.f41Stream) return
  if (!final && shouldDeferAssistantPost(session)) return
  if (final) applyContextFooterToBuffer(session)
  const text = session.streamBuffer
  if (!text.trim() && !final) return

  const payload: StreamTextPayload = {
    session_key: session.sessionKey,
    text,
  }
  if (session.streamId) payload.stream_id = session.streamId
  if (session.outboundMessageId) payload.outbound_message_id = session.outboundMessageId
  if (final) {
    payload.final = true
    const ids = session.inboundMessageIds
    const lastId = ids?.[ids.length - 1]
    if (lastId) payload.message_id = lastId
  }

  await postStreamText(session, payload)
  session.streamLastPostAt = Date.now()
}

export function flushStreamPost(session: SdkSessionAgent, final: boolean): Promise<void> {
  session.streamPostChain = (session.streamPostChain ?? Promise.resolve())
    .then(() => doFlushStreamPost(session, final))
    .catch((e: unknown) => {
      pushUiLog("SDK", "WARN", `[${session.sessionKey}] stream-post chain 错误: ${e instanceof Error ? e.message : String(e)}`)
    })
  return session.streamPostChain
}

function scheduleStreamPost(session: SdkSessionAgent, final: boolean): void {
  if (!session.f41Stream) return
  if (final) {
    flushStreamPost(session, true)
    return
  }
  const now = Date.now()
  const elapsed = session.streamLastPostAt != null ? now - session.streamLastPostAt : STREAM_POST_INTERVAL_MS
  if (elapsed >= STREAM_POST_INTERVAL_MS) {
    flushStreamPost(session, false)
    return
  }
  if (session.streamPostTimer) return
  session.streamPostTimer = setTimeout(() => {
    session.streamPostTimer = undefined
    flushStreamPost(session, false)
  }, STREAM_POST_INTERVAL_MS - elapsed)
}

function shouldDeferAssistantPost(session: SdkSessionAgent): boolean {
  if (!presentationOrderingEligible(session)) return false
  if (session.outboundMessageId) return false
  return !!(session.presentationDeferStream || session.seenProcessEvent)
}

function isAwaitingFirstProcessEvent(session: SdkSessionAgent): boolean {
  return presentationOrderingEligible(session)
    && !session.outboundMessageId
    && !session.seenProcessEvent
}

/** 首包 POST 前短窗等待 tool/thinking，与 STREAM_POST_INTERVAL 对齐 */
function schedulePreambleRelease(session: SdkSessionAgent): void {
  if (!session.f41Stream) return
  clearStreamPostTimer(session)
  session.streamPostTimer = setTimeout(() => {
    session.streamPostTimer = undefined
    if (shouldDeferAssistantPost(session)) return
    scheduleStreamPost(session, false)
  }, STREAM_POST_INTERVAL_MS)
}

export function appendAssistantStreamDelta(session: SdkSessionAgent, delta: string): void {
  session.streamBuffer += delta
  if (shouldDeferAssistantPost(session)) return
  if (isAwaitingFirstProcessEvent(session)) {
    schedulePreambleRelease(session)
    return
  }
  scheduleStreamPost(session, false)
}

export function closeThinkingIfOpen(session: SdkSessionAgent): void {
  if (!session.thinkingOpen) return
  session.thinkingOpen = false
  void postPresentationEvent(session, { kind: "thinking", final: true })
  maybeReleaseDeferredAssistant(session)
}

/**
 * 过程事件可见时置 ordering 闩（seenProcessEvent / presentationDeferStream）。
 * task 里程碑与飞书抑制 kind 不参与 assistant defer。
 */
export function markProcessEventSeen(session: SdkSessionAgent, kind: PresentationKind): void {
  if (kind === "task") return
  const channelType = resolveSessionChannelType(session.sessionKey)
  if (feishuSuppressesProcessKind(channelType, kind)) return
  if (!presentationOrderingEligible(session)) return
  clearStreamPostTimer(session)
  session.seenProcessEvent = true
  session.presentationDeferStream = true
}

export async function flushDeferredStreamPost(session: SdkSessionAgent): Promise<void> {
  if (!session.streamBuffer.trim()) return
  await flushStreamPost(session, false)
}

/** 过程结束或 daemon 已 deferred 时释放 assistant 缓冲（对齐 presentationDeferStream） */
export function maybeReleaseDeferredAssistant(session: SdkSessionAgent): void {
  if (!presentationOrderingEligible(session)) return
  if (!session.seenProcessEvent && !session.presentationDeferStream) return
  void flushDeferredStreamPost(session)
}
