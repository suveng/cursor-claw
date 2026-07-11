/**
 * 会话回退栈 SSOT（与 activeSessionMap 并列，均在 Daemon 进程内存）。
 * key = 临时 sessionKey，value = 创建临时会话前的活跃 sessionKey。
 * Electron 经 /api/session-fallback 读写；跨 Electron 重启仍可读（Daemon 未重启时）。
 */
export const fallbackSessionMap = new Map<string, string>();

/** 写入回退关系：临时会话结束后可切回原活跃会话 */
export function setSessionFallback(sessionKey: string, fallbackSessionKey: string): void {
  fallbackSessionMap.set(sessionKey, fallbackSessionKey);
}

/** 读取回退目标；无记录返回 undefined */
export function getSessionFallback(sessionKey: string): string | undefined {
  return fallbackSessionMap.get(sessionKey);
}

/** 清除回退关系（幂等，无记录亦成功） */
export function clearSessionFallback(sessionKey: string): void {
  fallbackSessionMap.delete(sessionKey);
}
