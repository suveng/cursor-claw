/**
 * 会话回退栈 SSOT（与 activeSessionMap 并列，均在 Daemon 进程内存）。
 * key = 临时 sessionKey，value = 创建临时会话前的活跃 sessionKey。
 * Electron 经 /api/session-fallback 读写；跨 Electron 重启仍可读（Daemon 未重启时）。
 */
import { scheduleSessionRoutingPersist } from "./daemon-session-routing-persist.js";

export const fallbackSessionMap = new Map<string, string>();

/** active 映射引用（由 daemon.ts 注入，避免 routing↔daemon 环引） */
let activeMapForPersist: Map<string, string> | null = null;

/** 注入 active 映射，供 fallback 写路径触发联合 persist */
export function wireSessionRoutingPersist(active: Map<string, string>): void {
  activeMapForPersist = active;
}

/** fallback 变更后 debounce 写盘（须先 wire active 映射） */
function scheduleRoutingPersist(): void {
  if (activeMapForPersist) {
    scheduleSessionRoutingPersist(activeMapForPersist, fallbackSessionMap);
  }
}

/** 写入回退关系：临时会话结束后可切回原活跃会话 */
export function setSessionFallback(sessionKey: string, fallbackSessionKey: string): void {
  fallbackSessionMap.set(sessionKey, fallbackSessionKey);
  scheduleRoutingPersist();
}

/** 读取回退目标；无记录返回 undefined */
export function getSessionFallback(sessionKey: string): string | undefined {
  return fallbackSessionMap.get(sessionKey);
}

/** 清除回退关系（幂等，无记录亦成功） */
export function clearSessionFallback(sessionKey: string): void {
  fallbackSessionMap.delete(sessionKey);
  scheduleRoutingPersist();
}
