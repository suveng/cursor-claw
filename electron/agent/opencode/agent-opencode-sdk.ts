/**
 * OpenCode SDK 执行引擎入口（仿 agent-codex-sdk.ts）。
 */
import { reportSessionAgentPhase } from "../../daemon/daemon-client"
import { pushUiLog } from "../../app/ui-logger"
import { ZERO_CONTEXT_USAGE, resolveContextLimitForSession } from "../cursor-sdk/context-usage"
import { buildPrompt } from "../shared/agent-launcher"
import { releaseRunGuard, enterGuardWithLifecycle } from "../shared/agent-run-guard"
import { createRunLifecycle } from "../shared/run-lifecycle"
import {
  OPENCODE_SESSIONS, OPENCODE_PENDING_LAUNCHES, OPENCODE_FAILED_COOLDOWNS,
} from "./agent-opencode-session-registry"
import { PLATFORM_RUN_LIMIT_MS } from "../cursor-sdk/finalize-sdk-run"
import { readOpencodeMcpServers, appendInlineMcpToOpencodeConfig } from "../../mcp/loaders/opencode-mcp-loader"
import type { OpencodeLaunchOptions, OpencodeSessionAgent } from "./agent-opencode-types"
import { OPENCODE_DEFAULT_MODEL } from "./agent-opencode-types"
import {
  f41Eligible, resolveSessionChannelType, opencodeResidentModeEnabled,
  resetOpencodeRunPresentationState, markOpencodeSessionActivity, resolveOpencodeClient,
  parseModelRef, maskOpencodeApiKey, setOpencodeWatchdogState,
} from "./agent-opencode-utils"
import {
  broadcastOpencodeSessionStatus,
  maybeRotateOpencodeSessionContext, initOpencodeStreamState,
} from "./agent-opencode-stream"
import { notifySessionChat } from "../shared/run-notify"
import { completeOpencodeRun, type OpencodeRunEpoch } from "./agent-opencode-complete"
import { streamOpencodeEvents } from "./agent-opencode-events"
import { watchOpencodeRunGuard } from "./agent-opencode-watchdog"
import { registerOpencodeLaunchHandler, registerOpencodeDispatchHandler } from "./agent-opencode-http"
import { formatOpencodeFailureMessage, sanitizeOpencodeSensitiveText } from "./opencode-failure-messages"
import { persistOpencodeActiveRunSnapshot } from "./opencode-run-persist"
import type { AgentResource } from "../../../src/shared/channel-types"

export type { OpencodeLaunchOptions, OpencodeSessionAgent } from "./agent-opencode-types"
export { ensureOpencodeHttpServer, getOpencodeAgentApiPort } from "./agent-opencode-http"
export { getOpencodeSessionList, isOpencodeSessionRunning, stopOpencodeSession, stopAllOpencodeSessions } from "./agent-opencode-session-registry"

const FAIL_COOLDOWN_MS = 30_000
const NOTIFY = "Agent 处理中…"
const WATCHDOG_TICK_MS = 800
const NEVER_CANCEL = (process.env.NEVER_CANCEL_ON_DURATION ?? "true").trim().toLowerCase() !== "0"
  && (process.env.NEVER_CANCEL_ON_DURATION ?? "true").trim().toLowerCase() !== "false"
const IDLE_MS = Number(process.env.OPENCODE_IDLE_TIMEOUT_MS || process.env.SDK_IDLE_TIMEOUT_MS || 300_000)
const ABS_MS = Number(process.env.OPENCODE_ABSOLUTE_TIMEOUT_MS || PLATFORM_RUN_LIMIT_MS)

const completeOpts = {
  deleteSession: (key: string) => OPENCODE_SESSIONS.delete(key),
  getAllSessions: () => [...OPENCODE_SESSIONS.values()],
  setFailedCooldown: (key: string, until: number) => OPENCODE_FAILED_COOLDOWNS.set(key, until),
  resetPresentationState: resetOpencodeRunPresentationState,
}

