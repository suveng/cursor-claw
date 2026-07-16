/**
 * Claude Agent SDK 执行引擎（入口 & 核心）
 * 使用 @anthropic-ai/claude-agent-sdk query() API，映射 PresentationEvent。
 * 拆分：agent-cc-types / agent-cc-utils / agent-cc-stream / agent-cc-events / agent-cc-http
 */
import { query } from "@anthropic-ai/claude-agent-sdk"
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { pushUiLog } from "../../app/ui-logger"
import {
  ZERO_CONTEXT_USAGE,
  resolveContextLimitForSession,
  resetContextUsagePeak,
  resolveDisplayContextTokens,
} from "../cursor-sdk/context-usage"
import { type ChatType, buildPrompt } from "../shared/agent-launcher"
import { completeRunGuard, releaseRunGuard, enterGuardWithLifecycle } from "../shared/agent-run-guard"
import { createRunLifecycle } from "../shared/run-lifecycle"
import { maybeRotateContext } from "../cursor-sdk/context-rotation-lite"

import type { CcSessionAgent } from "./agent-cc-types"
import {
  resolveSessionChannelType, f41Eligible, ccResidentModeEnabled,
  resetCcRunPresentationState, setWatchdogState, markSessionActivity,
} from "./agent-cc-utils"
import { buildQueryOptions } from "./cc-query-options"
import { killCcSpawnedProcess } from "./cc-spawn-process"
import { notifySessionChat, clearStreamPostTimer, broadcastCcSessionStatus, completeCcRun } from "./agent-cc-stream"
import { stopSessionChatProgress } from "../shared/run-notify"
import { armCcWatchdog, streamCcSdkMessages } from "./agent-cc-events"
import { registerCcLaunchHandler, registerCcDispatchHandler } from "./agent-cc-http"
import { PLATFORM_RUN_LIMIT_MS } from "../cursor-sdk/finalize-sdk-run"
import { CC_SESSIONS } from "./agent-cc-session-registry"
import { persistCcActiveRunSnapshot } from "./cc-run-persist"
import { markCcRunUserStopped } from "./cc-run-persistence"

export type { PresentationEvent, PresentationKind } from "../cursor-sdk/agent-sdk"
export type { ClaudeCodeLaunchOptions, CcSessionAgent } from "./agent-cc-types"
export { CLAUDE_CODE_MODEL_LIST } from "./agent-cc-types"
export { checkClaudeCodeApiKey, ensureClaudeCodeHttpServer, getCcAgentApiPort } from "./agent-cc-http"
export { getClaudeCodeSessionList, getCcSession, getCcActiveQuery } from "./agent-cc-session-registry"
/** 长驻策略：Map + query(resume)；SDK 0.3.207 无 startup() 导出，与 Cursor SDK_RESIDENT_AGENT 语义对等 */
const CC_PENDING_LAUNCHES = new Set<string>()
const CC_FAILED_COOLDOWNS = new Map<string, number>()
const FAIL_COOLDOWN_MS = 30_000
const NOTIFY_PROCESSING = "Agent 处理中…"
const WATCHDOG_TICK_MS = 800
/** 与 SDK 共用 NEVER_CANCEL_ON_DURATION；默认 true 不按总时长硬杀 */
const NEVER_CANCEL_ON_DURATION = (() => {
  const raw = (process.env.NEVER_CANCEL_ON_DURATION ?? process.env.never_cancel_on_duration ?? "true").trim().toLowerCase()
  return raw !== "0" && raw !== "false"
})()
const WATCHDOG_IDLE_TIMEOUT_MS = Number(process.env.CC_IDLE_TIMEOUT_MS || process.env.SDK_IDLE_TIMEOUT_MS || 300_000)
const CC_LEGACY_ABSOLUTE_TIMEOUT_MS = Number(
  process.env.CC_ABSOLUTE_TIMEOUT_MS
  || process.env.CC_RUN_WATCHDOG_MS
  || process.env.SDK_RUN_WATCHDOG_MS
  || PLATFORM_RUN_LIMIT_MS,
)
/** 绝对运行时长 cap，与 idle 解耦；仅 never-cancel 关闭时在 onTick 生效 */
function resolveCcSafeTimeoutMs(raw: number, fallback: number): number {
  if (Number.isFinite(raw) && raw > 0) return raw
  return fallback
}
const WATCHDOG_ABSOLUTE_TIMEOUT_MS = resolveCcSafeTimeoutMs(CC_LEGACY_ABSOLUTE_TIMEOUT_MS, PLATFORM_RUN_LIMIT_MS)

