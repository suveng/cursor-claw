import * as fs from "node:fs";
import type { QueueMessageMeta } from "./file-queue-types.js";
import { getQueueDir, getSessionDir } from "./file-queue-path.js";
import { matchesSafeId, writeMessageAtomically } from "./file-queue-message-io.js";

/**
 * IM 入队唯一写盘入口：写入 `.qmsg` JSON。
 * 同 session 下已有同 messageId（safeId）的 `.qmsg`/`.claimed` 时 dedup 返回 false。
 */
export function pushToFileQueue(
  text: string,
  messageId?: string,
  source?: string,
  sessionKey?: string,
  skipDedup?: boolean,
  meta?: QueueMessageMeta,
): boolean {
  if (!getQueueDir() || !text?.trim()) return false;

  const dir = getSessionDir(sessionKey);
  const ts = Date.now();
  const fileToken = messageId || `${ts}-${Math.random().toString(36).slice(2, 8)}`;
  const safeId = fileToken.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${ts}_${safeId}.qmsg`;

  if (messageId && !skipDedup) {
    try {
      const existing = fs.readdirSync(dir);
      if (existing.some((f) => (f.endsWith(".qmsg") || f.endsWith(".claimed")) && matchesSafeId(f, safeId))) {
        return false;
      }
    } catch { /* ignore */ }
  }

  const data = JSON.stringify({
    text,
    messageId: messageId || "",
    timestamp: ts,
    source: source || `pid-${process.pid}`,
    sessionKey: sessionKey || "",
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  });
  return writeMessageAtomically(dir, filename, data);
}
