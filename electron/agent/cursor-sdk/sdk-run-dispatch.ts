/**
 * SDK agent.send 调度与 ContextRotation（拆分自 agent-sdk.ts）
 */
import { Agent, type SDKAgent, type Run, type McpServerConfig } from "@cursor/sdk"
import {
  ZERO_CONTEXT_USAGE,
  createAgentSendOptions,
  evaluatePreSendContextPressure,
} from "./context-usage"
import { appendInlineMcpToSendOptions, loadInlineMcpServersForSdk } from "../../mcp/loaders/mcp-sdk-loader"
import { buildIdempotencyKey, shouldRetry } from "../shared/retry-policy"
import { maybeRotateContext } from "./context-rotation-lite"
import { notifySessionChat } from "../../daemon/sdk-daemon-notify"
import {
  markSessionActivity,
  resolveLastInboundId,
  sleep,
} from "./sdk-session-registry"
import type { SdkSessionAgent } from "./sdk-session-types"
import { pushUiLog } from "../../app/ui-logger"

const SEND_RETRY_MAX_ATTEMPTS = 3
const NOTIFY_COMPRESSING = "正在压缩上下文…"

function makeCompressionNotify(session: SdkSessionAgent): (phase: "started" | "completed") => void {
  return (phase) => {
    if (phase !== "started" || session.compressionNotified) return
    session.compressionNotified = true
    void notifySessionChat(session.sessionKey, NOTIFY_COMPRESSING)
  }
}

function logSdkConfigSources(workspaceDir: string, inlineMcp: Record<string, McpServerConfig>): void {
  const names = Object.keys(inlineMcp).join(",")
  pushUiLog("SDK", "INFO", `[config] settingSources=project,user cwd=${workspaceDir} inlineMcp=${names}`)
}

/** 组装 send 选项并注入幂等键 */
export function buildSendOptions(session: SdkSessionAgent, idempotencyKey: string): Parameters<SDKAgent["send"]>[1] {
  const ws = session.workspaceDir ?? process.cwd()
  logSdkConfigSources(ws, loadInlineMcpServersForSdk(ws))
  const options = appendInlineMcpToSendOptions(
    createAgentSendOptions(session, pushUiLog, {
      onCompression: makeCompressionNotify(session),
      onActivity: () => markSessionActivity(session, "onDelta"),
    }),
    session.workspaceDir,
  ) as Record<string, unknown>
  options.idempotencyKey = idempotencyKey
  session.lastInjectedMcpServers = options.mcpServers as Record<string, McpServerConfig> | undefined
  return options as Parameters<SDKAgent["send"]>[1]
}

/** ContextRotation-lite：先建新实例再切换 */
async function maybeRotateSessionForPressure(
  session: SdkSessionAgent,
  originalText: string,
): Promise<{ text: string; rotated: boolean }> {
  const pressure = evaluatePreSendContextPressure(session, pushUiLog)
  const ratio = pressure.ratio ?? 0
  const decision = maybeRotateContext({ sessionKey: session.sessionKey, usageRatio: ratio, nowMs: Date.now() })
  if (!decision.rotated) return { text: originalText, rotated: false }
  const modelSelection: { id: string; params?: { id: string; value: string }[] } = { id: session.modelId ?? "composer-2" }
  if (session.modelParams?.trim()) {
    try {
      modelSelection.params = JSON.parse(session.modelParams)
    } catch { /* 忽略非法模型参数 */ }
  }
  const previousAgent = session.agent
  const previousAgentId = session.agentId
  const injected = loadInlineMcpServersForSdk(session.workspaceDir ?? process.cwd())
  let nextAgent: SDKAgent
  try {
    nextAgent = await Agent.create({
      apiKey: session.apiKey ?? "",
      model: modelSelection,
      mcpServers: injected,
      local: {
        cwd: session.workspaceDir ?? process.cwd(),
        settingSources: ["project", "user"],
        sandboxOptions: { enabled: false },
      },
    })
  } catch (err: unknown) {
    pushUiLog(
      "SDK",
      "WARN",
      `[${session.sessionKey}] context_rotation skipped: ${err instanceof Error ? err.message : String(err)}`,
    )
    session.agent = previousAgent
    session.agentId = previousAgentId
    return { text: originalText, rotated: false }
  }
  session.agent = nextAgent
  session.agentId = nextAgent.agentId
  session.lastInjectedMcpServers = injected
  try {
    previousAgent.close()
  } catch { /* best-effort */ }
  session.contextUsage = { ...ZERO_CONTEXT_USAGE }
  session.contextUsagePeakTokens = undefined
  const summary = decision.summary ?? "已执行上下文轮转。"
  return { text: `${summary}\n\n${originalText}`, rotated: true }
}

/** 发送入口：retryable 退避；busy 不硬重试 */
export async function sendWithRetry(
  session: SdkSessionAgent,
  inputText: string,
): Promise<{ run?: Run; attempts: number; finalReason?: string; busyDelayMs?: number; rotated: boolean }> {
  let text = inputText
  let rotated = false
  let lastReason = "unknown"
  for (let attempt = 1; attempt <= SEND_RETRY_MAX_ATTEMPTS; attempt += 1) {
    if (attempt === 1) {
      const rotatedResult = await maybeRotateSessionForPressure(session, text)
      text = rotatedResult.text
      rotated = rotatedResult.rotated
    }
    const idempotencyKey = buildIdempotencyKey(session.sessionKey, resolveLastInboundId(session), attempt)
    try {
      const run = await session.agent.send(text, buildSendOptions(session, idempotencyKey))
      session.lastDispatchAttempts = attempt
      pushUiLog("SDK", "INFO", `[${session.sessionKey}] dispatch_retry status=ok attempts=${attempt} idempotency=${idempotencyKey}`)
      return { run, attempts: attempt, rotated }
    } catch (err: unknown) {
      const decision = shouldRetry(err, attempt)
      lastReason = decision.reason
      pushUiLog(
        "SDK",
        "WARN",
        `[${session.sessionKey}] dispatch_retry status=failed attempts=${attempt} reason=${decision.reason} delayMs=${decision.delayMs}`,
      )
      if (decision.isBusy) {
        return { attempts: attempt, finalReason: decision.reason, busyDelayMs: decision.delayMs, rotated }
      }
      if (!decision.retryable || attempt >= SEND_RETRY_MAX_ATTEMPTS) {
        break
      }
      await sleep(decision.delayMs)
    }
  }
  return { attempts: SEND_RETRY_MAX_ATTEMPTS, finalReason: lastReason, rotated }
}
