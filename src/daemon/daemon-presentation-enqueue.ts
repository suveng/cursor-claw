/**
 * 入队确认、F1/Get 进度与排队文案（从 daemon-presentation-handlers 切出）。
 */
import type { AgentPhase } from "./daemon-orchestrator.js";
import type { SessionProgressState } from "./daemon-presentation-ordering.js";

export interface EnqueueHandlerDeps {
  log: (level: string, ...args: unknown[]) => void;
  sessionProgressMap: Map<string, SessionProgressState>;
  sessionGetReactedIds: Map<string, Set<string>>;
  getSessionAgentPhase: (sessionKey: string) => AgentPhase | undefined;
  getSessionUnclaimedCount: (sessionKey: string) => number;
  resolveChannel: (sessionKey: string) =>
    | { type: "wechat"; rt: { wechat?: { startProgressTyping: (chatId: string) => Promise<void> } }; chatId: string }
    | { type: "feishu" }
    | { type: "error"; message: string };
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
  addReactionToMessages: (messageIds: string[], sessionKey: string, emojiType?: string) => void;
}

export interface EnqueueHandlerApi {
  buildEnqueueStatusText: (sessionKey: string, pending: number) => string;
  recordGetReactions: (sessionKey: string, messageIds: string[]) => void;
  clearGetReactions: (sessionKey: string, messageIds: string[]) => void;
  confirmEnqueueAndStartProgress: (messageId: string, sessionKey: string, chatId?: string) => Promise<void>;
}

/** 入队确认与 Get 表情进度 */
export function createEnqueueHandlers(deps: EnqueueHandlerDeps): EnqueueHandlerApi {
  function buildEnqueueStatusText(sessionKey: string, pending: number): string {
    const phase = deps.getSessionAgentPhase(sessionKey) ?? "idle";
    let text: string;
    if (phase === "starting") {
      text = "已收到。正在连接 Agent，你的消息已排队";
    } else if (phase === "processing") {
      text = "已收到。Agent 正在处理上一条，你的消息已排队";
    } else if (pending <= 1) {
      text = "已收到，等待 Agent 领取";
    } else {
      text = "已收到，已加入待处理队列";
    }
    if (pending > 1) text += `（前面还有 ${pending - 1} 条待处理）`;
    return text;
  }

  function getGetReactedIds(sessionKey: string): Set<string> {
    let set = deps.sessionGetReactedIds.get(sessionKey);
    if (!set) {
      set = new Set();
      deps.sessionGetReactedIds.set(sessionKey, set);
    }
    const state = deps.sessionProgressMap.get(sessionKey);
    if (state) state.getReactedMessageIds = set;
    return set;
  }

  function recordGetReactions(sessionKey: string, messageIds: string[]): void {
    const set = getGetReactedIds(sessionKey);
    for (const id of messageIds) {
      if (id) set.add(id);
    }
  }

  function clearGetReactions(sessionKey: string, messageIds: string[]): void {
    const set = deps.sessionGetReactedIds.get(sessionKey);
    if (!set) return;
    for (const id of messageIds) set.delete(id);
    if (set.size === 0) deps.sessionGetReactedIds.delete(sessionKey);
  }

  async function confirmEnqueueAndStartProgress(
    messageId: string,
    sessionKey: string,
    chatId?: string,
  ): Promise<void> {
    const pending = deps.getSessionUnclaimedCount(sessionKey);
    const statusText = buildEnqueueStatusText(sessionKey, pending);
    try {
      await deps.replyToMessage(messageId, statusText, chatId);
    } catch (e: unknown) {
      deps.log("WARN", `入队确认发送失败: ${e instanceof Error ? e.message : e}`);
    }

    let state = deps.sessionProgressMap.get(sessionKey);
    if (!state) {
      state = { typingActive: false };
      deps.sessionProgressMap.set(sessionKey, state);
    }

    const ch = deps.resolveChannel(sessionKey);
    if (ch.type === "wechat") {
      state.typingActive = true;
      ch.rt.wechat!.startProgressTyping(ch.chatId).catch((e: unknown) => {
        deps.log("WARN", `startProgressTyping 失败: ${e instanceof Error ? e.message : e}`);
      });
    } else if (ch.type === "feishu") {
      state.typingActive = true;
      deps.addReactionToMessages([messageId], sessionKey, "Get");
      recordGetReactions(sessionKey, [messageId]);
    }
  }

  return {
    buildEnqueueStatusText,
    recordGetReactions,
    clearGetReactions,
    confirmEnqueueAndStartProgress,
  };
}
