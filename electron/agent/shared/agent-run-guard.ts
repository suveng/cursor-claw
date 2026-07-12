import { randomUUID } from "node:crypto"
import { formatRunFailureMessage } from "./run-failure-formatter.js"
import { notifySessionChat } from "./run-notify.js"
import type { RunLifecycle } from "./run-lifecycle.js"

type GuardState = {
  token: string
  acquiredAt: number
  completed: boolean
}

export interface RunGuardAcquireResult {
  token: string
  acquired: boolean
  holder?: string
}

/** enterGuardWithLifecycle 结果：allowed | busy | stale_aborted */
export type GuardEnterResult = "allowed" | "busy" | "stale_aborted"

export interface GuardLifecycleSession {
  sessionKey: string
  errorNotified?: boolean
  staleAborted?: boolean
}

export interface WatchRunGuardInput {
  sessionKey: string
  token: string
  timeoutMs: number
  tickMs: number
  onTimeout?: () => Promise<void> | void
  onTick?: () => Promise<"completed" | "cancelled" | "timeout" | void> | "completed" | "cancelled" | "timeout" | void
}

const guardBySession = new Map<string, GuardState>()

/**
 * 同 session 严格单飞：仅一个 token 可持有执行权。
 */
export function acquireRunGuard(sessionKey: string): RunGuardAcquireResult {
  const existing = guardBySession.get(sessionKey)
  const token = randomUUID()
  if (existing && !existing.completed) {
    return { token, acquired: false, holder: existing.token }
  }
  guardBySession.set(sessionKey, { token, acquiredAt: Date.now(), completed: false })
  return { token, acquired: true }
}

/** busy 时经 shared formatter + notify 发出一次说明（S8，不静默丢弃） */
async function notifyGuardBusy(session: GuardLifecycleSession): Promise<void> {
  if (session.errorNotified) return
  session.errorNotified = true
  const text = formatRunFailureMessage({
    reason: "session_abnormal",
    detail: "agent_busy",
    sessionKey: session.sessionKey,
  })
  await notifySessionChat(session.sessionKey, text, { stop_progress: true })
}

/**
 * 与 RunLifecycle.enterGuard 衔接的 guard 包装；busy 时 IM 通知用户
 */
export function enterGuardWithLifecycle(
  session: GuardLifecycleSession,
  lifecycle?: Pick<RunLifecycle, "enterGuard">,
): RunGuardAcquireResult & { result: GuardEnterResult } {
  lifecycle?.enterGuard()
  if (session.staleAborted) {
    return { token: randomUUID(), acquired: false, result: "stale_aborted" }
  }
  const guard = acquireRunGuard(session.sessionKey)
  if (!guard.acquired) {
    void notifyGuardBusy(session)
    return { ...guard, result: "busy" }
  }
  return { ...guard, result: "allowed" }
}

/**
 * 幂等释放：token 不匹配或已释放均静默。
 */
export function releaseRunGuard(sessionKey: string, token: string): void {
  const state = guardBySession.get(sessionKey)
  if (!state || state.token !== token) return
  guardBySession.delete(sessionKey)
}

/**
 * 标记完成后 watchdog 将收敛为 completed。
 */
export function completeRunGuard(sessionKey: string, token: string): void {
  const state = guardBySession.get(sessionKey)
  if (!state || state.token !== token) return
  state.completed = true
}

/**
 * watchdog：统一超时判定入口，超时回调交由调用方执行 cancel/finalize。
 */
export async function watchRunGuard(input: WatchRunGuardInput): Promise<"completed" | "timeout" | "cancelled"> {
  const tick = Math.max(200, input.tickMs)
  const startedAt = Date.now()
  while (true) {
    const state = guardBySession.get(input.sessionKey)
    if (!state || state.token !== input.token) return "cancelled"
    if (state.completed) return "completed"
    const phase = await input.onTick?.()
    if (phase === "completed" || phase === "cancelled") return phase
    if (phase === "timeout") {
      await input.onTimeout?.()
      return "timeout"
    }
    if (Date.now() - startedAt >= input.timeoutMs) {
      await input.onTimeout?.()
      return "timeout"
    }
    await new Promise((resolve) => setTimeout(resolve, tick))
  }
}

/** 调试辅助：返回当前持有时长（ms），无持有返回 null。 */
export function getRunGuardHeldMs(sessionKey: string): number | null {
  const state = guardBySession.get(sessionKey)
  if (!state) return null
  return Math.max(0, Date.now() - state.acquiredAt)
}
