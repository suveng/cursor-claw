/**
 * Claude Code SDK 执行引擎（入口 & 核心）
 * spawn @anthropic-ai/claude-code CLI，解析 stream-json JSONL，映射 PresentationEvent。
 * 拆分：agent-cc-types（类型）/ agent-cc-utils（辅助）/ agent-cc-stream（流）/
 *       agent-cc-events（事件）/ agent-cc-http（HTTP）/ 本文件（launch/dispatch/stop）
 */
import { spawn } from "node:child_process"
import { reportSessionAgentPhase } from "./daemon-client"
import { pushUiLog } from "./ui-logger"
import {
  ZERO_CONTEXT_USAGE,
  resolveContextLimitForSession,
  resetContextUsagePeak,
  resolveDisplayContextTokens,
} from "./context-usage"
import { type ChatType, buildPrompt, resolveSessionChatName } from "./agent-launcher"
import { acquireRunGuard, completeRunGuard, releaseRunGuard } from "./agent-run-guard"
import { maybeRotateContext } from "./context-rotation-lite"

import type { CcSessionAgent } from "./agent-cc-types"
import {
  getCcBinaryPath, resolveSessionChannelType, f41Eligible,
  ccResidentModeEnabled, resetCcRunPresentationState, setWatchdogState, markSessionActivity,
} from "./agent-cc-utils"
import { notifySessionChat, flushStreamPost, clearStreamPostTimer, broadcastCcSessionStatus, completeCcRun } from "./agent-cc-stream"
import { armCcWatchdog, streamCcEvents } from "./agent-cc-events"
import { registerCcLaunchHandler, registerCcDispatchHandler } from "./agent-cc-http"

// ── re-exports（保持对外接口不变） ────────────────────────────────────────────
export type { PresentationEvent, PresentationKind } from "./agent-sdk"
export type { ClaudeCodeLaunchOptions, CcSessionAgent } from "./agent-cc-types"
export { CLAUDE_CODE_MODEL_LIST } from "./agent-cc-types"
export { checkClaudeCodeApiKey, ensureClaudeCodeHttpServer, getCcAgentApiPort } from "./agent-cc-http"

// ── 模块级状态 ────────────────────────────────────────────────────────────────
const CC_SESSIONS = new Map<string, CcSessionAgent>()
const CC_PENDING_LAUNCHES = new Set<string>()
const CC_FAILED_COOLDOWNS = new Map<string, number>()
const FAIL_COOLDOWN_MS = 30_000
const NOTIFY_PROCESSING = "Agent 处理中…"
const WATCHDOG_TICK_MS = 800
const WATCHDOG_IDLE_TIMEOUT_MS = Number(process.env.CC_IDLE_TIMEOUT_MS || process.env.SDK_IDLE_TIMEOUT_MS || 300_000)
const WATCHDOG_ABSOLUTE_TIMEOUT_MS = WATCHDOG_IDLE_TIMEOUT_MS

/** completeCcRun 注入选项（捕获模块级 Map） */
const completeCcRunOpts = {
  deleteSession: (key: string) => CC_SESSIONS.delete(key),
  getAllSessions: () => [...CC_SESSIONS.values()],
  setFailedCooldown: (key: string, until: number) => CC_FAILED_COOLDOWNS.set(key, until),
  resetPresentationState: resetCcRunPresentationState,
}

// ── 核心 launch ────────────────────────────────────────────────────────────────

