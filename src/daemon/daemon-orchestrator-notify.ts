/**
 * Daemon orchestrator 用户 IM 通知（失败文案见 src/shared/orchestrator-failure-formatter）
 */
import { formatOrchestratorFailure } from "../shared/orchestrator-failure-formatter.js"

export { formatOrchestratorFailure }

export interface OrchestratorNotifyDeps {
  httpJson: <T = unknown>(url: string, body?: unknown, timeoutMs?: number) => Promise<T>
  localDaemonUrl: (p: string) => string
  log: (level: string, ...args: unknown[]) => void
  /** HTTP 失败时仍须停进度（避免残留 typing） */
  stopSessionProgress?: (sessionKey: string) => void
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
      // send-text 未达达时本地补停，与 stop_progress 语义对齐
      if (stopProgress) deps.stopSessionProgress?.(sessionKey)
    }
  }

  return { notifySessionUser, formatOrchestratorFailure }
}
