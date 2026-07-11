import * as path from "node:path"
import * as fs from "node:fs"
import { app } from "electron"
import {
  getConfig, getChannel, getAgentResource, isCodexResourceId, isOpencodeResourceId, resolveChannelForSession,
  resolveChannelModel, effectiveWorkspaceDir, mainChatScopeKey,
  type MessageChannel, type ModelScenario,
} from "../config/config-store"
import { parseChatKey } from "../../src/shared/channel-types"
import { broadcastLog, pushUiLog } from "../app/ui-logger"
import { readLockFile, httpGet, httpPost, syncActiveSession, getCurrentActiveSession, drainSessionMessages, reportSessionAgentPhase, getSessionFallback, clearSessionFallback, setSessionFallback } from "../daemon/daemon-client"
import { reportCommandResult } from "../scheduling/command-handler"
import {
  setChatNameResolver,
  setPromptObservabilityLogger,
  type ChatType, type LaunchMeta,
} from "../agent/shared/agent-launcher"
import {
  stopSdkSession, stopAllSdkSessions,
  isSdkSessionRunning, getSdkSessionList,
} from "../agent/cursor-sdk/agent-sdk"
import {
  isClaudeCodeSessionRunning, stopClaudeCodeSession, stopAllClaudeCodeSessions,
  getClaudeCodeSessionList,
} from "../agent/claude-code/agent-claude-sdk"
import { isCodexSessionRunning, stopCodexSession, stopAllCodexSessions, getCodexSessionList } from "../agent/codex/agent-codex-sdk"
import {
  isOpencodeSessionRunning, stopOpencodeSession, stopAllOpencodeSessions, getOpencodeSessionList,
} from "../agent/opencode/agent-opencode-sdk"
import { launchSdkAgentFromHttp } from "../agent/cursor-sdk/agent-sdk-http"

// ── readLockFile 短 TTL 缓存 ─────────────────────────────
let _lockCache: { value: ReturnType<typeof readLockFile>; ts: number } | null = null
function cachedLock() {
  const now = Date.now()
  if (_lockCache && now - _lockCache.ts < 2000) return _lockCache.value
  const v = readLockFile()
  _lockCache = { value: v, ts: now }
  return v
}

// ── 生命周期通知 ──────────────────────────────────────────

const CHAT_NEW_USAGE =
  "💡 用法：/chat new <任务描述> [-dir <工作目录路径>]\n" +
  "例如：/chat new 帮我检查一下服务器状态\n" +
  "例如：/chat new -dir /path/to/project 帮我检查一下服务器状态"

async function notifyChat(sessionKey: string, text: string, stopProgress = false): Promise<void> {
  const lock = cachedLock()
  if (!lock?.port) return
  const chatId = extractChatId(sessionKey)
  try {
    await httpPost(`http://127.0.0.1:${lock.port}/api/send-text`, {
      text, session_key: sessionKey, ...(stopProgress && { stop_progress: true }),
    }, 5000)
  } catch (e: unknown) {
    broadcastLog(`[Notify] 发送通知失败 (${chatId}): ${e instanceof Error ? e.message : String(e)}`, "WARN")
  }
}

// ── SDK-only 运行时 ───────────────────────────────────────

export function isSessionAgentRunning(key: string): boolean {
  return isSdkSessionRunning(key) || isClaudeCodeSessionRunning(key) || isCodexSessionRunning(key) || isOpencodeSessionRunning(key)
}

export function stopSessionAgent(key: string): void {
  if (isSdkSessionRunning(key)) stopSdkSession(key)
  else if (isClaudeCodeSessionRunning(key)) stopClaudeCodeSession(key)
  else if (isCodexSessionRunning(key)) stopCodexSession(key)
  else if (isOpencodeSessionRunning(key)) stopOpencodeSession(key)
}

export function stopAllSessionAgents(): void {
  stopAllSdkSessions()
  stopAllClaudeCodeSessions()
  stopAllCodexSessions()
  stopAllOpencodeSessions()
}