/** 启动一个 Claude Code Agent 进程（或 dispatch 到已有 resident 进程） */
export async function launchClaudeCodeAgent(opts: import("./agent-cc-types").ClaudeCodeLaunchOptions): Promise<{ ok: boolean; error?: string }> {
  const { sessionKey, chatType, meta, workspaceDir, useMainWorkspace,
    senderOpenId, chatName, taskMessage, apiKey, baseUrl, model } = opts

  if (!sessionKey) return { ok: false, error: "session_key is required" }
  if (!apiKey?.trim()) return { ok: false, error: "API Key 未配置" }

  // 冷却期检查
  const cooldown = CC_FAILED_COOLDOWNS.get(sessionKey)
  if (cooldown && Date.now() < cooldown) {
    return { ok: false, error: `会话冷却中（${Math.ceil((cooldown - Date.now()) / 1000)}s），请稍后重试` }
  }
  if (CC_PENDING_LAUNCHES.has(sessionKey)) return { ok: false, error: "会话正在启动中" }
  CC_PENDING_LAUNCHES.add(sessionKey)

  let guard: ReturnType<typeof acquireRunGuard> | undefined
  let session: CcSessionAgent | undefined

  try {
    session = CC_SESSIONS.get(sessionKey)
    if (session?.child) {
      CC_PENDING_LAUNCHES.delete(sessionKey)
      return dispatchToClaudeCodeAgent(sessionKey, taskMessage ?? "", meta?.messageIds)
    }

    guard = acquireRunGuard(sessionKey)
    if (!guard.acquired) return { ok: false, error: `会话 ${sessionKey} 正在执行中（guard=${guard.holder}）` }

    // 异步解析上下文上限（不阻断 launch）
    const limitProxy = { modelId: model?.trim() || "claude-sonnet-4-6", apiKey: apiKey.trim(), contextLimitTokens: undefined as number | undefined }
    void resolveContextLimitForSession(limitProxy).then(() => {
      const s = CC_SESSIONS.get(sessionKey)
      if (s && limitProxy.contextLimitTokens != null) s.contextLimitTokens = limitProxy.contextLimitTokens
    })

    const residentMode = ccResidentModeEnabled()
    if (!session) {
      session = {
        sessionKey, child: null, ccSessionId: null,
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
      // 保留 ccSessionId（resident resume）
      resetCcRunPresentationState(session)
      Object.assign(session, {
        chatType, workspaceDir, senderOpenId, chatName, meta, useMainWorkspace,
        f41Stream: f41Eligible(sessionKey, chatType),
        apiKey: apiKey.trim(), baseUrl: baseUrl?.trim() || undefined,
        model: model?.trim() || undefined,
      })
    }

    session.runGuardToken = guard.token
    session.inboundMessageIds = meta?.messageIds
    session.runStartedAt = Date.now()

    const prompt = buildPrompt(meta, taskMessage, sessionKey, useMainWorkspace)
    const modelArg = session.model || "claude-sonnet-4-6"

    // 上下文轮转检查（高压时清除 ccSessionId 强制新窗口）
    if (session.ccSessionId && session.contextLimitTokens) {
      const used = resolveDisplayContextTokens(session.contextUsage, session.contextUsagePeakTokens)
      const ratio = session.contextLimitTokens > 0 ? used / session.contextLimitTokens : 0
      if (maybeRotateContext({ sessionKey, usageRatio: ratio, nowMs: Date.now() }).rotated) {
        pushUiLog("CC", "INFO", `[${sessionKey}] 上下文轮转，新建会话窗口`)
        session.ccSessionId = null
        resetContextUsagePeak(session)
      }
    }

    const preArgs = buildSpawnArgs(modelArg, session.ccSessionId)
    const env = buildSpawnEnv(session.apiKey, session.baseUrl)
    const binaryPath = getCcBinaryPath()
    pushUiLog("CC", "INFO", `[${sessionKey}] 启动 claude: ${binaryPath} (model=${modelArg} resident=${residentMode})`)

    const child = spawn(binaryPath, [...preArgs, prompt], { cwd: workspaceDir, env, stdio: ["ignore", "pipe", "pipe"] })
    session.child = child

    armCcWatchdog(session, guard.token, makeWatchdogOpts())
    streamCcEvents(session, child, makeStreamOpts())

    broadcastCcSessionStatus([...CC_SESSIONS.values()])
    await notifySessionChat(sessionKey, NOTIFY_PROCESSING)
    await reportSessionAgentPhase(sessionKey, "processing")
    return { ok: true }
  } finally {
    CC_PENDING_LAUNCHES.delete(sessionKey)
    // 若 guard 已获取但子进程未成功启动，释放 guard 避免永久锁死（R-W1）
    if (guard?.acquired && session && !session.child) releaseRunGuard(sessionKey, guard.token)
  }
}

// ── dispatch（向 resident session 发送新任务） ─────────────────────────────────

/** 向已有 resident session 分派新任务 */
export async function dispatchToClaudeCodeAgent(
  sessionKey: string, taskText: string, messageIds?: string[],
): Promise<{ ok: boolean; error?: string }> {
  const session = CC_SESSIONS.get(sessionKey)
  if (!session) return { ok: false, error: `会话 ${sessionKey} 不存在，请先 launch` }
  if (session.child) return { ok: false, error: `会话 ${sessionKey} 正在执行中，请等待完成后再 dispatch` }
  if (session.pendingDispatch) return { ok: false, error: `会话 ${sessionKey} 已有 dispatch 进行中` }

  session.pendingDispatch = true
  try {
    resetCcRunPresentationState(session)
    session.inboundMessageIds = messageIds

    const guard = acquireRunGuard(sessionKey)
    if (!guard.acquired) {
      session.pendingDispatch = false // guard 失败时清零，避免永久锁死（R-S5）
      return { ok: false, error: `会话 ${sessionKey} guard 获取失败` }
    }
    session.runGuardToken = guard.token
    session.runStartedAt = Date.now()

    const prompt = buildPrompt(session.meta, taskText, sessionKey, session.useMainWorkspace)
    const modelArg = session.model || "claude-sonnet-4-6"
    const preArgs = buildSpawnArgs(modelArg, session.ccSessionId)
    const env = buildSpawnEnv(session.apiKey, session.baseUrl)

    pushUiLog("CC", "INFO", `[${sessionKey}] dispatch claude (resume=${session.ccSessionId ?? "new"})`)
    const child = spawn(getCcBinaryPath(), [...preArgs, prompt], { cwd: session.workspaceDir, env, stdio: ["ignore", "pipe", "pipe"] })
    session.child = child

    armCcWatchdog(session, guard.token, makeWatchdogOpts())
    streamCcEvents(session, child, makeStreamOpts())

    broadcastCcSessionStatus([...CC_SESSIONS.values()])
    await notifySessionChat(sessionKey, NOTIFY_PROCESSING)
    await reportSessionAgentPhase(sessionKey, "processing")
    return { ok: true }
  } catch (e: unknown) {
    session.pendingDispatch = false
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── 查询 / stop 函数 ──────────────────────────────────────────────────────────

/** 判断指定 session 是否正在运行（有子进程或 pendingDispatch） */
export function isClaudeCodeSessionRunning(sessionKey: string): boolean {
  const s = CC_SESSIONS.get(sessionKey)
  return !!s && (s.child !== null || s.pendingDispatch)
}

/** 停止并清理指定 session */
export function stopClaudeCodeSession(sessionKey: string): void {
  const s = CC_SESSIONS.get(sessionKey)
  if (!s) return
  s.abortController.abort()
  clearStreamPostTimer(s)
  if (s.child) { try { s.child.kill("SIGTERM") } catch { /* best-effort */ } }
  if (s.runGuardToken) {
    completeRunGuard(sessionKey, s.runGuardToken)
    releaseRunGuard(sessionKey, s.runGuardToken)
    s.runGuardToken = undefined
  }
  CC_SESSIONS.delete(sessionKey)
  void reportSessionAgentPhase(sessionKey, "idle")
  broadcastCcSessionStatus([...CC_SESSIONS.values()])
}

/** 停止所有 CC session 并清空冷却与 pending 记录 */
export function stopAllClaudeCodeSessions(): void {
  for (const key of [...CC_SESSIONS.keys()]) stopClaudeCodeSession(key)
  CC_FAILED_COOLDOWNS.clear()
  CC_PENDING_LAUNCHES.clear()
}

/** 获取所有 CC session 概览列表 */
export function getClaudeCodeSessionList(): Array<{ sessionKey: string; chatType: string; startedAt: number; chatName?: string; pid: number }> {
  return [...CC_SESSIONS.values()].map((s) => ({
    sessionKey: s.sessionKey,
    chatType: s.chatType as string,
    startedAt: s.startedAt,
    chatName: resolveSessionChatName(s.sessionKey, s.chatName, s.senderOpenId),
    pid: s.child?.pid ?? 0,
  }))
}

// ── 私有辅助 ──────────────────────────────────────────────────────────────────

/** 构建 claude CLI spawn 参数数组 */
function buildSpawnArgs(modelArg: string, ccSessionId: string | null): string[] {
  const args = ["--print", "--output-format", "stream-json", "--dangerously-skip-permissions", "--model", modelArg]
  if (ccSessionId) args.push("--resume", ccSessionId)
  return args
}

/** 构建 spawn 环境变量（处理 ANTHROPIC_BASE_URL 继承问题 R-W2） */
function buildSpawnEnv(apiKey: string, baseUrl?: string): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ANTHROPIC_API_KEY: apiKey }
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl
  } else {
    // 显式清除，避免父进程 env 的 ANTHROPIC_BASE_URL 被意外继承（R-W2）
    delete env.ANTHROPIC_BASE_URL
  }
  return env
}

/** 构建 armCcWatchdog 选项（捕获 CC_SESSIONS） */
function makeWatchdogOpts() {
  return {
    idleTimeoutMs: WATCHDOG_IDLE_TIMEOUT_MS,
    tickMs: WATCHDOG_TICK_MS,
    absoluteTimeoutMs: WATCHDOG_ABSOLUTE_TIMEOUT_MS,
    getSession: (key: string) => CC_SESSIONS.get(key),
    setWatchdogState,
  }
}

/** 构建 streamCcEvents 选项（注入依赖） */
function makeStreamOpts() {
  return {
    resolveChannelType: resolveSessionChannelType,
    markActivity: markSessionActivity,
    completeCcRun: (session: CcSessionAgent, exitCode: number | null) =>
      completeCcRun(session, exitCode, completeCcRunOpts, FAIL_COOLDOWN_MS),
  }
}

// ── 模块初始化：注入 HTTP handler ─────────────────────────────────────────────

// 将 launch/dispatch 注入 agent-cc-http.ts，消除循环依赖
registerCcLaunchHandler(launchClaudeCodeAgent)
registerCcDispatchHandler(dispatchToClaudeCodeAgent)
