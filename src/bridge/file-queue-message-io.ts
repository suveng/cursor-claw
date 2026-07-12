import * as fs from "node:fs";
import * as path from "node:path";
import type { QueueMessage, QueueMessageMeta } from "./file-queue-types.js";

/** 从文件名 `${ts}_${safeId}.ext` 提取时间戳前缀 */
export function fileTimestamp(file: string): number {
  const ts = parseInt(path.basename(file).split("_")[0], 10);
  return Number.isNaN(ts) ? 0 : ts;
}

/**
 * 文件名 `${ts}_${safeId}.ext` 是否精确对应该 safeId。
 * 使用 `_` 后整段匹配，禁止 endsWith 后缀歧义。
 */
export function matchesSafeId(filename: string, safeId: string): boolean {
  const base = filename.replace(/\.\w+$/, "");
  const idx = base.indexOf("_");
  return idx >= 0 && base.slice(idx + 1) === safeId;
}

/** 读取并解析单条队列 JSON；兼容旧格式顶层 chatType/senderOpenId */
export function parseMessageFile(filePath: string): QueueMessage | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const meta: QueueMessageMeta = { ...(parsed.meta || {}) };
    // 兼容旧格式：顶层 chatType/senderOpenId 收进 meta
    if (parsed.chatType && !meta.chatType) meta.chatType = parsed.chatType;
    if (parsed.senderOpenId && !meta.senderOpenId) meta.senderOpenId = parsed.senderOpenId;
    return {
      text: typeof parsed.text === "string" ? parsed.text : raw,
      messageId: parsed.messageId || "",
      sessionKey: parsed.sessionKey || parsed.chatId || "",
      timestamp: parsed.timestamp || fileTimestamp(filePath),
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    };
  } catch {
    return null;
  }
}

/** tmp+rename 原子写盘；供入队与合并替换复用 */
export function writeMessageAtomically(dir: string, filename: string, data: string): boolean {
  try {
    const tmpPath = path.join(dir, filename + ".tmp");
    const finalPath = path.join(dir, filename);
    fs.writeFileSync(tmpPath, data, "utf-8");
    fs.renameSync(tmpPath, finalPath);
    return true;
  } catch {
    return false;
  }
}
