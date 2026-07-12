/**
 * Daemon orchestrator launch/dispatch 失败用户可见文案 SSOT
 * daemon 与 electron run-failure-formatter 共用，禁止双份实现
 */

/** launch/dispatch 调度失败：归因错误串 → 用户 IM 文案 */
export function formatOrchestratorFailure(error?: string): string {
  if (!error?.trim()) return "Agent 启动失败，请稍后重试。"
  const e = error.trim()
  if (
    e.includes("冷却中") ||
    e.includes("未启用其他人") ||
    e.includes("未配置 API Key") ||
    e.includes("SDK 资源")
  ) {
    return e
  }
  if (e.includes("Agent API 未就绪")) return e
  return "Agent 启动失败，请稍后重试。"
}
