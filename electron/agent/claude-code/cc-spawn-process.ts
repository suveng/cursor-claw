/**
 * Claude Agent SDK spawnClaudeCodeProcess 薄适配器。
 * 将 CLI 拉起从 SDK 黑盒改为显式 child_process.spawn，供 buildQueryOptions 注入。
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk"
import { pushUiLog } from "../../app/ui-logger"
import type { CcSessionAgent } from "./agent-cc-types"
import { resolveCcAgentBinaryPath } from "./agent-cc-utils"

/** 将 asar 虚拟路径替换为解包目录（spawn 需要真实文件） */
function resolveAsarUnpackedPath(p: string): string {
  if (p.includes("app.asar") && !p.includes("app.asar.unpacked")) {
    return p.replace("app.asar", "app.asar.unpacked")
  }
  return p
}

/** 清空 session 上的 spawn 句柄（内存 only，勿序列化） */
function clearSpawnHandles(session: CcSessionAgent): void {
  session.spawnedProcess = undefined
  session.childPid = undefined
}

/**
 * 校验 CLI 可执行文件存在；返回可用于 spawn 的真实路径。
 * 缺失时抛含 cc_spawn_enoent 的可检索错误。
 */
function resolveExistingCommandPath(command: string): string {
  const candidates = new Set<string>()
  candidates.add(resolveAsarUnpackedPath(command))
  const resolved = resolveCcAgentBinaryPath()
  if (resolved !== command) {
    candidates.add(resolveAsarUnpackedPath(resolved))
  }
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(`cc_spawn_enoent: Claude CLI 不存在 (command=${command})`)
}

/** 构造 spawn 失败错误（message 含 cc_spawn_failed） */
function buildSpawnFailedError(detail: string): Error {
  return new Error(`cc_spawn_failed: ${detail}`)
}

/**
 * 为指定 session 创建 SDK `spawnClaudeCodeProcess` 回调。
 * 成功时写入 childPid / spawnedProcess 并打 cc_spawn pid= 日志。
 */
export function createCcSpawnClaudeCodeProcess(
  session: CcSessionAgent,
): (options: SpawnOptions) => SpawnedProcess {
  return (options: SpawnOptions): SpawnedProcess => {
    clearSpawnHandles(session)

    let commandPath: string
    try {
      commandPath = resolveExistingCommandPath(options.command)
    } catch (err) {
      clearSpawnHandles(session)
      if (err instanceof Error && err.message.includes("cc_spawn_enoent")) throw err
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`cc_spawn_enoent: ${msg}`)
    }

    let child: ChildProcess
    try {
      child = spawn(commandPath, options.args, {
        cwd: options.cwd,
        env: options.env as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
        signal: options.signal,
      })
    } catch (err) {
      clearSpawnHandles(session)
      const msg = err instanceof Error ? err.message : String(err)
      throw buildSpawnFailedError(`spawn 同步失败: ${msg}`)
    }

    // 异步 spawn 失败（如 ENOENT）时清空句柄，错误仍由 SDK 经 process.on('error') 消费
    child.on("error", (spawnErr) => {
      clearSpawnHandles(session)
      pushUiLog(
        "CC",
        "WARN",
        `[${session.sessionKey}] cc_spawn_failed: ${spawnErr.message}`,
      )
    })

    if (child.pid != null) session.childPid = child.pid
    session.spawnedProcess = child

    pushUiLog(
      "CC",
      "INFO",
      `[${session.sessionKey}] cc_spawn pid=${child.pid ?? "?"} path=${commandPath}`,
    )

    return child
  }
}

/**
 * best-effort 终止 spawn 子进程并清空 session 句柄。
 * 供 stopClaudeCodeSession / watchdog onTimeout 复用。
 */
export function killCcSpawnedProcess(session: CcSessionAgent): void {
  const proc = session.spawnedProcess
  try {
    if (proc && !proc.killed) {
      if (process.platform === "win32") proc.kill()
      else proc.kill("SIGTERM")
    }
  } catch {
    /* best-effort，不阻断调用方 */
  }
  clearSpawnHandles(session)
}
