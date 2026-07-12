/**
 * 判定 write EPIPE / 断管类系统错误（code、errno、message、syscall）。
 * Daemon stderr 在 Electron 重启时断管，须统一识别以免 uncaughtException 日志风暴。
 */

/** Unix 平台 EPIPE 常见 errno（Linux/macOS 均为 -32） */
const EPIPE_ERRNO = -32;

/** 从 unknown 提取 Node ErrnoException 形态字段 */
function asErrnoException(err: unknown): NodeJS.ErrnoException | null {
  if (err == null || typeof err !== "object") return null;
  return err as NodeJS.ErrnoException;
}

/** 判定 write EPIPE / 断管类系统错误 */
export function isBrokenPipeError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === "string") return err.includes("EPIPE");

  const e = asErrnoException(err);
  if (!e) return false;

  if (e.code === "EPIPE") return true;
  if (e.errno === EPIPE_ERRNO) return true;

  const msg = e.message;
  if (typeof msg === "string" && msg.includes("EPIPE")) return true;

  // 断管后 write 失败：syscall 为 write 且带 EPIPE 特征
  if (e.syscall === "write" && (e.code === "EPIPE" || e.errno === EPIPE_ERRNO)) {
    return true;
  }

  return false;
}
