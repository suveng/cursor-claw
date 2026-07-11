/**
 * 上下文占用 helper：usage 合并、模型上限查表、footer 格式化。
 * 供 agent-sdk 在 onDelta / final flush 路径调用。
 */
import type { InteractionUpdate } from "@cursor/sdk"
import { evaluatePreSendContextPressureCore, logTurnEndedHighWatermark } from "./context-usage-pressure"

export { HIGH_WATERMARK_RATIO } from "./context-usage-pressure"
export { resolveContextLimitForSession, resolveModelContextLimit } from "./context-usage-model-limit"

/** turn-ended.usage 最小字段（与 SDK TurnUsageInput 对齐） */
export interface TurnUsageSlice {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** 展示用 token 用量快照（turn-ended 时 replace 为最后一轮，非 Run 内累加） */
export interface ContextUsageState {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export const ZERO_CONTEXT_USAGE: ContextUsageState = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

type UiLogFn = (channel: string, level: string, message: string) => void

/** 压缩/活跃回调：onCompression 飞书通知；onActivity 刷新 watchdog */
export type CompressionNotifyFn = (phase: "started" | "completed") => void
export type CreateAgentSendOptionsOpts = { onCompression?: CompressionNotifyFn; onActivity?: () => void }

/** 合并单 turn usage（遗留导出；展示态用 setTurnUsage） */
export function mergeTurnUsage(s: ContextUsageState, u: TurnUsageSlice): ContextUsageState {
  return {
    inputTokens: s.inputTokens + (u.inputTokens || 0),
    outputTokens: s.outputTokens + (u.outputTokens || 0),
    cacheReadTokens: s.cacheReadTokens + (u.cacheReadTokens || 0),
    cacheWriteTokens: s.cacheWriteTokens + (u.cacheWriteTokens || 0),
  }
}

/** 用单 turn usage 替换展示态（当前 turn 快照，供 peak 比较） */
export function setTurnUsage(_state: ContextUsageState, usage: TurnUsageSlice): ContextUsageState {
  return {
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    cacheReadTokens: usage.cacheReadTokens || 0,
    cacheWriteTokens: usage.cacheWriteTokens || 0,
  }
}

/** 含 peak / Run 结束时 footer 用量的 session 展示态 */
export interface ContextUsageDisplaySession {
  contextUsage: ContextUsageState
  contextUsagePeakTokens?: number
  /** Run 结束时 SDK run.usage.totalTokens；footer 优先使用 */
  contextUsageFromRunTotal?: number
  /** 本 Run 是否已 finalize（防重复 wait / 重复日志） */
  contextUsageFinalized?: boolean
}

/** turn-ended：更新当前快照，并抬升 session 级 peak（同 Run 末轮偏低时仍反映峰值） */
export function updateContextUsageDisplay(
  session: ContextUsageDisplaySession,
  usage: TurnUsageSlice,
): void {
  session.contextUsage = setTurnUsage(session.contextUsage, usage)
  const used = totalContextTokens(session.contextUsage)
  if (used > 0) {
    session.contextUsagePeakTokens = Math.max(session.contextUsagePeakTokens ?? 0, used)
  }
}

/** 压缩完成后清除 peak，后续 turn 以压缩后用量为基准 */
export function resetContextUsagePeak(session: ContextUsageDisplaySession): void {
  session.contextUsagePeakTokens = undefined
}

/** footer 展示用量：当前 turn 与 session peak 取大 */
export function resolveDisplayContextTokens(
  state: ContextUsageState,
  peakTokens?: number,
): number {
  const current = totalContextTokens(state)
  if (peakTokens == null || peakTokens <= 0) return current
  return Math.max(current, peakTokens)
}

/** 计算 prompt 侧已用 token（input + cache 读写，不含 output，反映窗口占用而非 billing） */
export function totalContextTokens(state: ContextUsageState): number {
  return state.inputTokens + state.cacheReadTokens + state.cacheWriteTokens
}

/** token 数格式化为 k 单位（≥1000 用 k，整数省略小数） */
export function formatTokensK(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0"
  if (tokens < 1000) return String(Math.round(tokens))
  const k = tokens / 1000
  return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`
}

/** 格式化 footer；无效返回 null */
export function formatContextFooter(
  state: ContextUsageState,
  limitTokens: number | null | undefined,
  peakTokens?: number,
  /** Run 结束时 run.usage.totalTokens，优先于 turn-ended 推算 */
  usedOverride?: number,
): string | null {
  const used = usedOverride != null && usedOverride > 0
    ? usedOverride
    : resolveDisplayContextTokens(state, peakTokens)
  if (used <= 0) return null
  const hasLimit = limitTokens != null && Number.isFinite(limitTokens) && limitTokens > 0
  if (hasLimit) {
    const percent = Math.min(100, Math.max(0, Math.round((used / limitTokens) * 100)))
    return `\n\n---\n上下文：${percent}% (${formatTokensK(used)}/${formatTokensK(limitTokens)})`
  }
  return `\n\n---\n上下文：已用 ${formatTokensK(used)}`
}

/** 在正文末尾安全 append footer；footer 为 null 或正文已含「上下文：」则原样返回 */
export function appendContextFooter(body: string, footer: string | null): string {
  if (!footer) return body
  if (body.includes("上下文：")) return body
  return body + footer
}

/** send 前只读压力评估（T2 契约：session + log，不阻断 send） */
export function evaluatePreSendContextPressure(
  session: ContextUsageDisplaySession & { sessionKey: string; contextLimitTokens?: number },
  log: UiLogFn,
  options?: { highWatermarkRatio?: number },
): { ratio: number | null; used: number; limit: number | null } {
  const used = resolveDisplayContextTokens(session.contextUsage, session.contextUsagePeakTokens)
  return evaluatePreSendContextPressureCore(session.sessionKey, used, session.contextLimitTokens, log, options)
}

/** onDelta 回调体：turn-ended 快照、高水位与 summary 压缩日志 */
export function handleAgentSendDelta(
  session: ContextUsageDisplaySession & { sessionKey: string; contextLimitTokens?: number },
  update: InteractionUpdate,
  log: UiLogFn,
  onCompression?: CompressionNotifyFn,
  onActivity?: () => void,
): void {
  if (update.type === "turn-ended") {
    if (update.usage) updateContextUsageDisplay(session, update.usage)
    const used = resolveDisplayContextTokens(session.contextUsage, session.contextUsagePeakTokens)
    logTurnEndedHighWatermark(session.sessionKey, used, session.contextLimitTokens, log)
    onActivity?.()
    return
  }
  if (update.type === "summary-started") {
    log("SDK", "INFO", `[${session.sessionKey}] [compression] 上下文压缩开始`)
    onCompression?.("started")
    onActivity?.()
    return
  }
  if (update.type === "summary-completed") {
    log("SDK", "INFO", `[${session.sessionKey}] [compression] 上下文压缩完成`)
    resetContextUsagePeak(session)
    onCompression?.("completed")
    onActivity?.()
    return
  }
  if (update.type === "summary") {
    log("SDK", "INFO", `[${session.sessionKey}] [compression] ${update.summary}`)
  }
}

/** 为 agent.send 构造 onDelta（harness 默认 summarization，SDK 无 autoCompress） */
export function createAgentSendOptions(
  session: ContextUsageDisplaySession & { sessionKey: string },
  log: UiLogFn,
  optsOrCompression?: CompressionNotifyFn | CreateAgentSendOptionsOpts,
): { onDelta: (args: { update: InteractionUpdate }) => void } {
  const opts: CreateAgentSendOptionsOpts = typeof optsOrCompression === "function"
    ? { onCompression: optsOrCompression }
    : (optsOrCompression ?? {})
  return {
    onDelta: (args) => {
      try {
        handleAgentSendDelta(session, args.update, log, opts.onCompression, opts.onActivity)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        log("SDK", "WARN", `[${session.sessionKey}] onDelta 处理异常: ${msg}`)
      }
    },
  }
}