/** 异步解析并缓存 contextLimitTokens（仿 Codex launch，供轮转阈值判断） */
function resolveOpencodeContextLimit(sessionKey: string, model: string | undefined, apiKey: string): void {
  const modelId = model?.trim() || OPENCODE_DEFAULT_MODEL
  const limitProxy = { modelId, apiKey: apiKey.trim(), contextLimitTokens: undefined as number | undefined }
  void resolveContextLimitForSession(limitProxy).then(() => {
    const s = OPENCODE_SESSIONS.get(sessionKey)
    if (s && limitProxy.contextLimitTokens != null) s.contextLimitTokens = limitProxy.contextLimitTokens
  })
}

function profileStub(opts: OpencodeLaunchOptions): AgentResource {
  return {
    id: opts.profileResourceId ?? opts.sessionKey,
    type: "opencode",
    name: "runtime",
    apiKey: opts.apiKey,
    providerId: opts.providerId,
    model: opts.model,
    deployMode: opts.deployMode,
    opencodeHostname: opts.opencodeHostname,
    opencodePort: opts.opencodePort,
    baseUrl: opts.baseUrl,
  }
}

function failRun(session: OpencodeSessionAgent, err: unknown, epoch: OpencodeRunEpoch): void {
  session.lastStatus = { status: "ERROR", message: formatOpencodeFailureMessage(err) }
  session.pendingDispatch = false
  void completeOpencodeRun(session, -1, completeOpts, FAIL_COOLDOWN_MS, epoch)
}

/** 启动 prompt 并挂载事件流（recover 续接复用） */
export async function startOpencodeRun(session: OpencodeSessionAgent, prompt: string, guardToken: string, opts: OpencodeLaunchOptions): Promise<void> {
  session.lastTaskMessage = prompt
  session.opencodeHostname = opts.opencodeHostname
  session.opencodePort = opts.opencodePort
  const epoch = { runStartedAt: session.runStartedAt, runGuardToken: guardToken }
  const inlineConfig = appendInlineMcpToOpencodeConfig({}, readOpencodeMcpServers(opts.workspaceDir), opts.workspaceDir)
  let bundle
  try {
    bundle = await resolveOpencodeClient(profileStub(opts), inlineConfig)
  } catch (e: unknown) {
    failRun(session, e, epoch)
    return
  }
  session.activeClient = bundle.client
  session.embeddedServer = bundle.server
  session.deployMode = bundle.deployMode

  try {
    await bundle.client.auth.set({ path: { id: opts.providerId }, body: { type: "api", key: opts.apiKey } })
  } catch (e: unknown) {
    pushUiLog("OpenCode", "ERROR", `[${session.sessionKey}] auth.set: ${sanitizeOpencodeSensitiveText(e instanceof Error ? e.message : String(e))}`)
    failRun(session, e, epoch)
    return
  }

  if (!session.opencodeSessionId) {
    const created = await bundle.client.session.create({ body: { title: session.sessionKey } })
    const sid = created.data?.id
    if (!sid) {
      failRun(session, { message: "session.create 未返回 id" }, epoch)
      return
    }
    session.opencodeSessionId = sid
  }

  persistOpencodeActiveRunSnapshot(session, true)

  const { providerID, modelID } = parseModelRef(opts.model?.trim() || OPENCODE_DEFAULT_MODEL)
  watchOpencodeRunGuard(session, guardToken, {
    idleTimeoutMs: IDLE_MS, tickMs: WATCHDOG_TICK_MS, absoluteTimeoutMs: ABS_MS,
    neverCancelOnDuration: NEVER_CANCEL,
    getSession: (k) => OPENCODE_SESSIONS.get(k),
    setWatchdogState: setOpencodeWatchdogState,
  })

  const sub = await bundle.client.event.subscribe()
  streamOpencodeEvents(session, sub.stream, {
    resolveChannelType: resolveSessionChannelType,
    markActivity: markOpencodeSessionActivity,
    completeOpencodeRun: (s, code, ep) => completeOpencodeRun(s, code, completeOpts, FAIL_COOLDOWN_MS, ep),
  })

  const promptRes = await bundle.client.session.prompt({
    path: { id: session.opencodeSessionId },
    body: { model: { providerID, modelID }, parts: [{ type: "text", text: prompt }] },
  })
  if (promptRes.error) {
    session.lastStatus = { status: "ERROR", message: formatOpencodeFailureMessage(promptRes.error) }
    session.abortController.abort()
  }
}

