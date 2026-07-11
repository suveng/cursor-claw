/**
 * Codex SDK 执行引擎（入口 & 编排）
 * new Codex + startThread + runStreamed；复杂逻辑下沉 events/stream/utils。
 */
import { Codex } from "@openai/codex-sdk"
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { pushUiLog } from "../../app/ui-logger"
import {
  ZERO_CONTEXT_USAGE,
  resolveContextLimitForSession,
} from "../cursor-sdk/context-usage"
import { buildPrompt } from "../shared/agent-launcher"
import { acquireRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import {
  CODEX_SESSIONS, CODEX_PENDING_LAUNCHES, CODEX_FAILED_COOLDOWNS,
} from "./agent-codex-session-registry"
import { PLATFORM_RUN_LIMIT_MS } from "../cursor-sdk/finalize-sdk-run"
import { loadCodexMcpServers } from "../../mcp/loaders/codex-mcp-loader"
import type { CodexLaunchOptions, CodexSessionAgent } from "./agent-codex-types"
import { CODEX_DEFAULT_MODEL_ID } from "./agent-codex-types"
import {
  f41Eligible,
  resolveSessionChannelType,
  codexResidentModeEnabled,
  resetCodexRunPresentationState,
  setCodexWatchdogState,
  markCodexSessionActivity,
  checkCodexCliAvailable,
  resolveCodexCliPath,
  maskCodexApiKey,
} from "./agent-codex-utils"
import {
  notifyCodexSessionChat,
  broadcastCodexSessionStatus,
  maybeRotateCodexSessionContext,
} from "./agent-codex-stream"
import { completeCodexRun } from "./agent-codex-complete"
import { streamCodexEvents } from "./agent-codex-events"
import { armCodexWatchdog } from "./agent-codex-watchdog"
import { registerCodexLaunchHandler, registerCodexDispatchHandler } from "./agent-codex-http"
import { formatCodexFailureMessage, sanitizeCodexSensitiveText } from "./codex-failure-messages"

export type { CodexLaunchOptions, CodexSessionAgent } from "./agent-codex-types"
export { ensureCodexHttpServer, getCodexAgentApiPort } from "./agent-codex-http"
export { CODEX_MODEL_LIST, CODEX_DEFAULT_MODEL_ID } from "./agent-codex-types"
export { getCodexSessionList, isCodexSessionRunning, stopCodexSession, stopAllCodexSessions } from "./agent-codex-session-registry"
const FAIL_COOLDOWN_MS = 30_000
const NOTIFY_PROCESSING = "Agent 处理中…"
const WATCHDOG_TICK_MS = 800
const NEVER_CANCEL_ON_DURATION = (() => {
  const raw = (process.env.NEVER_CANCEL_ON_DURATION ?? "true").trim().toLowerCase()
  return raw !== "0" && raw !== "false"
})()
const WATCHDOG_IDLE_TIMEOUT_MS = Number(process.env.CODEX_IDLE_TIMEOUT_MS || process.env.SDK_IDLE_TIMEOUT_MS || 300_000)
const WATCHDOG_ABSOLUTE_TIMEOUT_MS = Number(process.env.CODEX_ABSOLUTE_TIMEOUT_MS || PLATFORM_RUN_LIMIT_MS)

const completeOpts = {
  deleteSession: (key: string) => CODEX_SESSIONS.delete(key),
  getAllSessions: () => [...CODEX_SESSIONS.values()],
  setFailedCooldown: (key: string, until: number) => CODEX_FAILED_COOLDOWNS.set(key, until),
  resetPresentationState: resetCodexRunPresentationState,
}

/** 构建 Codex 客户端（含 MCP config 与 CLI 路径覆盖） */
function buildCodexClient(session: CodexSessionAgent, mcpInline?: Record<string, Record<string, unknown>>): Codex {
  const cliPath = resolveCodexCliPath()
  const config = mcpInline && Object.keys(mcpInline).length > 0 ? { mcp_servers: mcpInline } : undefined
  return new Codex({
    apiKey: session.apiKey,
    baseUrl: session.baseUrl,
    codexPathOverride: cliPath ?? undefined,
    config,
  })
}

/** Thread 启动选项 */
function buildThreadOptions(session: CodexSessionAgent) {
  return {
    model: session.model,
    workingDirectory: session.workspaceDir,
    skipGitRepoCheck: true,
    approvalPolicy: "never" as const,
    sandboxMode: "workspace-write" as const,
  }
}

/** 获取或重建 Thread：resident 续跑优先 resumeThread(codexSessionId) */
function resolveCodexThread(
  session: CodexSessionAgent,
  mcpInline?: Record<string, Record<string, unknown>>,
): import("@openai/codex-sdk").Thread {
  if (session.activeThread) return session.activeThread
  const codex = buildCodexClient(session, mcpInline)
  const threadOpts = buildThreadOptions(session)
  session.activeThread = session.codexSessionId
    ? codex.resumeThread(session.codexSessionId, threadOpts)
    : codex.startThread(threadOpts)
  return session.activeThread
}

/** 启动 runStreamed 并挂载事件流 */
function startCodexRun(session: CodexSessionAgent, prompt: string, guardToken: string, mcpInline?: Record<string, Record<string, unknown>>): void {
  const thread = resolveCodexThread(session, mcpInline)
  armCodexWatchdog(session, guardToken, makeWatchdogOpts())
  const runEpoch = { runStartedAt: session.runStartedAt, runGuardToken: session.runGuardToken }
  void (async () => {
    try {
      const { events } = await thread.runStreamed(prompt, { signal: session.abortController.signal })
      streamCodexEvents(session, events, makeStreamOpts())
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e)
      pushUiLog("Codex", "ERROR", `[${session.sessionKey}] runStreamed 失败: ${sanitizeCodexSensitiveText(raw)}`)
      session.lastStatus = { status: "ERROR", message: formatCodexFailureMessage(e) }
      session.pendingDispatch = false
      void completeCodexRun(session, -1, completeOpts, FAIL_COOLDOWN_MS, runEpoch)
    }
  })()
}

