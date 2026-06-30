/**
 * Claude Agent SDK 事件映射
 * 遍历 query() 返回的 SDKMessage 流，映射至 Presentation / stream-text 出站。
 */
import type { SDKMessage, Query } from "@anthropic-ai/claude-agent-sdk"
import { pushUiLog } from "./ui-logger"
import { updateContextUsageDisplay, type TurnUsageSlice } from "./context-usage"
import { watchRunGuard } from "./agent-run-guard"
import type { CcSessionAgent } from "./agent-cc-types"
import { presentationOrderingEligible } from "./agent-cc-utils"
import {
  flushCcLog, appendCcLog, closeThinkingIfOpen, markProcessEventSeen, postPresentationEvent,
} from "./agent-cc-stream"
import {
  appendCcAssistantStreamDelta, flushDeferredStreamPost, maybeReleaseDeferredAssistant,
} from "./agent-cc-presentation"
import { formatCcHookUiLog } from "./cc-sdk-hooks"

/** Anthropic usage → TurnUsageSlice */
function mapUsageToSlice(usage?: {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}): TurnUsageSlice | null {
  if (!usage) return null
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

/** 处理 content block 数组（assistant / user） */
function handleContentBlocks(
  session: CcSessionAgent,
  blocks: Array<{ type: string; text?: string; thinking?: string; name?: string; id?: string; tool_use_id?: string; is_error?: boolean }>,
  resolveChannelType: (sessionKey: string) => string | undefined,
  isUserMessage: boolean,
): void {
  for (const block of blocks) {
    if (!isUserMessage && block.type === "text" && block.text) {
      if (session.f41Stream) appendCcAssistantStreamDelta(session, block.text)
      else appendCcLog(session, "text", block.text)
    } else if (!isUserMessage && block.type === "thinking" && (block.thinking || block.text)) {
      const delta = block.thinking ?? block.text ?? ""
      appendCcLog(session, "thinking", delta)
      markProcessEventSeen(session)
      session.thinkingOpen = true
      void postPresentationEvent(session, { kind: "thinking", delta }, resolveChannelType)
    } else if (!isUserMessage && block.type === "tool_use" && block.name) {
      flushCcLog(session)
      closeThinkingIfOpen(session, resolveChannelType)
      session.lastTool = { name: block.name, status: "running" }
      markProcessEventSeen(session)
      session.toolPresentationOutboundIds?.delete(block.name)
      void postPresentationEvent(session, { kind: "tool", tool_name: block.name, tool_status: "started", final: false }, resolveChannelType)
    } else if (isUserMessage && block.type === "tool_result" && block.tool_use_id) {
      const toolName = session.lastTool?.name ?? "unknown_tool"
      const isError = block.is_error === true
      session.lastTool = { name: toolName, status: isError ? "error" : "completed" }
      void postPresentationEvent(session, { kind: "tool", tool_name: toolName, tool_status: isError ? "failed" : "completed", final: true }, resolveChannelType)
      maybeReleaseDeferredAssistant(session)
    }
  }
}

/** 处理 stream_event 增量（includePartialMessages） */
function handleStreamEvent(
  session: CcSessionAgent,
  event: { type?: string; delta?: { type?: string; text?: string; thinking?: string } },
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  if (event.type !== "content_block_delta" || !event.delta) return
  const d = event.delta
  if (d.type === "text_delta" && d.text) {
    if (session.f41Stream) appendCcAssistantStreamDelta(session, d.text)
    else appendCcLog(session, "text", d.text)
  } else if (d.type === "thinking_delta" && d.thinking) {
    appendCcLog(session, "thinking", d.thinking)
    markProcessEventSeen(session)
    session.thinkingOpen = true
    void postPresentationEvent(session, { kind: "thinking", delta: d.thinking }, resolveChannelType)
  }
}

/** 单条 SDKMessage 分派 */
export function handleSdkMessage(
  session: CcSessionAgent,
  msg: SDKMessage,
  resolveChannelType: (sessionKey: string) => string | undefined,
  markActivity: (session: CcSessionAgent, source: string) => void,
): void {
  markActivity(session, `sdk:${msg.type}`)

  if (msg.type === "system") {
    if (msg.subtype === "init") {
      if (msg.session_id) {
        pushUiLog("CC", "INFO", `[${session.sessionKey}] cc_session_id=${msg.session_id}`)
        session.ccSessionId = msg.session_id
      }
      if (msg.model) session.modelId = msg.model
      return
    }
    // SDK hook 流事件：刷新活动时钟 + UI 日志（与 cc-sdk-hooks 回调格式一致）
    if (msg.subtype === "hook_started" || msg.subtype === "hook_progress" || msg.subtype === "hook_response") {
      const hookMsg = msg as { hook_event: string; hook_name: string }
      markActivity(session, `hook:${msg.subtype}`)
      pushUiLog("CC", "INFO", formatCcHookUiLog(session.sessionKey, {
        hook_event: hookMsg.hook_event,
        hook_name: hookMsg.hook_name,
      }))
      return
    }
  }

  if (msg.type === "assistant") {
    closeThinkingIfOpen(session, resolveChannelType)
    maybeReleaseDeferredAssistant(session)
    const content = msg.message.content as Array<{ type: string; text?: string; thinking?: string; name?: string; id?: string }>
    handleContentBlocks(session, content, resolveChannelType, false)
    const usageSlice = mapUsageToSlice(msg.message.usage as Parameters<typeof mapUsageToSlice>[0])
    if (usageSlice) updateContextUsageDisplay(session, usageSlice)
    if (msg.session_id) session.ccSessionId = msg.session_id
    return
  }

  if (msg.type === "stream_event") {
    handleStreamEvent(session, msg.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } }, resolveChannelType)
    if (msg.session_id) session.ccSessionId = msg.session_id
    return
  }

  if (msg.type === "user") {
    const content = msg.message.content as Array<{ type: string; tool_use_id?: string; is_error?: boolean }>
    handleContentBlocks(session, content, resolveChannelType, true)
    return
  }

  if (msg.type === "result") {
    if (msg.session_id) session.ccSessionId = msg.session_id
    const usageSlice = mapUsageToSlice(msg.usage)
    if (usageSlice) updateContextUsageDisplay(session, usageSlice)
    if (msg.duration_ms) {
      pushUiLog("CC", "INFO", `[${session.sessionKey}] result: subtype=${msg.subtype} duration=${msg.duration_ms}ms`)
    }
    if (msg.is_error || msg.subtype === "error") {
      const errMsg = "errors" in msg && Array.isArray(msg.errors) ? msg.errors.join("; ") : msg.result
      session.lastStatus = { status: "ERROR", message: errMsg ?? "unknown error" }
    }
    return
  }

  if (msg.type === "tool_progress") {
    session.lastTool = { name: msg.tool_name, status: "running" }
    markProcessEventSeen(session)
    session.toolPresentationOutboundIds?.delete(msg.tool_name)
    void postPresentationEvent(session, { kind: "tool", tool_name: msg.tool_name, tool_status: "started", final: false }, resolveChannelType)
  }
}

