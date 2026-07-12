import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as Lark from "@larksuiteoapi/node-sdk";

/** 媒体缓存目录（飞书/微信下载的图片、文件、语音共用） */
export const MEDIA_CACHE_DIR = path.join(os.tmpdir(), "cursor-claw-images");

/** 清理媒体缓存中 mtime 超过 maxAgeMs 的旧文件，返回删除数量（避免临时文件无限堆积） */
export function cleanupMediaCache(maxAgeMs: number): number {
  let removed = 0;
  try {
    if (!fs.existsSync(MEDIA_CACHE_DIR)) return 0;
    const now = Date.now();
    for (const name of fs.readdirSync(MEDIA_CACHE_DIR)) {
      const full = path.join(MEDIA_CACHE_DIR, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && now - st.mtimeMs > maxAgeMs) { fs.unlinkSync(full); removed++; }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return removed;
}

/** 需剥离的代理环境变量键（飞书 SDK 走直连时避免被系统代理劫持） */
const PROXY_KEYS = [
  "HTTP_PROXY", "http_proxy",
  "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy",
  "NODE_USE_ENV_PROXY",
];

/** 从 process.env 删除代理相关键，返回实际删除的键名列表 */
export function stripProxyEnv(): string[] {
  const removed: string[] = [];
  for (const key of PROXY_KEYS) {
    if (process.env[key]) {
      removed.push(key);
      delete process.env[key];
    }
  }
  return removed;
}

/** 本地时间戳字符串（日志前缀） */
export function localTimestamp(): string {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

/** 创建飞书自建应用 Client（固定 Feishu 域、error 日志级别） */
export function createLarkClient(appId: string, appSecret: string): Lark.Client {
  return new Lark.Client({
    appId,
    appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.error,
  });
}
