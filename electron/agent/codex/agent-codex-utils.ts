/**
 * Codex SDK 会话辅助工具
 * CLI 路径解析、凭证/路径脱敏、session 辅助与 Presentation 时序。
 */
import { resolve, join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { pushUiLog } from "../../app/ui-logger"
import { ZERO_CONTEXT_USAGE, resolveDisplayContextTokens } from "../cursor-sdk/context-usage"
import type { CodexSessionAgent } from "./agent-codex-types"
import {
  f41Eligible,
  resolveSessionChannelType,
  presentationOrderingEnvEnabled,
} from "../claude-code/agent-cc-utils"

export { f41Eligible, resolveSessionChannelType }
export { maskCodexApiKey } from "./codex-failure-messages"

/** 失败归因输入：timeout 标志 + 上下文水位 */
export function buildCodexFailCtx(s: CodexSessionAgent, e: unknown) {
  return {
    ...(typeof e === "object" && e != null ? e as object : { message: String(e) }),
    isTimeoutFailure: s.watchdogTimedOut === true,
    contextUsed: resolveDisplayContextTokens(s.contextUsage, s.contextUsagePeakTokens),
    contextLimit: s.contextLimitTokens ?? null,
  }
}

const CODEX_NPM_NAME = "@openai/codex"

/** 平台 optional 包映射（与 @openai/codex-sdk 内部一致） */
const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
}

let _codexCliPath: string | null | undefined

/** asar 解包路径（spawn 需要真实文件） */
function resolveAsarUnpackedPath(p: string): string {
  if (p.includes("app.asar") && !p.includes("app.asar.unpacked")) {
    return p.replace("app.asar", "app.asar.unpacked")
  }
  return p
}

/** 解析当前平台 target triple */
function resolveTargetTriple(): string | null {
  const { platform, arch } = process
  if (platform === "linux" || platform === "android") {
    if (arch === "x64") return "x86_64-unknown-linux-musl"
    if (arch === "arm64") return "aarch64-unknown-linux-musl"
  }
  if (platform === "darwin") {
    if (arch === "x64") return "x86_64-apple-darwin"
    if (arch === "arm64") return "aarch64-apple-darwin"
  }
  if (platform === "win32") {
    if (arch === "x64") return "x86_64-pc-windows-msvc"
    if (arch === "arm64") return "aarch64-pc-windows-msvc"
  }
  return null
}

/** 解析 Codex CLI 原生二进制路径；失败返回 null */
export function resolveCodexCliPath(): string | null {
  if (_codexCliPath !== undefined) return _codexCliPath

  const targetTriple = resolveTargetTriple()
  if (!targetTriple) {
    _codexCliPath = null
    return null
  }
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple]
  if (!platformPackage) {
    _codexCliPath = null
    return null
  }

  const codexBinaryName = process.platform === "win32" ? "codex.exe" : "codex"
  const candidates: string[] = []

  try {
    const req = createRequire(import.meta.url)
    const codexPkgJson = req.resolve(`${CODEX_NPM_NAME}/package.json`)
    const codexReq = createRequire(codexPkgJson)
    const platPkgJson = codexReq.resolve(`${platformPackage}/package.json`)
    candidates.push(join(dirname(platPkgJson), "vendor", targetTriple, "bin", codexBinaryName))
  } catch { /* optional 包未安装 */ }

  const appDir = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  for (const base of [appDir, resolve(".")]) {
    candidates.push(join(base, "node_modules", platformPackage, "vendor", targetTriple, "bin", codexBinaryName))
  }

  for (const p of candidates) {
    const real = resolveAsarUnpackedPath(p)
    if (existsSync(real)) {
      _codexCliPath = real
      return real
    }
  }

  pushUiLog("Codex", "WARN", `未找到 Codex CLI 二进制 (searched: ${candidates.join(", ")})`)
  _codexCliPath = null
  return null
}

/** spawn 前 CLI 可用性检测；缺失返回用户可见文案 */
export function checkCodexCliAvailable(): { ok: true; path: string } | { ok: false; error: string } {
  const p = resolveCodexCliPath()
  if (!p || !existsSync(p)) {
    return { ok: false, error: "未检测到 Codex CLI，请先安装" }
  }
  return { ok: true, path: p }
}

/** 日志用端口脱敏 */
export function maskCodexPort(port: number | string | undefined): string {
  if (port == null || port === "") return "(unknown)"
  return String(port)
}

/** 日志用路径脱敏：保留末段目录名 */
export function maskCodexPath(filePath: string | undefined): string {
  if (!filePath?.trim()) return "(empty)"
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean)
  if (parts.length <= 2) return parts.join("/")
  return `.../${parts.slice(-2).join("/")}`
}

/** resident 模式：Run 结束后保留 Map 条目以复用 codexSessionId */
export function codexResidentModeEnabled(): boolean {
  const v = (process.env.CODEX_RESIDENT_AGENT ?? process.env.SDK_RESIDENT_AGENT ?? "").trim().toLowerCase()
  return v !== "0" && v !== "false"
}

/** Presentation 时序：开关开启且 f41 流式（主用户私聊或飞书群聊） */
export function presentationOrderingEligible(session: CodexSessionAgent): boolean {
  return presentationOrderingEnvEnabled() && session.f41Stream
}

/** 重置单次 run 的 presentation 状态（保留 codexSessionId / activeThread） */
export function resetCodexRunPresentationState(session: CodexSessionAgent): void {
  session.errorNotified = false
  session.lastStatus = undefined
  session.lastTool = undefined
  session.runStartedAt = undefined
  session.streamBuffer = ""
  session.outboundMessageId = undefined
  session.toolPresentationOutboundIds = undefined
  session.streamId = undefined
  session.streamLastPostAt = undefined
  // 对称 resetCodexStreamState：清 timer/链，避免本文件 import stream 循环依赖
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
  session.contextUsageFinalized = false
  session.compressionNotified = false
  session.runFinalizing = false
  session.failureArchiveDone = false
  session.watchdogState = "running"
  session.watchdogStateAt = Date.now()
  session.itemToolNames = undefined
  session.abortController = new AbortController()
}

/** 切换 watchdog 状态 */
export function setCodexWatchdogState(
  session: CodexSessionAgent,
  next: "running" | "draining" | "cancelling",
  reason: string,
): void {
  if (session.watchdogState === next) return
  session.watchdogState = next
  session.watchdogStateAt = Date.now()
  pushUiLog("Codex", "INFO", `[${session.sessionKey}] watchdog 状态切换 -> ${next} (${reason})`)
}

/** 更新活跃时间；watchdog 非 running 时恢复 */
export function markCodexSessionActivity(session: CodexSessionAgent, source: string): void {
  session.lastActivityAt = Date.now()
  if (session.watchdogState !== "running") {
    setCodexWatchdogState(session, "running", `activity_resume:${source}`)
  }
}
