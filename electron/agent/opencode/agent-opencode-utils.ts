/**
 * OpenCode Client 解析、模型解析与脱敏工具（仿 agent-codex-utils）。
 */
import { createOpencode, createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk"
import { pushUiLog } from "../../app/ui-logger"
import { ZERO_CONTEXT_USAGE } from "../cursor-sdk/context-usage"
import type { AgentResource } from "../../../src/shared/channel-types"
import type { OpencodeClientBundle, OpencodeSessionAgent } from "./agent-opencode-types"
import { OPENCODE_DEFAULT_MODEL } from "./agent-opencode-types"
import { formatOpencodeFailureMessage, maskOpencodeApiKey, sanitizeOpencodeSensitiveText } from "./opencode-failure-messages"
import { f41Eligible, resolveSessionChannelType, presentationOrderingEnvEnabled } from "../claude-code/agent-cc-utils"

export { f41Eligible, resolveSessionChannelType, maskOpencodeApiKey }

/** 按 Profile id 缓存内嵌 server（懒启动） */
const embeddedByProfileId = new Map<string, OpencodeClientBundle>()

/** 解析 providerID/modelID（支持 provider/model 或仅 modelID） */
export function parseModelRef(model: string): { providerID: string; modelID: string } {
  const trimmed = model.trim() || OPENCODE_DEFAULT_MODEL
  const slash = trimmed.indexOf("/")
  if (slash > 0) {
    return { providerID: trimmed.slice(0, slash), modelID: trimmed.slice(slash + 1) }
  }
  return { providerID: "anthropic", modelID: trimmed }
}

/** 外部模式探活（ponytail: SDK 无 global.health，用 config.get 代替） */
async function probeOpencodeClient(client: OpencodeClient): Promise<void> {
  try {
    const res = await client.config.get()
    if (res.error) throw new Error(res.error.message ?? "health check failed")
  } catch (e: unknown) {
    const err = new Error("external health check failed")
    ;(err as Error & { code: string }).code = "external_health_failed"
    throw err
  }
}

/** 解析 OpenCode Client：embedded 懒启动并缓存；external 直连 baseUrl */
export async function resolveOpencodeClient(
  profile: AgentResource,
  inlineConfig?: Record<string, unknown>,
): Promise<OpencodeClientBundle> {
  const deployMode = profile.deployMode ?? "embedded"
  if (deployMode === "external") {
    const baseUrl = profile.baseUrl?.trim()
    if (!baseUrl) {
      const err = new Error("外部模式未配置 baseUrl")
      ;(err as Error & { code: string }).code = "external_health_failed"
      throw err
    }
    const client = createOpencodeClient({ baseUrl })
    await probeOpencodeClient(client)
    return { client, deployMode: "external" }
  }

  const cached = embeddedByProfileId.get(profile.id)
  if (cached?.client) return cached

  const hostname = profile.opencodeHostname?.trim() || "127.0.0.1"
  const port = profile.opencodePort ?? 4096
  try {
    const result = await createOpencode({
      hostname,
      port,
      config: inlineConfig ?? {},
      timeout: 15_000,
    })
    const bundle: OpencodeClientBundle = {
      client: result.client,
      server: result.server,
      deployMode: "embedded",
    }
    embeddedByProfileId.set(profile.id, bundle)
    pushUiLog("OpenCode", "INFO", `内嵌 OpenCode 已启动 ${result.server.url}`)
    return bundle
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : String(e)
    pushUiLog("OpenCode", "ERROR", `内嵌启动失败: ${sanitizeOpencodeSensitiveText(raw)}`)
    const err = new Error(formatOpencodeFailureMessage({ code: "embedded_start_failed" }))
    ;(err as Error & { code: string }).code = "embedded_start_failed"
    throw err
  }
}

/** 应用退出时关闭全部内嵌 server */
export function closeAllEmbeddedOpencodeServers(): void {
  for (const [id, bundle] of embeddedByProfileId) {
    try { bundle.server?.close() } catch { /* best-effort */ }
    embeddedByProfileId.delete(id)
  }
}

export function opencodeResidentModeEnabled(): boolean {
  const v = (process.env.OPENCODE_RESIDENT_AGENT ?? process.env.SDK_RESIDENT_AGENT ?? "").trim().toLowerCase()
  return v !== "0" && v !== "false"
}

/** Presentation 时序：开关开启且 f41 流式（主用户私聊或飞书群聊） */
export function presentationOrderingEligible(session: OpencodeSessionAgent): boolean {
  return presentationOrderingEnvEnabled() && session.f41Stream
}

/** 重置单次 run 的 presentation 状态 */
export function resetOpencodeRunPresentationState(session: OpencodeSessionAgent): void {
  session.errorNotified = false
  session.lastStatus = undefined
  session.lastTool = undefined
  session.runStartedAt = undefined
  session.streamBuffer = ""
  session.outboundMessageId = undefined
  session.toolPresentationOutboundIds = undefined
  session.streamId = undefined
  session.streamLastPostAt = undefined
  // 对称 resetOpencodeStreamState：清 timer/链，避免本文件 import stream 循环依赖
  if (session.streamPostTimer) {
    clearTimeout(session.streamPostTimer)
    session.streamPostTimer = undefined
  }
  session.streamPostChain = undefined
  session.logAgg = { kind: null, buf: "" }
  session.seenProcessEvent = false
  session.presentationDeferStream = false
  session.thinkingOpen = false
  session.contextUsage = { ...ZERO_CONTEXT_USAGE }
  session.contextUsageFromRunTotal = undefined
  session.runFinalizing = false
  session.failureArchiveDone = false
  session.watchdogState = "running"
  session.watchdogStateAt = Date.now()
  session.eventLoopRunning = false
  session.abortController = new AbortController()
}

export function setOpencodeWatchdogState(
  session: OpencodeSessionAgent,
  next: "running" | "draining" | "cancelling",
  reason: string,
): void {
  if (session.watchdogState === next) return
  session.watchdogState = next
  session.watchdogStateAt = Date.now()
  pushUiLog("OpenCode", "INFO", `[${session.sessionKey}] watchdog -> ${next} (${reason})`)
}

export function markOpencodeSessionActivity(session: OpencodeSessionAgent, source: string): void {
  session.lastActivityAt = Date.now()
  if (session.watchdogState !== "running") {
    setOpencodeWatchdogState(session, "running", `activity:${source}`)
  }
}

/** 失败归因上下文 */
export function buildOpencodeFailCtx(session: OpencodeSessionAgent, e: unknown) {
  return {
    ...(typeof e === "object" && e != null ? e as object : { message: String(e) }),
    isTimeoutFailure: session.watchdogTimedOut === true,
    contextUsed: session.contextUsagePeakTokens,
    contextLimit: session.contextLimitTokens ?? null,
  }
}
