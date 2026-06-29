/**
 * Claude Code SDK 事件解析与子进程流监听
 *
 * 包含：
 * - stream-json 事件接口定义（CcSystemEvent / CcAssistantEvent 等）
 * - parseCcEvent：JSONL 行解析
 * - handleCcEvent：单事件分派处理（更新 session 状态 & 推送 presentation）
 * - armCcWatchdog：空闲超时看门狗
 * - streamCcEvents：子进程 stdout/stderr/close/error 流监听
 */
import type { ChildProcess } from "node:child_process"
import { pushUiLog } from "./ui-logger"
import { updateContextUsageDisplay, type TurnUsageSlice } from "./context-usage"
import { watchRunGuard } from "./agent-run-guard"
import type { CcSessionAgent } from "./agent-cc-types"
import {
  flushCcLog, appendCcLog, appendStreamDelta,
  closeThinkingIfOpen, markProcessEventSeen, postPresentationEvent,
} from "./agent-cc-stream"

// ── stream-json 事件结构（JSONL 每行一条） ────────────────────────────────────

export interface CcSystemEvent {
  type: "system"; subtype: "init"; session_id: string; model?: string
}

export interface CcMessageContentBlock {
  type: "text" | "tool_use" | "thinking" | "tool_result" | string
  text?: string; name?: string; id?: string; input?: unknown
  tool_use_id?: string; content?: string; is_error?: boolean
}

export interface CcAssistantEvent {
  type: "assistant"
  message: {
    content: CcMessageContentBlock[]
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  }
  session_id?: string
}

export interface CcUserEvent {
  type: "user"
  message: { content: CcMessageContentBlock[] }
  tool_use_result?: { stdout?: string; stderr?: string; interrupted?: boolean }
}

export interface CcResultEvent {
  type: "result"; subtype: "success" | "error"; is_error: boolean
  result?: string; duration_ms?: number
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  session_id?: string; error?: string
}

/** 所有可能的 stream-json 事件联合类型 */
export type CcStreamEvent = CcSystemEvent | CcAssistantEvent | CcUserEvent | CcResultEvent | { type: string }

// ── 事件解析 ──────────────────────────────────────────────────────────────────

/** 解析 JSONL 单行为事件对象；非 JSON 或空行返回 null */
export function parseCcEvent(line: string): CcStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try { return JSON.parse(trimmed) as CcStreamEvent } catch { return null }
}

/** 将 assistant usage 字段映射为 TurnUsageSlice */
export function mapContentBlockToUsage(usage?: CcAssistantEvent["message"]["usage"]): TurnUsageSlice | null {
  if (!usage) return null
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

// ── 事件分派处理 ──────────────────────────────────────────────────────────────

/**
 * 处理单条 CC 事件，更新 session 状态并推送 presentation / stream 通知。
 * @param resolveChannelType 由主模块注入，用于飞书抑制判断
 * @param markActivity 由主模块注入，更新 session 活跃时间
 */
export function handleCcEvent(
  session: CcSessionAgent,
  event: CcStreamEvent,
  resolveChannelType: (sessionKey: string) => string | undefined,
  markActivity: (session: CcSessionAgent, source: string) => void,
): void {
  markActivity(session, `event:${event.type}`)

  if (event.type === "system" && (event as CcSystemEvent).subtype === "init") {
    const sysEvt = event as CcSystemEvent
    if (sysEvt.session_id) {
      pushUiLog("CC", "INFO", `[${session.sessionKey}] cc_session_id=${sysEvt.session_id}`)
      session.ccSessionId = sysEvt.session_id
    }
    if (sysEvt.model) session.modelId = sysEvt.model
    return
  }

  if (event.type === "assistant") {
    const assistEvt = event as CcAssistantEvent
    closeThinkingIfOpen(session, resolveChannelType)
    for (const block of assistEvt.message.content) {
      if (block.type === "text" && block.text) {
        if (session.f41Stream) appendStreamDelta(session, block.text)
        else appendCcLog(session, "text", block.text)
      } else if (block.type === "thinking" && block.text) {
        appendCcLog(session, "thinking", block.text)
        markProcessEventSeen(session)
        session.thinkingOpen = true
        void postPresentationEvent(session, { kind: "thinking", delta: block.text }, resolveChannelType)
      } else if (block.type === "tool_use" && block.name) {
        flushCcLog(session)
        closeThinkingIfOpen(session, resolveChannelType)
        const toolName = block.name
        session.lastTool = { name: toolName, status: "running" }
        markProcessEventSeen(session)
        if (session.toolPresentationOutboundIds) session.toolPresentationOutboundIds.delete(toolName)
        void postPresentationEvent(session, { kind: "tool", tool_name: toolName, tool_status: "started", final: false }, resolveChannelType)
      }
    }
    const usageSlice = mapContentBlockToUsage(assistEvt.message.usage)
    if (usageSlice) updateContextUsageDisplay(session, usageSlice)
    return
  }

  if (event.type === "user") {
    const userEvt = event as CcUserEvent
    for (const block of userEvt.message.content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        const toolName = session.lastTool?.name ?? "unknown_tool"
        const isError = block.is_error === true
        session.lastTool = { name: toolName, status: isError ? "error" : "completed" }
        void postPresentationEvent(session, { kind: "tool", tool_name: toolName, tool_status: isError ? "failed" : "completed", final: true }, resolveChannelType)
      }
    }
    return
  }

  if (event.type === "result") {
    const resultEvt = event as CcResultEvent
    if (resultEvt.session_id) session.ccSessionId = resultEvt.session_id
    if (resultEvt.usage) {
      const usageSlice = mapContentBlockToUsage(resultEvt.usage)
      if (usageSlice) updateContextUsageDisplay(session, usageSlice)
    }
    if (resultEvt.duration_ms) {
      pushUiLog("CC", "INFO", `[${session.sessionKey}] result: subtype=${resultEvt.subtype} duration=${resultEvt.duration_ms}ms`)
    }
    if (resultEvt.is_error || resultEvt.subtype === "error") {
      session.lastStatus = { status: "ERROR", message: resultEvt.error ?? resultEvt.result ?? "unknown error" }
    }
    return
  }
}

