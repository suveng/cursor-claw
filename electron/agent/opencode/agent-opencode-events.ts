/**
 * OpenCode SSE 事件 → PresentationEvent 映射（仿 agent-codex-events）。
 */
import type { Part } from "@opencode-ai/sdk"
import { pushUiLog } from "../../app/ui-logger"
import { updateContextUsageDisplay } from "../cursor-sdk/context-usage"
import { formatOpencodeFailureMessage, sanitizeOpencodeSensitiveText } from "./opencode-failure-messages"
import type { OpencodeRunEpoch } from "./agent-opencode-complete"
import type { OpencodeSessionAgent } from "./agent-opencode-types"
import { buildOpencodeFailCtx } from "./agent-opencode-utils"
import {
  flushOpencodeLog,
  appendOpencodeLog,
  closeOpencodeThinkingIfOpen,
  postOpencodePresentationEvent,
  markOpencodeProcessEventSeen,
  appendOpencodeStreamDelta,
  maybeRotateOpencodeSessionContext,
} from "./agent-opencode-stream"

type OpencodeEvent = { type: string; properties?: Record<string, unknown> }

function partTypeLabel(part: Part): string {
  return (part as { type?: string }).type ?? "unknown"
}

function handlePartUpdated(
  session: OpencodeSessionAgent,
  part: Part,
  delta: string | undefined,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  if (part.type === "text") {
    const text = delta ?? part.text ?? ""
    if (!text) return
    if (session.f41Stream) appendOpencodeStreamDelta(session, text)
    else appendOpencodeLog(session, "text", text)
    return
  }
  if (part.type === "reasoning") {
    const text = delta ?? part.text ?? ""
    if (!text) return
    appendOpencodeLog(session, "thinking", text)
    markOpencodeProcessEventSeen(session)
    session.thinkingOpen = true
    void postOpencodePresentationEvent(session, { kind: "thinking", delta: text }, resolveChannelType)
    return
  }
  if (part.type === "tool") {
    const toolName = part.tool || "tool"
    const st = part.state?.status
    if (st === "running" || st === "pending") {
      flushOpencodeLog(session)
      closeOpencodeThinkingIfOpen(session, resolveChannelType)
      session.lastTool = { name: toolName, status: "running" }
      markOpencodeProcessEventSeen(session)
      session.toolPresentationOutboundIds?.delete(toolName)
      void postOpencodePresentationEvent(session, {
        kind: "tool",
        tool_name: toolName,
        tool_status: "started",
        final: false,
      }, resolveChannelType)
      return
    }
    if (st === "completed" || st === "error") {
      const failed = st === "error"
      session.lastTool = { name: toolName, status: failed ? "error" : "completed" }
      const output = st === "completed" && "output" in part.state ? String(part.state.output ?? "") : undefined
      void postOpencodePresentationEvent(session, {
        kind: "tool",
        tool_name: toolName,
        tool_status: failed ? "failed" : "completed",
        tool_shell_output: output,
        final: true,
      }, resolveChannelType)
    }
    return
  }
  pushUiLog("OpenCode", "WARN", `[${session.sessionKey}] 未识别 part 类型: ${partTypeLabel(part)}`)
}

