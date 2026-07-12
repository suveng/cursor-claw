/**
 * Daemon orchestrator 用户 IM 通知（失败文案见 src/shared/orchestrator-failure-formatter）
 */
import { formatOrchestratorFailure } from "../shared/orchestrator-failure-formatter.js"

export { formatOrchestratorFailure }

export interface OrchestratorNotifyDeps {
  httpJson: <T = unknown>(url: string, body?: unknown, timeoutMs?: number) => Promise<T>
  localDaemonUrl: (p: string) => string
  log: (level: string, ...args: unknown[]) => void
}

/** 工厂：注入 daemon HTTP 依赖，供 orchestrator 与 HTTP 路由共用 */
export function createOrchestratorNotify(deps: OrchestratorNotifyDeps) {
  async function notifySessionUser(
    sessionKey: string,
    text: string,
    stopProgress = false,
  ): Promise<void> {
    try {
      await deps.httpJson(deps.localDaemonUrl("/api/send-text"), {
        text,
        session_key: sessionKey,
        ...(stopProgress && { stop_progress: true }),
      }, 10_000)
    } catch (e: unknown) {
      deps.log(
        "WARN",
        `notifySessionUser 失败 session=${sessionKey}: ${e instanceof Error ? e.message : e}`,
      )
    }
  }

  return { notifySessionUser, formatOrchestratorFailure }
}
