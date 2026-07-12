/**
 * 四引擎主进程 recover 编排（init 后统一触发）
 */
import { recoverSdkActiveRuns } from "../cursor-sdk/sdk-run-recover"
import type { RecoverSummary } from "../cursor-sdk/sdk-session-types"
import { recoverCcActiveRuns } from "../claude-code/cc-run-recover"
import { recoverCodexActiveRuns } from "../codex/codex-run-recover"
import { recoverOpencodeActiveRuns } from "../opencode/opencode-run-recover"
import { pushUiLog } from "../../app/ui-logger"

/** 四引擎 recover 汇总 */
export interface RecoverAllSummary {
  sdk: RecoverSummary
  cc: RecoverSummary
  codex: RecoverSummary
  opencode: RecoverSummary
}

const EMPTY_SUMMARY: RecoverSummary = { resumed: 0, failed: 0, skipped: 0 }

/** 顺序调用四引擎 recover；单引擎异常不阻断其余 */
export async function recoverAllActiveRuns(): Promise<RecoverAllSummary> {
  const summary: RecoverAllSummary = {
    sdk: { ...EMPTY_SUMMARY },
    cc: { ...EMPTY_SUMMARY },
    codex: { ...EMPTY_SUMMARY },
    opencode: { ...EMPTY_SUMMARY },
  }

  try {
    summary.sdk = await recoverSdkActiveRuns()
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    pushUiLog("SDK", "WARN", `[recover] recoverSdkActiveRuns 异常: ${detail}`)
  }

  try {
    summary.cc = await recoverCcActiveRuns()
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    pushUiLog("CC", "WARN", `[recover] recoverCcActiveRuns 异常: ${detail}`)
  }

  try {
    summary.codex = await recoverCodexActiveRuns()
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    pushUiLog("Codex", "WARN", `[recover] recoverCodexActiveRuns 异常: ${detail}`)
  }

  try {
    summary.opencode = await recoverOpencodeActiveRuns()
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    pushUiLog("OpenCode", "WARN", `[recover] recoverOpencodeActiveRuns 异常: ${detail}`)
  }

  pushUiLog(
    "SDK",
    "INFO",
    `[recover] recoverAllActiveRuns 完成 sdk=${formatSummary(summary.sdk)} cc=${formatSummary(summary.cc)} codex=${formatSummary(summary.codex)} opencode=${formatSummary(summary.opencode)}`,
  )
  return summary
}

function formatSummary(s: RecoverSummary): string {
  return `resumed=${s.resumed} failed=${s.failed} skipped=${s.skipped}`
}