// ── Session 状态 ──────────────────────────────────────────

export const chatNameCache = new Map<string, string>()

// ── Session 工具 ──────────────────────────────────────────

/** chatId 为 chatKey（`channelId|rawChatId`）；按所属通道的主用户绑定判断 */
export function isMainUser(chatId?: string, chatType?: string): boolean {
  if (chatType !== "p2p" || !chatId) return false
  const { channelId, chatId: raw } = parseChatKey(chatId)
  const channel = getChannel(channelId)
  if (!channel?.mainUserEnabled || !channel.mainUserChatId?.trim()) return false
  return raw === channel.mainUserChatId.trim()
}

export function extractChatId(sessionKey: string): string {
  const idx = sessionKey.indexOf("::")
  return idx > 0 ? sessionKey.slice(0, idx) : sessionKey
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  return `${Math.floor(m / 60)}h${m % 60}m`
}

// ── Session 生命周期 ──────────────────────────────────────

export async function handleSessionClosed(sessionKey: string, chatType: ChatType): Promise<void> {
  await reportSessionAgentPhase(sessionKey, "idle")
  const chatId = extractChatId(sessionKey)
  const mainChat = isMainUser(chatId, chatType)

  if (mainChat) {
    await notifyChat(sessionKey, "Agent已退出", true)
  }

  const lock = cachedLock()
  if (!lock) return

  const previous = await getSessionFallback(lock.port, sessionKey)
  await clearSessionFallback(lock.port, sessionKey)
  if (!previous) return

  const currentActive = await getCurrentActiveSession(lock.port, chatId)
  if (currentActive !== sessionKey) return

  const fallbackKey = isSessionAgentRunning(previous) ? previous : undefined
  if (fallbackKey) {
    await syncActiveSession(lock.port, chatId, fallbackKey)
    broadcastLog(`[System] 临时会话已结束，活跃会话自动回退至: ${fallbackKey}`, "INFO")
  }
}

// ── 名称解析 ──────────────────────────────────────────────

/** 拉名失败 WARN 节流（同进程，避免 status poll 刷屏） */
let lastFetchNameWarnAt = 0
const FETCH_NAME_WARN_INTERVAL_MS = 30_000

/** 拉名 catch 至少 WARN；节流后仍可丢弃重复日志，但不可全静默 */
function warnFetchNameFailed(kind: "chat-names" | "user-names", e: unknown): void {
  const now = Date.now()
  if (now - lastFetchNameWarnAt < FETCH_NAME_WARN_INTERVAL_MS) return
  lastFetchNameWarnAt = now
  broadcastLog(
    `[ChatName] ${kind} 失败: ${e instanceof Error ? e.message : String(e)}`,
    "WARN",
  )
}

export async function fetchChatNames(chatIds: string[]): Promise<void> {
  const missing = chatIds.filter((id) => id && !chatNameCache.has(id))
  if (missing.length === 0) return
  const lock = cachedLock()
  if (!lock?.port) return
  try {
    const res = (await httpPost(`http://127.0.0.1:${lock.port}/api/chat-names`, { chatIds: missing }, 15_000)) as { names?: Record<string, string> }
    if (res?.names) {
      for (const [id, name] of Object.entries(res.names)) chatNameCache.set(id, name)
    }
  } catch (e: unknown) {
    warnFetchNameFailed("chat-names", e)
  }
}

export async function fetchUserNames(openIds: string[]): Promise<void> {
  const missing = openIds.filter((id) => id && !chatNameCache.has(id))
  if (missing.length === 0) return
  const lock = cachedLock()
  if (!lock?.port) return
  try {
    const res = (await httpPost(`http://127.0.0.1:${lock.port}/api/user-names`, { openIds: missing }, 15_000)) as { names?: Record<string, string> }
    if (res?.names) {
      for (const [id, name] of Object.entries(res.names)) chatNameCache.set(id, name)
    }
  } catch (e: unknown) {
    warnFetchNameFailed("user-names", e)
  }
}

