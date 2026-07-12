/**
 * dispatch 失败重试：attempt 计数、退避延后、耗尽后 ack。
 * 退避数值对齐 Electron retry-policy，禁止 import Electron。
 */

/** 每 session 最多自动重试次数（不含首次 launch） */
export const MAX_DISPATCH_RETRIES = 3;
/** 非 busy 退避序列（ms） */
export const DISPATCH_BACKOFF_MS = [600, 1200, 2400] as const;

export interface DispatchRetryDeps {
  log: (level: string, ...args: unknown[]) => void;
  releaseClaimedMessages: (messageIds: string[], sessionKey?: string) => string[];
  ackMessages: (messageId: string, sessionKey?: string) => string[];
  notifySessionUser: (sessionKey: string, text: string, stopProgress?: boolean) => Promise<void>;
  formatOrchestratorFailure: (error?: string) => string;
  scheduleAgentDispatch: (sessionKey?: string) => void;
}

/** 工厂：进程内 retry 状态 + 调度/耗尽处理 */
export function createDispatchRetry(deps: DispatchRetryDeps) {
  const timerBySession = new Map<string, ReturnType<typeof setTimeout>>();
  const attemptBySession = new Map<string, number>();

  function clearAttempt(sessionKey: string): void {
    attemptBySession.delete(sessionKey);
  }

  /** 清除旧 timer，延后 scheduleAgentDispatch；日志关键字供运维检索 */
  function scheduleDispatchRetry(sessionKey: string, delayMs: number, reason: string): void {
    const existing = timerBySession.get(sessionKey);
    if (existing) clearTimeout(existing);
    const delay = Math.max(500, delayMs);
    const timer = setTimeout(() => {
      timerBySession.delete(sessionKey);
      deps.scheduleAgentDispatch(sessionKey);
    }, delay);
    timerBySession.set(sessionKey, timer);
    deps.log("INFO", `dispatch_retry_scheduled session=${sessionKey} delay_ms=${delay} reason=${reason}`);
    // busy 兼容既有可检索关键字
    if (reason === "busy") {
      deps.log("INFO", `agent_busy_requeue session=${sessionKey} delay_ms=${delay}`);
    }
  }

  function scheduleBusyRetry(sessionKey: string, delayMs: number): void {
    scheduleDispatchRetry(sessionKey, delayMs, "busy");
  }

  /**
   * launch 失败后：可重试则 release+延后；耗尽则 notify 后 ack。
   * @returns 是否仍处于可重试路径（true=已排重试；false=已耗尽 ack）
   */
  async function handleLaunchFailure(opts: {
    sessionKey: string;
    messageIds: string[];
    error?: string;
    busyDelayMs: number;
  }): Promise<"retried" | "exhausted"> {
    const { sessionKey, messageIds, error, busyDelayMs } = opts;
    const isBusy = busyDelayMs > 0;
    const attempt = attemptBySession.get(sessionKey) ?? 0;

    // busy 或未达上限：release 后延后重调度；禁止未耗尽时 ack
    if (attempt < MAX_DISPATCH_RETRIES) {
      deps.releaseClaimedMessages(messageIds, sessionKey);
      attemptBySession.set(sessionKey, attempt + 1);
      const delayMs = isBusy
        ? busyDelayMs
        : DISPATCH_BACKOFF_MS[Math.min(attempt, DISPATCH_BACKOFF_MS.length - 1)];
      // 非 busy 每次失败通知（与现网一致）；busy 可不发失败文案
      if (!isBusy) {
        await deps.notifySessionUser(sessionKey, deps.formatOrchestratorFailure(error));
      }
      scheduleDispatchRetry(sessionKey, delayMs, isBusy ? "busy" : "transient");
      return "retried";
    }

    // 重试耗尽：停试可感知通知后再 ack，避免永久卡盘与轰炸
    deps.log(
      "WARN",
      `dispatch_retry_exhausted session=${sessionKey} attempts=${attempt} error=${error ?? "unknown"}`,
    );
    clearAttempt(sessionKey);
    await deps.notifySessionUser(
      sessionKey,
      `${deps.formatOrchestratorFailure(error)}（已停止自动重试）`,
      true,
    );
    const lastId = messageIds[messageIds.length - 1];
    if (lastId) deps.ackMessages(lastId, sessionKey);
    return "exhausted";
  }

  return { clearAttempt, scheduleDispatchRetry, scheduleBusyRetry, handleLaunchFailure };
}