// ── watchdog ──────────────────────────────────────────────────────────────────

/** armCcWatchdog 配置参数 */
export interface ArmWatchdogOptions {
  idleTimeoutMs: number
  tickMs: number
  absoluteTimeoutMs: number
  /** 从 CC_SESSIONS 查找 session（依赖注入避免循环） */
  getSession: (sessionKey: string) => CcSessionAgent | undefined
  /** 切换 watchdogState（依赖注入） */
  setWatchdogState: (session: CcSessionAgent, next: "running" | "draining" | "cancelling", reason: string) => void
}

/** 启动 CC 进程的空闲超时看门狗 */
export function armCcWatchdog(session: CcSessionAgent, token: string, opts: ArmWatchdogOptions): void {
  const { idleTimeoutMs, tickMs, absoluteTimeoutMs, getSession, setWatchdogState } = opts
  void watchRunGuard({
    sessionKey: session.sessionKey, token, timeoutMs: absoluteTimeoutMs, tickMs,
    onTick: () => {
      const s = getSession(session.sessionKey)
      if (!s || s.runGuardToken !== token) return "cancelled"
      if (!s.child) return "completed"
      if (s.watchdogState === "running") {
        const idleMs = Date.now() - s.lastActivityAt
        if (idleMs >= idleTimeoutMs) { setWatchdogState(s, "draining", `idle ${idleMs}ms`); return undefined }
      }
      if (s.watchdogState === "draining") {
        const drainingMs = Date.now() - s.watchdogStateAt
        if (drainingMs > 15_000) { setWatchdogState(s, "cancelling", "drain_grace_exceeded"); return "timeout" }
      }
      return undefined
    },
    onTimeout: async () => {
      const s = getSession(session.sessionKey)
      if (!s || s.child === null) return
      pushUiLog("CC", "WARN", `[${session.sessionKey}] watchdog 超时，终止子进程`)
      try { s.child.kill("SIGTERM") } catch { /* best-effort */ }
      await new Promise((r) => setTimeout(r, 3000))
      try { s.child?.kill("SIGKILL") } catch { /* best-effort */ }
    },
  }).then((result) => {
    pushUiLog("CC", "INFO", `[${session.sessionKey}] watchdog 结束: ${result}`)
  })
}

// ── 子进程事件流监听 ───────────────────────────────────────────────────────────

/** streamCcEvents 依赖注入配置 */
export interface StreamCcEventsOptions {
  /** 用于飞书抑制判断 */
  resolveChannelType: (sessionKey: string) => string | undefined
  /** 更新 session 活跃时间 */
  markActivity: (session: CcSessionAgent, source: string) => void
  /** 进程结束回调 */
  completeCcRun: (session: CcSessionAgent, exitCode: number | null) => void
}

/** 监听子进程 stdout/stderr/close/error，解析并分派 CC stream-json 事件 */
export function streamCcEvents(session: CcSessionAgent, child: ChildProcess, opts: StreamCcEventsOptions): void {
  const { resolveChannelType, markActivity, completeCcRun } = opts
  const sessionKey = session.sessionKey
  let lineBuffer = ""

  child.stdout?.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString("utf-8")
    const lines = lineBuffer.split("\n")
    lineBuffer = lines.pop() ?? ""
    for (const line of lines) {
      const event = parseCcEvent(line)
      if (event) {
        try { handleCcEvent(session, event, resolveChannelType, markActivity) } catch (e: unknown) {
          pushUiLog("CC", "WARN", `[${sessionKey}] 事件处理异常: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trim()
    if (text) pushUiLog("CC", "WARN", `[${sessionKey}] stderr: ${text}`)
  })

  child.on("close", (code) => {
    if (lineBuffer.trim()) {
      const event = parseCcEvent(lineBuffer)
      if (event) { try { handleCcEvent(session, event, resolveChannelType, markActivity) } catch { /* best-effort */ } }
      lineBuffer = ""
    }
    pushUiLog("CC", code === 0 ? "INFO" : "WARN", `[${sessionKey}] 子进程退出 (code=${code})`)
    completeCcRun(session, code)
  })

  child.on("error", (err) => {
    pushUiLog("CC", "ERROR", `[${sessionKey}] 子进程错误: ${err.message}`)
    session.lastStatus = { status: "ERROR", message: err.message }
    completeCcRun(session, -1)
  })
}
