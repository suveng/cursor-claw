/**
 * 长工具卡住可操作提示（LITE-04）：默认 10min，每 tool 至多 1 次。
 * 与 LITE-01 心跳分工：本模块仅在 tool_running 超时触发，不负责静默续期。
 */
import { formatToolStuckHintText } from "../../../src/shared/tool-presentation.js"
import { notifySessionChat } from "../shared/run-notify"
import { pushUiLog } from "../../app/ui-logger"
import type { SdkSessionAgent } from "./sdk-session-types"

/** 默认 10 分钟；可用 SDK_TOOL_STUCK_MS 覆盖（毫秒） */
export const DEFAULT_TOOL_STUCK_MS = 10 * 60 * 1000

export function resolveToolStuckMs(): number {
  const raw = Number(process.env.SDK_TOOL_STUCK_MS)
  if (Number.isFinite(raw) && raw >= 60_000) return raw
  return DEFAULT_TOOL_STUCK_MS
}

/** 清除卡住计时器与 since（工具结束）；hintSent 由 Run 复位清零 */
export function clearToolStuckTimer(session: SdkSessionAgent): void {
  if (session.toolStuckTimer) {
    clearTimeout(session.toolStuckTimer)
    session.toolStuckTimer = undefined
  }
  session.toolRunningSince = undefined
}

/** Run 复位：清 timer + since + 已提示集合 */
export function resetToolStuckState(session: SdkSessionAgent): void {
  clearToolStuckTimer(session)
  session.toolStuckHintSent = undefined
}

/**
 * tool_call running：记录 toolRunningSince 并武装超时提示（同 tool 已提示则跳过）。
 */
export function armToolStuckHint(session: SdkSessionAgent, toolName: string): void {
  clearToolStuckTimer(session)
  const name = toolName.trim()
  if (!name) return
  session.toolRunningSince = Date.now()
  if (session.toolStuckHintSent?.has(name)) return

  const stuckMs = resolveToolStuckMs()
  const timer = setTimeout(() => {
    void fireToolStuckHint(session, name, stuckMs)
  }, stuckMs)
  timer.unref?.()
  session.toolStuckTimer = timer
}

async function fireToolStuckHint(
  session: SdkSessionAgent,
  toolName: string,
  stuckMs: number,
): Promise<void> {
  session.toolStuckTimer = undefined
  if (session.abortController.signal.aborted) return
  if (session.runPhase !== "tool_running") return
  if (session.lastTool?.name !== toolName || session.lastTool.status !== "running") return
  if (session.toolStuckHintSent?.has(toolName)) return

  if (!session.toolStuckHintSent) session.toolStuckHintSent = new Set()
  session.toolStuckHintSent.add(toolName)

  const mins = stuckMs / 60_000
  const text = formatToolStuckHintText(toolName, mins)
  pushUiLog("SDK", "INFO", `[${session.sessionKey}] tool_stuck_hint tool=${toolName} ms=${stuckMs}`)
  try {
    // 不传 stop_progress：任务仍在进行，仅提示可操作
    await notifySessionChat(session.sessionKey, text)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    pushUiLog("SDK", "WARN", `[${session.sessionKey}] tool_stuck_hint 失败: ${msg}`)
  }
}
