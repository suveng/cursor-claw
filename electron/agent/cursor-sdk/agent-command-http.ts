/**
 * POST /api/command/execute — 同步斜杠执行，复用 executeFileCommand（不经 .fcmd）。
 */
import { readLockFile, enqueueToMainSession } from "../../daemon/daemon-client"
import { launchIndependentAgent, stopAllSessionAgents } from "../../session/session-dispatcher"
import { runWithHttpCommandResultSink } from "../../scheduling/command-handler"
import { executeFileCommand } from "../../scheduling/command-executor"
import { broadcastLog } from "../../app/ui-logger"

export interface CommandExecuteHttpResponse {
  httpStatus: number
  body: { ok: boolean; message: string }
}

/** 解析请求体必填字段 */
function parseCommandExecuteBody(body: Record<string, unknown>): {
  ok: true
  command: string
  messageId: string
  chatId?: string
  chatType?: string
} | { ok: false; httpStatus: number; message: string } {
  const command = typeof body.command === "string" ? body.command.trim() : ""
  const messageId = typeof body.messageId === "string" ? body.messageId.trim() : ""
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() || undefined : undefined
  const chatType = typeof body.chatType === "string" ? body.chatType.trim() || undefined : undefined

  if (!command) {
    return { ok: false, httpStatus: 400, message: "❌ 缺少 command 参数" }
  }
  if (!messageId) {
    return { ok: false, httpStatus: 400, message: "❌ 缺少 messageId 参数" }
  }
  return { ok: true, command, messageId, chatId, chatType }
}

/** 未知斜杠指令判定（与 executeFileCommand default 分支一致） */
function isUnknownCommandMessage(message: string): boolean {
  return message.includes("未知指令")
}

/** 处理 POST /api/command/execute */
export async function handleCommandExecuteHttp(body: Record<string, unknown>): Promise<CommandExecuteHttpResponse> {
  const parsed = parseCommandExecuteBody(body)
  if (!parsed.ok) {
    return { httpStatus: parsed.httpStatus, body: { ok: false, message: parsed.message } }
  }

  const lock = readLockFile()
  if (!lock?.port) {
    return {
      httpStatus: 503,
      body: { ok: false, message: "❌ Daemon 未运行，请先启动应用内的 Daemon 服务" },
    }
  }

  const { command, messageId, chatId, chatType } = parsed
  const port = lock.port

  // 动态 import 避免 agent-sdk-http ↔ daemon-manager 循环依赖
  const dm = await import("../../daemon/daemon-manager")

  let capturedOk = true
  let capturedMessage = ""

  const captureSink = (ok: boolean, message: string) => {
    capturedOk = ok
    capturedMessage = message
  }

  try {
    const result = await runWithHttpCommandResultSink(captureSink, () =>
      executeFileCommand(
        { command, messageId, chatId, chatType },
        {
          port,
          messageId,
          chatId,
          chatType,
          // HTTP 路径：结果写入响应体，不写 /cmd/result
          reply: async (ok, message) => {
            capturedOk = ok
            capturedMessage = message
          },
          getDaemonStatus: dm.getDaemonStatus,
          stopAgent: () => stopAllSessionAgents(),
          restartDaemon: async () => {
            await dm.stopDaemon()
            await new Promise((r) => setTimeout(r, 1500))
            const restartResult = await dm.startDaemon()
            if (!restartResult.ok) {
              broadcastLog(`[指令] Daemon 重启失败: ${restartResult.error}`, "ERROR")
            }
            return restartResult.ok ? { ok: true } : { ok: false, error: restartResult.error }
          },
          applyWorkspaceSwitch: dm.applyWorkspaceSwitch,
          taskRunFn: (task, content) =>
            launchIndependentAgent(
              task.id, task.name, content, "task", undefined, task.channelId, task.model, task.modelParams,
            ),
          enqueueToMainSession: (content, preferredChatId) =>
            enqueueToMainSession(port, content, preferredChatId ?? chatId),
        },
      ),
    )

    const finalOk = capturedMessage ? capturedOk : result.ok
    const finalMessage = capturedMessage || result.message
    const httpStatus = !finalOk && isUnknownCommandMessage(finalMessage) ? 400 : 200

    return { httpStatus, body: { ok: finalOk, message: finalMessage } }
  } catch (e: unknown) {
    const errMsg = `❌ 执行异常: ${e instanceof Error ? e.message : String(e)}`
    broadcastLog(`[HTTP 指令] ${command} 执行异常: ${errMsg}`, "ERROR")
    return { httpStatus: 200, body: { ok: false, message: errMsg } }
  }
}
