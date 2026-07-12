/**
 * Codex recover 续接前终态探活（对称 OpenCode probeOpencodeRecoverTarget）
 */
import { Codex } from "@openai/codex-sdk"
import { loadCodexMcpServers } from "../../mcp/loaders/codex-mcp-loader"
import { checkCodexCliAvailable, resolveCodexCliPath } from "./agent-codex-utils"
import type { CodexActiveRunRecord } from "./codex-run-persistence"

const TERMINAL_THREAD_PATTERNS = [/not found/i, /invalid/i, /unknown/i, /不存在/, /已结束/]

/** 判断 runStreamed 首事件是否表明 thread 已不可续 */
function isTerminalThreadError(message: string): boolean {
  return TERMINAL_THREAD_PATTERNS.some((p) => p.test(message))
}

/**
 * 续接前探测 codexSessionId 对应 thread 是否仍可 resume。
 * 可续接 no-op；不可恢复 throw Error（由 recover 侧 classify + notify）。
 */
export async function probeCodexRecoverTarget(record: CodexActiveRunRecord): Promise<void> {
  if (!record.codexSessionId) return

  const cliCheck = checkCodexCliAvailable()
  if (!cliCheck.ok) throw new Error(cliCheck.error)

  const workspaceDir = record.workspaceDir || process.cwd()
  const mcpInline = loadCodexMcpServers(workspaceDir)
  const config = mcpInline && Object.keys(mcpInline).length > 0 ? { mcp_servers: mcpInline } : undefined

  const codex = new Codex({
    apiKey: record.apiKey,
    baseUrl: record.baseUrl,
    codexPathOverride: resolveCodexCliPath() ?? undefined,
    config,
  })

  const thread = codex.resumeThread(record.codexSessionId, {
    model: record.model,
    workingDirectory: workspaceDir,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
  })

  // ponytail: Codex SDK 无只读 thread 状态 API，用空 prompt 首事件探活；
  // 升级路径：若 SDK 暴露 getThread / resume 校验 API 可替换 runStreamed 探针。
  const abort = new AbortController()
  try {
    const { events } = await thread.runStreamed("", { signal: abort.signal })
    for await (const event of events) {
      if (event.type === "turn.failed") {
        const msg = event.error.message
        if (isTerminalThreadError(msg)) throw new Error("运行已结束")
        throw new Error(`Codex thread 不可用: ${msg}`)
      }
      if (event.type === "error") {
        if (isTerminalThreadError(event.message)) throw new Error("运行已结束")
        throw new Error(`Codex thread 不可用: ${event.message}`)
      }
      if (event.type === "turn.started" || event.type === "thread.started") {
        abort.abort()
        return
      }
    }
  } catch (e: unknown) {
    if (abort.signal.aborted) return
    const msg = e instanceof Error ? e.message : String(e)
    if (/aborted|AbortError/i.test(msg)) return
    if (isTerminalThreadError(msg) || msg === "运行已结束") throw new Error("运行已结束")
    throw e
  }
}