function buildSession(opts: OpencodeLaunchOptions, existing?: OpencodeSessionAgent): OpencodeSessionAgent {
  if (existing) {
    resetOpencodeRunPresentationState(existing)
    Object.assign(existing, {
      chatType: opts.chatType, workspaceDir: opts.workspaceDir, senderOpenId: opts.senderOpenId,
      chatName: opts.chatName, meta: opts.meta, useMainWorkspace: opts.useMainWorkspace,
      f41Stream: f41Eligible(opts.sessionKey, opts.chatType),
      providerId: opts.providerId.trim(), apiKey: opts.apiKey.trim(),
      model: opts.model?.trim() || undefined, deployMode: opts.deployMode,
      profileResourceId: opts.profileResourceId,
      opencodeHostname: opts.opencodeHostname, opencodePort: opts.opencodePort,
    })
    return existing
  }
  const s: OpencodeSessionAgent = {
    sessionKey: opts.sessionKey, opencodeSessionId: null, activeClient: null,
    deployMode: opts.deployMode, providerId: opts.providerId.trim(), apiKey: opts.apiKey.trim(),
    model: opts.model?.trim(), profileResourceId: opts.profileResourceId,
    opencodeHostname: opts.opencodeHostname, opencodePort: opts.opencodePort,
    startedAt: Date.now(), lastActivityAt: Date.now(), chatType: opts.chatType,
    workspaceDir: opts.workspaceDir, senderOpenId: opts.senderOpenId, chatName: opts.chatName,
    meta: opts.meta, useMainWorkspace: opts.useMainWorkspace,
    abortController: new AbortController(), f41Stream: f41Eligible(opts.sessionKey, opts.chatType),
    streamBuffer: "", residentMode: opencodeResidentModeEnabled(), pendingDispatch: false,
    contextUsage: { ...ZERO_CONTEXT_USAGE }, watchdogState: "running", watchdogStateAt: Date.now(),
    logAgg: { kind: null, buf: "" },
  }
  initOpencodeStreamState(s)
  return s
}

