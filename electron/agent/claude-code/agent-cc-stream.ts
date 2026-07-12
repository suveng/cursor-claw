/**
 * Claude Code SDK 流式推送、日志聚合与进程完成处理
 */
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { pushUiLog, broadcastSessionStatus } from "../../app/ui-logger"
import {
  appendContextFooter,
  formatContextFooter,
} from "../cursor-sdk/context-usage"
import { resolveSessionChatName } from "../shared/agent-launcher"
import { flushFeishuPlainAssistantIfNeeded } from "../shared/feishu-plain-assistant-reply"
import { completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import type { CcSessionAgent } from "./agent-cc-types"
import { presentationOrderingEligible, resolveSessionChannelType } from "./agent-cc-utils"
import { finalizeCcRunOnWatchdogTimeout } from "./engine-port-adapter"
import { completeCcViaLifecycle, notifyCcRunFailure } from "./engine-port-adapter"
import { clearCcActiveRun } from "./cc-run-persistence"
import { clearCcPersistThrottle } from "./cc-run-persist"
import {
  notifySessionChat,
  postPresentationEvent,
  postStreamText,
  type StreamTextPayload,
} from "./agent-cc-notify"
import { persistCcActiveRunSnapshot } from "./cc-run-persist"

export { notifySessionChat, postPresentationEvent, postStreamText, type StreamTextPayload } from "./agent-cc-notify"

// ── 日志聚合 ──────────────────────────────────────────────────────────────────

/** 聚合日志单条最大字符数，超出后自动 flush */
const LOG_FLUSH_LEN = 400

/** 将 session.logAgg 缓冲写入 UI 日志并重置 */
export function flushCcLog(session: CcSessionAgent): void {
  const agg = session.logAgg
  const text = agg.buf.trim()
  if (agg.kind && text) {
    if (agg.kind === "thinking") {
      pushUiLog("CC", "DEBUG", `[${session.sessionKey}] [thinking] ${text}`)
    } else {
      pushUiLog("CC", "INFO", `[${session.sessionKey}] ${text}`)
    }
  }
  agg.kind = null
  agg.buf = ""
}

/** 追加一段文字到聚合日志，类型切换时自动 flush */
export function appendCcLog(session: CcSessionAgent, kind: "thinking" | "text", delta: string): void {
  const agg = session.logAgg
  if (agg.kind && agg.kind !== kind) flushCcLog(session)
  agg.kind = kind
  agg.buf += delta
  if (agg.buf.length >= LOG_FLUSH_LEN) flushCcLog(session)
}

// ── 流式 Buffer 管理 ──────────────────────────────────────────────────────────

/** 流式推送间隔（毫秒） */
const STREAM_POST_INTERVAL_MS = 400

/** 取消 session 的流式推送定时器 */
export function clearStreamPostTimer(session: CcSessionAgent): void {
  if (session.streamPostTimer) {
    clearTimeout(session.streamPostTimer)
    session.streamPostTimer = undefined
  }
}

/** 为 streamBuffer 附加上下文 footer（final 专用） */
function appendCcContextFooter(session: CcSessionAgent, text: string): string {
  const footer = formatContextFooter(
    session.contextUsage,
    session.contextLimitTokens ?? null,
    session.contextUsagePeakTokens,
    session.contextUsageFromRunTotal,
  )
  return footer ? appendContextFooter(text, footer) : text
}

/** 执行实际的流式 flush，包括上下文 footer 附加 */
export async function doFlushStreamPost(session: CcSessionAgent, final: boolean): Promise<void> {
  clearStreamPostTimer(session)
  if (!session.f41Stream) return
  const channelType = resolveSessionChannelType(session.sessionKey)
  if (await flushFeishuPlainAssistantIfNeeded(
    session.f41Stream,
    channelType,
    final,
    session.sessionKey,
    session.streamBuffer,
    session.inboundMessageIds,
    "CC",
    final ? (t) => appendCcContextFooter(session, t) : undefined,
  )) {
    if (final) session.streamLastPostAt = Date.now()
    return
  }
  if (final) session.streamBuffer = appendCcContextFooter(session, session.streamBuffer)
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
  await postStreamText(session, payload)
  session.streamLastPostAt = Date.now()
  persistCcActiveRunSnapshot(session)
}

/** 将 flush 操作串入 Promise 链，保证顺序 */
export function flushStreamPost(session: CcSessionAgent, final: boolean): Promise<void> {
  session.streamPostChain = (session.streamPostChain ?? Promise.resolve())
    .then(() => doFlushStreamPost(session, final))
    .catch((e: unknown) => {
      pushUiLog("CC", "WARN", `[${session.sessionKey}] stream-post chain 错误: ${e instanceof Error ? e.message : String(e)}`)
    })
  return session.streamPostChain
}

/** 调度流式推送（节流：距上次不足间隔则定时，否则立即） */
export function scheduleStreamPost(session: CcSessionAgent, final: boolean): void {
  if (!session.f41Stream) return
  if (final) { flushStreamPost(session, true); return }
  const now = Date.now()
  const elapsed = session.streamLastPostAt != null ? now - session.streamLastPostAt : STREAM_POST_INTERVAL_MS
  if (elapsed >= STREAM_POST_INTERVAL_MS) { flushStreamPost(session, false); return }
  if (session.streamPostTimer) return
  session.streamPostTimer = setTimeout(() => {
    session.streamPostTimer = undefined
    flushStreamPost(session, false)
  }, STREAM_POST_INTERVAL_MS - elapsed)
}

/** 追加流式文字到 buffer 并调度推送 */
export function appendStreamDelta(session: CcSessionAgent, delta: string): void {
  session.streamBuffer += delta
  scheduleStreamPost(session, false)
}

/** 若 thinking block 未关闭则发送关闭事件 */
export function closeThinkingIfOpen(
  session: CcSessionAgent,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  if (!session.thinkingOpen) return
  session.thinkingOpen = false
  void postPresentationEvent(session, { kind: "thinking", final: true }, resolveChannelType)
}

/**
 * 过程事件可见时置 ordering 闩（seenProcessEvent / presentationDeferStream）。
 * 飞书呈现抑制（里程碑文本）≠ 不参与 ordering defer；thinking/tool/task 均置闩。
 */
export function markProcessEventSeen(
  session: CcSessionAgent,
  _kind: "thinking" | "tool" | "task",
): void {
  if (!presentationOrderingEligible(session)) return
  clearStreamPostTimer(session)
  session.seenProcessEvent = true
  session.presentationDeferStream = true
}

// ── 会话状态广播 ──────────────────────────────────────────────────────────────

/** 广播 Claude Code 会话列表到前端 */
export function broadcastCcSessionStatus(sessions: CcSessionAgent[]): void {
  const list = sessions.map((s) => ({
    sessionKey: s.sessionKey,
    pid: 0,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    chatType: s.chatType as string,
    chatName: resolveSessionChatName(s.sessionKey, s.chatName, s.senderOpenId),
    workspaceDir: s.workspaceDir,
  }))
  broadcastSessionStatus(list, "claude-code")
}

// ── 进程完成处理 ───────────────────────────────────────────────────────────────

/** completeCcRun 依赖注入选项 */
export interface CompleteCcRunOptions {
  deleteSession: (key: string) => void
  getAllSessions: () => CcSessionAgent[]
  setFailedCooldown: (key: string, until: number) => void
  resetPresentationState: (session: CcSessionAgent) => void
}

/** 子进程退出后清理 session 状态，推送最终流式内容并广播会话列表 */
export async function completeCcRun(
  session: CcSessionAgent, exitCode: number | null,
  opts: CompleteCcRunOptions, failCooldownMs: number,
): Promise<void> {
  const { deleteSession, getAllSessions, setFailedCooldown, resetPresentationState } = opts
  const sessionKey = session.sessionKey
  if (session.runFinalizing) return

  flushCcLog(session)
  session.thinkingOpen = false

  if (session.f41Stream && (session.streamBuffer.trim() || session.outboundMessageId)) {
    await flushStreamPost(session, true)
  } else if (session.streamBuffer.trim()) {
    const footer = formatContextFooter(
      session.contextUsage,
      session.contextLimitTokens ?? null,
      session.contextUsagePeakTokens,
    )
    await completeCcViaLifecycle(session, {
      source: "success",
      assistantText: appendContextFooter(session.streamBuffer, footer),
    })
  }

  const isWatchdogTimeout = session.watchdogTimedOut === true
  if (isWatchdogTimeout) {
    await finalizeCcRunOnWatchdogTimeout(session)
  } else {
    const isError = session.lastStatus?.status === "ERROR" || (exitCode !== null && exitCode !== 0)
    if (isError && !session.errorNotified) {
      await notifyCcRunFailure(session, exitCode)
      setFailedCooldown(sessionKey, Date.now() + failCooldownMs)
    }
  }

  session.runFinalizing = true

  if (session.runGuardToken) {
    completeRunGuard(sessionKey, session.runGuardToken)
    releaseRunGuard(sessionKey, session.runGuardToken)
    session.runGuardToken = undefined
  }
  session.activeQuery = null
  session.pendingDispatch = false
  clearCcActiveRun(sessionKey)
  clearCcPersistThrottle(sessionKey)
  await reportSessionAgentPhase(sessionKey, "idle")

  if (session.residentMode) { resetPresentationState(session); broadcastCcSessionStatus(getAllSessions()); return }
  deleteSession(sessionKey)
  broadcastCcSessionStatus(getAllSessions())
}
