/**
 * Cursor SDK 执行引擎（入口 & 编排）
 * 复杂逻辑下沉 sdk-run-* / sdk-session-* / agent-sdk-http。
 */
import { Agent } from "@cursor/sdk"
import { resolve, join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { ZERO_CONTEXT_USAGE, evaluatePreSendContextPressure, resolveContextLimitForSession } from "./context-usage"
import { buildPrompt } from "../shared/agent-launcher"
import { loadInlineMcpServersForSdk } from "../../mcp/loaders/mcp-sdk-loader"
import { acquireRunGuard, completeRunGuard, releaseRunGuard } from "../shared/agent-run-guard"
import { ensureAgentSdkHttpServer } from "./agent-sdk-http"
import { notifyDispatchFailure } from "./sdk-run-finalize"
import { sendWithRetry } from "./sdk-run-dispatch"
import { startSdkRun, stopSdkSession, stopAllSdkSessions } from "./sdk-run-lifecycle"
import {
  broadcastSdkSessionStatus,
  failedCooldowns,
  FAIL_COOLDOWN_MS,
  f41Eligible,
  getSdkSession,
  getSdkSessionCount,
  getSdkSessionList,
  hasSdkSession,
  isSdkSessionProcessing,
  isSdkSessionRunning,
  markSessionActivity,
  pendingLaunches,
  resetSdkRunPresentationState,
  sdkResidentModeEnabled,
  sdkSessions,
} from "./sdk-session-registry"
import type { SdkLaunchOptions } from "./sdk-session-types"
import { pushUiLog, broadcastLog } from "../../app/ui-logger"

// ── 类型与拆分模块 re-export（保持外部 import 路径不变） ──
export type {
  SdkSessionAgent,
  PresentationKind,
  PresentationEvent,
  SdkLaunchOptions,
  SdkModelOption,
} from "./sdk-session-types"
export { isRunTimeoutFailure, finalizeSdkRunOnTimeout } from "./sdk-run-finalize"
export { streamRunEvents, handleSdkEvent } from "./sdk-run-stream"
export {
  isSdkSessionRunning,
  hasSdkSession,
  getSdkSessionCount,
  getSdkSessionList,
  getSdkSession,
} from "./sdk-session-registry"
export { checkSdkApiKey, listSdkModels } from "./sdk-api-models"
export { stopSdkSession, stopAllSdkSessions } from "./sdk-run-lifecycle"
export { ensureAgentSdkHttpServer, getAgentSdkApiPort, launchSdkAgentFromHttp } from "./agent-sdk-http"
export { recoverSdkActiveRuns } from "./sdk-run-recover"

/** 解析 SDK 平台包内 ripgrep 路径 */
export function ensureSdkBinaryPaths(): void {
  if (process.env.CURSOR_RIPGREP_PATH) return
  const platformPkg = `@cursor/sdk-${process.platform}-${process.arch}`
  const binaryName = process.platform === "win32" ? "rg.exe" : "rg"
  const candidates: string[] = []
  try {
    const req = createRequire(import.meta.url)
    const pkgDir = dirname(req.resolve(`${platformPkg}/package.json`))
    candidates.push(join(pkgDir, "bin", binaryName))
  } catch { /* package not resolvable */ }
  const appDir = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  for (const base of [appDir, resolve(".")]) {
    candidates.push(join(base, "node_modules", platformPkg, "bin", binaryName))
    candidates.push(join(base, "resources", "node_modules", platformPkg, "bin", binaryName))
  }
  for (const p of candidates) {
    const real = p.includes("app.asar") && !p.includes("app.asar.unpacked")
      ? p.replace("app.asar", "app.asar.unpacked")
      : p
    if (existsSync(real)) {
      process.env.CURSOR_RIPGREP_PATH = real
      pushUiLog("SDK", "INFO", `Ripgrep 路径: ${real}`)
      return
    }
  }
  pushUiLog("SDK", "WARN", `未找到 ${binaryName}，SDK 可能报错 (searched: ${candidates.join(", ")})`)
}

export async function launchSdkAgent(opts: SdkLaunchOptions): Promise<{ ok: boolean; error?: string }> {
  const { sessionKey, chatType, meta, workspaceDir, senderOpenId, chatName, taskMessage } = opts
  ensureAgentSdkHttpServer()

  const existing = sdkSessions.get(sessionKey)
  if (existing && !existing.abortController.signal.aborted) {
    if (isSdkSessionProcessing(existing)) {
      markSessionActivity(existing, "launch_reentry")
      pushUiLog("SDK", "WARN", `[${sessionKey}] launchSdkAgent 早退：session 仍 processing`)
      return { ok: true }
    }
    if (taskMessage?.trim()) {
      const prompt = buildPrompt(meta, taskMessage, sessionKey, opts.useMainWorkspace)
      return dispatchToSdkAgent(sessionKey, prompt, meta?.messageIds)
    }
    return { ok: true }
  }

  if (pendingLaunches.has(sessionKey)) return { ok: true }

  const cooldownUntil = failedCooldowns.get(sessionKey)
  if (cooldownUntil && Date.now() < cooldownUntil) {
    return { ok: false, error: `冷却中，${Math.ceil((cooldownUntil - Date.now()) / 1000)}s 后可重试` }
  }
  failedCooldowns.delete(sessionKey)
  pendingLaunches.add(sessionKey)

  const apiKey = opts.apiKey?.trim()
  if (!apiKey) {
    pendingLaunches.delete(sessionKey)
    return { ok: false, error: "通道绑定的 SDK 资源未配置 API Key（设置 → Agent）" }
  }

  const prompt = buildPrompt(meta, taskMessage, sessionKey, opts.useMainWorkspace)

  try {
    ensureSdkBinaryPaths()
    const modelId = opts.model?.trim() && opts.model.trim() !== "auto" ? opts.model.trim() : "composer-2"
    const modelSelection: { id: string; params?: { id: string; value: string }[] } = { id: modelId }
    if (opts.modelParams?.trim()) {
      try { modelSelection.params = JSON.parse(opts.modelParams) } catch { /* ignore */ }
    }
    pushUiLog("SDK", "INFO", `[${sessionKey}] 正在创建 SDK Agent (cwd=${workspaceDir}, model=${JSON.stringify(modelSelection)})`)

    const injected = loadInlineMcpServersForSdk(workspaceDir)
    pushUiLog(
      "SDK",
      "INFO",
      `[config] settingSources=project,user cwd=${workspaceDir} inlineMcp=${Object.keys(injected).join(",")}`,
    )
    const agent = await Agent.create({
      apiKey,
      model: modelSelection,
      mcpServers: injected,
      local: { cwd: workspaceDir, settingSources: ["project", "user"], sandboxOptions: { enabled: false } },
    })

    const session = {
      sessionKey,
      agent,
      run: null,
      agentId: agent.agentId,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      chatType,
      workspaceDir,
      senderOpenId,
      chatName,
      abortController: new AbortController(),
      logAgg: { kind: null, buf: "" },
      f41Stream: f41Eligible(sessionKey, chatType),
      streamBuffer: "",
      residentMode: sdkResidentModeEnabled(),
      pendingDispatch: false,
      presentationDeferStream: false,
      seenProcessEvent: false,
      thinkingOpen: false,
      contextUsage: { ...ZERO_CONTEXT_USAGE },
      modelId,
      modelParams: opts.modelParams,
      apiKey,
      inboundMessageIds: meta?.messageIds,
      watchdogState: "running" as const,
      watchdogStateAt: Date.now(),
      lastInjectedMcpServers: injected,
    }
    sdkSessions.set(sessionKey, session)
    pendingLaunches.delete(sessionKey)
    broadcastLog(`[SDK] 会话 ${sessionKey} 已创建, agentId=${agent.agentId}`)
    broadcastSdkSessionStatus()

    await resolveContextLimitForSession(session)
    evaluatePreSendContextPressure(session, pushUiLog)
    const guard = acquireRunGuard(sessionKey)
    if (!guard.acquired) {
      pendingLaunches.delete(sessionKey)
      try { session.agent.close() } catch { /* best-effort */ }
      sdkSessions.delete(sessionKey)
      return { ok: false, error: "agent busy" }
    }
    session.runGuardToken = guard.token
    const sendResult = await sendWithRetry(session, prompt)
    if (!sendResult.run) {
      completeRunGuard(sessionKey, guard.token)
      releaseRunGuard(sessionKey, guard.token)
      session.runGuardToken = undefined
      try { session.agent.close() } catch { /* best-effort */ }
      sdkSessions.delete(sessionKey)
      broadcastSdkSessionStatus()
      if (sendResult.finalReason === "agent_busy") {
        return { ok: false, error: `agent busy|retry_after=${sendResult.busyDelayMs ?? 1500}` }
      }
      return { ok: false, error: `dispatch failed: ${sendResult.finalReason ?? "unknown"}` }
    }
    await startSdkRun(session, sendResult.run)
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    broadcastLog(`[SDK] 启动失败 ${sessionKey}: ${msg}`, "ERROR")
    failedCooldowns.set(sessionKey, Date.now() + FAIL_COOLDOWN_MS)
    pendingLaunches.delete(sessionKey)
    const failed = sdkSessions.get(sessionKey)
    if (failed?.runGuardToken) {
      completeRunGuard(sessionKey, failed.runGuardToken)
      releaseRunGuard(sessionKey, failed.runGuardToken)
      failed.runGuardToken = undefined
    }
    if (failed) try { failed.agent.close() } catch { /* best-effort */ }
    sdkSessions.delete(sessionKey)
    broadcastSdkSessionStatus()
    return { ok: false, error: msg }
  }
}

export async function dispatchToSdkAgent(
  sessionKey: string,
  taskText: string,
  messageIds?: string[],
): Promise<{ ok: boolean; error?: string }> {
  ensureAgentSdkHttpServer()
  const text = taskText?.trim()
  if (!text) return { ok: false, error: "empty task" }

  const session = sdkSessions.get(sessionKey)
  if (!session || session.abortController.signal.aborted) {
    pushUiLog("SDK", "ERROR", `[${sessionKey}] dispatch_failed: no resident agent`)
    return { ok: false, error: "no resident agent" }
  }
  if (isSdkSessionProcessing(session)) return { ok: false, error: "agent busy" }

  session.inboundMessageIds = messageIds?.length ? messageIds : undefined
  const guard = acquireRunGuard(sessionKey)
  if (!guard.acquired) return { ok: false, error: "agent busy|retry_after=1500" }
  session.runGuardToken = guard.token
  session.pendingDispatch = true
  try {
    resetSdkRunPresentationState(session)
    await resolveContextLimitForSession(session)
    evaluatePreSendContextPressure(session, pushUiLog)
    const sendResult = await sendWithRetry(session, text)
    if (!sendResult.run) {
      completeRunGuard(sessionKey, guard.token)
      releaseRunGuard(sessionKey, guard.token)
      session.runGuardToken = undefined
      session.pendingDispatch = false
      if (sendResult.finalReason === "agent_busy") {
        return { ok: false, error: `agent busy|retry_after=${sendResult.busyDelayMs ?? 1500}` }
      }
      return { ok: false, error: `dispatch failed: ${sendResult.finalReason ?? "unknown"}` }
    }
    session.pendingDispatch = false
    await startSdkRun(session, sendResult.run)
    return { ok: true }
  } catch (e: unknown) {
    session.pendingDispatch = false
    if (session.runGuardToken) {
      completeRunGuard(sessionKey, session.runGuardToken)
      releaseRunGuard(sessionKey, session.runGuardToken)
      session.runGuardToken = undefined
    }
    const msg = e instanceof Error ? e.message : String(e)
    await notifyDispatchFailure(sessionKey, msg)
    return { ok: false, error: msg }
  }
}