const completeCcRunOpts = {
  deleteSession: (key: string) => CC_SESSIONS.delete(key),
  getAllSessions: () => [...CC_SESSIONS.values()],
  setFailedCooldown: (key: string, until: number) => CC_FAILED_COOLDOWNS.set(key, until),
  resetPresentationState: resetCcRunPresentationState,
}

/** spawn 主路径 + query 消息桥（launch/dispatch/recover 共用；同步失败向上抛出） */
export function startCcSpawn(session: CcSessionAgent, prompt: string, guardToken: string): void {
  session.lastTaskMessage = prompt
  pushUiLog(
    "CC",
    "INFO",
    `[${session.sessionKey}] startCcSpawn: spawn 主路径 + query 桥 (resume=${session.ccSessionId ?? "new"})`,
  )
  const q = query({ prompt, options: buildQueryOptions(session) })
  session.activeQuery = q
  armCcWatchdog(session, guardToken, makeWatchdogOpts())
  streamCcSdkMessages(session, q, makeStreamOpts())
  persistCcActiveRunSnapshot(session, true)
}

/** @deprecated 已弃用，请使用 startCcSpawn */
export function startCcQuery(session: CcSessionAgent, prompt: string, guardToken: string): void {
  startCcSpawn(session, prompt, guardToken)
}

