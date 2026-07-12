import * as fs from "node:fs";
import * as path from "node:path";
import type { QueueMessage } from "./file-queue-types.js";
import { getQueueDir, getSessionDir, POLL_INTERVAL_MS } from "./file-queue-path.js";
import { parseMessageFile } from "./file-queue-message-io.js";

/**
 * 领取并消费下一条消息：rename 原子占用 → 读取 → 立即删除。
 * 领取即消费，不可恢复。仅用于 drain/dequeue-all（electron 本地 CLI 调度）场景；
 * poll-message 路径请用 claimSessionMessages（领取不删，靠回复确认）。
 */
export function claimNextMessage(filterSessionKey?: string): QueueMessage | null {
  if (!getQueueDir()) return null;

  const dir = getSessionDir(filterSessionKey);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".qmsg")).sort();
  } catch {
    return null;
  }

  for (const file of files) {
    const srcPath = path.join(dir, file);
    const claimedPath = srcPath.replace(/\.qmsg$/, ".claimed");
    // rename 是原子操作：并发领取时只有一个进程/请求能成功占用
    try {
      fs.renameSync(srcPath, claimedPath);
    } catch {
      continue;
    }
    const parsed = parseMessageFile(claimedPath);
    try { fs.unlinkSync(claimedPath); } catch { /* ignore */ }
    if (parsed) return parsed;
  }
  return null;
}

/** 会话目录下是否存在未确认消息（.qmsg 待投递 或 .claimed 已投递待回复确认） */
function hasPendingMessages(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith(".qmsg") || f.endsWith(".claimed"));
  } catch {
    return false;
  }
}

/**
 * 领取该会话所有未确认消息（不删除）：
 * 1. 把所有 .qmsg 改名为 .claimed（标记"已投递、待回复确认"）；
 * 2. 返回该会话全部 .claimed（含本次新投递的 + 历史未确认的），按 timestamp 升序。
 *
 * 消息只有在 Agent 通过 send-xxx 回复（ackMessages）后才删除；未确认则下次 poll 重新投递，
 * 因此幽灵连接领走也不会丢——这是"至少一次"投递的核心。
 */
export function claimSessionMessages(filterSessionKey?: string): QueueMessage[] {
  if (!getQueueDir()) return [];
  const dir = getSessionDir(filterSessionKey);

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const f of files) {
    if (!f.endsWith(".qmsg")) continue;
    const src = path.join(dir, f);
    try {
      fs.renameSync(src, src.replace(/\.qmsg$/, ".claimed"));
    } catch { /* 并发已被领取，忽略 */ }
  }

  let claimed: string[];
  try {
    claimed = fs.readdirSync(dir).filter((f) => f.endsWith(".claimed")).sort();
  } catch {
    return [];
  }

  const items: QueueMessage[] = [];
  for (const f of claimed) {
    const parsed = parseMessageFile(path.join(dir, f));
    if (parsed) items.push(parsed);
  }
  items.sort((a, b) => a.timestamp - b.timestamp);
  return items;
}

/**
 * 阻塞领取：有未确认消息（.qmsg 或 .claimed）立即返回；全空则挂起等待新消息。
 * timeoutMs: 0=不等待立即返回；<0=无限阻塞；>0=超时毫秒。
 */
export function waitForSessionMessages(
  timeoutMs: number,
  intervalMs = POLL_INTERVAL_MS,
  filterSessionKey?: string,
  isCancelled?: () => boolean,
): Promise<QueueMessage[]> {
  return new Promise((resolve) => {
    const dir = getSessionDir(filterSessionKey);
    if (hasPendingMessages(dir)) { resolve(claimSessionMessages(filterSessionKey)); return; }
    if (timeoutMs === 0) { resolve([]); return; }

    const infinite = timeoutMs < 0;
    const deadline = infinite ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (isCancelled?.()) { clearInterval(timer); resolve([]); return; }
      if (hasPendingMessages(dir)) { clearInterval(timer); resolve(claimSessionMessages(filterSessionKey)); return; }
      if (!infinite && Date.now() >= deadline) { clearInterval(timer); resolve([]); }
    }, intervalMs);
    timer.unref();
  });
}