// ── 消息队列 ──────────────────────────────────────────────

interface DequeuedMessage { text: string; messageId: string; sessionKey?: string; meta?: { chatType?: string; senderOpenId?: string } }
interface MergedMessages { text: string; count: number; chatType?: string; messageIds: string[]; chatId?: string; senderOpenId?: string }

export async function pullMergedMessagesFromQueue(chatId?: string): Promise<MergedMessages | null> {
  const lock = cachedLock()
  if (!lock?.port) return null
  try {
    const body = chatId ? { chatId } : {}
    const res = (await httpPost(`http://127.0.0.1:${lock.port}/dequeue-all`, body, 10_000)) as {
      messages?: (DequeuedMessage | string)[]
    } | null
    const msgs = res?.messages ?? []
    if (msgs.length === 0) return null

    const parsed: DequeuedMessage[] = msgs
      .map((m) => (typeof m === "string" ? { text: m, messageId: "" } : m))
      .filter((m) => m.text?.trim())

    if (parsed.length === 0) return null

    const chatType = parsed[0].meta?.chatType || undefined
    const messageIds = parsed.map((m) => m.messageId).filter(Boolean)

    const text = parsed.length === 1
      ? parsed[0].text.trim()
      : parsed.map((m, i) => `【消息 ${i + 1}】\n${m.text.trim()}`).join("\n\n")

    return { text, count: parsed.length, chatType, messageIds, chatId, senderOpenId: parsed[0].meta?.senderOpenId || undefined }
  } catch {
    return null
  }
}

export async function clearMessageQueue(): Promise<number> {
  const lock = cachedLock()
  if (!lock?.port) return 0
  try {
    const res = await httpPost(`http://127.0.0.1:${lock.port}/clear-queue`, {}) as { cleared?: number }
    return res?.cleared ?? 0
  } catch { return 0 }
}

export interface QueueMessageItem {
  index: number
  fileId: string
  preview: string
  sessionKey?: string
  chatType?: string
  timestamp?: number
  senderOpenId?: string
}

export async function getQueueMessages(): Promise<QueueMessageItem[]> {
  const lock = cachedLock()
  if (!lock?.port) return []
  try {
    const res = await httpGet(`http://127.0.0.1:${lock.port}/queue`) as { messages?: QueueMessageItem[] }
    return res.messages ?? []
  } catch {
    return []
  }
}

export async function deleteQueueMessage(fileId: string): Promise<boolean> {
  const lock = cachedLock()
  if (!lock?.port) return false
  try {
    const res = await httpPost(`http://127.0.0.1:${lock.port}/queue-delete`, { fileId }, 5000) as { ok?: boolean }
    return res?.ok ?? false
  } catch {
    return false
  }
}

// ── Agent 启动（Daemon SSOT）──────────────────────────────

interface LaunchAgentParams {
  sessionKey: string
  chatType: ChatType
  meta?: LaunchMeta
  useMainWorkspace?: boolean
  senderOpenId?: string
  chatName?: string
  taskMessage?: string
  channelId?: string
  modelOverride?: string
  modelParamsOverride?: string
  workingDirectory?: string
}

