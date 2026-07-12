import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

/** 阻塞 poll 默认间隔（毫秒） */
export const POLL_INTERVAL_MS = 400;

/** 写入中断遗留 .tmp 的超时清理阈值（毫秒） */
export const STALE_TMP_MS = 5 * 60 * 1000;

/** 队列根目录：`APP_DATA_DIR/file-queue/` */
let queueDir = "";

/**
 * 初始化文件队列根目录；须在 daemon 启动早期调用。
 * 磁盘布局：`APP_DATA_DIR/file-queue/<sessionHash>/` 下 `.qmsg` / `.claimed`。
 */
export function initFileQueue(): string {
  const appDataDir = process.env.APP_DATA_DIR;
  if (!appDataDir) throw new Error("APP_DATA_DIR 环境变量未设置");
  queueDir = path.join(appDataDir, "file-queue");
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
  return queueDir;
}

/** 返回已初始化的队列根目录；未 init 时为空串 */
export function getQueueDir(): string {
  return queueDir;
}

/** sessionKey → 16 位 MD5 子目录名（域内复用） */
export function sanitizeSessionDir(sessionKey: string): string {
  return crypto.createHash("md5").update(sessionKey).digest("hex").slice(0, 16);
}

/** 解析会话目录路径；无 sessionKey 时返回队列根目录 */
export function getSessionDir(sessionKey?: string): string {
  if (!sessionKey) return queueDir;
  const sub = path.join(queueDir, sanitizeSessionDir(sessionKey));
  if (!fs.existsSync(sub)) fs.mkdirSync(sub, { recursive: true });
  return sub;
}

/** 枚举所有会话子目录绝对路径（域内复用） */
export function listSessionDirs(): string[] {
  if (!queueDir) return [];
  try {
    return fs.readdirSync(queueDir)
      .filter((d) => {
        const full = path.join(queueDir, d);
        return fs.statSync(full).isDirectory();
      })
      .map((d) => path.join(queueDir, d));
  } catch { return []; }
}
