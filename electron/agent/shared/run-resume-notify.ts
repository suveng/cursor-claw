/**
 * 主进程重启续接失败通知（四引擎共用，对称 Cursor sdk-run-recover）
 */
import { pushUiLog } from "../../app/ui-logger"
import { notifySessionChat } from "./run-notify"

/** 续接失败分类：可重试 vs 不可恢复（R3 IM 尾句 SSOT） */
export type ResumeFailureCategory = "retryable" | "unrecoverable"

const RETRYABLE_TAIL = "请稍后重新发送消息重试"
const UNRECOVERABLE_TAIL = "请重新发送消息开始新任务"

/** 瞬时网络 / server 不可达等可重试错误串标定 */
const RETRYABLE_DETAIL_PATTERNS: RegExp[] = [
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
  /network/i,
  /timeout/i,
  /temporarily/i,
  /health check failed/i,
  /external_health_failed/i,
  /内嵌启动失败/i,
  /服务暂不可用/i,
]

/** 终态 / 依赖缺失等不可恢复错误串标定 */
const UNRECOVERABLE_DETAIL_PATTERNS: RegExp[] = [
  /失效/,
  /已结束/,
  /not found/i,
  /不存在/,
  /未检测到.*CLI/i,
  /invalid session/i,
  /thread.*不可用/i,
]

/**
 * 将引擎 recover / probe 原始错误映射为用户 reason 与 category。
 * 不确定时偏 retryable（02 §八·（一）缓解误杀可续接 Run）。
 */
export function classifyResumeFailure(
  engine: "cc" | "codex" | "opencode",
  detail: string,
): { reason: string; category: ResumeFailureCategory } {
  const d = detail.trim()
  if (!d) return { reason: "会话恢复失败", category: "retryable" }

  if (/OpenCode session 已失效|会话已失效/.test(d)) {
    return { reason: "会话已失效", category: "unrecoverable" }
  }
  if (/运行已结束|CC session 不存在|Codex thread 不可用/.test(d)) {
    return { reason: "运行已结束", category: "unrecoverable" }
  }
  if (/未检测到 Codex CLI/.test(d)) {
    return { reason: d, category: "unrecoverable" }
  }

  if (engine === "opencode" && /external|health|内嵌|embedded|启动失败/i.test(d) && !/失效/.test(d)) {
    return { reason: "会话恢复失败", category: "retryable" }
  }

  for (const p of UNRECOVERABLE_DETAIL_PATTERNS) {
    if (p.test(d)) {
      const reason = /失效/.test(d) ? "会话已失效" : /CLI/.test(d) ? d : "运行已结束"
      return { reason, category: "unrecoverable" }
    }
  }

  for (const p of RETRYABLE_DETAIL_PATTERNS) {
    if (p.test(d)) return { reason: "会话恢复失败", category: "retryable" }
  }

  // 无明确终态信号时偏可重试，避免探活过严误杀
  void engine
  return { reason: "会话恢复失败", category: "retryable" }
}

/** 续接失败：向原 session 下发一次可理解 IM 提示 */
export async function notifyResumeFailure(
  sessionKey: string,
  reason: string,
  category: ResumeFailureCategory = "unrecoverable",
): Promise<void> {
  const tail = category === "retryable" ? RETRYABLE_TAIL : UNRECOVERABLE_TAIL
  const text = `⚠️ 未能自动续接上次任务（${reason}），${tail}。`
  pushUiLog("SDK", "WARN", `[recover] notifyResumeFailure sessionKey=${sessionKey} reason=${reason}`)
  await notifySessionChat(sessionKey, text, { stop_progress: true })
}
