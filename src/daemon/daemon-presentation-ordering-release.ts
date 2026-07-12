/**
 * Presentation ordering deferred assistant release 链（从 daemon-presentation-ordering 切出）。
 */
import { randomUUID } from "node:crypto";
import type { PresentationOrderingDeps, SessionProgressState } from "./daemon-presentation-ordering.js";

export interface OrderingReleaseDeps {
  orderingDeps: PresentationOrderingDeps;
  isPresentationProcessIdle: (state: SessionProgressState) => boolean;
}

/** deferred assistant 首建与 release 串行链 */
export function createOrderingReleaseApi(releaseDeps: OrderingReleaseDeps) {
  const { orderingDeps: deps, isPresentationProcessIdle } = releaseDeps;

  async function releaseDeferredAssistantStreamImpl(
    sessionKey: string,
    state: SessionProgressState,
    opts?: { force?: boolean; final?: boolean; message_id?: string },
  ): Promise<void> {
    if (state.assistantCardReleased) return;
    if (!opts?.force && !isPresentationProcessIdle(state)) return;

    const text = state.deferredAssistantText ?? "";
    if (!text.trim() && !opts?.force) return;

    const ch = deps.resolveChannel(sessionKey);
    if (ch.type === "error") return;

    state.assistantCardReleased = true;

    try {
      const title = deps.extractWorkspaceTitle(sessionKey);
      const sid = state.streamId ?? randomUUID();
      state.streamId = sid;
      const now = Date.now();
      let outId: string | undefined;

      /** final：成功可 ack；终态必停（与 send-image/file 双调对齐；ack 空集早退时仍 stop） */
      const finishFinal = (mode: "ack-or-stop" | "stop-only" = "ack-or-stop"): void => {
        if (!opts?.final) return;
        if (mode === "ack-or-stop" && opts.message_id) deps.ackOnReply(opts.message_id, sessionKey);
        // stop 幂等：ackOnReply 已 stop 时无 state 早退；空集漏 stop 由此兜底
        deps.stopSessionProgress(sessionKey);
      };

      if (ch.type === "wechat") {
        const result = await ch.rt.wechat!.sendText(ch.chatId, text, { skipTyping: true });
        if (!result.ok) {
          state.assistantCardReleased = false;
          deps.logPresentationFailed(sessionKey, "assistant", "微信发送失败");
          finishFinal("stop-only");
          return;
        }
        outId = result.outboundId ?? `wx_stream_${sid}`;
        if (result.outboundId) deps.trackMessageSession(result.outboundId, sessionKey);
        state.streamPatchMode = false;
        state.outboundMessageId = outId;
        state.streamLastText = text;
        state.streamSentLength = text.length;
        state.streamLastPushAt = now;
      } else {
        const replyAnchor = deps.getPresentationReplyAnchor(sessionKey);
        if (replyAnchor) {
          outId = await ch.rt.sender!.sendMessage(text, replyAnchor, undefined, title);
        } else {
          outId = await ch.rt.sender!.sendStreamMessage(text, (ch as { chatId?: string }).chatId, title);
        }
        if (!outId) {
          state.assistantCardReleased = false;
          deps.logPresentationFailed(sessionKey, "assistant", "飞书 send 失败");
          finishFinal("stop-only");
          return;
        }
        state.streamPatchMode = true;
        deps.trackMessageSession(outId, sessionKey);
        state.streamLastText = text;
        state.streamSentLength = text.length;
        state.streamLastPushAt = now;
        state.outboundMessageId = outId;
      }

      deps.sessionLastReplyAt.set(sessionKey, now);
      finishFinal("ack-or-stop");
    } catch (e) {
      state.assistantCardReleased = false;
      // final 抛错仅停进度，不 ack
      if (opts?.final) deps.stopSessionProgress(sessionKey);
      throw e;
    }
  }

  function enqueueReleaseDeferredAssistantStream(
    sessionKey: string,
    state: SessionProgressState,
    opts?: { force?: boolean; final?: boolean; message_id?: string },
  ): Promise<void> {
    state.assistantReleaseChain = (state.assistantReleaseChain ?? Promise.resolve())
      .then(() => releaseDeferredAssistantStreamImpl(sessionKey, state, opts))
      .catch((e: unknown) => {
        deps.log(
          "WARN",
          `assistant-release chain 错误 session=${sessionKey}: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    return state.assistantReleaseChain;
  }

  return { enqueueReleaseDeferredAssistantStream };
}