export async function launchClaudeCodeAgent(opts: import("./agent-cc-types").ClaudeCodeLaunchOptions): Promise<{ ok: boolean; error?: string }> {
  const { sessionKey, chatType, meta, workspaceDir, useMainWorkspace,
    senderOpenId, chatName, taskMessage, apiKey, baseUrl, model } = opts

  if (!sessionKey) return { ok: false, error: "session_key is required" }
  if (!apiKey?.trim()) return { ok: false, error: "API Key 未配置" }

  const cooldown = CC_FAILED_COOLDOWNS.get(sessionKey)
  if (cooldown && Date.now() < cooldown) {
    return { ok: false, error: `会话冷却中（${Math.ceil((cooldown - Date.now()) / 1000)}s），请稍后重试` }
  }
  if (CC_PENDING_LAUNCHES.has(sessionKey)) return { ok: false, error: "会话正在启动中" }
  CC_PENDING_LAUNCHES.add(sessionKey)

  let guard: ReturnType<typeof enterGuardWithLifecycle> | undefined
  let session: CcSessionAgent | undefined

  try {
    session = CC_SESSIONS.get(sessionKey)
    if (session?.activeQuery) {
      CC_PENDING_LAUNCHES.delete(sessionKey)
      return dispatchToClaudeCodeAgent(sessionKey, taskMessage ?? "", meta?.messageIds)
    }
    if (session && !session.activeQuery && session.pendingDispatch) {
      CC_PENDING_LAUNCHES.delete(sessionKey)
      return { ok: false, error: "会话已有 dispatch 进行中" }
    }

    const limitProxy = { modelId: model?.trim() || "claude-sonnet-4-6", apiKey: apiKey.trim(), contextLimitTokens: undefined as number | undefined }
    void resolveContextLimitForSession(limitProxy).then(() => {
      const s = CC_SESSIONS.get(sessionKey)
      if (s && limitProxy.contextLimitTokens != null) s.contextLimitTokens = limitProxy.contextLimitTokens
    })

    const residentMode = ccResidentModeEnabled()
    if (!session) {
      session = {
        sessionKey, activeQuery: null, ccSessionId: null,
        startedAt: Date.now(), lastActivityAt: Date.now(),
        chatType, workspaceDir, senderOpenId, chatName,
        apiKey: apiKey.trim(), baseUrl: baseUrl?.trim() || undefined,
        model: model?.trim() || undefined, meta, useMainWorkspace,
        abortController: new AbortController(),
        f41Stream: f41Eligible(sessionKey, chatType), streamBuffer: "",
        residentMode, pendingDispatch: false,
        contextUsage: { ...ZERO_CONTEXT_USAGE },
        watchdogState: "running", watchdogStateAt: Date.now(),
        logAgg: { kind: null, buf: "" },
      }
      CC_SESSIONS.set(sessionKey, session)
    } else {
      resetCcRunPresentationState(session)
      Object.assign(session, {
        chatType, workspaceDir, senderOpenId, chatName, meta, useMainWorkspace,
        f41Stream: f41Eligible(sessionKey, chatType),
        apiKey: apiKey.trim(), baseUrl: baseUrl?.trim() || undefined,
        model: model?.trim() || undefined,
      })
    }

    // S8：busy 经 guard 内 notifyGuardBusy 发一次 IM，对称 Cursor T8
    const lifecycle = createRunLifecycle(session)
    guard = enterGuardWithLifecycle(session, lifecycle)
    if (!guard.acquired) return { ok: false, error: "agent busy" }

    session.runGuardToken = guard.token
    session.inboundMessageIds = meta?.messageIds
    session.runStartedAt = Date.now()

    if (session.ccSessionId && session.contextLimitTokens) {
      const used = resolveDisplayContextTokens(session.contextUsage, session.contextUsagePeakTokens)
      const ratio = session.contextLimitTokens > 0 ? used / session.contextLimitTokens : 0
      if (maybeRotateContext({ sessionKey, usageRatio: ratio, nowMs: Date.now() }).rotated) {
        pushUiLog("CC", "INFO", `[${sessionKey}] 上下文轮转，新建会话窗口`)
        session.ccSessionId = null
        resetContextUsagePeak(session)
      }
    }

    const prompt = buildPrompt(meta, taskMessage, sessionKey, useMainWorkspace)
    pushUiLog("CC", "INFO", `[${sessionKey}] 启动 Claude Agent spawn (model=${session.model || "claude-sonnet-4-6"} resident=${residentMode} resume=${session.ccSessionId ?? "new"})`)

    session.pendingDispatch = true
    try {
      startCcSpawn(session, prompt, guard.token)
    } catch (e: unknown) {
      session.pendingDispatch = false
      killCcSpawnedProcess(session)
      const errMsg = e instanceof Error ? e.message : String(e)
      pushUiLog("CC", "ERROR", `[${sessionKey}] cc_spawn 启动失败: ${errMsg}`)
      CC_FAILED_COOLDOWNS.set(sessionKey, Date.now() + FAIL_COOLDOWN_MS)
      return { ok: false, error: errMsg }
    }

    broadcastCcSessionStatus([...CC_SESSIONS.values()])
    await notifySessionChat(sessionKey, NOTIFY_PROCESSING)
    await reportSessionAgentPhase(sessionKey, "processing")
    return { ok: true }
  } finally {
    CC_PENDING_LAUNCHES.delete(sessionKey)
    if (guard?.acquired && session && !session.activeQuery) releaseRunGuard(sessionKey, guard.token)
  }
}

