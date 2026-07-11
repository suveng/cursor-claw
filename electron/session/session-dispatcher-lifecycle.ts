/**
 * 会话调度 — 生命周期、队列与名称解析
 * init / 关闭回退 / Daemon 队列 / chatName 拉取
 */
import { readLockFile, httpGet, httpPost, syncActiveSession, getCurrentActiveSession, reportSessionAgentPhase, getSessionFallback, clearSessionFallback } from "../daemon/daemon-client"
import { broadcastLog, pushUiLog } from "../app/ui-logger"
import {
  setChatNameResolver,
  setPromptObservabilityLogger,
  type ChatType,
} from "../agent/shared/agent-launcher"
import { isSessionAgentRunning } from "./session-dispatcher-runtime"
import { chatNameCache, extractChatId, isMainUser } from "./session-dispatcher-shared"

// ── readLockFile 短 TTL 缓存 ─────────────────────────────

let _lockCache: { value: ReturnType<typeof readLockFile>; ts: number } | null = null

/** Daemon 锁文件缓存（2s TTL，减少高频 HTTP 读盘） */
export function cachedLock() {
  const now = Date.now()
  if (_lockCache && now - _lockCache.ts < 2000) return _lockCache.value
  const v = readLockFile()
  _lockCache = { value: v, ts: now }
  return v
}

/** 经 Daemon 向会话发送文本通知 */
export async function notifyChat(sessionKey: string, text: string, stopProgress = false): Promise<void> {
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

// ── Session 生命周期 ──────────────────────────────────────

/** 会话 Agent 退出后：上报 idle、主用户通知、临时会话回退 */
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

function warnFetchNameFailed(kind: "chat-names" | "user-names", e: unknown): void {
  const now = Date.now()
  if (now - lastFetchNameWarnAt < FETCH_NAME_WARN_INTERVAL_MS) return
  lastFetchNameWarnAt = now
  broadcastLog(
    `[ChatName] ${kind} 失败: ${e instanceof Error ? e.message : String(e)}`,
    "WARN",
  )
}

/** 批量拉取群聊名称并写入 chatNameCache */
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

/** 批量拉取用户名称并写入 chatNameCache */
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

export interface MergedMessages { text: string; count: number; chatType?: string; messageIds: string[]; chatId?: string; senderOpenId?: string }

/** 从 Daemon 队列合并拉取消息 */
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

/** 清空 Daemon 消息队列 */
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

/** 读取 Daemon 队列快照 */
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

/** 按 fileId 删除队列条目 */
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

// ── 初始化 ────────────────────────────────────────────────

/** 注册 chatName 解析器与 Prompt 可观测日志；不无条件拉起非 SDK 引擎 HTTP server */
export function initSessionDispatcher(): void {
  setChatNameResolver((chatId) => chatNameCache.get(chatId))
  setPromptObservabilityLogger(({ sessionKey, injected, groupName, preview }) => {
    pushUiLog(
      "Prompt",
      injected ? "INFO" : "WARN",
      `[${sessionKey}] group_name=${injected ? groupName : "未注入"} | ${preview}`,
    )
  })
}
