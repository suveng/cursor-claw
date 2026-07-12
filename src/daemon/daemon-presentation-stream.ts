/**
 * stream-text 出站与分段降级（从 daemon.ts 抽出）。
 */
import { randomUUID } from "node:crypto";
import type { SessionProgressState } from "./daemon-presentation-ordering.js";
import type { PresentationOrderingApi } from "./daemon-presentation-ordering.js";

/** 流式通道解析结果（最小字段，避免 import daemon ChannelRuntime） */
export type StreamChannel =
  | { type: "wechat"; rt: { wechat?: { sendText: (chatId: string, text: string, opts: { skipTyping: boolean }) => Promise<{ ok: boolean; outboundId?: string }> } }; chatId: string }
  | { type: "feishu"; rt: { sender?: { sendMessage: (text: string, replyId: string | undefined, chatId: string | undefined, title?: string) => Promise<string | undefined>; sendStreamMessage: (text: string, chatId?: string, title?: string) => Promise<string | undefined>; updateMessageContent: (msgId: string, text: string, title?: string) => Promise<boolean> } }; chatId?: string };

export interface StreamHandlerDeps {
  log: (level: string, ...args: unknown[]) => void;
  sessionProgressMap: Map<string, SessionProgressState>;
  sessionLastReplyAt: Map<string, number>;
  ordering: PresentationOrderingApi;
  resolveChannel: (sessionKey: string) => StreamChannel | { type: "error"; message: string };
  extractWorkspaceTitle: (sessionKey?: string) => string | undefined;
  getPresentationReplyAnchor: (sessionKey: string) => string | undefined;
  trackMessageSession: (messageId: string, sessionKey: string) => void;
  ackOnReply: (messageId?: string, sessionKey?: string) => void;
  stopSessionProgress: (sessionKey: string) => void;
}

