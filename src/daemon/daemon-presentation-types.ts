/**
 * Presentation 事件与 handlers 共享类型（避免 handlers/events 循环 import）。
 */

import type { QueueMessageMeta } from "../bridge/file-queue.js";
import type { AgentPhase } from "./daemon-orchestrator.js";
import type { PresentationOrderingApi, SessionProgressState } from "./daemon-presentation-ordering.js";

export type PresentationKind = "assistant" | "thinking" | "tool" | "diff" | "merge_batch" | "task";

export interface PresentationEvent {
  session_key: string;
  kind: PresentationKind;
  delta?: string;
  tool_name?: string;
  tool_status?: "started" | "completed" | "failed";
  tool_shell_command?: string;
  tool_shell_cwd?: string;
  tool_shell_output?: string;
  tool_task_description?: string;
  tool_file_path?: string;
  task_status?: string;
  task_text?: string;
  final?: boolean;
  outbound_message_id?: string;
}

/** 子 handler 共享运行时上下文（由 createPresentationHandlers 组装） */
export interface PresentationHandlerCtx {
  log: (level: string, ...args: unknown[]) => void;
  ordering: PresentationOrderingApi;
  sessionProgressMap: Map<string, SessionProgressState>;
  sessionGetReactedIds: Map<string, Set<string>>;
  sessionLastReplyAt: Map<string, number>;
  mergeBatchBySession: ReadonlyMap<string, {
    sessionKey?: string;
    phase: string;
    batchId: string;
    overrideText?: string;
    lastInboundMessageId?: string;
    cardMessageId?: string;
    updatedAt: number;
  }>;
  mergeCardRegistry: ReadonlyMap<string, { sessionKey: string; batchId: string }>;
  getSessionAgentPhase: (sessionKey: string) => AgentPhase | undefined;
  getSessionUnclaimedCount: (sessionKey: string) => number;
  getSessionPendingCount: (sessionKey: string) => number;
  listUnclaimedMessages: (sessionKey: string) => Array<{ text: string }>;
  replaceSessionUnclaimedMessages: (
    sessionKey: string,
    text: string,
    meta: QueueMessageMeta,
  ) => { ok: boolean; error?: string };
  formatMergeBody: (messages: Array<{ text: string }>) => string;
  isTerminalMergePhase: (phase: string) => boolean;
  renderMergeBatchCardForSession: (batch: {
    sessionKey?: string;
    phase: string;
    batchId?: string;
    overrideText?: string;
    lastInboundMessageId?: string;
    cardMessageId?: string;
    updatedAt?: number;
  }) => Promise<void>;
  replyToMessage: (messageId: string, text: string, chatId?: string) => Promise<void>;
  addReactionToMessages: (messageIds: string[], sessionKey: string, emojiType?: string) => void;
  resolveChannel: (
    sessionKey: string,
  ) =>
    | { type: "wechat"; rt: { wechat?: { sendText: (chatId: string, text: string, opts: { skipTyping: boolean }) => Promise<boolean>; startProgressTyping: (chatId: string) => Promise<void>; stopProgressTyping: (chatId: string) => Promise<void> } }; chatId: string }
    | { type: "feishu"; rt: { sender?: { sendMessage: (text: string, replyId: string | undefined, chatId: string | undefined, title?: string) => Promise<string | undefined>; renderToolProgressCard: (...args: unknown[]) => Promise<{ cardMessageId: string; cardEntityId: string; cardSequence: number } | null>; renderThinkingCard: (...args: unknown[]) => Promise<{ cardMessageId: string; cardEntityId: string; cardSequence: number } | null> } }; chatId?: string }
    | { type: "error"; message: string };
  extractWorkspaceTitle: (sessionKey?: string) => string | undefined;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  sendMilestonePlainText: (sessionKey: string, text: string) => Promise<boolean>;
  milestoneLogFn: (message: string) => void;
  getPresentationReplyAnchor: (sessionKey: string) => string | undefined;
  logPresentationFailed: (sessionKey: string, kind: string, reason: string) => void;
  handleStreamText: (body: {
    session_key?: string;
    text?: string;
    stream_id?: string;
    outbound_message_id?: string;
    message_id?: string;
    final?: boolean;
  }) => Promise<{ ok: boolean; stream_id?: string; outbound_message_id?: string; deferred?: boolean; error?: string }>;
}

export const MERGE_EDIT_MAX_CHARS = 30000;
export const THINKING_SUMMARY_MAX_CHARS = 800;
