/**
 * SDK agent.send 调度与 ContextRotation（拆分自 agent-sdk.ts）
 */
import type { Run, McpServerConfig, SDKAgent } from "@cursor/sdk"
import {
  createAgentSendOptions,
  evaluatePreSendContextPressure,
} from "./context-usage"
import { appendInlineMcpToSendOptions } from "../../mcp/loaders/mcp-sdk-loader"
import { bootstrapSdkPluginWorkspace, logSdkPluginConfig } from "../../mcp/loaders/plugin-sdk-bootstrap"
import { buildIdempotencyKey, shouldRetry } from "../shared/retry-policy"
import { maybeRotateContext } from "./context-rotation-lite"
import { recreateSessionAgent, maybeRefreshStaleResidentAgent } from "./sdk-resident-refresh"
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

function logSdkConfigSources(workspaceDir: string): Record<string, McpServerConfig> {
  const boot = bootstrapSdkPluginWorkspace(workspaceDir)
  logSdkPluginConfig(workspaceDir, boot, (level, msg) => pushUiLog("SDK", level, msg))
  return boot.mcpServers
}

/** 组装 send 选项并注入幂等键 */
export function buildSendOptions(session: SdkSessionAgent, idempotencyKey: string): Parameters<SDKAgent["send"]>[1] {
  const ws = session.workspaceDir ?? process.cwd()
  const inlineMcp = logSdkConfigSources(ws)
  const options = appendInlineMcpToSendOptions(
    createAgentSendOptions(session, pushUiLog, {
      onCompression: makeCompressionNotify(session),
      onActivity: () => markSessionActivity(session, "onDelta"),
    }),
    session.workspaceDir,
    inlineMcp,
  ) as Record<string, unknown>
  options.idempotencyKey = idempotencyKey
  session.lastInjectedMcpServers = options.mcpServers as Record<string, McpServerConfig> | undefined
  return options as Parameters<SDKAgent["send"]>[1]
}

/** ContextRotation-lite：先建新实例再切换（复用 recreateSessionAgent） */
async function maybeRotateSessionForPressure(
  session: SdkSessionAgent,
  originalText: string,
): Promise<{ text: string; rotated: boolean }> {
  const pressure = evaluatePreSendContextPressure(session, pushUiLog)
  // 每次 pre-send 覆盖快照，供 context_blocked 阻断与失败归因（轮转清零 peak 后仍可读）
  session.lastPreSendUsedTokens = pressure.used
  session.lastPreSendUsageRatio = pressure.ratio ?? undefined
  const ratio = pressure.ratio ?? 0
  const decision = maybeRotateContext({ sessionKey: session.sessionKey, usageRatio: ratio, nowMs: Date.now() })
  if (!decision.rotated) return { text: originalText, rotated: false }
  const ok = await recreateSessionAgent(session, "context_rotation")
  if (!ok) return { text: originalText, rotated: false }
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
      // 长驻空闲超阈值：先刷新再压力轮转（create 失败保留旧实例）
      await maybeRefreshStaleResidentAgent(session)
      const rotatedResult = await maybeRotateSessionForPressure(session, text)
      text = rotatedResult.text
      rotated = rotatedResult.rotated
      // ratio≥100% 且轮转未成功：立即阻断，不进入 agent.send
      const preSendRatio = session.lastPreSendUsageRatio ?? 0
      if (preSendRatio >= 1.0 && !rotated) {
        session.lastDispatchAttempts = 1
        pushUiLog("SDK", "WARN", `[${session.sessionKey}] pre-send context_blocked ratio=${preSendRatio}`)
        return { attempts: 1, finalReason: "context_blocked", rotated: false }
      }
    }
    const idempotencyKey = buildIdempotencyKey(session.sessionKey, resolveLastInboundId(session), attempt)
    try {
      // 即将 send 时写入，供 completeSdkRun 静默 ERROR opaque_retry
      session.lastSendText = text
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
