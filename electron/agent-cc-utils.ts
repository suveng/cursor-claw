/**
 * Claude Agent SDK 会话辅助工具
 * 二进制路径解析、session 辅助、Presentation 时序编排（对称 agent-sdk）。
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

/** 平台 optional 包内 Claude Code 可执行文件名 */
const CC_BINARY_NAME = process.platform === "win32" ? "claude.exe" : "claude"
const CC_PLATFORM_PKG = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`

let _ccAgentBinaryPath: string | null = null

/** 将 asar 虚拟路径替换为解包目录（spawn 需要真实文件） */
function resolveAsarUnpackedPath(p: string): string {
  if (p.includes("app.asar") && !p.includes("app.asar.unpacked")) {
    return p.replace("app.asar", "app.asar.unpacked")
  }
  return p
}

/** 解析 Claude Agent SDK 平台二进制路径；dev/打包均适用 */
export function resolveCcAgentBinaryPath(): string {
  if (_ccAgentBinaryPath) return _ccAgentBinaryPath

  const candidates: string[] = []
  try {
    const req = createRequire(import.meta.url)
    const pkgDir = dirname(req.resolve(`${CC_PLATFORM_PKG}/package.json`))
    candidates.push(join(pkgDir, CC_BINARY_NAME))
  } catch { /* optional 包未安装 */ }

  const appDir = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  for (const base of [appDir, resolve(".")]) {
    candidates.push(join(base, "node_modules", CC_PLATFORM_PKG, CC_BINARY_NAME))
    candidates.push(join(base, "resources", "node_modules", CC_PLATFORM_PKG, CC_BINARY_NAME))
  }

  for (const p of candidates) {
    const real = resolveAsarUnpackedPath(p)
    if (existsSync(real)) {
      _ccAgentBinaryPath = real
      return real
    }
  }

  pushUiLog("CC", "WARN", `未找到 Claude Agent 二进制 (searched: ${candidates.join(", ")})`)
  _ccAgentBinaryPath = CC_BINARY_NAME
  return CC_BINARY_NAME
}

/** 每次 query 前调用，确保二进制路径已解析并写入日志 */
export function ensureCcAgentBinaryPaths(): void {
  const p = resolveCcAgentBinaryPath()
  if (p !== CC_BINARY_NAME) pushUiLog("CC", "INFO", `Claude Agent 二进制: ${p}`)
}

/** 从 sessionKey 提取 chatId */
export function extractChatId(sessionKey: string): string {
  const idx = sessionKey.indexOf("::")
  return idx > 0 ? sessionKey.slice(0, idx) : sessionKey
}

/** 获取 session 对应通道类型（飞书表达抑制） */
export function resolveSessionChannelType(sessionKey: string): string | undefined {
  const chatId = extractChatId(sessionKey)
  const { channelId } = parseChatKey(chatId)
  const channel = channelId ? getChannel(channelId) : resolveChannelForSession(sessionKey)
  return channel?.type
}

/** f41 流式条件：主用户私聊 / 飞书群聊 allowOthers */
export function f41Eligible(sessionKey: string, chatType: ChatType): boolean {
  const chatId = extractChatId(sessionKey)
  const { channelId, chatId: raw } = parseChatKey(chatId)
  const channel = channelId ? getChannel(channelId) : undefined
  if (chatType === "p2p") {
    if (!channel?.mainUserEnabled || !channel.mainUserChatId?.trim()) return false
    return raw === channel.mainUserChatId.trim()
  }
  if (chatType === "group") return channel?.type === "feishu" && !!channel.allowOthers
  return false
}

/** resident 模式：Run 结束后保留 Map 条目以复用 ccSessionId */
export function ccResidentModeEnabled(): boolean {
  const v = (process.env.CC_RESIDENT_AGENT ?? process.env.SDK_RESIDENT_AGENT ?? "").trim().toLowerCase()
  return v !== "0" && v !== "false"
}

/** PRESENTATION_ORDERING 环境开关 */
export function presentationOrderingEnvEnabled(): boolean {
  const v = (process.env.PRESENTATION_ORDERING ?? "").trim().toLowerCase()
  return v !== "0" && v !== "false"
}

/** Presentation 时序：开关开启且主用户私聊 f41 流式 */
export function presentationOrderingEligible(session: CcSessionAgent): boolean {
  return presentationOrderingEnvEnabled() && session.f41Stream && session.chatType === "p2p"
}

/** 是否应延迟 assistant stream-text 首包 */
export function shouldDeferCcAssistantPost(session: CcSessionAgent): boolean {
  if (!presentationOrderingEligible(session)) return false
  if (session.outboundMessageId) return false
  return !!(session.presentationDeferStream || session.seenProcessEvent)
}

/** 重置单次 run 的 presentation 状态（保留 ccSessionId） */
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
  session.presentationDeferStream = false
  session.thinkingOpen = false
  session.ccTextFromPartialStream = false
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

/** 切换 watchdog 状态 */
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

/** 更新活跃时间；watchdog 非 running 时恢复 */
export function markSessionActivity(session: CcSessionAgent, source: string): void {
  session.lastActivityAt = Date.now()
  if (session.watchdogState !== "running") {
    setWatchdogState(session, "running", `activity_resume:${source}`)
  }
}