async function launchAgent(p: LaunchAgentParams): Promise<{ ok: boolean; error?: string }> {
  const { sessionKey, chatType, senderOpenId, chatName, taskMessage } = p
  const useMain = p.useMainWorkspace ?? (chatType === "p2p")

  const channel: MessageChannel | undefined = getChannel(p.channelId) ?? resolveChannelForSession(sessionKey)
  const boundId = channel?.agentResourceId
  const resource = getAgentResource(boundId)
  if (!resource) {
    if (boundId && isCodexResourceId(boundId)) {
      return { ok: false, error: "通道绑定的 Codex Profile 已删除，请在设置中重新选择" }
    }
    if (boundId && isOpencodeResourceId(boundId)) {
      return { ok: false, error: "通道绑定的 OpenCode Profile 已删除，请在设置中重新选择" }
    }
    return { ok: false, error: "请配置 SDK 资源（设置 → Agent）" }
  }
  if (resource.type !== "sdk" && resource.type !== "claude-code" && resource.type !== "codex" && resource.type !== "opencode") {
    return { ok: false, error: "请配置 SDK 资源（设置 → Agent）" }
  }
  if (!resource.apiKey?.trim()) {
    return { ok: false, error: "通道绑定的资源未配置 API Key（设置 → Agent）" }
  }
  if (resource.type === "opencode" && !resource.providerId?.trim()) {
    return { ok: false, error: "通道绑定的 OpenCode Profile 未配置 Provider ID（设置 → Agent）" }
  }

  const isOwnTask = chatType === "task" || chatType === "temp" || chatType === "workflow"
  if (!useMain && !isOwnTask && !channel?.allowOthers) {
    return { ok: false, error: `通道「${channel?.name ?? "未知"}」未启用其他人使用` }
  }

  let workDir: string
  if (p.workingDirectory) {
    workDir = p.workingDirectory
    if (chatType !== "temp" && !fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true })
  } else if (useMain || isOwnTask) {
    workDir = effectiveWorkspaceDir(channel)
  } else {
    const resolved = resolveOthersWorkspaceDir(channel, sessionKey)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    workDir = resolved.workDir
  }
  if (!workDir) return { ok: false, error: "工作目录未配置" }

  let model: string
  let modelParams: string
  if (p.modelOverride?.trim()) {
    model = p.modelOverride.trim()
    modelParams = p.modelParamsOverride ?? ""
  } else if (resource.type === "codex") {
    // Codex：以 Profile model 为准
    if (resource.model?.trim()) {
      model = resource.model.trim()
      modelParams = ""
    } else {
      const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
      const resolved = resolveChannelModel(channel, scenario)
      model = resolved.model || "gpt-5"
      modelParams = resolved.modelParams
    }
  } else if (resource.type === "opencode") {
    model = resource.model?.trim() || ""
    modelParams = ""
  } else {
    const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
    const resolved = resolveChannelModel(channel, scenario)
    model = resolved.model
    modelParams = resolved.modelParams
  }

  const launchBody = {
    session_key: sessionKey,
    task_text: taskMessage,
    chat_type: chatType,
    chat_id: extractChatId(sessionKey),
    sender_open_id: senderOpenId,
    use_main_workspace: useMain,
    channel_id: p.channelId ?? channel?.id,
    model,
    model_params: modelParams,
    working_directory: workDir,
    chat_name: chatName,
    ...(p.meta?.messageIds?.length && { message_ids: p.meta.messageIds }),
  }

  // 统一经 agent-sdk-http 网关（resolveBoundAgentResourceType 路由四引擎），避免 Daemon 三角跳转或直 POST 各引擎独立端口
  return launchSdkAgentFromHttp(launchBody)
}

export async function launchSessionAgent(
  sessionKey: string, chatType: ChatType,
  meta?: LaunchMeta,
  useMainWorkspace?: boolean, senderOpenId?: string,
): Promise<{ ok: boolean; error?: string }> {
  return launchAgent({ sessionKey, chatType, meta, useMainWorkspace, senderOpenId })
}

export async function launchIndependentAgent(
  taskId: string, taskName: string, message: string, type: ChatType = "task",
  chatId?: string, channelId?: string, model?: string, modelParams?: string,
  workingDirectory?: string,
): Promise<{ ok: boolean; error?: string }> {
  return launchAgent({
    sessionKey: taskId, chatType: type, chatName: taskName, taskMessage: message,
    meta: { chatId: chatId ?? taskName, chatType: type },
    channelId, modelOverride: model, modelParamsOverride: modelParams,
    workingDirectory,
  })
}

