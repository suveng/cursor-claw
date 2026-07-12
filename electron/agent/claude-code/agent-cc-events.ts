/**
 * Claude Agent SDK 事件映射
 * 遍历 query() 返回的 SDKMessage 流，映射至 Presentation / stream-text 出站。
 */
import type { SDKMessage, Query } from "@anthropic-ai/claude-agent-sdk"
import { pushUiLog } from "../../app/ui-logger"
import { updateContextUsageDisplay, type TurnUsageSlice } from "../cursor-sdk/context-usage"
import { watchRunGuard } from "../shared/agent-run-guard"
import type { CcSessionAgent } from "./agent-cc-types"
import { presentationOrderingEligible } from "./agent-cc-utils"
import {
  flushCcLog, appendCcLog, closeThinkingIfOpen, markProcessEventSeen, postPresentationEvent,
} from "./agent-cc-stream"
import {
  appendCcAssistantStreamDelta, flushDeferredStreamPost, maybeReleaseDeferredAssistant,
} from "./agent-cc-presentation"
import {
  handleCcToolFinalPresentation,
  handleCcToolRunningPresentation,
} from "./agent-cc-presentation-tool"
import { formatCcHookUiLog } from "./cc-sdk-hooks"
import { emitCcQueryTerminalRunEvent, mapCcSdkMessageToRunEvent } from "./engine-port-adapter"
import { createRunLifecycle } from "../shared/run-lifecycle"

/** content block 最小结构（含 tool_use.input） */
type CcContentBlock = {
  type: string
  text?: string
  thinking?: string
  name?: string
  id?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
}

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
  blocks: CcContentBlock[],
  resolveChannelType: (sessionKey: string) => string | undefined,
  isUserMessage: boolean,
): void {
  for (const block of blocks) {
    if (!isUserMessage && block.type === "text" && block.text) {
      // f41 流式：若 partial text_delta 已写入，跳过 assistant text block 避免正文重复
      if (session.f41Stream) {
        if (!session.ccTextFromPartialStream) appendCcAssistantStreamDelta(session, block.text)
      } else appendCcLog(session, "text", block.text)
    } else if (!isUserMessage && block.type === "thinking" && (block.thinking || block.text)) {
      const delta = block.thinking ?? block.text ?? ""
      appendCcLog(session, "thinking", delta)
      markProcessEventSeen(session, "thinking")
      session.thinkingOpen = true
      void postPresentationEvent(session, { kind: "thinking", delta }, resolveChannelType)
    } else if (!isUserMessage && block.type === "tool_use" && block.name) {
      handleCcToolRunningPresentation(session, block.name, block.input, resolveChannelType)
    } else if (isUserMessage && block.type === "tool_result" && block.tool_use_id) {
      const toolName = session.lastTool?.name ?? "unknown_tool"
      handleCcToolFinalPresentation(session, toolName, block.is_error === true, block, resolveChannelType)
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
    if (session.f41Stream) {
      session.ccTextFromPartialStream = true
      appendCcAssistantStreamDelta(session, d.text)
    } else appendCcLog(session, "text", d.text)
  } else if (d.type === "thinking_delta" && d.thinking) {
    appendCcLog(session, "thinking", d.thinking)
    markProcessEventSeen(session, "thinking")
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
      if (Array.isArray(msg.mcp_servers)) {
        session.lastMcpServersSnapshot = msg.mcp_servers.map((s) => ({
          ...s,
          config: s.config ? { ...(s.config as object) } : s.config,
          tools: s.tools ? [...s.tools] : s.tools,
        }))
      }
      return
    }
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
    const content = msg.message.content as CcContentBlock[]
    handleContentBlocks(session, content, resolveChannelType, false)
    const usageSlice = mapUsageToSlice(msg.message.usage as Parameters<typeof mapUsageToSlice>[0])
    if (usageSlice) updateContextUsageDisplay(session, usageSlice)
    if (msg.session_id) session.ccSessionId = msg.session_id
    session.ccTextFromPartialStream = false
    return
  }

  if (msg.type === "stream_event") {
    handleStreamEvent(session, msg.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } }, resolveChannelType)
    if (msg.session_id) session.ccSessionId = msg.session_id
    return
  }

  if (msg.type === "user") {
    const content = msg.message.content as CcContentBlock[]
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
    const runEvent = mapCcSdkMessageToRunEvent(msg)
    if (runEvent) {
      createRunLifecycle(session).onStreamEvent(runEvent)
    }
    return
  }

  if (msg.type === "tool_progress") {
    handleCcToolRunningPresentation(session, msg.tool_name, undefined, resolveChannelType)
  }
}

/** armCcWatchdog 配置 */
export interface ArmWatchdogOptions {
  idleTimeoutMs: number
  tickMs: number
  absoluteTimeoutMs: number
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
      emitCcQueryTerminalRunEvent(session, exitCode)
      completeCcRun(session, exitCode)
    }
  })()
}
