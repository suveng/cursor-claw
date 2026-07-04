/**
 * SDK Session 注册表与活跃时钟（拆分自 agent-sdk.ts）
 */
import type { Run } from "@cursor/sdk"
import { getChannel, resolveChannelForSession } from "../../config/config-store"
import { parseChatKey } from "../../../src/shared/channel-types"
import { ZERO_CONTEXT_USAGE } from "./context-usage"
import { type ChatType, resolveSessionChatName } from "../shared/agent-launcher"
import { pushUiLog, broadcastSessionStatus } from "../../app/ui-logger"
import type { SdkSessionAgent } from "./sdk-session-types"

/** 活跃 SDK 会话 Map（内部模块共享） */
export const sdkSessions = new Map<string, SdkSessionAgent>()
export const pendingLaunches = new Set<string>()
export const failedCooldowns = new Map<string, number>()
export const FAIL_COOLDOWN_MS = 30_000

export function sdkResidentModeEnabled(): boolean {
  const v = (process.env.SDK_RESIDENT_AGENT ?? "").trim().toLowerCase()
  return v !== "0" && v !== "false"
}

export function isSdkSessionProcessing(session: SdkSessionAgent): boolean {
  return session.run !== null || session.pendingDispatch
}

/** 重置 Run 级呈现状态（跨 Run 字段如 contextUsagePeakTokens 保留） */
export function resetSdkRunPresentationState(session: SdkSessionAgent): void {
  session.errorNotified = false
  session.lastStatus = undefined
  session.lastTool = undefined
  session.runPhase = undefined
  session.runStartedAt = undefined
  session.streamBuffer = ""
  session.outboundMessageId = undefined
  session.toolPresentationOutboundIds = undefined
  session.streamId = undefined
  session.streamLastPostAt = undefined
  session.logAgg = { kind: null, buf: "" }
  session.presentationDeferStream = false
  session.seenProcessEvent = false
  session.thinkingOpen = false
  session.contextUsage = { ...ZERO_CONTEXT_USAGE }
  session.contextUsageFromRunTotal = undefined
  session.contextUsageFinalized = false
  session.compressionNotified = false
  session.runFinalizing = false
  session.failureArchiveDone = false
  session.taskSeq = undefined
  session.watchdogState = "running"
  session.watchdogStateAt = Date.now()
  session.watchdogTimedOut = undefined
  session.abortController = new AbortController()
}

export function setWatchdogState(
  session: SdkSessionAgent,
  next: "running" | "draining" | "cancelling",
  reason: string,
): void {
  if (session.watchdogState === next) return
  session.watchdogState = next
  session.watchdogStateAt = Date.now()
  pushUiLog("SDK", "INFO", `[${session.sessionKey}] watchdog 状态切换 -> ${next} (${reason})`)
}

/**
 * 活跃信号统一入口：任何可观测事件都刷新 lastActivityAt。
 * draining 态可 resume 为 running（hung run 保护）；cancelling 或 watchdog 已置闩时不 resume，避免竞态误复活。
 */
export function markSessionActivity(session: SdkSessionAgent, source: string): void {
  session.lastActivityAt = Date.now()
  // watchdog 已进入取消或 onTimeout 已置闩：仅刷新时钟，禁止 activity_resume
  if (session.watchdogState === "cancelling" || session.watchdogTimedOut) {
    return
  }
  if (session.watchdogState !== "running") {
    setWatchdogState(session, "running", `activity_resume:${source}`)
  }
}

export function extractErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const code = (value as { errorCode?: unknown }).errorCode
  return code != null && String(code).trim() ? String(code) : undefined
}

export function extractChatId(sessionKey: string): string {
  const idx = sessionKey.indexOf("::")
  return idx > 0 ? sessionKey.slice(0, idx) : sessionKey
}

/** 主用户私聊或飞书群聊（allowOthers）+ SDK 资源 → 可走 /api/stream-text */
export function f41Eligible(sessionKey: string, chatType: ChatType): boolean {
  const chatId = extractChatId(sessionKey)
  const { channelId, chatId: raw } = parseChatKey(chatId)
  const channel = channelId ? getChannel(channelId) : undefined
  if (chatType === "p2p") {
    if (!channel?.mainUserEnabled || !channel.mainUserChatId?.trim()) return false
    return raw === channel.mainUserChatId.trim()
  }
  if (chatType === "group") {
    return channel?.type === "feishu" && !!channel.allowOthers
  }
  return false
}

function presentationOrderingEnvEnabled(): boolean {
  const v = (process.env.PRESENTATION_ORDERING ?? "").trim().toLowerCase()
  if (v === "0" || v === "false") return false
  return true
}

/** Presentation 时序编排：PRESENTATION_ORDERING 开启且主用户私聊 SDK 流式 */
export function presentationOrderingEligible(session: SdkSessionAgent): boolean {
  if (!presentationOrderingEnvEnabled()) return false
  return session.f41Stream && session.chatType === "p2p"
}

export function resolveRunDurationMs(session: SdkSessionAgent, run?: Run | null): number | undefined {
  const fromRun = run?.durationMs ?? session.run?.durationMs
  if (fromRun != null) return fromRun
  if (session.runStartedAt != null) return Date.now() - session.runStartedAt
  return undefined
}

/** 从 sessionKey 解析通道类型 */
export function resolveSessionChannelType(sessionKey: string): string | undefined {
  const chatId = extractChatId(sessionKey)
  const { channelId } = parseChatKey(chatId)
  const channel = channelId ? getChannel(channelId) : resolveChannelForSession(sessionKey)
  return channel?.type
}

export function broadcastSdkSessionStatus(): void {
  const list = [...sdkSessions.values()].map((s) => ({
    sessionKey: s.sessionKey,
    pid: 0,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    chatType: s.chatType as string,
    chatName: resolveSessionChatName(s.sessionKey, s.chatName, s.senderOpenId),
    workspaceDir: s.workspaceDir,
  }))
  broadcastSessionStatus(list, "sdk")
}

export function isSdkSessionRunning(sessionKey: string): boolean {
  if (pendingLaunches.has(sessionKey)) return true
  const s = sdkSessions.get(sessionKey)
  if (!s || s.abortController.signal.aborted) return false
  return isSdkSessionProcessing(s)
}

/** 长驻 Agent 实例是否存在（含 idle，供 stop 等路径） */
export function hasSdkSession(sessionKey: string): boolean {
  const s = sdkSessions.get(sessionKey)
  return s !== undefined && !s.abortController.signal.aborted
}

export function getSdkSessionCount(): number {
  let count = 0
  for (const s of sdkSessions.values()) {
    if (!s.abortController.signal.aborted) count++
  }
  return count
}

export function getSdkSessionList() {
  return [...sdkSessions.values()].map((s) => ({
    sessionKey: s.sessionKey,
    agentId: s.agentId,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    chatType: s.chatType,
    workspaceDir: s.workspaceDir,
    senderOpenId: s.senderOpenId,
    chatName: s.chatName,
  }))
}

export function getSdkSession(sessionKey: string): SdkSessionAgent | undefined {
  return sdkSessions.get(sessionKey)
}

export function resolveLastInboundId(session: SdkSessionAgent): string {
  const ids = session.inboundMessageIds
  if (!ids || ids.length === 0) return "no-inbound"
  return ids[ids.length - 1] || "no-inbound"
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
