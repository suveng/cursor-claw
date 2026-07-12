import * as fs from "node:fs";
import * as path from "node:path";
import type { QueueMessage, QueueMessageMeta, QueueMessageView, QueueSessionInfo } from "./file-queue-types.js";
import {
  getQueueDir,
  getSessionDir,
  listSessionDirs,
  sanitizeSessionDir,
} from "./file-queue-path.js";
import { parseMessageFile, writeMessageAtomically } from "./file-queue-message-io.js";

/** 指定会话待处理（待领取 + 已领取待 ack）消息条数；目录不存在或未初始化时返回 0 */
export function getSessionPendingCount(sessionKey: string): number {
  if (!getQueueDir() || !sessionKey) return 0;
  const dir = path.join(getQueueDir(), sanitizeSessionDir(sessionKey));
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".qmsg") || f.endsWith(".claimed")).length;
  } catch {
    return 0;
  }
}

/** 指定会话待领取（仅 .qmsg）消息条数；目录不存在或未初始化时返回 0 */
export function getSessionUnclaimedCount(sessionKey: string): number {
  if (!getQueueDir() || !sessionKey) return 0;
  const dir = path.join(getQueueDir(), sanitizeSessionDir(sessionKey));
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".qmsg")).length;
  } catch {
    return 0;
  }
}

/** 按 timestamp 升序返回指定会话全部待领取（.qmsg）消息 */
export function listUnclaimedMessages(sessionKey: string): QueueMessage[] {
  if (!getQueueDir() || !sessionKey) return [];
  const dir = path.join(getQueueDir(), sanitizeSessionDir(sessionKey));
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".qmsg")).sort();
  } catch {
    return [];
  }
  const items: QueueMessage[] = [];
  for (const f of files) {
    const parsed = parseMessageFile(path.join(dir, f));
    if (parsed) items.push(parsed);
  }
  items.sort((a, b) => a.timestamp - b.timestamp);
  return items;
}

/** 删除会话全部 .qmsg 并写入单条新消息；.claimed 不动 */
export function replaceSessionUnclaimedMessages(
  sessionKey: string,
  newText: string,
  meta?: QueueMessageMeta,
): { ok: boolean; messageId?: string; error?: string } {
  if (!getQueueDir() || !sessionKey || !newText?.trim()) return { ok: false, error: "invalid input" };
  const dir = path.join(getQueueDir(), sanitizeSessionDir(sessionKey));
  if (!fs.existsSync(dir)) return { ok: false, error: "session not found" };

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return { ok: false, error: "read failed" };
  }

  for (const f of files) {
    if (!f.endsWith(".qmsg")) continue;
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
  }

  const ts = Date.now();
  const messageId = `merge_override_${ts}`;
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${ts}_${safeId}.qmsg`;
  const data = JSON.stringify({
    text: newText.trim(),
    messageId,
    timestamp: ts,
    source: `daemon-${process.pid}`,
    sessionKey,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  });
  if (writeMessageAtomically(dir, filename, data)) {
    return { ok: true, messageId };
  }
  return { ok: false, error: "write failed" };
}

export function getEarliestMessageTime(filterSessionKey?: string): number | null {
  if (!getQueueDir()) return null;
  const dir = getSessionDir(filterSessionKey);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".qmsg")).sort();
    if (files.length === 0) return null;
    const file = files[0];
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const parsed = JSON.parse(raw);
      return parsed.timestamp || parseInt(file.split("_")[0], 10) || null;
    } catch { return null; }
  } catch { /* ignore */ }
  return null;
}

export function getQueueLength(filterSessionKey?: string): number {
  if (!getQueueDir()) return 0;
  if (filterSessionKey) {
    const dir = getSessionDir(filterSessionKey);
    try { return fs.readdirSync(dir).filter((f) => f.endsWith(".qmsg")).length; } catch { return 0; }
  }
  try {
    let total = 0;
    for (const sub of listSessionDirs()) {
      try { total += fs.readdirSync(sub).filter((f) => f.endsWith(".qmsg")).length; } catch { /* ignore */ }
    }
    total += fs.readdirSync(getQueueDir()).filter((f) => f.endsWith(".qmsg")).length;
    return total;
  } catch { return 0; }
}

export function getQueueMessages(filterSessionKey?: string): QueueMessageView[] {
  if (!getQueueDir()) return [];
  const dirs = filterSessionKey ? [getSessionDir(filterSessionKey)] : [getQueueDir(), ...listSessionDirs()];
  const result: QueueMessageView[] = [];
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".qmsg")).sort();
      for (const f of files) {
        try {
          const filePath = path.join(dir, f);
          const raw = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(raw);
          const ts = parsed.timestamp || fs.statSync(filePath).mtimeMs;
          result.push({
            index: result.length, fileId: f,
            preview: (parsed.text ?? "").slice(0, 200),
            sessionKey: parsed.sessionKey || parsed.chatId || undefined,
            chatType: parsed.meta?.chatType || parsed.chatType || undefined,
            timestamp: Math.round(ts),
            senderOpenId: parsed.meta?.senderOpenId || parsed.senderOpenId || undefined,
          });
        } catch {
          result.push({ index: result.length, fileId: f, preview: "(unreadable)" });
        }
      }
    } catch { /* ignore */ }
  }
  return result;
}

export function deleteQueueMessage(fileId: string, filterSessionKey?: string): boolean {
  if (!getQueueDir() || !fileId) return false;
  const basename = path.basename(fileId);
  if (basename !== fileId || !fileId.endsWith(".qmsg")) return false;
  const dirs = filterSessionKey ? [getSessionDir(filterSessionKey)] : [getQueueDir(), ...listSessionDirs()];
  for (const dir of dirs) {
    try {
      const filePath = path.join(dir, basename);
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
    } catch { /* ignore */ }
  }
  return false;
}

export function getDistinctSessions(): QueueSessionInfo[] {
  if (!getQueueDir()) return [];
  const map = new Map<string, { chatType: string; senderOpenId?: string }>();
  const dirs = [getQueueDir(), ...listSessionDirs()];
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".qmsg"));
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, f), "utf-8");
          const parsed = JSON.parse(raw);
          const key = parsed.sessionKey || parsed.chatId || "";
          if (key && !map.has(key)) {
            map.set(key, {
              chatType: parsed.meta?.chatType || parsed.chatType || "p2p",
              senderOpenId: parsed.meta?.senderOpenId || parsed.senderOpenId || undefined,
            });
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  return [...map.entries()].map(([key, v]) => ({
    sessionKey: key,
    chatType: v.chatType,
    senderOpenId: v.senderOpenId,
  }));
}