export async function launchWorkflowAgent(p: {
  instanceId: string; nodeId: string; nodeName: string
  prompt: string; workingDirectory: string
  notifyChatId?: string; model?: string
}): Promise<{ ok: boolean; error?: string }> {
  const sessionKey = `${p.notifyChatId || "wf"}::wf_${p.instanceId}_${p.nodeId}`
  return launchAgent({
    sessionKey, chatType: "workflow",
    chatName: `WF: ${p.nodeName}`,
    taskMessage: p.prompt,
    workingDirectory: p.workingDirectory,
    meta: { chatId: p.notifyChatId || sessionKey, chatType: "workflow" },
    channelId: p.notifyChatId ? parseChatKey(extractChatId(p.notifyChatId)).channelId : undefined,
    modelOverride: p.model,
  })
}

export async function notifyWorkflowChat(chatId: string, text: string): Promise<void> {
  const lock = cachedLock()
  if (!lock?.port) return
  try {
    await httpPost(`http://127.0.0.1:${lock.port}/api/send-text`, { text, session_key: chatId }, 5000)
  } catch (e: unknown) {
    broadcastLog(`[WF Notify] 发送通知失败: ${e instanceof Error ? e.message : String(e)}`, "WARN")
  }
}

// ── Session 列表 ──────────────────────────────────────────

export function getSessionAgentList() {
  const sdkList = getSdkSessionList().map((s) => {
    const chatId = s.sessionKey.includes("::") ? s.sessionKey.split("::")[0] : s.sessionKey
    const chatName = s.chatName || chatNameCache.get(chatId) || (s.senderOpenId ? chatNameCache.get(s.senderOpenId) : undefined)
    return { ...s, chatName, pid: 0, engineType: "sdk" as const }
  })
  const ccList = getClaudeCodeSessionList().map((s) => {
    const chatId = s.sessionKey.includes("::") ? s.sessionKey.split("::")[0] : s.sessionKey
    const chatName = s.chatName || chatNameCache.get(chatId)
    return { ...s, chatName, engineType: "claude-code" as const }
  })
  const codexList = getCodexSessionList().map((s) => {
    const chatId = s.sessionKey.includes("::") ? s.sessionKey.split("::")[0] : s.sessionKey
    const chatName = s.chatName || chatNameCache.get(chatId) || (s.senderOpenId ? chatNameCache.get(s.senderOpenId) : undefined)
    return { ...s, chatName, engineType: "codex" as const }
  })
  const opencodeList = getOpencodeSessionList().map((s) => {
    const chatId = s.sessionKey.includes("::") ? s.sessionKey.split("::")[0] : s.sessionKey
    const chatName = s.chatName || chatNameCache.get(chatId) || (s.senderOpenId ? chatNameCache.get(s.senderOpenId) : undefined)
    return { ...s, chatName, engineType: "opencode" as const }
  })
  return [...sdkList, ...ccList, ...codexList, ...opencodeList]
}

// ── /chat new 参数解析与目录校验 ────────────────────────────

const CHAT_NEW_DIR_FLAG = "-dir"

function parseChatNewArgs(tokens: string[]):
  | { ok: true; taskMsg: string; workingDirectory?: string }
  | { ok: false; error: string } {
  const dirIdx = tokens.findIndex((t) => t.toLowerCase() === CHAT_NEW_DIR_FLAG)
  if (dirIdx === -1) {
    const taskMsg = tokens.join(" ").trim()
    if (!taskMsg) return { ok: false, error: CHAT_NEW_USAGE }
    return { ok: true, taskMsg }
  }
  const before = tokens.slice(0, dirIdx)
  const after = tokens.slice(dirIdx + 1)
  if (after.length === 0) return { ok: false, error: "❌ -dir 缺少路径" }
  let taskMsg: string
  let workingDirectory: string
  if (before.length > 0) {
    taskMsg = before.join(" ").trim()
    workingDirectory = after.join(" ").trim()
  } else {
    workingDirectory = after[0].trim()
    taskMsg = after.slice(1).join(" ").trim()
  }
  if (!workingDirectory) return { ok: false, error: "❌ -dir 缺少路径" }
  if (!taskMsg) return { ok: false, error: CHAT_NEW_USAGE }
  return { ok: true, taskMsg, workingDirectory }
}