/** armCcWatchdog 配置 */
export interface ArmWatchdogOptions {
  idleTimeoutMs: number
  tickMs: number
  absoluteTimeoutMs: number
  /** 默认 true：watchRunGuard 不设总时长硬 cap，idle 仍走 onTick */
  neverCancelOnDuration: boolean
  getSession: (sessionKey: string) => CcSessionAgent | undefined
  setWatchdogState: (session: CcSessionAgent, next: "running" | "draining" | "cancelling", reason: string) => void
}

/** 空闲超时看门狗；超时中止 activeQuery */
export function armCcWatchdog(session: CcSessionAgent, token: string, opts: ArmWatchdogOptions): void {
  const { idleTimeoutMs, tickMs, absoluteTimeoutMs, neverCancelOnDuration, getSession, setWatchdogState } = opts
  void watchRunGuard({
    sessionKey: session.sessionKey,
    token,
    // 与 SDK 对齐：never-cancel 时不让 L73 总时长硬杀，idle/absolute 均在 onTick 判定
    timeoutMs: neverCancelOnDuration ? Number.MAX_SAFE_INTEGER : absoluteTimeoutMs,
    tickMs,
    onTick: () => {
      const s = getSession(session.sessionKey)
      if (!s || s.runGuardToken !== token) return "cancelled"
      if (!s.activeQuery) return "completed"
      const now = Date.now()
      if (s.watchdogState === "running") {
        const idleMs = now - s.lastActivityAt
        if (idleMs >= idleTimeoutMs) { setWatchdogState(s, "draining", `idle ${idleMs}ms`); return undefined }
      }
      if (s.watchdogState === "draining") {
        const drainingMs = now - s.watchdogStateAt
        if (drainingMs > 15_000) { setWatchdogState(s, "cancelling", "drain_grace_exceeded"); return "timeout" }
      }
      // 显式关闭 never-cancel 时，绝对运行时长仅在 onTick 触发（对称 SDK armRunWatchdog）
      if (
        !neverCancelOnDuration &&
        s.runStartedAt != null &&
        now - s.runStartedAt >= absoluteTimeoutMs
      ) {
        setWatchdogState(s, "cancelling", "duration_limit")
        return "timeout"
      }
      return undefined
    },
    onTimeout: async () => {
      const s = getSession(session.sessionKey)
      if (!s?.activeQuery) return
      // 先于 close 置位，供 completeCcRun 超时专分支识别
      s.watchdogTimedOut = true
      pushUiLog("CC", "WARN", `[${session.sessionKey}] watchdog 超时，中止 Query`)
      try { s.activeQuery.close() } catch { /* best-effort */ }
    },
  }).then((result) => {
    pushUiLog("CC", "INFO", `[${session.sessionKey}] watchdog 结束: ${result}`)
  })
}

