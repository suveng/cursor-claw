/**
 * 斜杠指令执行器：从 poll 与 HTTP 路径复用，覆盖 help/status/list 等全部分支。
 */
import * as path from "node:path"
import { app } from "electron"
import {
  getConfig,
  getChannel,
  effectiveWorkspaceDir,
  mainChatScopeKey,
  setMainChatIdForScope,
} from "../config/config-store"
import { parseChatKey } from "../../src/shared/channel-types"
import { broadcastLog } from "../app/ui-logger"
import { getSdkSessionCount } from "../agent/cursor-sdk/agent-sdk"
import { getClaudeCodeSessionList } from "../agent/claude-code/agent-claude-sdk"
import { getCodexSessionList } from "../agent/codex/agent-codex-sdk"
import { getOpencodeSessionList } from "../agent/opencode/agent-opencode-sdk"
import { readTasksFromFile } from "./cron-scheduler"
import { buildHelpText } from "./feishu-help-text"
import {
  type FileCommand,
  handleFeishuModelCommand,
  handleFeishuMcpCommand,
  handleFeishuTaskCommand,
  handleFeishuWorkflowCommand,
  type TaskRunFn,
} from "./command-handler"
import {
  isSessionAgentRunning,
  stopSessionAgent,
  handleChatCommand,
  clearMessageQueue,
  getQueueMessages,
  isMainUser,
} from "../session/session-dispatcher"

export type { FileCommand } from "./command-handler"

/** Daemon 状态快照（避免 command-executor 反向依赖 daemon-manager） */
export interface DaemonStatusSnapshot {
  running: boolean
  version?: string
  uptime?: number
  queueLength?: number
}

/** 单次指令执行上下文：port/会话字段 + 主进程能力注入 */
export interface CommandExecutorContext {
  port: number
  messageId: string
  chatId?: string
  chatType?: string
  reply: (ok: boolean, message: string) => Promise<void>
  getDaemonStatus: () => Promise<DaemonStatusSnapshot>
  stopAgent: () => void
  restartDaemon: () => Promise<{ ok: boolean; error?: string }>
  applyWorkspaceSwitch: (workspaceDir: string, stopOldSessions: boolean) => Promise<{ ok: boolean; error?: string }>
  taskRunFn: TaskRunFn
  enqueueToMainSession: (content: string, preferredChatId?: string) => Promise<{ ok: boolean; error?: string }>
}

/** 是否有活跃 SDK、Claude Code、Codex 或 OpenCode 会话 */
function isAgentRunning(): boolean {
  return getSdkSessionCount() > 0 || getClaudeCodeSessionList().length > 0
    || getCodexSessionList().length > 0 || getOpencodeSessionList().length > 0
}

/** 状态展示用 PID：优先 CC 子进程 */
function getAgentDisplayPid(): number | null {
  return getClaudeCodeSessionList().find((s) => s.pid > 0)?.pid ?? null
}

function resolveCommandSessionKey(chatId?: string, chatType?: string): string | undefined {
  if (!chatId) return undefined
  if (chatType === "p2p" && isMainUser(chatId, chatType)) {
    const channel = getChannel(parseChatKey(chatId).channelId)
    const wsDir = effectiveWorkspaceDir(channel)
    if (wsDir) return `${chatId}::${wsDir}`
  }
  return chatId
}