function validateWorkspacePath(dir: string):
  | { ok: true; resolved: string }
  | { ok: false; error: string } {
  const trimmed = dir.trim()
  if (!trimmed) {
    return { ok: false, error: "工作目录未配置，请先在设置中配置主工作目录" }
  }
  const resolved = path.resolve(trimmed)
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: "目录不存在，请检查路径或省略 -dir 使用当前主会话目录" }
  }
  try {
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      return { ok: false, error: "指定路径不是目录，请改为有效的文件夹路径" }
    }
    fs.accessSync(resolved, fs.constants.R_OK)
  } catch {
    return { ok: false, error: "无法访问该目录，请检查权限或改用其他路径" }
  }
  return { ok: true, resolved }
}

function resolveOthersWorkspaceDir(
  channel: MessageChannel | undefined,
  sessionKey: string,
): { ok: true; workDir: string } | { ok: false; error: string } {
  const mode = channel?.othersWorkspaceMode ?? "isolated"
  if (mode === "isolated") {
    const safeChatId = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")
    const workDir = path.join(app.getPath("userData"), "workspaces", safeChatId)
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true })
    return { ok: true, workDir }
  }
  const dir = channel?.othersWorkspaceDir?.trim() ?? ""
  if (!dir) {
    const workDir = effectiveWorkspaceDir(channel)
    if (!workDir.trim()) {
      return { ok: false, error: "工作目录未配置，请先在设置中配置主工作目录" }
    }
    return { ok: true, workDir }
  }
  const check = validateWorkspacePath(dir)
  if (!check.ok) return check
  return { ok: true, workDir: check.resolved }
}

// ── /chat 命令处理 ────────────────────────────────────────

