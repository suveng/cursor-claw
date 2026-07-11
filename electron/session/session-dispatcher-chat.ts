/**
 * 会话调度 — /chat 命令与工作目录校验
 */
import * as path from "node:path"
import { getChannel, effectiveWorkspaceDir } from "../config/config-store"
import { parseChatKey } from "../../src/shared/channel-types"
import { reportCommandResult } from "../scheduling/command-handler"
import { syncActiveSession, getCurrentActiveSession, setSessionFallback } from "../daemon/daemon-client"
import type { MessageChannel } from "../config/config-store"
import { formatDuration } from "./session-dispatcher-shared"
import { getSessionAgentList, stopSessionAgent } from "./session-dispatcher-runtime"
import { launchIndependentAgent } from "./session-dispatcher-launch"
import { validateLaunchWorkspacePath, resolveLaunchWorkDir } from "../agent/shared/launch-request-resolve"

const CHAT_NEW_USAGE =
  "💡 用法：/chat new <任务描述> [-dir <工作目录路径>]\n" +
  "例如：/chat new 帮我检查一下服务器状态\n" +
  "例如：/chat new -dir /path/to/project 帮我检查一下服务器状态"

const CHAT_NEW_DIR_FLAG = "-dir"

/** 解析 /chat new 子命令参数（支持 -dir） */
export function parseChatNewArgs(tokens: string[]):
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

/** 校验工作目录存在且可读（委托 launch-request-resolve SSOT） */
export function validateWorkspacePath(dir: string):
  | { ok: true; resolved: string }
  | { ok: false; error: string } {
  return validateLaunchWorkspacePath(dir)
}

/** 解析「其他人/群聊」工作目录（委托 launch-request-resolve SSOT） */
export function resolveOthersWorkspaceDir(
  channel: MessageChannel | undefined,
  sessionKey: string,
): { ok: true; workDir: string } | { ok: false; error: string } {
  return resolveLaunchWorkDir({
    sessionKey,
    chatType: "group",
    explicitDir: "",
    useMain: false,
    channel,
  })
}

/** 处理飞书 /chat 远程指令（ls/new/stop/切换） */
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
