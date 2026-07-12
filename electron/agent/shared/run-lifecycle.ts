/**
 * RunLifecycle 状态机骨架（一期 stub，不强制四引擎全量接入）
 */
import type {
  RunEvent,
  RunLifecycleSessionSlice,
  RunPhase,
  RunTerminalContext,
} from "./run-lifecycle-types.js"
import { completeRunFromTemplate } from "./run-complete-template.js"

export interface RunLifecycle {
  readonly phase: RunPhase
  enterGuard(): void
  onStreamEvent(event: RunEvent): void
  onWatchdog(event: RunEvent): void
  enterCompleting(ctx: RunTerminalContext): Promise<void>
  enterNotifying(ctx: RunTerminalContext): Promise<void>
  resume(): void
}

/** 创建 session 级 Lifecycle 实例 */
export function createRunLifecycle(session: RunLifecycleSessionSlice): RunLifecycle {
  let phase: RunPhase = "guarding"

  const setPhase = (next: RunPhase): void => {
    phase = next
  }

  return {
    get phase() {
      return phase
    },

    enterGuard(): void {
      setPhase("guarding")
    },

    onStreamEvent(event: RunEvent): void {
      if (phase === "guarding") setPhase("streaming")
      switch (event.type) {
        case "run_succeeded":
          setPhase("completing")
          break
        case "run_failed":
        case "run_cancelled":
        case "dispatch_rejected":
          setPhase("notifying")
          break
        default:
          break
      }
    },

    onWatchdog(event: RunEvent): void {
      if (phase === "streaming") setPhase("watching")
      if (event.type === "watchdog_timeout") setPhase("notifying")
    },

    async enterCompleting(ctx: RunTerminalContext): Promise<void> {
      if (session.runFinalizing) return
      session.runFinalizing = true
      setPhase("completing")
      await this.enterNotifying(ctx)
    },

    async enterNotifying(ctx: RunTerminalContext): Promise<void> {
      if (session.errorNotified && (ctx.source === "failure" || ctx.source === "watchdog")) return
      setPhase("notifying")
      await completeRunFromTemplate(session, {
        assistantText: ctx.assistantText,
        failure: ctx.failure,
        failureText: ctx.failureText,
        source: ctx.source,
      })
    },

    resume(): void {
      // S7 续接 stub：二～三期完善 errorNotified 重置与阶段恢复
      setPhase("guarding")
    },
  }
}