export async function launchOpencodeAgent(opts: OpencodeLaunchOptions): Promise<{ ok: boolean; error?: string }> {
  if (!opts.sessionKey) return { ok: false, error: "session_key is required" }
  if (!opts.apiKey?.trim()) return { ok: false, error: "API Key 未配置" }
  if (!opts.providerId?.trim()) return { ok: false, error: "Provider ID 未配置" }

  const cooldown = OPENCODE_FAILED_COOLDOWNS.get(opts.sessionKey)
  if (cooldown && Date.now() < cooldown) {
    return { ok: false, error: `会话冷却中（${Math.ceil((cooldown - Date.now()) / 1000)}s），请稍后重试` }
  }
  if (OPENCODE_PENDING_LAUNCHES.has(opts.sessionKey)) return { ok: false, error: "会话正在启动中" }
  OPENCODE_PENDING_LAUNCHES.add(opts.sessionKey)

  let guard: ReturnType<typeof enterGuardWithLifecycle> | undefined
  let session: OpencodeSessionAgent | undefined
  try {
    session = OPENCODE_SESSIONS.get(opts.sessionKey)
    if (session?.pendingDispatch) return dispatchToOpencodeAgent(opts.sessionKey, opts.taskMessage ?? "", opts.meta?.messageIds)

    session = buildSession(opts, session)
    if (!OPENCODE_SESSIONS.has(opts.sessionKey)) OPENCODE_SESSIONS.set(opts.sessionKey, session)

    // S8：busy 经 guard 内 notifyGuardBusy 发一次 IM，对称 Cursor T8
    const lifecycle = createRunLifecycle(session)
    guard = enterGuardWithLifecycle(session, lifecycle)
    if (!guard.acquired) return { ok: false, error: "agent busy" }
    session.runGuardToken = guard.token
    session.inboundMessageIds = opts.meta?.messageIds
    session.runStartedAt = Date.now()
    resolveOpencodeContextLimit(opts.sessionKey, opts.model, opts.apiKey)
    maybeRotateOpencodeSessionContext(session)

    const prompt = buildPrompt(opts.meta, opts.taskMessage, opts.sessionKey, opts.useMainWorkspace)
    pushUiLog("OpenCode", "INFO", `[${opts.sessionKey}] launch (provider=${opts.providerId} key=${maskOpencodeApiKey(opts.apiKey)})`)
    session.pendingDispatch = true
    await startOpencodeRun(session, prompt, guard.token, opts)

    broadcastOpencodeSessionStatus([...OPENCODE_SESSIONS.values()])
    await notifySessionChat(opts.sessionKey, NOTIFY)
    await reportSessionAgentPhase(opts.sessionKey, "processing")
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: formatOpencodeFailureMessage(e) }
  } finally {
    OPENCODE_PENDING_LAUNCHES.delete(opts.sessionKey)
    if (guard?.acquired && session && !session.pendingDispatch) releaseRunGuard(opts.sessionKey, guard.token)
  }
}

export async function dispatchToOpencodeAgent(sessionKey: string, taskText: string, messageIds?: string[]): Promise<{ ok: boolean; error?: string }> {
  const session = OPENCODE_SESSIONS.get(sessionKey)
  if (!session) return { ok: false, error: `会话 ${sessionKey} 不存在，请先 launch` }
  if (session.pendingDispatch) return { ok: false, error: `会话 ${sessionKey} 正在执行中` }

  const cooldown = OPENCODE_FAILED_COOLDOWNS.get(sessionKey)
  if (cooldown && Date.now() < cooldown) {
    return { ok: false, error: `会话冷却中（${Math.ceil((cooldown - Date.now()) / 1000)}s），请稍后重试` }
  }

  session.pendingDispatch = true
  try {
    resetOpencodeRunPresentationState(session)
    session.inboundMessageIds = messageIds
    resolveOpencodeContextLimit(sessionKey, session.model, session.apiKey)
    maybeRotateOpencodeSessionContext(session)
    const lifecycle = createRunLifecycle(session)
    const guard = enterGuardWithLifecycle(session, lifecycle)
    if (!guard.acquired) {
      session.pendingDispatch = false
      return { ok: false, error: "agent busy|retry_after=1500" }
    }
    session.runGuardToken = guard.token
    session.runStartedAt = Date.now()

    const opts: OpencodeLaunchOptions = {
      sessionKey, chatType: session.chatType, meta: session.meta,
      workspaceDir: session.workspaceDir ?? "", useMainWorkspace: session.useMainWorkspace,
      senderOpenId: session.senderOpenId, chatName: session.chatName, taskMessage: taskText,
      providerId: session.providerId, apiKey: session.apiKey, model: session.model,
      deployMode: session.deployMode, profileResourceId: session.profileResourceId,
      opencodeHostname: session.opencodeHostname, opencodePort: session.opencodePort,
    }
    await startOpencodeRun(session, buildPrompt(session.meta, taskText, sessionKey, session.useMainWorkspace), guard.token, opts)
    broadcastOpencodeSessionStatus([...OPENCODE_SESSIONS.values()])
    await notifySessionChat(sessionKey, NOTIFY)
    await reportSessionAgentPhase(sessionKey, "processing")
    return { ok: true }
  } catch (e: unknown) {
    session.pendingDispatch = false
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

registerOpencodeLaunchHandler(launchOpencodeAgent)
registerOpencodeDispatchHandler(dispatchToOpencodeAgent)