export function createStreamTextHandler(deps: StreamHandlerDeps) {
  const {
    log, sessionProgressMap, sessionLastReplyAt, ordering,
    resolveChannel, extractWorkspaceTitle, getPresentationReplyAnchor,
    trackMessageSession, ackOnReply, stopSessionProgress,
  } = deps;

async function sendStreamSegments(
  ch: StreamChannel,
  state: SessionProgressState,
  text: string,
  sessionKey: string,
  title: string | undefined,
  final: boolean,
): Promise<void> {
  const sentLen = state.streamSentLength ?? 0;
  if (text.length <= sentLen && !final) return;

  let delta = text.slice(sentLen);
  if (!final && delta.length > 0) {
    const lastParaBreak = delta.lastIndexOf("\n\n");
    if (lastParaBreak > 0) {
      delta = delta.slice(0, lastParaBreak);
    } else if (lastParaBreak === -1 && !text.endsWith("\n\n")) {
      return;
    }
  }
  if (!delta.trim()) {
    if (final && sentLen < text.length) delta = text.slice(sentLen);
    else return;
  }

  if (ch.type === "wechat") {
    const result = await ch.rt.wechat!.sendText(ch.chatId, delta, { skipTyping: true });
    if (result.outboundId) trackMessageSession(result.outboundId, sessionKey);
  } else {
    const segId = await ch.rt.sender!.sendMessage(delta, undefined, ch.chatId, title);
    if (segId) trackMessageSession(segId, sessionKey);
  }
  state.streamSentLength = sentLen + delta.length;
  state.streamLastPushAt = Date.now();
  state.streamLastText = text.slice(0, state.streamSentLength);
}
async function handleStreamText(body: {
  session_key?: string;
  text?: string;
  stream_id?: string;
  outbound_message_id?: string;
  message_id?: string;
  final?: boolean;
}): Promise<{ ok: boolean; stream_id?: string; outbound_message_id?: string; deferred?: boolean; error?: string }> {
  const { session_key, text, stream_id, outbound_message_id, message_id, final } = body;
  if (!session_key || text === undefined || text === "") {
    return { ok: false, error: "session_key and text are required" };
  }
  if (!ordering.isStreamTextEligible(session_key)) {
    return { ok: false, error: "stream-text not supported for this session" };
  }

  const ch = resolveChannel(session_key);
  if (ch.type === "error") return { ok: false, error: ch.message };

  let state = sessionProgressMap.get(session_key);
  if (!state) {
    state = { typingActive: false };
    ordering.resetPresentationOrderingFields(state);
    sessionProgressMap.set(session_key, state);
  }

  const orderingOn = ordering.presentationOrderingEnabled(session_key);
  if (!outbound_message_id && !stream_id) {
    ordering.resetPresentationOrderingFields(state);
  }

  if (stream_id && state.streamId && stream_id !== state.streamId) {
    return { ok: false, error: "stream_id mismatch" };
  }
  const sid = stream_id ?? state.streamId ?? randomUUID();
  state.streamId = sid;

  let outIdHint = outbound_message_id ?? state.outboundMessageId;
  let isFirst = !outIdHint;
  const now = Date.now();
  const throttle = ordering.streamTextThrottleMs();
  const forceSend = !!final || isFirst;
  if (!forceSend && state.streamLastPushAt != null && now - state.streamLastPushAt < throttle) {
    return { ok: true, stream_id: sid, outbound_message_id: state.outboundMessageId };
  }
  if (!forceSend && state.streamLastText === text) {
    return { ok: true, stream_id: sid, outbound_message_id: state.outboundMessageId };
  }

  if (orderingOn) {
    // Rev2 end-only + T-FIX-4：飞行窗口门控 — release 已占位但 outbound 尚未写入时，等待 chain 完成再判 isFirst
    if (state.assistantCardReleased && !state.outboundMessageId) {
      await (state.assistantReleaseChain ?? Promise.resolve());
      outIdHint = outbound_message_id ?? state.outboundMessageId;
      isFirst = !outIdHint;
      if (!state.outboundMessageId && !final) {
        return { ok: true, stream_id: sid, deferred: true };
      }
    }
    // Rev2 end-only：含过程 Run 过程未结束前仅累积 defer 缓冲，禁止 mid-run 首建 CardKit
    state.deferredAssistantText = text;
    if (!final && !state.outboundMessageId && state.presentationProcessActive) {
      return { ok: true, stream_id: sid, deferred: true };
    }
    // Rev2 end-only：final 经 T-FIX-1 assistantReleaseChain 首建 + 完结
    if (!state.assistantCardReleased && final && state.presentationProcessActive) {
      await ordering.enqueueReleaseDeferredAssistantStream(session_key, state, { force: true, final: true, message_id });
      return { ok: true, stream_id: sid, outbound_message_id: state.outboundMessageId };
    }
    if (!state.assistantCardReleased && final) {
      await ordering.enqueueReleaseDeferredAssistantStream(session_key, state, { force: true });
      isFirst = !state.outboundMessageId;
    }
  }

  const title = extractWorkspaceTitle(session_key);
  let outId = outIdHint;

  /** final：成功可 ack；终态必停（与 send-image/file 双调对齐；ack 空集早退时仍 stop） */
  const finishFinal = (mode: "ack-or-stop" | "stop-only" = "ack-or-stop"): void => {
    if (!final) return;
    if (mode === "ack-or-stop" && message_id) ackOnReply(message_id, session_key);
    // stop 幂等：ackOnReply 已 stop 时无 state 早退；空集漏 stop 由此兜底
    stopSessionProgress(session_key);
  };

  if (isFirst) {
    if (ch.type === "wechat") {
      const result = await ch.rt.wechat!.sendText(ch.chatId, text, { skipTyping: true });
      if (!result.ok) {
        finishFinal("stop-only");
        return { ok: false, error: "微信发送失败" };
      }
      outId = result.outboundId ?? `wx_stream_${sid}`;
      if (result.outboundId) trackMessageSession(result.outboundId, session_key);
      state.streamPatchMode = false;
      state.outboundMessageId = outId;
      state.streamLastText = text;
      state.streamSentLength = text.length;
      state.streamLastPushAt = now;
      if (orderingOn) state.assistantCardReleased = true;
    } else {
      // 飞书 plain text 流式：首包 send + 后续 updateMessageContent
      const replyAnchor = orderingOn ? getPresentationReplyAnchor(session_key) : undefined;
      if (replyAnchor) {
        outId = await ch.rt.sender!.sendMessage(text, replyAnchor, undefined, title);
      } else {
        outId = await ch.rt.sender!.sendStreamMessage(text, ch.chatId, title);
      }
      if (!outId) {
        finishFinal("stop-only");
        return { ok: false, error: "飞书发送失败" };
      }
      state.streamPatchMode = true;
      state.outboundMessageId = outId;
      trackMessageSession(outId, session_key);
      state.streamLastText = text;
      state.streamSentLength = text.length;
      state.streamLastPushAt = now;
      if (orderingOn) state.assistantCardReleased = true;
    }
  } else {
    outId = outId ?? state.outboundMessageId;
    if (!outId) {
      finishFinal("stop-only");
      return { ok: false, error: "missing outbound_message_id" };
    }

    if (ch.type === "feishu" && state.streamPatchMode !== false) {
      const patched = await ch.rt.sender!.updateMessageContent(outId, text, title);
      if (patched) {
        state.streamLastText = text;
        state.streamLastPushAt = now;
        state.streamSentLength = text.length;
      } else {
        state.streamPatchMode = false;
        log("INFO", `飞书 text update 不可用，降级分段发送: session=${session_key}`);
        await sendStreamSegments(ch, state, text, session_key, title, !!final);
      }
    } else {
      await sendStreamSegments(ch, state, text, session_key, title, !!final);
    }
  }

  sessionLastReplyAt.set(session_key, Date.now());
  finishFinal("ack-or-stop");
  return { ok: true, stream_id: sid, outbound_message_id: outId };
}

  return { handleStreamText };
}
