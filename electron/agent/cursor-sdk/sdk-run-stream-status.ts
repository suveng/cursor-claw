/**
 * SDK status 终态事件 → RunEvent 路由（拆分自 sdk-run-stream.ts）
 */
import type { RunLifecycle } from "../shared/run-lifecycle"
import { guardSdkPromise } from "./sdk-async-guard"
import { applySdkStreamRunEvent } from "./sdk-run-port-lifecycle"
import { isRunTimeoutFailure } from "./sdk-run-finalize"
import type { SdkSessionAgent } from "./sdk-session-types"

/** status ERROR/EXPIRED/CANCELLED 经 RunEvent 路由至 Lifecycle（非直调 notify） */
export function routeSdkStatusTerminal(
  session: SdkSessionAgent,
  lifecycle: RunLifecycle | undefined,
  status: string,
  message?: string,
): void {
  const isErr = status === "ERROR" || status === "EXPIRED"
  if (!isErr && status !== "CANCELLED") return
  if (
    session.abortController.signal.aborted ||
    !session.run ||
    session.watchdogTimedOut ||
    session.runFinalizing ||
    !lifecycle
  ) {
    return
  }
  const run = session.run
  if (isRunTimeoutFailure(session, run, { status, message })) {
    guardSdkPromise(
      applySdkStreamRunEvent(session, lifecycle, { type: "watchdog_timeout", trigger: "status" }, run),
      session.sessionKey,
      "applySdkStreamRunEvent:timeout-status",
      "ERROR",
    )
    return
  }
  if (status === "CANCELLED") {
    guardSdkPromise(
      applySdkStreamRunEvent(session, lifecycle, { type: "run_cancelled", reason: message }, run),
      session.sessionKey,
      "applySdkStreamRunEvent:cancelled",
      "ERROR",
    )
    return
  }
  if (isErr) {
    guardSdkPromise(
      applySdkStreamRunEvent(
        session,
        lifecycle,
        { type: "run_failed", reason: "run_error", detail: message },
        run,
      ),
      session.sessionKey,
      "applySdkStreamRunEvent:failed",
      "ERROR",
    )
  }
}
