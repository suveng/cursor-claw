/**
 * 长驻空闲后台预热：定时扫描 idle≥阈值的 resident session，
 * 后台 recreate（不必等用户发消息）；多会话串行 + jitter，防雪崩。
 */
import { pushUiLog } from "../../app/ui-logger"
import {
  recreateSessionAgent,
  RESIDENT_STALE_IDLE_MS,
} from "./sdk-resident-refresh"
import {
  isSdkSessionProcessing,
  sdkSessions,
  sleep,
} from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"

/** 扫描周期（timer.unref，不阻止进程退出） */
const SCAN_INTERVAL_MS = 60_000
/** 多会话串行 recreate 间隔基线 */
const BETWEEN_RECREATE_MS = 2_000
/** 串行间隔额外 jitter 上限 */
const BETWEEN_RECREATE_JITTER_MS = 3_000

let scanTimer: ReturnType<typeof setInterval> | null = null
/** 防止上一轮扫描未结束时重叠 tick */
let scanBusy = false
let exitHooked = false

/** 空闲 ≥ 阈值且非 processing 的长驻候选 */
function collectStaleResidentCandidates(now: number): SdkSessionAgent[] {
  const out: SdkSessionAgent[] = []
  for (const session of sdkSessions.values()) {
    if (session.abortController.signal.aborted) continue
    if (!session.residentMode) continue
    // processing / 有 run / pendingDispatch 一律跳过
    if (isSdkSessionProcessing(session)) continue
    const idleMs = now - session.lastActivityAt
    if (idleMs < RESIDENT_STALE_IDLE_MS) continue
    out.push(session)
  }
  // 最久空闲优先，避免总饿死同一批
  out.sort((a, b) => a.lastActivityAt - b.lastActivityAt)
  return out
}

/** 串行间隔 = 基线 + [0, jitter) */
function nextSerialDelayMs(): number {
  return BETWEEN_RECREATE_MS + Math.floor(Math.random() * BETWEEN_RECREATE_JITTER_MS)
}

/**
 * 单轮扫描：候选串行 recreate，同时只跑一个；
 * 与发前 maybeRefresh 共用 recreateSessionAgent 的 inFlight 闩。
 */
async function tickResidentBgWarmup(): Promise<void> {
  if (scanBusy) return
  scanBusy = true
  try {
    const now = Date.now()
    const candidates = collectStaleResidentCandidates(now)
    if (candidates.length === 0) return

    pushUiLog(
      "SDK",
      "INFO",
      `[resident-bg-warmup] scan candidates=${candidates.length}`,
    )

    for (let i = 0; i < candidates.length; i += 1) {
      const session = candidates[i]
      // 再检：扫描中途可能已 dispatch / 被发前 refresh
      if (session.abortController.signal.aborted) continue
      if (!session.residentMode) continue
      if (isSdkSessionProcessing(session)) continue
      const idleMs = Date.now() - session.lastActivityAt
      if (idleMs < RESIDENT_STALE_IDLE_MS) continue

      pushUiLog(
        "SDK",
        "WARN",
        `[${session.sessionKey}] resident-bg-warmup idle=${idleMs}ms`,
      )
      const ok = await recreateSessionAgent(session, "resident-bg-warmup")
      if (ok) {
        pushUiLog(
          "SDK",
          "INFO",
          `[${session.sessionKey}] resident-bg-warmup ok agentId=${session.agentId}`,
        )
      }
      // 多会话：本轮串行，间隔 + jitter 后再处理下一个
      if (i < candidates.length - 1) {
        await sleep(nextSerialDelayMs())
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    pushUiLog("SDK", "WARN", `[resident-bg-warmup] tick 异常: ${msg}`)
  } finally {
    scanBusy = false
  }
}

/** 进程退出时清 timer（与 stopAll 互补） */
function ensureExitHook(): void {
  if (exitHooked) return
  exitHooked = true
  process.once("exit", () => {
    stopResidentBgWarmup()
  })
}

/**
 * 启动后台预热扫描（幂等）。ensureAgentSdkHttpServer / 新建 session 后调用。
 */
export function startResidentBgWarmup(): void {
  if (scanTimer) return
  ensureExitHook()
  scanTimer = setInterval(() => {
    void tickResidentBgWarmup()
  }, SCAN_INTERVAL_MS)
  // 不阻止 Node/Electron 进程退出
  scanTimer.unref()
  pushUiLog(
    "SDK",
    "INFO",
    `[resident-bg-warmup] timer started interval=${SCAN_INTERVAL_MS}ms stale=${RESIDENT_STALE_IDLE_MS}ms`,
  )
}

/**
 * 停止扫描 timer（stopAllSdkSessions / 进程退出）。
 * 不清 recreate inFlight（由 recreateSessionAgent finally 自行释放）。
 */
export function stopResidentBgWarmup(): void {
  if (!scanTimer) return
  clearInterval(scanTimer)
  scanTimer = null
  pushUiLog("SDK", "INFO", "[resident-bg-warmup] timer stopped")
}
