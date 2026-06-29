/**
 * Claude Code SDK 会话辅助工具
 *
 * 包含：
 * - claude CLI 二进制路径解析
 * - session 辅助函数（extractChatId / f41Eligible / ccResidentModeEnabled）
 * - 通道类型解析
 * - session 状态重置（resetCcRunPresentationState）
 * - watchdog 状态切换（setWatchdogState / markSessionActivity）
 *
 * 依赖方向：agent-cc-types → agent-cc-utils（仅 import 外部包 + agent-cc-types）
 */
import { resolve, join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { getChannel, resolveChannelForSession } from "./config-store"
import { parseChatKey } from "../src/shared/channel-types"
import { pushUiLog } from "./ui-logger"
import { ZERO_CONTEXT_USAGE } from "./context-usage"
import type { ChatType } from "./agent-launcher"
import type { CcSessionAgent } from "./agent-cc-types"

// ── 二进制路径解析 ────────────────────────────────────────────────────────────

/** 解析 claude CLI 二进制路径，优先 node_modules，fallback PATH */
export function resolveCcBinaryPath(): string {
  // 1. 优先通过 createRequire 定位 node_modules/.bin/claude
  try {
    const req = createRequire(import.meta.url)
    const pkgDir = dirname(req.resolve("@anthropic-ai/claude-code/package.json"))
    const binaryInBin = join(pkgDir, "bin", process.platform === "win32" ? "claude.exe" : "claude")
    const binPath = join(pkgDir, "bin", "claude.exe")
    if (existsSync(binPath)) return binPath
    if (existsSync(binaryInBin)) return binaryInBin
  } catch { /* fallthrough */ }

  // 2. node_modules/.bin/claude（npm link 或全局安装）
  const dotBin = join(resolve("."), "node_modules", ".bin", "claude")
  if (existsSync(dotBin)) return dotBin

  // 3. 直接使用 PATH 中的 claude
  return "claude"
}

let _ccBinaryPath: string | null = null

/** 获取 claude CLI 二进制路径（惰性缓存） */
export function getCcBinaryPath(): string {
  if (_ccBinaryPath === null) _ccBinaryPath = resolveCcBinaryPath()
  return _ccBinaryPath
}

// ── Session 辅助 ──────────────────────────────────────────────────────────────

/** 从 sessionKey 提取 chatId 部分（"::" 前） */
export function extractChatId(sessionKey: string): string {
  const idx = sessionKey.indexOf("::")
  return idx > 0 ? sessionKey.slice(0, idx) : sessionKey
}

/** 获取 session 对应的通道类型（用于飞书表达抑制） */
export function resolveSessionChannelType(sessionKey: string): string | undefined {
  const chatId = extractChatId(sessionKey)
  const { channelId } = parseChatKey(chatId)
  const channel = channelId ? getChannel(channelId) : resolveChannelForSession(sessionKey)
  return channel?.type
}

/** 判断 session 是否满足 f41 流式条件（主用户私聊 / 飞书群聊 allowOthers） */
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

/** 读取环境变量判断是否启用 resident 模式（进程结束后保留 session 以复用 ccSessionId） */
export function ccResidentModeEnabled(): boolean {
  const v = (process.env.CC_RESIDENT_AGENT ?? process.env.SDK_RESIDENT_AGENT ?? "").trim().toLowerCase()
  return v !== "0" && v !== "false"
}

// ── Session 状态管理 ──────────────────────────────────────────────────────────

/** 重置单次 run 的 presentation 状态（不清除 ccSessionId，保留 resident 上下文） */
export function resetCcRunPresentationState(session: CcSessionAgent): void {
  session.errorNotified = false
  session.lastStatus = undefined
  session.lastTool = undefined
  session.runStartedAt = undefined
  session.streamBuffer = ""
  session.outboundMessageId = undefined
  session.toolPresentationOutboundIds = undefined
  session.streamId = undefined
  session.streamLastPostAt = undefined
  session.logAgg = { kind: null, buf: "" }
  session.seenProcessEvent = false
  session.thinkingOpen = false
  session.contextUsage = { ...ZERO_CONTEXT_USAGE }
  session.contextUsageFromRunTotal = undefined
  session.contextUsageFinalized = false
  session.compressionNotified = false
  session.runFinalizing = false
  session.failureArchiveDone = false
  session.watchdogState = "running"
  session.watchdogStateAt = Date.now()
  session.abortController = new AbortController()
}

/** 切换 watchdog 状态并写入 UI 日志 */
export function setWatchdogState(
  session: CcSessionAgent,
  next: "running" | "draining" | "cancelling",
  reason: string,
): void {
  if (session.watchdogState === next) return
  session.watchdogState = next
  session.watchdogStateAt = Date.now()
  pushUiLog("CC", "INFO", `[${session.sessionKey}] watchdog 状态切换 -> ${next} (${reason})`)
}

/** 更新 session 最后活跃时间，watchdog 非 running 时自动恢复 */
export function markSessionActivity(session: CcSessionAgent, source: string): void {
  session.lastActivityAt = Date.now()
  if (session.watchdogState !== "running") {
    setWatchdogState(session, "running", `activity_resume:${source}`)
  }
}
