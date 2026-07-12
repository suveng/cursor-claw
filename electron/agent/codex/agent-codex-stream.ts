/**
 * Codex SDK 流式推送、日志聚合与 Run 完成处理
 * 仿 agent-cc-stream：flush/append 日志、stream-text、presentation-event；收尾见 agent-codex-complete。
 */
import { readLockFile, httpPost } from "../../daemon/daemon-client"
import { pushUiLog, broadcastSessionStatus } from "../../app/ui-logger"
import { appendContextFooter, formatContextFooter, resolveDisplayContextTokens, resetContextUsagePeak } from "../cursor-sdk/context-usage"
import { resolveSessionChatName } from "../shared/agent-launcher"
import {
  isFeishuPlainAssistantReply,
  flushFeishuPlainAssistantIfNeeded,
} from "../shared/feishu-plain-assistant-reply"
import { maybeRotateContext } from "../cursor-sdk/context-rotation-lite"
import type { CodexSessionAgent } from "./agent-codex-types"
import { presentationOrderingEligible, resolveSessionChannelType } from "./agent-codex-utils"
import { persistCodexActiveRunSnapshot } from "./codex-run-persist"

const LOG_FLUSH_LEN = 400
const STREAM_POST_INTERVAL_MS = 400

/** stream-text 请求体 */
export interface StreamTextPayload {
  session_key: string
  text: string
  stream_id?: string
  outbound_message_id?: string
  message_id?: string
  final?: boolean
}

/** 聚合日志 flush */
export function flushCodexLog(session: CodexSessionAgent): void {
  const agg = session.logAgg
  const text = agg.buf.trim()
  if (agg.kind && text) {
    const level = agg.kind === "thinking" ? "DEBUG" : "INFO"
    const prefix = agg.kind === "thinking" ? "[thinking] " : ""
    pushUiLog("Codex", level, `[${session.sessionKey}] ${prefix}${text}`)
  }
  agg.kind = null
  agg.buf = ""
}

