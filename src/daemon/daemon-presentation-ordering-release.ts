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

      if (ch.type === "wechat") {
        const ok = await ch.rt.wechat!.sendText(ch.chatId, text, { skipTyping: true });
        if (!ok) {
          state.assistantCardReleased = false;
          deps.logPresentationFailed(sessionKey, "assistant", "微信发送失败");
          return;
        }
        outId = `wx_stream_${sid}`;
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

      if (opts?.final) {
        if (opts.message_id) {
          deps.ackOnReply(opts.message_id, sessionKey);
        } else {
          deps.stopSessionProgress(sessionKey);
        }
      }
    } catch (e) {
      state.assistantCardReleased = false;
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
