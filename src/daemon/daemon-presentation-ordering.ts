/**
 * Presentation 时序编排（PRESENTATION_ORDERING）与 eligible 门控。
 * 从 daemon.ts 垂直切出，供 presentation handlers 经 deps 消费，避免与 HTTP/orchestrator 互引。
 */

import type { PresentationCardState } from "../bridge/lark-core.js";
import { streamTextThrottleMs, createOrderingEligibleApi } from "./daemon-presentation-ordering-eligible.js";
import { createOrderingReleaseApi } from "./daemon-presentation-ordering-release.js";

/** 工具卡状态：缓存 shell 命令供 completed PATCH（挂接 SessionProgressState） */
export interface ToolProgressCardState extends PresentationCardState {
  shellCommand?: string;
  shellCwd?: string;
  shellOutput?: string;
}

/** 会话进行中指示状态（流式 + ordering + 里程碑字段） */
export interface SessionProgressState {
  typingActive: boolean;
  outboundMessageId?: string;
  streamId?: string;
  streamLastText?: string;
  streamLastPushAt?: number;
  streamPatchMode?: boolean;
  streamSentLength?: number;
  cardId?: string;
  elementId?: string;
  cardSequence?: number;
  streamCardKitMode?: boolean;
  getReactedMessageIds?: Set<string>;
  toolCards?: Map<string, ToolProgressCardState>;
  thinkingCardEntityId?: string;
  thinkingCardMessageId?: string;
  thinkingCardSequence?: number;
  thinkingBuffer?: string;
  thinkingLastPushAt?: number;
  presentationAssistantAccum?: string;
  presentationProcessActive?: boolean;
  activeToolNames?: Set<string>;
  thinkingOpen?: boolean;
  deferredAssistantText?: string;
  assistantCardReleased?: boolean;
  assistantReleaseChain?: Promise<void>;
  runPresentationEpoch?: number;
  lastMilestoneText?: string;
  lastMilestoneAt?: number;
  milestoneDedupSet?: Set<string>;
}

/** 通道运行时最小字段（ordering eligible 判定用，避免 import daemon） */
export interface OrderingChannelRuntime {
  cfg: {
    type: string;
    mainUserEnabled?: boolean;
    mainUserChatId?: string;
    allowOthers?: boolean;
  };
}

export interface PresentationOrderingDeps {
  log: (level: string, ...args: unknown[]) => void;
  sessionChatTypeMap: Map<string, string>;
  listUnclaimedMessages: (sessionKey: string) => Array<{ meta?: { chatType?: string } }>;
  resolveChannelRuntime: (
    sessionKey: string,
  ) => { rt: OrderingChannelRuntime; rawKey: string; chatId: string } | null;
  isWechatChatId: (rawChatId?: string) => rawChatId is string;
  resolveChannel: (
    sessionKey: string,
  ) =>
    | { type: "wechat"; rt: { wechat?: { sendText: (chatId: string, text: string, opts: { skipTyping: boolean }) => Promise<boolean> } }; chatId: string }
    | { type: "feishu"; rt: { sender?: { sendMessage: (text: string, replyId: string | undefined, chatId: string | undefined, title?: string) => Promise<string | undefined>; sendStreamMessage: (text: string, chatId?: string, title?: string) => Promise<string | undefined> } } }
    | { type: "error"; message: string };
  extractWorkspaceTitle: (sessionKey?: string) => string | undefined;
  getPresentationReplyAnchor: (sessionKey: string) => string | undefined;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  sessionLastReplyAt: Map<string, number>;
  ackOnReply: (messageId?: string, sessionKey?: string) => void;
  stopSessionProgress: (sessionKey: string) => void;
  logPresentationFailed: (sessionKey: string, kind: string, reason: string) => void;
}

export interface PresentationOrderingApi {
  streamTextThrottleMs: () => number;
  rememberSessionChatType: (sessionKey: string, chatType: string) => void;
  resolveSessionChatType: (sessionKey: string) => string | undefined;
  presentationOrderingEnabled: (sessionKey: string) => boolean;
  resetPresentationOrderingFields: (state: SessionProgressState) => void;
  isMainUserP2pEligible: (sessionKey: string) => boolean;
  isStreamTextEligible: (sessionKey: string) => boolean;
  isPresentationEligible: (sessionKey: string) => boolean;
  isFeishuProcessPresentationSuppressed: (sessionKey: string, kind: string) => boolean;
  isWechatPresentationSession: (sessionKey: string) => boolean;
  logPresentationOrderViolation: (ctx: {
    sessionKey: string;
    streamId?: string;
    assistantMsgId: string;
    processKind: string;
    processMsgId?: string;
    orderingEnabled: boolean;
  }) => void;
  enqueueReleaseDeferredAssistantStream: (
    sessionKey: string,
    state: SessionProgressState,
    opts?: { force?: boolean; final?: boolean; message_id?: string },
  ) => Promise<void>;
}

export function createPresentationOrdering(deps: PresentationOrderingDeps): PresentationOrderingApi {
  const eligible = createOrderingEligibleApi(deps);
  const release = createOrderingReleaseApi({
    orderingDeps: deps,
    isPresentationProcessIdle: eligible.isPresentationProcessIdle,
  });

  return {
    streamTextThrottleMs,
    rememberSessionChatType: eligible.rememberSessionChatType,
    resolveSessionChatType: eligible.resolveSessionChatType,
    presentationOrderingEnabled: eligible.presentationOrderingEnabled,
    resetPresentationOrderingFields: eligible.resetPresentationOrderingFields,
    isMainUserP2pEligible: eligible.isMainUserP2pEligible,
    isStreamTextEligible: eligible.isStreamTextEligible,
    isPresentationEligible: eligible.isPresentationEligible,
    isFeishuProcessPresentationSuppressed: eligible.isFeishuProcessPresentationSuppressed,
    isWechatPresentationSession: eligible.isWechatPresentationSession,
    logPresentationOrderViolation: eligible.logPresentationOrderViolation,
    enqueueReleaseDeferredAssistantStream: release.enqueueReleaseDeferredAssistantStream,
  };
}
