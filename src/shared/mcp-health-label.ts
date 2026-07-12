/**
 * MCP 健康状态展示文案 SSOT（Daemon admin、斜杠 /mcp、Session 面板共用口径）
 * 禁止返回裸「未知」；agent-api 未就绪时须输出可读降级句。
 */

/** 纯中文健康文案（HTTP admin info、buildMcpServerInfo 等） */
export function formatMcpHealthDisplay(status?: string, healthError?: string): string {
  if (healthError) return `暂不可查（${healthError}）`
  if (!status) return "暂不可查（依赖未就绪）"
  if (status === "ready") return "可连接"
  if (status === "disabled") return "已禁用"
  if (status === "needs_login") return "需 OAuth 授权"
  return status
}

/** IM 斜杠/飞书输出：emoji 前缀 + SSOT 降级语义 */
export function formatMcpHealthDisplayIm(status?: string, healthError?: string): string {
  if (healthError || !status) return `🟠 ${formatMcpHealthDisplay(status, healthError)}`
  if (status === "ready") return "🟢 可连接"
  if (status === "disabled") return "⚪ 已禁用"
  if (status === "needs_login") return "🟡 需 OAuth 授权"
  return `🔴 ${status}`
}

/** Session 面板 status 列：disk 来源空 status 标「未探测」，其余走降级句 */
export function formatMcpPanelStatusLabel(
  rawStatus: string | undefined,
  source: "runtime" | "snapshot" | "disk",
): string {
  if (rawStatus === "ready" || rawStatus === "enabled") return "ready"
  if (rawStatus === "disabled") return "disabled"
  if (rawStatus === "needs_login") return "需授权"
  if (!rawStatus) return source === "disk" ? "未探测" : formatMcpHealthDisplay(undefined)
  return rawStatus
}