function resolveResetWorkspaceDir(sessionKey?: string, chatId?: string, chatType?: string): string | undefined {
  if (!sessionKey) return undefined
  if (chatType === "p2p" && isMainUser(chatId, chatType)) {
    const channel = getChannel(parseChatKey(chatId!).channelId)
    return effectiveWorkspaceDir(channel)
  }
  return path.join(app.getPath("userData"), "workspaces", sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_"))
}

/**
 * 执行单条斜杠指令（poll / HTTP 共用）。
 * 子 handler 自行 report 时，返回值 message 可能为空。
 */
export async function executeFileCommand(
  cmd: Pick<FileCommand, "command" | "messageId" | "chatId" | "chatType">,
  ctx: CommandExecutorContext,
): Promise<{ ok: boolean; message: string }> {
  const rawCmd = cmd.command.trim()
  const cmdTokens = rawCmd.split(/\s+/).filter((t) => t.length > 0)
  const head = (cmdTokens[0] ?? "").toLowerCase()
  let result: { ok: boolean; message: string } = { ok: true, message: "" }

  const reply = async (ok: boolean, message: string) => {
    result = { ok, message }
    await ctx.reply(ok, message)
  }

  switch (head) {
    case "/stop": {
      const sessionKey = resolveCommandSessionKey(cmd.chatId, cmd.chatType) ?? cmd.chatId
      if (sessionKey && isSessionAgentRunning(sessionKey)) {
        stopSessionAgent(sessionKey)
        await reply(true, "✅ 当前会话 Agent 已停止")
      } else {
        await reply(false, "❌ 当前会话无运行中的 Agent")
      }
      break
    }

    case "/status": {
      const status = await ctx.getDaemonStatus()
      const schedTasks = readTasksFromFile()
      const schedTotal = schedTasks.length
      const schedEnabled = schedTasks.filter((t) => t.enabled).length
      const lines = [
        `🛡️ Daemon: ${status.running ? "✅ 运行中" : "❌ 未运行"}`,
        status.version ? `🔄 版本: ${status.version}` : "",
        status.uptime !== undefined ? `⌛️ 运行时间: ${Math.floor(status.uptime / 60)}分钟` : "",
        `🤖 Agent: ${isAgentRunning() ? `✅ 运行中${getAgentDisplayPid() ? ` (PID: ${getAgentDisplayPid()})` : ""}` : "❌ 未运行"}`,
        `📭 队列消息: ${status.queueLength ?? 0} 条`,
        `⏰ 定时任务: 开启 ${schedEnabled} / 共 ${schedTotal} 条`,
      ].filter(Boolean)
      await reply(true, lines.join("\n"))
      break
    }

    case "/list": {
      const msgs = await getQueueMessages()
      if (msgs.length === 0) {
        await reply(true, "📭 消息队列为空")
      } else {
        const lines = msgs.map((m) => `  [${m.index}] ${m.preview}`)
        await reply(true, `📬 队列中有 ${msgs.length} 条消息：\n${lines.join("\n")}`)
      }
      break
    }

    case "/task": {
      await handleFeishuTaskCommand(
        ctx.port, cmd.messageId, rawCmd, ctx.taskRunFn, cmd.chatId,
        async (content, preferredChatId) => ctx.enqueueToMainSession(content, preferredChatId ?? cmd.chatId),
      )
      break
    }

    case "/model": {
      await handleFeishuModelCommand(ctx.port, cmd.messageId, rawCmd, cmd.chatId)
      break
    }

    case "/mcp": {
      await handleFeishuMcpCommand(ctx.port, cmd.messageId, rawCmd, cmd.chatId)
      break
    }

    case "/workflow":
    case "/wf": {
      await handleFeishuWorkflowCommand(ctx.port, cmd.messageId, rawCmd, cmd.chatId)
      break
    }

    case "/restart": {
      ctx.stopAgent()
      const cleared = await clearMessageQueue()
      // 仅在 restartDaemon 完成后 reply 一次终态文案，避免中间态与成功/失败消息重复
      const result = await ctx.restartDaemon()
      if (result.ok) {
        await reply(true, `✅ Daemon 重启成功（已停止 Agent，已清空 ${cleared} 条队列消息）`)
      } else {
        await reply(false, `❌ Daemon 重启失败: ${result.error ?? "未知错误"}（已停止 Agent，已清空 ${cleared} 条队列消息）`)
      }
      break
    }

    case "/clean": {
      const cleared = await clearMessageQueue()
      broadcastLog(`[指令 /clean] 已清空队列 ${cleared} 条`, "INFO")
      await reply(true, `✅ 已清空消息队列，共移除 ${cleared} 条`)
      break
    }

    case "/reset": {
      const sessionKey = resolveCommandSessionKey(cmd.chatId, cmd.chatType)
      if (sessionKey && isSessionAgentRunning(sessionKey)) {
        stopSessionAgent(sessionKey)
      }
      const wsDir = resolveResetWorkspaceDir(sessionKey, cmd.chatId, cmd.chatType)
      const cmdChannelId = cmd.chatId ? parseChatKey(cmd.chatId).channelId : undefined
      if (wsDir && cmdChannelId) setMainChatIdForScope(mainChatScopeKey(cmdChannelId, wsDir), "")
      broadcastLog(`[指令 /reset] 已重置会话 ${sessionKey ?? cmd.chatId ?? "unknown"}`, "INFO")
      await reply(true, "✅ 当前会话已重置, 请重新发消息开启新会话")
      break
    }

    case "/workspace": {
      const wsArgs = cmdTokens.slice(1)
      if (wsArgs.length === 0 || wsArgs[0] === "info") {
        const cfg = getConfig()
        await reply(true, `📂 当前工作目录: ${cfg.workspaceDir || "(未配置)"}`)
      } else if (wsArgs[0] === "set" && wsArgs.length >= 2) {
        const newDir = wsArgs.slice(1).join(" ").trim()
        const cfg = getConfig()
        if (newDir === cfg.workspaceDir) {
          await reply(true, `📂 工作目录未变化: ${newDir}`)
        } else {
          await reply(true, `📂 正在切换工作目录到: ${newDir}\n⏳ 切换中...`)
          const wsResult = await ctx.applyWorkspaceSwitch(newDir, false)
          if (wsResult.ok) {
            broadcastLog(`[指令 /workspace] 已切换到 ${newDir}`, "INFO")
            await reply(true, `✅ 工作目录已切换到: ${newDir} 会话上下文已切换`)
          } else {
            broadcastLog(`[指令 /workspace] 切换失败: ${wsResult.error}`, "ERROR")
            await reply(false, `❌ 切换失败: ${wsResult.error}`)
          }
        }
      } else {
        await reply(false, "用法：/workspace 查看当前 | /workspace set <路径>")
      }
      break
    }

    case "/chat": {
      await handleChatCommand(cmdTokens, ctx.port, cmd.messageId, cmd.chatId)
      break
    }

    case "/help": {
      await reply(true, buildHelpText())
      break
    }

    default:
      await reply(false, `😅 未知指令: ${head}`)
  }

  return result
}
