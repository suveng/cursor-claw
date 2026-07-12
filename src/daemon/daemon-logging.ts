/**
 * Daemon 文件日志：路径解析、目录确保、2MB 轮转、stderr 同步写入。
 * 经 createDaemonLogger 注入枢纽；禁止改日志关键字文案与双写策略。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { localTimestamp } from "../bridge/lark-core.js";

/** 日志写入 API（注入给各子模块 deps） */
export type DaemonLogFn = (level: string, ...args: unknown[]) => void;

export interface DaemonLogger {
  log: DaemonLogFn;
  ensureLogDir: () => void;
  /** 实际写入的日志文件绝对路径（供启动 INFO 一行） */
  logFilePath: string;
}

/**
 * 创建 Daemon 日志器。
 * 路径：DAEMON_LOG_PATH → APP_DATA_DIR/daemon.log → cwd/daemon.log。
 */
export function createDaemonLogger(): DaemonLogger {
  const appDataDir = process.env.APP_DATA_DIR || "";
  // 子进程由 Electron 注入 DAEMON_LOG_PATH；独立运行时兜底至 APP_DATA_DIR/daemon.log
  const logFilePath =
    process.env.DAEMON_LOG_PATH?.trim() ||
    (appDataDir ? path.join(appDataDir, "daemon.log") : path.join(process.cwd(), "daemon.log"));
  const maxLogSize = 2 * 1024 * 1024;
  const rotateCheckInterval = 100;
  let logWriteCount = 0;
  let logDirEnsured = false;

  /** 换行用 ⏎ 标记（展示层还原），避免与 Windows 路径中 \n、\r 字面量冲突 */
  function escapeLogContentSingleLine(s: string): string {
    return s.replace(/\r?\n/g, "⏎");
  }

  function ensureLogDir(): void {
    if (logDirEnsured) return;
    const dir = path.dirname(logFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    logDirEnsured = true;
  }

  /** 每 N 次写入检查一次；超 2MB 则滚动为 .old */
  function rotateLogIfNeeded(): void {
    if (++logWriteCount % rotateCheckInterval !== 0) return;
    try {
      if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > maxLogSize) {
        const backup = logFilePath + ".old";
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(logFilePath, backup);
      }
    } catch {
      /* ignore */
    }
  }

  function log(level: string, ...args: unknown[]): void {
    const ts = localTimestamp();
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    const line = `${ts} [Daemon] ${level} ${escapeLogContentSingleLine(msg)}\n`;
    process.stderr.write(line);
    try {
      ensureLogDir();
      rotateLogIfNeeded();
      fs.appendFileSync(logFilePath, line);
    } catch {
      /* ignore */
    }
  }

  return { log, ensureLogDir, logFilePath };
}
