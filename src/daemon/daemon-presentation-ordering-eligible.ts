/**
 * Presentation ordering eligible 门控与节流（从 daemon-presentation-ordering 切出）。
 */
import {
  isFeishuProcessPresentationSuppressed as feishuSuppressesProcessKind,
} from "../shared/feishu-presentation-gate.js";
import type { OrderingChannelRuntime, PresentationOrderingDeps, SessionProgressState } from "./daemon-presentation-ordering.js";

/** 流式更新节流间隔（ms），默认 1000，可配置范围 500–1500 */
export function streamTextThrottleMs(): number {
  const raw = Number(process.env.STREAM_TEXT_THROTTLE_MS);
  const ms = Number.isFinite(raw) && raw > 0 ? raw : 1000;
  return Math.min(1500, Math.max(500, ms));
}

function presentationOrderingEnvEnabled(): boolean {
  const v = (process.env.PRESENTATION_ORDERING ?? "").trim().toLowerCase();
  if (v === "0" || v === "false") return false;
  return true;
}

/** eligible 门控函数集 */
export function createOrderingEligibleApi(deps: PresentationOrderingDeps) {
  const { sessionChatTypeMap, listUnclaimedMessages, resolveChannelRuntime, isWechatChatId, resolveChannel } = deps;

  function rememberSessionChatType(sessionKey: string, chatType: string): void {
    if (sessionKey && chatType) sessionChatTypeMap.set(sessionKey, chatType);
  }

  function resolveSessionChatType(sessionKey: string): string | undefined {
    const cached = sessionChatTypeMap.get(sessionKey);
    if (cached) return cached;
    const msgs = listUnclaimedMessages(sessionKey);
    const ct = msgs[0]?.meta?.chatType;
    if (ct) rememberSessionChatType(sessionKey, ct);
    return ct;
  }

  function isMainUserP2pEligible(sessionKey: string): boolean {
    const resolved = resolveChannelRuntime(sessionKey);
    if (!resolved) return false;
    const { rt, rawKey, chatId } = resolved;
    if (isWechatChatId(rawKey) && rawKey.includes("@chatroom")) return false;
    if (!rt.cfg.mainUserEnabled || !rt.cfg.mainUserChatId?.trim()) return false;
    return chatId === rt.cfg.mainUserChatId.trim();
  }

  function isStreamTextEligible(sessionKey: string): boolean {
    if (isMainUserP2pEligible(sessionKey)) return true;
    const resolved = resolveChannelRuntime(sessionKey);
    if (!resolved) return false;
    const { rt, rawKey } = resolved;
    if (isWechatChatId(rawKey) && rawKey.includes("@chatroom")) return false;
    if (rt.cfg.type !== "feishu" || !rt.cfg.allowOthers) return false;
    return resolveSessionChatType(sessionKey) === "group";
  }

  function presentationOrderingEnabled(sessionKey: string): boolean {
    if (!presentationOrderingEnvEnabled()) return false;
    return isStreamTextEligible(sessionKey);
  }

  function isPresentationProcessIdle(state: SessionProgressState): boolean {
    return (state.activeToolNames?.size ?? 0) === 0 && !state.thinkingOpen;
  }

  function resetPresentationOrderingFields(state: SessionProgressState): void {
    state.presentationProcessActive = false;
    state.activeToolNames = new Set();
    state.thinkingOpen = false;
    state.deferredAssistantText = "";
    state.assistantCardReleased = false;
    state.assistantReleaseChain = undefined;
    state.runPresentationEpoch = 0;
  }

  function isPresentationEligible(sessionKey: string): boolean {
    return isStreamTextEligible(sessionKey);
  }

  function isFeishuProcessPresentationSuppressed(sessionKey: string, kind: string): boolean {
    const ch = resolveChannel(sessionKey);
    if (ch.type === "error") return false;
    return feishuSuppressesProcessKind(ch.type, kind);
  }

  function isWechatPresentationSession(sessionKey: string): boolean {
    return resolveChannel(sessionKey).type === "wechat";
  }

  function logPresentationOrderViolation(ctx: {
    sessionKey: string;
    streamId?: string;
    assistantMsgId: string;
    processKind: string;
    processMsgId?: string;
    orderingEnabled: boolean;
  }): void {
    deps.log(
      "WARN",
      `presentation_order_violation session_key=${ctx.sessionKey} stream_id=${ctx.streamId ?? ""} assistant_msg_id=${ctx.assistantMsgId} process_kind=${ctx.processKind} process_msg_id=${ctx.processMsgId ?? ""} ordering_enabled=${ctx.orderingEnabled}`,
    );
  }

  return {
    rememberSessionChatType,
    resolveSessionChatType,
    presentationOrderingEnabled,
    resetPresentationOrderingFields,
    isMainUserP2pEligible,
    isStreamTextEligible,
    isPresentationEligible,
    isFeishuProcessPresentationSuppressed,
    isWechatPresentationSession,
    logPresentationOrderViolation,
    isPresentationProcessIdle,
  };
}