export async function handleChatCommand(tokens: string[], port: number, messageId: string, chatId?: string): Promise<void> {
  const reply = (ok: boolean, msg: string) => reportCommandResult(port, messageId, ok, msg, chatId)
  const sub = tokens[1]?.toLowerCase()

  const sessions = getSessionAgentList().sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))

  if (!sub || sub === "ls" || sub === "list") {
    if (sessions.length === 0) { await reply(true, "📭 当前没有活跃会话"); return }
    const now = Date.now()
    const lines = sessions.map((s, i) => {
      const idx = `#${i + 1}`
      const type = s.chatType === "p2p" ? "私聊" : s.chatType === "group" ? "群聊" : s.chatType === "task" ? "定时" : s.chatType === "temp" ? "临时" : s.chatType === "workflow" ? "工作流" : s.chatType
      const name = s.chatName || "-"
      const dir = s.workspaceDir ? path.basename(s.workspaceDir) : "-"
      const started = s.startedAt ? new Date(s.startedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "-"
      const dur = s.startedAt ? formatDuration(now - s.startedAt) : "-"
      return `${idx} [${type}] ${name} | 启动:${started} | 时长:${dur} | dir:${dir}`
    })
    await reply(true, `📋 活跃会话 (${sessions.length}):\n${lines.join("\n")}`)
    return
  }

  if (sub === "new") {
    const parsed = parseChatNewArgs(tokens.slice(2))
    if (!parsed.ok) { await reply(false, parsed.error); return }

    const channel = chatId ? getChannel(parseChatKey(chatId).channelId) : undefined
    const dirToValidate = parsed.workingDirectory ?? effectiveWorkspaceDir(channel)
    const dirCheck = validateWorkspacePath(dirToValidate)
    if (!dirCheck.ok) { await reply(false, dirCheck.error); return }

    const taskId = `temp_${Date.now()}`
    const result = await launchIndependentAgent(
      taskId, "临时会话", parsed.taskMsg, "temp", chatId,
      undefined, undefined, undefined, dirCheck.resolved,
    )
    if (result.ok && chatId) {
      const currentActive = await getCurrentActiveSession(port, chatId)
      if (currentActive && currentActive !== taskId) {
        await setSessionFallback(port, taskId, currentActive)
      }
      await syncActiveSession(port, chatId, taskId)
    }
    if (result.ok) {
      const newSession = getSessionAgentList().find((s) => s.sessionKey === taskId)
      const workspaceDisplay = newSession?.workspaceDir ?? dirCheck.resolved
      const lines = [
        `🚀 新会话已创建:`,
        `  任务: ${parsed.taskMsg}`,
        `  SessionKey: ${taskId}`,
        `  类型: 临时`,
        `  工作目录: ${workspaceDisplay}`,
        `  启动时间: ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`,
        `\n🔀 已切换到此会话，临时会话结束后将自动回退`,
      ]
      await reply(true, lines.join("\n"))
    } else {
      await reply(false, `❌ 启动失败: ${result.error ?? "未知错误"}`)
    }
    return
  }

  if (sub === "stop") {
    const idx = parseInt(tokens[2], 10)
    if (isNaN(idx) || idx < 1 || idx > sessions.length) {
      await reply(false, `❌ 无效序号，范围 1-${sessions.length}`)
      return
    }
    const target = sessions[idx - 1]
    stopSessionAgent(target.sessionKey)
    await reply(true, `✅ 已停止会话 #${idx}: ${target.chatName || target.sessionKey}`)
    return
  }

  const idx = parseInt(sub, 10)
  if (!isNaN(idx)) {
    if (idx < 1 || idx > sessions.length) {
      await reply(false, `❌ 无效序号，范围 1-${sessions.length}`)
      return
    }
    const s = sessions[idx - 1]
    const now = Date.now()
    const type = s.chatType === "p2p" ? "私聊" : s.chatType === "group" ? "群聊" : s.chatType === "task" ? "定时任务" : s.chatType === "temp" ? "临时任务" : s.chatType === "workflow" ? "工作流" : s.chatType

    if (chatId) {
      await syncActiveSession(port, chatId, s.sessionKey)
    }

    const lines = [
      `🔀 已切换到会话 #${idx}:`,
      `  类型: ${type}`,
      `  名称: ${s.chatName || "-"}`,
      `  SessionKey: ${s.sessionKey}`,
      `  工作目录: ${s.workspaceDir || "-"}`,
      `  启动时间: ${s.startedAt ? new Date(s.startedAt).toLocaleString("zh-CN", { hour12: false }) : "-"}`,
      `  运行时长: ${s.startedAt ? formatDuration(now - s.startedAt) : "-"}`,
      `\n💡 后续消息将路由到此会话`,
    ]
    await reply(true, lines.join("\n"))
    return
  }

  await reply(false, "💡 /chat 用法:\n  /chat ls — 列出所有活跃会话\n  /chat <序号> — 切换到指定会话\n  /chat stop <序号> — 停止指定会话\n  /chat new <描述> [-dir <路径>] — 创建新临时会话（省略 -dir 则使用当前主会话目录）")
}

// ── 初始化 ────────────────────────────────────────────────

export function initSessionDispatcher(): void {
  setChatNameResolver((chatId) => chatNameCache.get(chatId))
  // 四引擎 buildPrompt 共用：UI 日志可观测 group_name 是否出现在最终 Prompt
  setPromptObservabilityLogger(({ sessionKey, injected, groupName, preview }) => {
    pushUiLog(
      "Prompt",
      injected ? "INFO" : "WARN",
      `[${sessionKey}] group_name=${injected ? groupName : "未注入"} | ${preview}`,
    )
  })
  // 非 SDK 引擎 HTTP server 懒加载：首次 launch 经 launchSdkAgentFromHttp 进程内委托，init 仅常驻统一网关（ensureAgentSdkHttpServer 由 daemon-manager 调用）
}
