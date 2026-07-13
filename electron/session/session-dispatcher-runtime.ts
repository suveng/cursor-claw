/**
 * 会话调度 — 四引擎运行态查询与停止；当前会话原地重启
 */
import {
  stopSdkSession, stopAllSdkSessions,
  isSdkSessionRunning, getSdkSessionList, hasSdkSession,
} from "../agent/cursor-sdk/agent-sdk"
import { restartSdkSessionInPlace } from "../agent/cursor-sdk/sdk-resident-refresh"
import {
  isClaudeCodeSessionRunning, stopClaudeCodeSession, stopAllClaudeCodeSessions,
  getClaudeCodeSessionList, getCcSession,
} from "../agent/claude-code/agent-claude-sdk"
import {
  isCodexSessionRunning, stopCodexSession, stopAllCodexSessions,
  getCodexSessionList, getCodexSession,
} from "../agent/codex/agent-codex-sdk"
import {
  isOpencodeSessionRunning, stopOpencodeSession, stopAllOpencodeSessions,
  getOpencodeSessionList,
} from "../agent/opencode/agent-opencode-sdk"
import { chatNameCache } from "./session-dispatcher-shared"

/** 任意引擎下 sessionKey 是否仍在运行 */
export function isSessionAgentRunning(key: string): boolean {
  return isSdkSessionRunning(key) || isClaudeCodeSessionRunning(key) || isCodexSessionRunning(key) || isOpencodeSessionRunning(key)
}

/** 停止指定 sessionKey 对应引擎会话 */
export function stopSessionAgent(key: string): void {
  if (isSdkSessionRunning(key)) stopSdkSession(key)
  else if (isClaudeCodeSessionRunning(key)) stopClaudeCodeSession(key)
  else if (isCodexSessionRunning(key)) stopCodexSession(key)
  else if (isOpencodeSessionRunning(key)) stopOpencodeSession(key)
}

/** 停止全部四引擎活跃会话 */
export function stopAllSessionAgents(): void {
  stopAllSdkSessions()
  stopAllClaudeCodeSessions()
  stopAllCodexSessions()
  stopAllOpencodeSessions()
}

/** /restart 当前会话结果（仅本 session，禁止 stopAll） */
export type RestartCurrentSessionResult =
  | { kind: "sdk-ok" }
  | { kind: "sdk-fail" }
  | { kind: "removed" }
  | { kind: "none" }

/**
 * 仅重建/移除当前会话 Agent：SDK 原地 recreate；其它引擎停并移除（冷启）。
 * 禁止 stopAll / 清全局队列 / restartDaemon。
 */
export async function restartCurrentSessionAgent(sessionKey: string): Promise<RestartCurrentSessionResult> {
  // idle 长驻须用 hasSdkSession（isSdkSessionRunning 对 idle 为 false）
  if (hasSdkSession(sessionKey)) {
    const ok = await restartSdkSessionInPlace(sessionKey, "slash-restart")
    return ok ? { kind: "sdk-ok" } : { kind: "sdk-fail" }
  }
  if (getCcSession(sessionKey)) {
    stopClaudeCodeSession(sessionKey)
    return { kind: "removed" }
  }
  if (getCodexSession(sessionKey)) {
    stopCodexSession(sessionKey)
    return { kind: "removed" }
  }
  // OpenCode：列表命中则停并移除
  if (getOpencodeSessionList().some((s) => s.sessionKey === sessionKey)) {
    stopOpencodeSession(sessionKey)
    return { kind: "removed" }
  }
  return { kind: "none" }
}

/** 聚合四引擎会话列表（补全 chatName 展示字段） */
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
