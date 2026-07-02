/**
 * Codex SDK 事件映射
 * 8 类 ThreadEvent → PresentationEvent / contextUsage / codexSessionId。
 */
import type { Usage, ThreadItem } from "@openai/codex-sdk"
import { pushUiLog } from "../../app/ui-logger"
import { updateContextUsageDisplay, type TurnUsageSlice } from "../cursor-sdk/context-usage"
import { formatCodexFailureMessage, sanitizeCodexSensitiveText } from "./codex-failure-messages"
import type { CodexRunEpoch } from "./agent-codex-complete"
import type { CodexSessionAgent, CodexThreadEvent } from "./agent-codex-types"
import { buildCodexFailCtx } from "./agent-codex-utils"
import {
  flushCodexLog,
  appendCodexLog,
  closeCodexThinkingIfOpen,
  postCodexPresentationEvent,
  markCodexProcessEventSeen,
  appendCodexStreamDelta,
  maybeRotateCodexSessionContext,
} from "./agent-codex-stream"

/** Codex Usage → TurnUsageSlice */
function mapCodexUsageToSlice(usage: Usage): TurnUsageSlice {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0),
    cacheReadTokens: usage.cached_input_tokens ?? 0,
    cacheWriteTokens: 0,
  }
}

/** 从未识别 ThreadItem 提取可读类型名 */
function threadItemTypeLabel(item: ThreadItem): string {
  return (item as { type?: string }).type ?? "unknown"
}

/** 解析 tool 展示名并缓存 item.id → name */
function resolveToolName(session: CodexSessionAgent, item: ThreadItem): string {
  if (item.type === "command_execution") {
    const name = item.command?.trim() || "shell"
    session.itemToolNames?.set(item.id, name)
    return name
  }
  if (item.type === "mcp_tool_call") {
    const name = `${item.server}/${item.tool}`
    session.itemToolNames?.set(item.id, name)
    return name
  }
  return session.itemToolNames?.get(item.id) ?? session.lastTool?.name ?? "unknown_tool"
}

/** item.started：预建 thinking / tool 展示卡 */
function handleItemStarted(
  session: CodexSessionAgent,
  item: ThreadItem,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  if (item.type === "reasoning") {
    markCodexProcessEventSeen(session)
    session.thinkingOpen = true
    void postCodexPresentationEvent(session, { kind: "thinking", delta: "" }, resolveChannelType)
    return
  }
  if (item.type === "command_execution" || item.type === "mcp_tool_call") {
    flushCodexLog(session)
    closeCodexThinkingIfOpen(session, resolveChannelType)
    const toolName = resolveToolName(session, item)
    session.lastTool = { name: toolName, status: "running" }
    markCodexProcessEventSeen(session)
    session.toolPresentationOutboundIds?.delete(toolName)
    void postCodexPresentationEvent(session, {
      kind: "tool",
      tool_name: toolName,
      tool_status: "started",
      tool_shell_command: item.type === "command_execution" ? item.command : undefined,
      final: false,
    }, resolveChannelType)
    return
  }
  if (item.type === "file_change") {
    pushUiLog("Codex", "INFO", `[${session.sessionKey}] 文件变更: ${item.changes?.length ?? 0} 项`)
    return
  }
  pushUiLog("Codex", "WARN", `[${session.sessionKey}] 未识别 item.started 子类型: ${threadItemTypeLabel(item)}`)
}

/** item.updated：流式 assistant / thinking 增量 */
function handleItemUpdated(
  session: CodexSessionAgent,
  item: ThreadItem,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  if (item.type === "agent_message" && item.text) {
    if (session.f41Stream) appendCodexStreamDelta(session, item.text)
    else appendCodexLog(session, "text", item.text)
    return
  }
  if (item.type === "reasoning" && item.text) {
    appendCodexLog(session, "thinking", item.text)
    markCodexProcessEventSeen(session)
    session.thinkingOpen = true
    void postCodexPresentationEvent(session, { kind: "thinking", delta: item.text }, resolveChannelType)
    return
  }
  if (item.type === "command_execution" && item.aggregated_output) {
    const toolName = resolveToolName(session, item)
    void postCodexPresentationEvent(session, {
      kind: "tool",
      tool_name: toolName,
      tool_status: "started",
      tool_shell_output: item.aggregated_output,
      final: false,
    }, resolveChannelType)
    return
  }
  // 其他子类型增量仅记 DEBUG
  pushUiLog("Codex", "DEBUG", `[${session.sessionKey}] item.updated: ${threadItemTypeLabel(item)}`)
}

