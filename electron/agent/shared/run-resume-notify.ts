/**
 * 主进程重启续接失败通知（四引擎共用，对称 Cursor sdk-run-recover）
 */
import { pushUiLog } from "../../app/ui-logger"
import { notifySessionChat } from "./run-notify"

const RESUME_FAIL_USER_HINT = "请重新发送消息继续"

/** 续接失败：向原 session 下发一次可理解 IM 提示 */
export async function notifyResumeFailure(sessionKey: string, reason: string): Promise<void> {
  const text = `⚠️ 未能自动续接上次任务（${reason}），${RESUME_FAIL_USER_HINT}。`
  pushUiLog("SDK", "WARN", `[recover] notifyResumeFailure sessionKey=${sessionKey} reason=${reason}`)
  await notifySessionChat(sessionKey, text, { stop_progress: true })
}