/** 单条 SSE 事件入口 */
export function handleOpencodeSseEvent(
  session: OpencodeSessionAgent,
  event: unknown,
  resolveChannelType: (sessionKey: string) => string | undefined,
  markActivity: (session: OpencodeSessionAgent, source: string) => void,
): void {
  const ev = event as OpencodeEvent
  if (!ev?.type) return
  markActivity(session, `opencode:${ev.type}`)

  if (ev.type === "message.part.updated") {
    const props = ev.properties as { part?: Part; delta?: string } | undefined
    if (props?.part) handlePartUpdated(session, props.part, props.delta, resolveChannelType)
    return
  }

  if (ev.type === "permission.updated") {
    pushUiLog("OpenCode", "WARN", `[${session.sessionKey}] permission 请求已自动跳过（无审批 UI）`)
    return
  }

  if (ev.type === "session.idle") {
    const sid = (ev.properties as { sessionID?: string } | undefined)?.sessionID
    if (sid && session.opencodeSessionId && sid !== session.opencodeSessionId) return
    return
  }

  if (ev.type === "session.error") {
    const err = (ev.properties as { error?: { data?: { message?: string } } } | undefined)?.error
    const msg = formatOpencodeFailureMessage(buildOpencodeFailCtx(session, { message: err?.data?.message }))
    session.lastStatus = { status: "ERROR", message: msg }
    pushUiLog("OpenCode", "ERROR", `[${session.sessionKey}] session.error: ${msg}`)
    return
  }

  if (ev.type === "message.updated") {
    const info = (ev.properties as { info?: { role?: string; tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } } } | undefined)?.info
    if (info?.role === "assistant" && info.tokens) {
      const slice = {
        inputTokens: info.tokens.input ?? 0,
        outputTokens: (info.tokens.output ?? 0) + (info.tokens.reasoning ?? 0),
        cacheReadTokens: info.tokens.cache?.read ?? 0,
        cacheWriteTokens: info.tokens.cache?.write ?? 0,
      }
      updateContextUsageDisplay(session, slice)
      session.contextUsageFromRunTotal = slice.inputTokens + slice.outputTokens + slice.cacheReadTokens
      maybeRotateOpencodeSessionContext(session)
    }
    return
  }

  if (ev.type === "session.created") {
    const id = (ev.properties as { info?: { id?: string } } | undefined)?.info?.id
    if (id) {
      session.opencodeSessionId = id
      pushUiLog("OpenCode", "INFO", `[${session.sessionKey}] opencode_session_id=${id}`)
    }
    return
  }

  pushUiLog("OpenCode", "WARN", `[${session.sessionKey}] 未识别 OpenCode 事件: ${ev.type}`)
}

export interface StreamOpencodeEventsOptions {
  resolveChannelType: (sessionKey: string) => string | undefined
  markActivity: (session: OpencodeSessionAgent, source: string) => void
  completeOpencodeRun: (session: OpencodeSessionAgent, exitCode: number | null, epoch?: OpencodeRunEpoch) => void
}

/** 订阅 OpenCode SSE 并驱动 Run 收尾 */
export function streamOpencodeEvents(
  session: OpencodeSessionAgent,
  events: AsyncIterable<unknown>,
  opts: StreamOpencodeEventsOptions,
): void {
  const { resolveChannelType, markActivity, completeOpencodeRun } = opts
  const sessionKey = session.sessionKey
  const runEpoch = { runStartedAt: session.runStartedAt, runGuardToken: session.runGuardToken }
  session.eventLoopRunning = true

  void (async () => {
    let exitCode: number | null = 0
    try {
      for await (const event of events) {
        if (session.abortController.signal.aborted) break
        try {
          handleOpencodeSseEvent(session, event, resolveChannelType, markActivity)
          const ev = event as OpencodeEvent
          if (ev.type === "session.idle") {
            const sid = (ev.properties as { sessionID?: string } | undefined)?.sessionID
            if (!sid || sid === session.opencodeSessionId) break
          }
        } catch (e: unknown) {
          const raw = e instanceof Error ? e.message : String(e)
          pushUiLog("OpenCode", "WARN", `[${sessionKey}] 事件处理异常: ${sanitizeOpencodeSensitiveText(raw)}`)
        }
      }
      flushOpencodeLog(session)
      closeOpencodeThinkingIfOpen(session, resolveChannelType)
    } catch (e: unknown) {
      exitCode = -1
      const raw = e instanceof Error ? e.message : String(e)
      pushUiLog("OpenCode", "ERROR", `[${sessionKey}] SSE 流异常: ${sanitizeOpencodeSensitiveText(raw)}`)
      session.lastStatus = {
        status: "ERROR",
        message: formatOpencodeFailureMessage(buildOpencodeFailCtx(session, e)),
      }
    } finally {
      void completeOpencodeRun(session, exitCode, runEpoch)
    }
  })()
}