/** item.completed：tool 完成 / assistant final */
function handleItemCompleted(
  session: CodexSessionAgent,
  item: ThreadItem,
  resolveChannelType: (sessionKey: string) => string | undefined,
): void {
  if (item.type === "agent_message") {
    closeCodexThinkingIfOpen(session, resolveChannelType)
    if (!session.f41Stream && item.text) appendCodexLog(session, "text", item.text)
    return
  }
  if (item.type === "command_execution") {
    const toolName = resolveToolName(session, item)
    const failed = item.status === "failed" || (item.exit_code != null && item.exit_code !== 0)
    session.lastTool = { name: toolName, status: failed ? "error" : "completed" }
    void postCodexPresentationEvent(session, {
      kind: "tool",
      tool_name: toolName,
      tool_status: failed ? "failed" : "completed",
      tool_shell_command: item.command,
      tool_shell_output: item.aggregated_output,
      final: true,
    }, resolveChannelType)
    return
  }
  if (item.type === "mcp_tool_call") {
    const toolName = resolveToolName(session, item)
    const failed = item.status === "failed"
    session.lastTool = { name: toolName, status: failed ? "error" : "completed" }
    void postCodexPresentationEvent(session, {
      kind: "tool",
      tool_name: toolName,
      tool_status: failed ? "failed" : "completed",
      final: true,
    }, resolveChannelType)
    return
  }
  if (item.type === "file_change") {
    pushUiLog("Codex", "INFO", `[${session.sessionKey}] 文件变更完成: ${item.status}`)
    return
  }
  pushUiLog("Codex", "WARN", `[${session.sessionKey}] 未识别 item.completed 子类型: ${threadItemTypeLabel(item)}`)
}

/** 单条 Codex 事件分派 */
export function handleCodexEvent(
  session: CodexSessionAgent,
  event: CodexThreadEvent | { type: "error" | "thread.error"; message: string },
  resolveChannelType: (sessionKey: string) => string | undefined,
  markActivity: (session: CodexSessionAgent, source: string) => void,
): void {
  markActivity(session, `codex:${event.type}`)

  if (event.type === "thread.started") {
    session.codexSessionId = event.thread_id
    pushUiLog("Codex", "INFO", `[${session.sessionKey}] codex_session_id=${event.thread_id}`)
    return
  }
  if (event.type === "turn.started") {
    session.runStartedAt = Date.now()
    return
  }
  if (event.type === "item.started") {
    if (!session.itemToolNames) session.itemToolNames = new Map()
    handleItemStarted(session, event.item, resolveChannelType)
    return
  }
  if (event.type === "item.updated") {
    handleItemUpdated(session, event.item, resolveChannelType)
    return
  }
  if (event.type === "item.completed") {
    handleItemCompleted(session, event.item, resolveChannelType)
    return
  }
  if (event.type === "turn.completed") {
    const slice = mapCodexUsageToSlice(event.usage)
    updateContextUsageDisplay(session, slice)
    const total = slice.inputTokens + slice.outputTokens + slice.cacheReadTokens
    session.contextUsageFromRunTotal = total
    session.contextUsageFinalized = true
    pushUiLog("Codex", "INFO", `[${session.sessionKey}] [context-usage] in=${slice.inputTokens} out=${slice.outputTokens}`)
    maybeRotateCodexSessionContext(session)
    return
  }
  if (event.type === "turn.failed") {
    const msg = formatCodexFailureMessage(buildCodexFailCtx(session, event.error))
    session.lastStatus = { status: "ERROR", message: msg }
    pushUiLog("Codex", "ERROR", `[${session.sessionKey}] turn.failed: ${msg}`)
    return
  }
  if (event.type === "error" || event.type === "thread.error") {
    const msg = formatCodexFailureMessage(buildCodexFailCtx(session, { message: event.message }))
    session.lastStatus = { status: "ERROR", message: msg }
    pushUiLog("Codex", "ERROR", `[${session.sessionKey}] thread.error: ${msg}`)
    return
  }

  pushUiLog("Codex", "WARN", `[${session.sessionKey}] 未识别 Codex 事件: ${(event as { type: string }).type}`)
}

export interface StreamCodexEventsOptions {
  resolveChannelType: (sessionKey: string) => string | undefined
  markActivity: (session: CodexSessionAgent, source: string) => void
  completeCodexRun: (session: CodexSessionAgent, exitCode: number | null, epoch?: CodexRunEpoch) => void
}

/** 异步遍历 Codex 事件流 */
export function streamCodexEvents(
  session: CodexSessionAgent,
  events: AsyncGenerator<CodexThreadEvent>,
  opts: StreamCodexEventsOptions,
): void {
  const { resolveChannelType, markActivity, completeCodexRun } = opts
  const sessionKey = session.sessionKey
  // 启动时捕获代际，供 completeCodexRun 校验旧 stream 不覆盖新 run
  const runEpoch = { runStartedAt: session.runStartedAt, runGuardToken: session.runGuardToken }
  void (async () => {
    let exitCode: number | null = 0
    try {
      for await (const event of events) {
        if (session.abortController.signal.aborted) break
        try {
          handleCodexEvent(session, event, resolveChannelType, markActivity)
        } catch (e: unknown) {
          const raw = e instanceof Error ? e.message : String(e)
          pushUiLog("Codex", "WARN", `[${sessionKey}] 事件处理异常: ${sanitizeCodexSensitiveText(raw)}`)
        }
      }
      flushCodexLog(session)
      closeCodexThinkingIfOpen(session, resolveChannelType)
    } catch (e: unknown) {
      exitCode = -1
      const raw = e instanceof Error ? e.message : String(e)
      pushUiLog("Codex", "ERROR", `[${sessionKey}] Codex 流异常: ${sanitizeCodexSensitiveText(raw)}`)
      session.lastStatus = { status: "ERROR", message: formatCodexFailureMessage(buildCodexFailCtx(session, e)) }
    } finally {
      completeCodexRun(session, exitCode, runEpoch)
    }
  })()
}
