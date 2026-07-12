/**
 * 微信会话 typing / 进度续期控制器（由 WeChatManager 持有）。
 * 与出站 sendText/sendMedia 的 ensure/cancel 共用 ticket 缓存。
 */
import type { WeChatClient } from "./wechat/index.js";

/** 与 WeChatManager.status 对齐的最小连接态（避免循环 import） */
type TypingConnStatus = "disconnected" | "qr_pending" | "logging_in" | "connected" | "error";

/** 宿主只暴露 client/status/log，避免循环依赖业务方法 */
export interface WeChatTypingHost {
  getClient: () => WeChatClient | null;
  getStatus: () => TypingConnStatus;
  log: (level: string, ...args: unknown[]) => void;
}

/** iLink typing 约 5s 消失，提前 4s 续期 */
const TYPING_REFRESH_MS = 4000;

export class WeChatProgressTyping {
  private tickets = new Map<string, string>();
  /** 进度 typing 续期定时器（每 4s 刷新 ticket，直至 stopProgress） */
  private refreshTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly host: WeChatTypingHost) {}

  /** 开启会话级进行中指示（由 daemon 进度状态机调用） */
  async startProgress(userId: string): Promise<void> {
    if (!this.host.getClient() || this.host.getStatus() !== "connected") {
      this.host.log("WARN", "[WeChat] startProgressTyping: 未连接");
      return;
    }
    this.clearRefreshTimer(userId);
    await this.startTypingForUser(userId);
    const timer = setInterval(() => {
      void this.refreshProgress(userId);
    }, TYPING_REFRESH_MS);
    this.refreshTimers.set(userId, timer);
  }

  /** 停止进行中指示并清理 ticket（由 daemon 进度状态机调用） */
  async stopProgress(userId: string): Promise<void> {
    if (!this.host.getClient() || this.host.getStatus() !== "connected") {
      this.clearRefreshTimer(userId);
      this.host.log("WARN", "[WeChat] stopProgressTyping: 未连接");
      return;
    }
    this.clearRefreshTimer(userId);
    await this.cancel(userId);
  }

  /** 断开连接时清理全部续期 timer，防泄漏 */
  clearAll(): void {
    for (const userId of [...this.refreshTimers.keys()]) {
      this.clearRefreshTimer(userId);
    }
    this.tickets.clear();
  }

  /** 确保发送前有 typing：有缓存 ticket 则跳过 */
  async ensure(userId: string): Promise<void> {
    if (!this.host.getClient()) return;
    const cached = this.tickets.get(userId);
    if (cached) return;
    try {
      const ticket = await this.host.getClient()!.getTypingTicket(userId);
      if (ticket) {
        this.tickets.set(userId, ticket);
        await this.host.getClient()!.sendTyping(userId, ticket, "typing");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.host.log("WARN", `[WeChat] ensureTyping 失败: ${msg}`);
    }
  }

  /** 取消 typing 并清除缓存 */
  async cancel(userId: string): Promise<void> {
    if (!this.host.getClient()) return;
    const ticket = this.tickets.get(userId);
    if (!ticket) return;
    this.tickets.delete(userId);
    try {
      await this.host.getClient()!.sendTyping(userId, ticket, "cancel");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.host.log("WARN", `[WeChat] cancelTyping 失败: ${msg}`);
    }
  }

  /** 清除续期定时器（重复 stop 安全） */
  private clearRefreshTimer(userId: string): void {
    const timer = this.refreshTimers.get(userId);
    if (!timer) return;
    clearInterval(timer);
    this.refreshTimers.delete(userId);
  }

  /** 周期续期 typing ticket（失败 WARN 不阻断主路径） */
  private async refreshProgress(userId: string): Promise<void> {
    if (!this.host.getClient() || this.host.getStatus() !== "connected") return;
    try {
      const ticket = await this.host.getClient()!.getTypingTicket(userId);
      if (!ticket) {
        // 无 ticket 亦视为续期失败，便于运维检索（不阻断主路径）
        this.host.log("WARN", `[WeChat] wechat_typing_refresh 失败: 无 typing ticket user=${userId}`);
        return;
      }
      this.tickets.set(userId, ticket);
      await this.host.getClient()!.sendTyping(userId, ticket, "typing");
      this.host.log("INFO", `[WeChat] wechat_typing_refresh user=${userId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.host.log("WARN", `[WeChat] wechat_typing_refresh 失败: ${msg}`);
    }
  }

  /** 获取 ticket 并发送 typing 状态 */
  private async startTypingForUser(userId: string): Promise<void> {
    if (!this.host.getClient()) return;
    try {
      const ticket = await this.host.getClient()!.getTypingTicket(userId);
      if (ticket) {
        this.tickets.set(userId, ticket);
        await this.host.getClient()!.sendTyping(userId, ticket, "typing");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.host.log("WARN", `[WeChat] startTyping 失败: ${msg}`);
    }
  }
}