/** streamCcSdkMessages 依赖注入 */
export interface StreamCcSdkMessagesOptions {
  resolveChannelType: (sessionKey: string) => string | undefined
  markActivity: (session: CcSessionAgent, source: string) => void
  completeCcRun: (session: CcSessionAgent, exitCode: number | null) => void
}

/** 异步遍历 SDKMessage 流；正常/异常结束均调用 completeCcRun 一次 */
export function streamCcSdkMessages(
  session: CcSessionAgent,
  queryIterator: Query,
  opts: StreamCcSdkMessagesOptions,
): void {
  const { resolveChannelType, markActivity, completeCcRun } = opts
  const sessionKey = session.sessionKey

  void (async () => {
    let exitCode: number | null = 0
    try {
      for await (const msg of queryIterator) {
        if (session.abortController.signal.aborted) break
        try {
          handleSdkMessage(session, msg, resolveChannelType, markActivity)
        } catch (e: unknown) {
          pushUiLog("CC", "WARN", `[${sessionKey}] 事件处理异常: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      flushCcLog(session)
      closeThinkingIfOpen(session, resolveChannelType)
      if (presentationOrderingEligible(session) && session.seenProcessEvent) {
        await flushDeferredStreamPost(session)
      }
    } catch (e: unknown) {
      exitCode = -1
      pushUiLog("CC", "ERROR", `[${sessionKey}] SDK 流异常: ${e instanceof Error ? e.message : String(e)}`)
      session.lastStatus = { status: "ERROR", message: e instanceof Error ? e.message : String(e) }
    } finally {
      session.activeQuery = null
      session.pendingDispatch = false
      completeCcRun(session, exitCode)
    }
  })()
}
