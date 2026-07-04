/**
 * 飞书 CardKit 抑制时的里程碑 send-text 降级。
 * 独立模块，不 import daemon.ts；经注入 sendFn 发送，避免循环依赖。
 */

/** 同键节流间隔（ms） */
export const MILESTONE_THROTTLE_MS = 3000;

/** 单次 Run 同文案里程碑上限 */
export const MILESTONE_MAX_PER_RUN = 4;

/** 里程碑降级所需的状态字段（挂接到 daemon SessionProgressState） */
export interface MilestoneState {
  /** 上次发送的节流键：`sessionKey:kind:hash(text)` */
  lastMilestoneText?: string;
  /** 上次里程碑发送时间戳（ms） */
  lastMilestoneAt?: number;
  /** Run 级去重：记录已发送的 `kind:hash#序号` */
  milestoneDedupSet?: Set<string>;
}

/** T5 挂接时与 daemon SessionProgressState 合并 */
export type SessionProgressState = MilestoneState;

/** 注入的发送回调：等价于 send-text 且不带 message_id/stop_progress */
export type MilestoneSendFn = (sessionKey: string, text: string) => Promise<boolean>;

/** 可选 WARN 日志回调（daemon 传入 `log("WARN", ...)` 包装） */
export type MilestoneLogFn = (message: string) => void;

/**
 * djb2 哈希，将长文案压缩为短键。
 * 节流/去重键均基于 hash(text)，避免 lastMilestoneText 存全文。
 */
export function hashMilestoneText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** 节流键：sessionKey + kind + hash(text) */
function buildThrottleKey(sessionKey: string, kind: string, text: string): string {
  return `${sessionKey}:${kind}:${hashMilestoneText(text)}`;
}

/** 去重键：kind + hash(text)（Run 级，不含 sessionKey） */
function buildDedupKey(kind: string, text: string): string {
  return `${kind}:${hashMilestoneText(text)}`;
}

/** 统计本 Run 内同 dedupKey 已发送次数 */
function getDedupCount(state: MilestoneState, dedupKey: string): number {
  const prefix = `${dedupKey}#`;
  let count = 0;
  for (const entry of state.milestoneDedupSet ?? []) {
    if (entry.startsWith(prefix)) count++;
  }
  return count;
}

/**
 * 发送里程碑文本：节流 ≥3s、同文案 ≤4 次/Run。
 * 成功后才更新 state；失败打含 `milestone_fallback` 的 WARN 日志。
 */
export async function sendMilestoneText(
  sessionKey: string,
  kind: string,
  text: string,
  state: MilestoneState,
  sendFn: MilestoneSendFn,
  logFn?: MilestoneLogFn,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || !sessionKey) return;

  const throttleKey = buildThrottleKey(sessionKey, kind, trimmed);
  const now = Date.now();

  // 同节流键 3s 内跳过
  if (
    state.lastMilestoneText === throttleKey &&
    state.lastMilestoneAt !== undefined &&
    now - state.lastMilestoneAt < MILESTONE_THROTTLE_MS
  ) {
    return;
  }

  const dedupKey = buildDedupKey(kind, trimmed);
  if (getDedupCount(state, dedupKey) >= MILESTONE_MAX_PER_RUN) {
    return;
  }

  try {
    const ok = await sendFn(sessionKey, trimmed);
    if (!ok) {
      logFn?.(
        `milestone_fallback session=${sessionKey} kind=${kind} reason=send_rejected`,
      );
      return;
    }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logFn?.(
      `milestone_fallback session=${sessionKey} kind=${kind} reason=send_error error=${errMsg}`,
    );
    return;
  }

  state.lastMilestoneText = throttleKey;
  state.lastMilestoneAt = now;
  if (!state.milestoneDedupSet) state.milestoneDedupSet = new Set();
  state.milestoneDedupSet.add(`${dedupKey}#${getDedupCount(state, dedupKey)}`);
}

/** Run 结束时清空里程碑节流与去重状态 */
export function clearMilestoneState(state: MilestoneState): void {
  state.lastMilestoneText = undefined;
  state.lastMilestoneAt = undefined;
  if (state.milestoneDedupSet) {
    state.milestoneDedupSet.clear();
  }
  delete state.milestoneDedupSet;
}
