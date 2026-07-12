/**
 * Electron 父进程监护：stdin 断管 / ppid 消失时自行退出并清 lock。
 * 防御 Electron 强杀（SIGKILL / Force Quit）无法走 will-quit 的场景。
 */
import { isBrokenPipeError } from "../shared/is-broken-pipe-error.js";

export interface DaemonParentWatchOptions {
  log: (level: string, ...args: unknown[]) => void;
  removeLockFile: () => void;
  stopScheduledTasks: () => void;
  /** 检测到父进程消失后延迟退出（毫秒），默认 5000 */
  exitDelayMs?: number;
  /** ppid 轮询间隔（毫秒），默认 2000 */
  ppidCheckIntervalMs?: number;
}

const DEFAULT_EXIT_DELAY_MS = 5000;
const DEFAULT_PPID_CHECK_MS = 2000;

/** 启动父进程监护（幂等：重复调用仅首次生效） */
export function startDaemonParentWatch(opts: DaemonParentWatchOptions): void {
  let scheduled = false;
  let exiting = false;

  const exitDelayMs = opts.exitDelayMs ?? DEFAULT_EXIT_DELAY_MS;
  const ppidCheckMs = opts.ppidCheckIntervalMs ?? DEFAULT_PPID_CHECK_MS;

  const doExit = (reason: string): void => {
    if (exiting) return;
    exiting = true;
    opts.log("INFO", `parent_watch: ${reason}，${exitDelayMs}ms 后退出`);
    setTimeout(() => {
      try { opts.stopScheduledTasks(); } catch { /* ignore */ }
      try { opts.removeLockFile(); } catch { /* ignore */ }
      process.exit(0);
    }, exitDelayMs).unref();
  };

  const scheduleExit = (reason: string): void => {
    if (scheduled || exiting) return;
    scheduled = true;
    doExit(reason);
  };

  // stdin pipe：Electron spawn 使用 stdio pipe，主进程退出时 stdin 关闭
  if (process.stdin.readable && !process.stdin.isTTY) {
    process.stdin.on("end", () => scheduleExit("stdin_end"));
    process.stdin.on("close", () => scheduleExit("stdin_close"));
    process.stdin.on("error", (err) => {
      if (isBrokenPipeError(err)) scheduleExit("stdin_epipe");
    });
    // 保持 pipe 可读，避免部分平台过早 EOF
    process.stdin.resume();
  }

  // ppid 轮询：父进程被强杀后 ppid 变 1 或 signal 0 失败
  const initialPpid = process.ppid;
  const checkParent = (): void => {
    if (exiting) return;
    const ppid = process.ppid;
    if (ppid === 1 && initialPpid !== 1) {
      scheduleExit("ppid_reparented");
      return;
    }
    if (ppid > 0 && ppid !== initialPpid) {
      scheduleExit("ppid_changed");
      return;
    }
    try {
      process.kill(ppid, 0);
    } catch {
      scheduleExit("ppid_gone");
    }
  };

  setInterval(checkParent, ppidCheckMs).unref();
}