/** 追加聚合日志 */
export function appendCodexLog(session: CodexSessionAgent, kind: "thinking" | "text", delta: string): void {
  const agg = session.logAgg
  if (agg.kind && agg.kind !== kind) flushCodexLog(session)
  agg.kind = kind
  agg.buf += delta
  if (agg.buf.length >= LOG_FLUSH_LEN) flushCodexLog(session)
}
/** 出站 presentation-event；飞书里程碑抑制由 Daemon 处理，Electron 侧始终 POST */
export async function postCodexPresentationEvent(
  session: CodexSessionAgent,
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
    }
    if (res?.outbound_message_id && event.kind === "tool" && event.tool_name) {
      if (!session.toolPresentationOutboundIds) session.toolPresentationOutboundIds = new Map()
      session.toolPresentationOutboundIds.set(event.tool_name, res.outbound_message_id)
    }
  } catch (e: unknown) {
    pushUiLog("Codex", "WARN", `[${session.sessionKey}] presentation-event 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** stream-text 出站 */
export async function postCodexStreamText(session: CodexSessionAgent, payload: StreamTextPayload): Promise<void> {
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
    pushUiLog("Codex", "WARN", `[${session.sessionKey}] stream-text 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function clearCodexStreamPostTimer(session: CodexSessionAgent): void {
  if (session.streamPostTimer) {
    clearTimeout(session.streamPostTimer)
    session.streamPostTimer = undefined
  }
}

/** ordering 且已见过程、尚无 outbound 时 defer assistant 非 final 出站 */
function shouldDeferCodexAssistantPost(session: CodexSessionAgent): boolean {
  if (!presentationOrderingEligible(session)) return false
  if (session.outboundMessageId) return false
  return !!(session.presentationDeferStream || session.seenProcessEvent)
}

/** Rev2 end-only：含过程 Run 仅 Run 收尾 final 出站 */
function shouldEndOnlyCodexAssistantDefer(session: CodexSessionAgent): boolean {
  if (!presentationOrderingEligible(session)) return false
  if (session.outboundMessageId) return false
  return !!(session.seenProcessEvent || session.presentationDeferStream)
}

/** 纯对话 preamble：ordering 开启但尚未见过程事件 */
function isAwaitingFirstCodexProcessEvent(session: CodexSessionAgent): boolean {
  return presentationOrderingEligible(session)
    && !session.outboundMessageId
    && !session.seenProcessEvent
}

/** 首包 POST 前短窗等待 tool/thinking，与 STREAM_POST_INTERVAL 对齐 */
function scheduleCodexPreambleRelease(session: CodexSessionAgent): void {
  if (!session.f41Stream) return
  clearCodexStreamPostTimer(session)
  session.streamPostTimer = setTimeout(() => {
    session.streamPostTimer = undefined
    if (shouldDeferCodexAssistantPost(session)) return
    scheduleCodexStreamPost(session, false)
  }, STREAM_POST_INTERVAL_MS)
}

/** 执行流式 flush（final 时附加 context footer） */
export async function doFlushCodexStreamPost(session: CodexSessionAgent, final: boolean): Promise<void> {
  clearCodexStreamPostTimer(session)
  if (!session.f41Stream) return
  const channelType = resolveSessionChannelType(session.sessionKey)
  if (await flushFeishuPlainAssistantIfNeeded(
    session.f41Stream,
    channelType,
    final,
    session.sessionKey,
    session.streamBuffer,
    session.inboundMessageIds,
    "Codex",
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
  if (!final && shouldDeferCodexAssistantPost(session)) return
  // Rev2 end-only：含过程 Run 仅 Run 收尾 flushCodexStreamPost(true) 出站
  if (!final && shouldEndOnlyCodexAssistantDefer(session)) return
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
  await postCodexStreamText(session, payload)
  session.streamLastPostAt = Date.now()
  persistCodexActiveRunSnapshot(session)
}

/** 串行链 flush */
export function flushCodexStreamPost(session: CodexSessionAgent, final: boolean): Promise<void> {
  session.streamPostChain = (session.streamPostChain ?? Promise.resolve())
    .then(() => doFlushCodexStreamPost(session, final))
    .catch((e: unknown) => {
      pushUiLog("Codex", "WARN", `[${session.sessionKey}] stream chain 错误: ${e instanceof Error ? e.message : String(e)}`)
    })
  return session.streamPostChain
}

/** 节流调度 stream-text */
export function scheduleCodexStreamPost(session: CodexSessionAgent, final: boolean): void {
  if (!session.f41Stream) return
  if (final) { flushCodexStreamPost(session, true); return }
  const now = Date.now()
  const elapsed = session.streamLastPostAt != null ? now - session.streamLastPostAt : STREAM_POST_INTERVAL_MS
  if (elapsed >= STREAM_POST_INTERVAL_MS) { flushCodexStreamPost(session, false); return }
  if (session.streamPostTimer) return
  session.streamPostTimer = setTimeout(() => {
    session.streamPostTimer = undefined
    flushCodexStreamPost(session, false)
  }, STREAM_POST_INTERVAL_MS - elapsed)
}

/** 追加 assistant 流式增量 */
export function appendCodexStreamDelta(session: CodexSessionAgent, delta: string): void {
  session.streamBuffer += delta
  if (isFeishuPlainAssistantReply(session.f41Stream, resolveSessionChannelType(session.sessionKey))) {
    return
  }
  if (shouldDeferCodexAssistantPost(session)) return
  if (isAwaitingFirstCodexProcessEvent(session)) {
    scheduleCodexPreambleRelease(session)
    return
  }
  scheduleCodexStreamPost(session, false)
}

export function closeCodexThinkingIfOpen(
  session: CodexSessionAgent,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  if (!session.thinkingOpen) return
  session.thinkingOpen = false
  void postCodexPresentationEvent(session, { kind: "thinking", final: true }, resolveChannelType)
}

/**
 * 过程事件可见时置 ordering 闩（seenProcessEvent / presentationDeferStream）。
 * 对称 OpenCode markOpencodeProcessEventSeen；飞书里程碑降级在 Daemon 侧，不在此早退。
 */
export function markCodexProcessEventSeen(session: CodexSessionAgent): void {
  if (!presentationOrderingEligible(session)) return
  clearCodexStreamPostTimer(session)
  session.seenProcessEvent = true
  session.presentationDeferStream = true
}

/** 高水位触发上下文轮转；resident 下清空 thread 句柄，下次 dispatch 走 resumeThread/startThread */
export function maybeRotateCodexSessionContext(session: CodexSessionAgent): boolean {
  if (!session.codexSessionId || !session.contextLimitTokens) return false
  const used = resolveDisplayContextTokens(session.contextUsage, session.contextUsagePeakTokens)
  const ratio = session.contextLimitTokens > 0 ? used / session.contextLimitTokens : 0
  if (!maybeRotateContext({ sessionKey: session.sessionKey, usageRatio: ratio, nowMs: Date.now() }).rotated) return false
  pushUiLog("Codex", "INFO", `[${session.sessionKey}] 上下文轮转，清空 codexSessionId`)
  session.codexSessionId = null
  session.activeThread = null
  resetContextUsagePeak(session)
  return true
}

/** 广播 Codex 会话列表 */
export function broadcastCodexSessionStatus(sessions: CodexSessionAgent[]): void {
  const list = sessions.map((s) => ({
    sessionKey: s.sessionKey,
    pid: 0,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    chatType: s.chatType as string,
    chatName: resolveSessionChatName(s.sessionKey, s.chatName, s.senderOpenId),
    workspaceDir: s.workspaceDir,
  }))
  broadcastSessionStatus(list, "codex")
}