export async function launchCodexAgent(opts: CodexLaunchOptions): Promise<{ ok: boolean; error?: string }> {
  const { sessionKey, chatType, meta, workspaceDir, useMainWorkspace,
    senderOpenId, chatName, taskMessage, apiKey, baseUrl, model } = opts

  if (!sessionKey) return { ok: false, error: "session_key is required" }
  if (!apiKey?.trim()) return { ok: false, error: "API Key 未配置" }

  const cliCheck = checkCodexCliAvailable()
  if (!cliCheck.ok) return { ok: false, error: cliCheck.error }

  const cooldown = CODEX_FAILED_COOLDOWNS.get(sessionKey)
  if (cooldown && Date.now() < cooldown) {
    return { ok: false, error: `会话冷却中（${Math.ceil((cooldown - Date.now()) / 1000)}s），请稍后重试` }
  }
  if (CODEX_PENDING_LAUNCHES.has(sessionKey)) return { ok: false, error: "会话正在启动中" }
  CODEX_PENDING_LAUNCHES.add(sessionKey)

  let guard: ReturnType<typeof acquireRunGuard> | undefined
  let session: CodexSessionAgent | undefined

  try {
    session = CODEX_SESSIONS.get(sessionKey)
    if (session?.pendingDispatch) {
      return dispatchToCodexAgent(sessionKey, taskMessage ?? "", meta?.messageIds)
    }

    guard = acquireRunGuard(sessionKey)
    if (!guard.acquired) return { ok: false, error: `会话 ${sessionKey} 正在执行中（guard=${guard.holder}）` }

    const modelId = model?.trim() || CODEX_DEFAULT_MODEL_ID
    const limitProxy = { modelId, apiKey: apiKey.trim(), contextLimitTokens: undefined as number | undefined }
    void resolveContextLimitForSession(limitProxy).then(() => {
      const s = CODEX_SESSIONS.get(sessionKey)
      if (s && limitProxy.contextLimitTokens != null) s.contextLimitTokens = limitProxy.contextLimitTokens
    })

    const residentMode = codexResidentModeEnabled()
    const mcpInline = opts.mcpServers ?? loadCodexMcpServers(workspaceDir)
    const mcpCount = Object.keys(mcpInline).length
    pushUiLog("Codex", "INFO", `[${sessionKey}] [mcp] inline ${mcpCount} servers`)

    if (!session) {
      session = {
        sessionKey, activeThread: null, codexSessionId: null,
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
      CODEX_SESSIONS.set(sessionKey, session)
    } else {
      resetCodexRunPresentationState(session)
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
    session.modelId = modelId

    maybeRotateCodexSessionContext(session)

    const prompt = buildPrompt(meta, taskMessage, sessionKey, useMainWorkspace, chatName, senderOpenId)
    pushUiLog("Codex", "INFO", `[${sessionKey}] 启动 Codex (model=${session.model || modelId} apiKey=${maskCodexApiKey(session.apiKey)} resident=${residentMode})`)

    session.pendingDispatch = true
    startCodexRun(session, prompt, guard.token, mcpInline)

    broadcastCodexSessionStatus([...CODEX_SESSIONS.values()])
    await notifyCodexSessionChat(sessionKey, NOTIFY_PROCESSING)
    await reportSessionAgentPhase(sessionKey, "processing")
    return { ok: true }
  } finally {
    CODEX_PENDING_LAUNCHES.delete(sessionKey)
    if (guard?.acquired && session && !session.pendingDispatch) releaseRunGuard(sessionKey, guard.token)
  }
}

/** 连发续接：resumeThread(codexSessionId) + runStreamed */
export async function dispatchToCodexAgent(
  sessionKey: string, taskText: string, messageIds?: string[],
): Promise<{ ok: boolean; error?: string }> {
  const session = CODEX_SESSIONS.get(sessionKey)
  if (!session) return { ok: false, error: `会话 ${sessionKey} 不存在，请先 launch` }
  if (session.pendingDispatch) return { ok: false, error: `会话 ${sessionKey} 正在执行中` }

  const cooldown = CODEX_FAILED_COOLDOWNS.get(sessionKey)
  if (cooldown && Date.now() < cooldown) {
    return { ok: false, error: `会话冷却中（${Math.ceil((cooldown - Date.now()) / 1000)}s），请稍后重试` }
  }

  const cliCheck = checkCodexCliAvailable()
  if (!cliCheck.ok) return { ok: false, error: cliCheck.error }

  session.pendingDispatch = true
  try {
    resetCodexRunPresentationState(session)
    session.inboundMessageIds = messageIds
    maybeRotateCodexSessionContext(session)

    const guard = acquireRunGuard(sessionKey)
    if (!guard.acquired) {
      session.pendingDispatch = false
      return { ok: false, error: `会话 ${sessionKey} guard 获取失败` }
    }
    session.runGuardToken = guard.token
    session.runStartedAt = Date.now()

    const mcpInline = loadCodexMcpServers(session.workspaceDir ?? "")
    const prompt = buildPrompt(session.meta, taskText, sessionKey, session.useMainWorkspace, session.chatName, session.senderOpenId)
    pushUiLog("Codex", "INFO", `[${sessionKey}] dispatch Codex (resume=${session.codexSessionId ?? "new"})`)
    startCodexRun(session, prompt, guard.token, mcpInline)

    broadcastCodexSessionStatus([...CODEX_SESSIONS.values()])
    await notifyCodexSessionChat(sessionKey, NOTIFY_PROCESSING)
    await reportSessionAgentPhase(sessionKey, "processing")
    return { ok: true }
  } catch (e: unknown) {
    session.pendingDispatch = false
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getCodexSession(sessionKey: string): CodexSessionAgent | undefined {
  return CODEX_SESSIONS.get(sessionKey)
}

function makeWatchdogOpts() {
  return {
    idleTimeoutMs: WATCHDOG_IDLE_TIMEOUT_MS,
    tickMs: WATCHDOG_TICK_MS,
    absoluteTimeoutMs: WATCHDOG_ABSOLUTE_TIMEOUT_MS,
    neverCancelOnDuration: NEVER_CANCEL_ON_DURATION,
    getSession: (key: string) => CODEX_SESSIONS.get(key),
    setWatchdogState: setCodexWatchdogState,
  }
}

function makeStreamOpts() {
  return {
    resolveChannelType: resolveSessionChannelType,
    markActivity: markCodexSessionActivity,
    completeCodexRun: (session: CodexSessionAgent, exitCode: number | null, epoch?: { runStartedAt?: number; runGuardToken?: string }) =>
      completeCodexRun(session, exitCode, completeOpts, FAIL_COOLDOWN_MS, epoch),
  }
}

// HTTP handler 依赖注入（仿 agent-claude-sdk.ts 末尾注册）
registerCodexLaunchHandler(launchCodexAgent)
registerCodexDispatchHandler(dispatchToCodexAgent)
