/**
 * 飞书长任务「仍在干活」心跳 / CardKit 续期控制器（对标 wechat-progress-typing）。
 * Map + interval + start/stop 幂等；禁止假 SDK turn / 空 agent.send。
 * 何时续期由 daemon 注入 renew；仅在出站静默超过间隔时触发。
 */

/** 宿主只暴露 renew/log，避免 bridge↔daemon 环依赖 */
export interface LarkCardkitRenewalHost {
  /** 静默超时后的续期：CardKit settings PATCH 或轻量里程碑 */
  renew: (sessionKey: string) => Promise<void>;
  log: (level: string, ...args: unknown[]) => void;
}

/** 默认 60s，远大于 milestone ≥3s，避免刷屏；可用 LARK_CARDKIT_RENEWAL_MS 覆盖 */
const DEFAULT_INTERVAL_MS = 60_000;

function resolveIntervalMs(): number {
  const raw = Number(process.env.LARK_CARDKIT_RENEWAL_MS);
  if (Number.isFinite(raw) && raw >= 15_000) return raw;
  return DEFAULT_INTERVAL_MS;
}

/**
 * 飞书会话级进度心跳：start 后周期性检查静默；有近期出站则跳过。
 */
export class LarkCardkitRenewal {
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private lastOutboundAt = new Map<string, number>();
  private readonly intervalMs: number;

  constructor(
    private readonly host: LarkCardkitRenewalHost,
    intervalMs?: number,
  ) {
    this.intervalMs = intervalMs ?? resolveIntervalMs();
  }

  /** 开启会话心跳（幂等：重复 start 先清旧 timer） */
  start(sessionKey: string): void {
    if (!sessionKey) return;
    this.clearRefreshTimer(sessionKey);
    this.lastOutboundAt.set(sessionKey, Date.now());
    const timer = setInterval(() => {
      void this.tick(sessionKey);
    }, this.intervalMs);
    // 不阻止进程退出
    timer.unref?.();
    this.refreshTimers.set(sessionKey, timer);
  }

  /** 停止心跳并清理（重复 stop 安全） */
  stop(sessionKey: string): void {
    this.clearRefreshTimer(sessionKey);
    this.lastOutboundAt.delete(sessionKey);
  }

  /** 真实 tool/thinking/assistant/里程碑出站后刷新静默时钟 */
  noteOutbound(sessionKey: string): void {
    if (!sessionKey) return;
    if (!this.refreshTimers.has(sessionKey)) return;
    this.lastOutboundAt.set(sessionKey, Date.now());
  }

  /** 断开/进程退出时清理全部 timer，防泄漏 */
  clearAll(): void {
    for (const key of [...this.refreshTimers.keys()]) {
      this.stop(key);
    }
  }

  /** 清除续期定时器 */
  private clearRefreshTimer(sessionKey: string): void {
    const timer = this.refreshTimers.get(sessionKey);
    if (!timer) return;
    clearInterval(timer);
    this.refreshTimers.delete(sessionKey);
  }

  /** 周期检查：无出站静默满 interval 才 renew */
  private async tick(sessionKey: string): Promise<void> {
    if (!this.refreshTimers.has(sessionKey)) return;
    const last = this.lastOutboundAt.get(sessionKey) ?? 0;
    if (Date.now() - last < this.intervalMs) return;
    try {
      await this.host.renew(sessionKey);
      this.host.log("INFO", `[Lark] cardkit_renewal session=${sessionKey}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.host.log("WARN", `[Lark] cardkit_renewal 失败: ${msg}`);
    }
  }
}
