import * as fs from "node:fs";
import * as path from "node:path";
import {
  getQueueDir,
  getSessionDir,
  listSessionDirs,
  STALE_TMP_MS,
} from "./file-queue-path.js";
import { fileTimestamp, matchesSafeId } from "./file-queue-message-io.js";

/**
 * 回复确认（ack）：Agent 回复某条 message_id 即视为该消息及更早的全部已处理。
 * 删除该会话中「时间戳 ≤ 目标消息」的所有 .claimed（仅已投递的；未投递的 .qmsg 不动，
 * 防止时钟乱序误删新消息），返回被确认消息的 messageId（用于打表情）。
 * 找不到目标消息（已被确认过）返回空数组。session_key 缺省时遍历所有会话兜底。
 */
export function ackMessages(messageId: string, filterSessionKey?: string): string[] {
  if (!getQueueDir() || !messageId) return [];
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dirs = filterSessionKey ? [getSessionDir(filterSessionKey)] : [getQueueDir(), ...listSessionDirs()];

  for (const dir of dirs) {
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".claimed"));
    } catch {
      continue;
    }

    const target = files.find((f) => matchesSafeId(f, safeId));
    if (!target) continue;
    const cutoff = fileTimestamp(target);

    const acked: string[] = [];
    for (const f of files) {
      if (fileTimestamp(f) > cutoff) continue;
      const filePath = path.join(dir, f);
      let mid = "";
      try {
        mid = JSON.parse(fs.readFileSync(filePath, "utf-8")).messageId || "";
      } catch { /* ignore */ }
      try {
        fs.unlinkSync(filePath);
        if (mid) acked.push(mid);
      } catch { /* ignore */ }
    }
    return acked;
  }
  return [];
}

/** 仅清理写入中断遗留的 .tmp 孤儿文件；.claimed 不超时删除（靠 Agent 回复确认） */
export function cleanupStaleMessages(): void {
  if (!getQueueDir()) return;
  const now = Date.now();
  const dirs = [getQueueDir(), ...listSessionDirs()];
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".tmp")) continue;
        const filePath = path.join(dir, f);
        try {
          if (now - fs.statSync(filePath).mtimeMs > STALE_TMP_MS) {
            fs.unlinkSync(filePath);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
}

/**
 * 冷启动回收遗留 .claimed：全应用重启后无 live Agent，磁盘 claimed 为孤儿状态。
 * 还原为 .qmsg 以保留「至少一次」投递语义，供 orchestrator 重新领取。
 * @returns 回收条数
 */
export function cleanupOrphanClaimedOnColdStart(): number {
  if (!getQueueDir()) return 0;
  let count = 0;
  const dirs = listSessionDirs();
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".claimed"));
      for (const f of files) {
        const src = path.join(dir, f);
        const dest = src.replace(/\.claimed$/, ".qmsg");
        try {
          if (fs.existsSync(dest)) {
            // 异常双份：删孤儿 claimed，保留已有 .qmsg
            fs.unlinkSync(src);
          } else {
            fs.renameSync(src, dest);
          }
          count++;
        } catch { /* 并发或 IO 失败，跳过 */ }
      }
    } catch { /* ignore */ }
  }
  return count;
}

/**
 * 失败重入队用：按 messageId 将 .claimed rename 回 .qmsg，供再次 claim。
 * 勿与 ackMessages（删除 .claimed）混淆——本函数保留消息体，不是确认删除。
 * 与 cleanupOrphanClaimedOnColdStart 同构（rename；目标 .qmsg 已存在则删孤儿 claimed），范围按 id。
 * @returns 实际释放成功的 messageId 列表（找不到或 IO 失败则跳过，不抛错）
 */
export function releaseClaimedMessages(messageIds: string[], filterSessionKey?: string): string[] {
  if (!getQueueDir() || !messageIds?.length) return [];
  const dirs = filterSessionKey
    ? [getSessionDir(filterSessionKey)]
    : [getQueueDir(), ...listSessionDirs()];
  const released: string[] = [];

  for (const messageId of messageIds) {
    if (!messageId) continue;
    const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");

    for (const dir of dirs) {
      let files: string[];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".claimed"));
      } catch {
        continue;
      }

      const target = files.find((f) => matchesSafeId(f, safeId));
      if (!target) continue;

      const src = path.join(dir, target);
      const dest = src.replace(/\.claimed$/, ".qmsg");
      try {
        if (fs.existsSync(dest)) {
          // 异常双份：删孤儿 claimed，保留已有 .qmsg（与冷启动一致）
          fs.unlinkSync(src);
        } else {
          fs.renameSync(src, dest);
        }
        released.push(messageId);
      } catch {
        /* 并发 rename 失败可忽略（与 claim 既有策略一致） */
      }
      break;
    }
  }

  return released;
}
