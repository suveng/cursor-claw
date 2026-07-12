/**
 * 会话级 in-flight 与并行 kickoff：跨 session 不互相 await launch。
 * ponytail: 无 worker pool；仅 Set + 短生命周期 scan 锁。
 */

export interface OrchestratorDispatchDeps {
  log: (level: string, ...args: unknown[]) => void;
  getDistinctSessions: () => Array<{
    sessionKey: string;
    chatType: string;
    senderOpenId?: string;
  }>;
  dispatchSessionToAgent: (
    sessionKey: string,
    chatType: string,
    senderOpenId?: string,
  ) => Promise<void>;
}

/** 工厂：loop / in-flight / scan 锁，经 createOrchestrator 注入 */
export function createOrchestratorDispatch(deps: OrchestratorDispatchDeps) {
  /** 同 session 并行 kickoff 互斥；他 session 仍可推进 */
  const inFlightSessions = new Set<string>();
  /** 仅保护「枚举 + 标记 in-flight + 启动」同步段，禁止跨 launch await */
  let dispatchScanBusy = false;
  let dispatchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function runAgentDispatchLoop(): Promise<void> {
    if (dispatchScanBusy) return;
    dispatchScanBusy = true;
    const kickoffs: Promise<void>[] = [];
    try {
      for (const { sessionKey, chatType, senderOpenId } of deps.getDistinctSessions()) {
        if (inFlightSessions.has(sessionKey)) continue;
        inFlightSessions.add(sessionKey);
        kickoffs.push(
          (async () => {
            try {
              await deps.dispatchSessionToAgent(sessionKey, chatType, senderOpenId);
            } catch (e: unknown) {
              deps.log(
                "ERROR",
                `dispatch kickoff 异常: session=${sessionKey} ${e instanceof Error ? e.message : e}`,
              );
            } finally {
              inFlightSessions.delete(sessionKey);
            }
          })(),
        );
      }
    } catch (e: unknown) {
      deps.log("ERROR", `dispatch loop 异常: ${e instanceof Error ? e.message : e}`);
    } finally {
      // 先释 scan 锁再 fire-and-forget，不跨越 forwardElectronAgentApi await
      dispatchScanBusy = false;
    }
    if (kickoffs.length > 0) {
      deps.log(
        "INFO",
        `dispatch_parallel: kickoffs=${kickoffs.length} inflight=${inFlightSessions.size}`,
      );
      void Promise.allSettled(kickoffs);
    }
  }

  function scheduleAgentDispatch(_sessionKey?: string): void {
    if (dispatchDebounceTimer) clearTimeout(dispatchDebounceTimer);
    dispatchDebounceTimer = setTimeout(() => void runAgentDispatchLoop(), 300);
  }

  return { scheduleAgentDispatch, runAgentDispatchLoop };
}
