/**
 * Daemon 统一终止：HTTP /shutdown → SIGTERM → SIGKILL → 清理 lock。
 * 供 stopDaemon、cleanupDaemonManager（will-quit）共用，避免两套实现漂移。
 */
import { execFileSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { readLockFile, removeLockFile, httpPost } from "./daemon-client"
import type { LockInfo } from "./daemon-client"

export interface KillDaemonOptions {
  cachedPort?: number | null
  spawnProcess?: ChildProcess | null
  /** 接管模式：lock.pid 对应的外部 Daemon（非本进程 spawn） */
  externalPid?: number | null
  termWaitMs?: number
  shutdownWaitMs?: number
}

const DEFAULT_TERM_WAIT_MS = 1000
const DEFAULT_SHUTDOWN_WAIT_MS = 500

/** 探测进程是否仍存活（signal 0 不杀进程） */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 收集待终止 pid（去重，仅存活进程） */
function collectTargetPids(opts: KillDaemonOptions, lock: LockInfo | null): number[] {
  const pids = new Set<number>()
  if (lock?.pid && isProcessAlive(lock.pid)) pids.add(lock.pid)
  if (opts.externalPid && isProcessAlive(opts.externalPid)) pids.add(opts.externalPid)
  const spawnPid = opts.spawnProcess?.pid
  if (spawnPid && isProcessAlive(spawnPid)) pids.add(spawnPid)
  return [...pids]
}

/** will-quit 同步阻塞 POST（子进程跑 Node HTTP，避免污染主进程事件循环） */
function syncHttpPost(url: string, timeoutMs: number): void {
  const script = `
    const http = require("http");
    const u = new URL(${JSON.stringify(url)});
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeout: ${timeoutMs},
    }, () => process.exit(0));
    req.on("error", () => process.exit(0));
    req.on("timeout", () => { req.destroy(); process.exit(0); });
    req.write("{}");
    req.end();
  `
  try {
    execFileSync(process.execPath, ["-e", script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: timeoutMs + 300,
      windowsHide: true,
    })
  } catch { /* 尽力 shutdown，失败走信号兜底 */ }
}

/** 同步阻塞等待（will-quit 路径） */
function syncDelay(ms: number): void {
  if (ms <= 0) return
  try {
    execFileSync(process.execPath, ["-e", `setTimeout(()=>{}, ${ms})`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: ms + 500,
      windowsHide: true,
    })
  } catch { /* ignore */ }
}

function escalateKillPids(pids: number[], termWaitMs: number): void {
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM") } catch { /* ignore */ }
  }
  if (pids.length > 0) syncDelay(termWaitMs)
  for (const pid of pids) {
    if (isProcessAlive(pid)) {
      try { process.kill(pid, "SIGKILL") } catch { /* ignore */ }
    }
  }
}

async function escalateKillPidsAsync(pids: number[], termWaitMs: number): Promise<void> {
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM") } catch { /* ignore */ }
  }
  if (pids.length > 0) await new Promise((r) => setTimeout(r, termWaitMs))
  for (const pid of pids) {
    if (isProcessAlive(pid)) {
      try { process.kill(pid, "SIGKILL") } catch { /* ignore */ }
    }
  }
}

/** 异步终止（stopDaemon IPC / Dashboard / /restart） */
export async function killDaemonByLockOrProcess(opts: KillDaemonOptions = {}): Promise<void> {
  const lock = readLockFile()
  const port = lock?.port ?? opts.cachedPort ?? null
  const shutdownWait = opts.shutdownWaitMs ?? DEFAULT_SHUTDOWN_WAIT_MS
  const termWait = opts.termWaitMs ?? DEFAULT_TERM_WAIT_MS

  if (port) {
    try {
      await httpPost(`http://127.0.0.1:${port}/shutdown`, {}, 3000)
      await new Promise((r) => setTimeout(r, shutdownWait))
    } catch { /* ignore，走信号兜底 */ }
  }

  const pids = collectTargetPids(opts, lock)
  await escalateKillPidsAsync(pids, termWait)
  removeLockFile()
}

/** 同步终止（will-quit / cleanupDaemonManager，尽力阻塞至杀完或超时） */
export function killDaemonByLockOrProcessSync(opts: KillDaemonOptions = {}): void {
  const lock = readLockFile()
  const port = lock?.port ?? opts.cachedPort ?? null
  const shutdownWait = opts.shutdownWaitMs ?? DEFAULT_SHUTDOWN_WAIT_MS
  const termWait = opts.termWaitMs ?? DEFAULT_TERM_WAIT_MS

  if (port) {
    syncHttpPost(`http://127.0.0.1:${port}/shutdown`, 800)
    syncDelay(shutdownWait)
  }

  const pids = collectTargetPids(opts, lock)
  escalateKillPids(pids, termWait)
  removeLockFile()
}

/** lock 存在但 health 失败或 pid 已死 → 清理残留 lock */
export async function cleanupStaleDaemonLock(
  tryHealth: (port: number) => Promise<boolean>,
): Promise<void> {
  const lock = readLockFile()
  if (!lock) return
  let healthOk = false
  if (lock.port) {
    try { healthOk = await tryHealth(lock.port) } catch { healthOk = false }
  }
  const pidAlive = lock.pid ? isProcessAlive(lock.pid) : false
  if (!healthOk || !pidAlive) removeLockFile()
}