export async function dispatchToClaudeCodeAgent(
  sessionKey: string, taskText: string, messageIds?: string[],
): Promise<{ ok: boolean; error?: string }> {
  const session = CC_SESSIONS.get(sessionKey)
  if (!session) return { ok: false, error: `会话 ${sessionKey} 不存在，请先 launch` }
  if (session.activeQuery) return { ok: false, error: `会话 ${sessionKey} 正在执行中，请等待完成后再 dispatch` }
  if (session.pendingDispatch) return { ok: false, error: `会话 ${sessionKey} 已有 dispatch 进行中` }

  session.pendingDispatch = true
  try {
    resetCcRunPresentationState(session)
    session.inboundMessageIds = messageIds

    const lifecycle = createRunLifecycle(session)
    const guard = enterGuardWithLifecycle(session, lifecycle)
    if (!guard.acquired) {
      session.pendingDispatch = false
      return { ok: false, error: "agent busy|retry_after=1500" }
    }
    session.runGuardToken = guard.token
    session.runStartedAt = Date.now()

    const prompt = buildPrompt(session.meta, taskText, sessionKey, session.useMainWorkspace)
    pushUiLog("CC", "INFO", `[${sessionKey}] dispatch Claude Agent spawn (resume=${session.ccSessionId ?? "new"})`)
    startCcSpawn(session, prompt, guard.token)

    broadcastCcSessionStatus([...CC_SESSIONS.values()])
    await notifySessionChat(sessionKey, NOTIFY_PROCESSING)
    await reportSessionAgentPhase(sessionKey, "processing")
    return { ok: true }
  } catch (e: unknown) {
    session.pendingDispatch = false
    killCcSpawnedProcess(session)
    session.activeQuery = null
    if (session.runGuardToken) {
      completeRunGuard(sessionKey, session.runGuardToken)
      releaseRunGuard(sessionKey, session.runGuardToken)
      session.runGuardToken = undefined
    }
    const errMsg = e instanceof Error ? e.message : String(e)
    pushUiLog("CC", "ERROR", `[${sessionKey}] cc_spawn dispatch 失败: ${errMsg}`)
    CC_FAILED_COOLDOWNS.set(sessionKey, Date.now() + FAIL_COOLDOWN_MS)
    return { ok: false, error: errMsg }
  }
}

export function isClaudeCodeSessionRunning(sessionKey: string): boolean {
  const s = CC_SESSIONS.get(sessionKey)
  return !!s && (s.activeQuery !== null || s.pendingDispatch)
}

export function stopClaudeCodeSession(sessionKey: string): void {
  const s = CC_SESSIONS.get(sessionKey)
  if (!s) return
  markCcRunUserStopped(sessionKey)
  s.abortController.abort()
  clearStreamPostTimer(s)
  if (s.activeQuery) { try { s.activeQuery.close() } catch { /* best-effort */ } }
  killCcSpawnedProcess(s)
  if (s.runGuardToken) {
    completeRunGuard(sessionKey, s.runGuardToken)
    releaseRunGuard(sessionKey, s.runGuardToken)
    s.runGuardToken = undefined
  }
  s.activeQuery = null
  s.pendingDispatch = false
  CC_SESSIONS.delete(sessionKey)
  // 用户取消不发 IM，但须停 typing
  stopSessionChatProgress(sessionKey)
  void reportSessionAgentPhase(sessionKey, "idle")
  broadcastCcSessionStatus([...CC_SESSIONS.values()])
}

export function stopAllClaudeCodeSessions(): void {
  for (const key of [...CC_SESSIONS.keys()]) stopClaudeCodeSession(key)
  CC_FAILED_COOLDOWNS.clear()
  CC_PENDING_LAUNCHES.clear()
}

function makeWatchdogOpts() {
  return {
    idleTimeoutMs: WATCHDOG_IDLE_TIMEOUT_MS,
    tickMs: WATCHDOG_TICK_MS,
    absoluteTimeoutMs: WATCHDOG_ABSOLUTE_TIMEOUT_MS,
    neverCancelOnDuration: NEVER_CANCEL_ON_DURATION,
    getSession: (key: string) => CC_SESSIONS.get(key),
    setWatchdogState,
  }
}

function makeStreamOpts() {
  return {
    resolveChannelType: resolveSessionChannelType,
    markActivity: markSessionActivity,
    completeCcRun: (session: CcSessionAgent, exitCode: number | null) =>
      completeCcRun(session, exitCode, completeCcRunOpts, FAIL_COOLDOWN_MS),
  }
}

registerCcLaunchHandler(launchClaudeCodeAgent)
registerCcDispatchHandler(dispatchToClaudeCodeAgent)
