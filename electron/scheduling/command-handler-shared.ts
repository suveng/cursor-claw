import { broadcastLog } from "../app/ui-logger"
import { httpPost } from "../daemon/daemon-client"

// ── 共享类型与工具（斜杠指令回报与模型列表解析）────────────────

export interface FileCommand { id: string; command: string; messageId: string; chatId?: string; chatType?: string }

/** HTTP 同步执行时捕获结果，跳过 POST /cmd/result（由 Daemon replyToMessage） */
let httpCommandResultSink: ((ok: boolean, message: string) => void) | undefined

/** 在 sink 作用域内执行指令，供 POST /api/command/execute 捕获子 handler 回报文案 */
export async function runWithHttpCommandResultSink<T>(
  sink: (ok: boolean, message: string) => void,
  fn: () => Promise<T>,
): Promise<T> {
  httpCommandResultSink = sink
  try {
    return await fn()
  } finally {
    httpCommandResultSink = undefined
  }
}

export async function reportCommandResult(port: number, messageId: string, ok: boolean, message: string, chatId?: string): Promise<void> {
  if (httpCommandResultSink) {
    httpCommandResultSink(ok, message)
    return
  }
  try {
    await httpPost(`http://127.0.0.1:${port}/cmd/result`, { messageId, ok, message, chatId })
  } catch (e: unknown) {
    broadcastLog(`指令结果回报失败: ${e instanceof Error ? e.message : e}`, "WARN")
  }
}

export type ListedModel = { id: string; label: string; current: boolean; params?: string }

export function parseListModelsStdout(out: string): ListedModel[] {
  const cleaned = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "")
  const models: ListedModel[] = []
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || /^available models/i.test(trimmed)) continue
    const match = trimmed.match(/^(\S+)\s+[–—-]\s+(.+?)(\s+\((?:default|current)\))?\s*$/)
    if (match) {
      models.push({ id: match[1], label: match[2].trim(), current: !!match[3] })
    }
  }
  return models
}
