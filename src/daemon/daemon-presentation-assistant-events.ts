/**
 * assistant/task/merge presentation-event 路由（从 daemon.ts 抽出）。
 */
import { sendMilestoneText } from "./daemon-presentation-milestone.js";
import type { PresentationEvent, PresentationHandlerCtx } from "./daemon-presentation-types.js";

export function createAssistantPresentationHandlers(ctx: PresentationHandlerCtx) {
  async function handleAssistantPresentationEvent(
    event: PresentationEvent,
  ): Promise<{ ok: boolean; outbound_message_id?: string; error?: string }> {
    const sessionKey = event.session_key?.trim();
    if (!sessionKey) return { ok: false, error: "session_key is required" };
    if (!ctx.ordering.isPresentationEligible(sessionKey)) {
      return { ok: false, error: "presentation not supported for this session" };
    }

    let state = ctx.sessionProgressMap.get(sessionKey);
    if (!state) {
      state = { typingActive: false };
      ctx.sessionProgressMap.set(sessionKey, state);
    }
    if (event.delta) {
      state.presentationAssistantAccum = (state.presentationAssistantAccum ?? "") + event.delta;
    }
    const text = state.presentationAssistantAccum ?? event.delta ?? "";
    if (!text.trim() && !event.final) {
      return { ok: true, outbound_message_id: event.outbound_message_id ?? state.outboundMessageId };
    }

    const result = await ctx.handleStreamText({
      session_key: sessionKey,
      text,
      stream_id: state.streamId,
      outbound_message_id: event.outbound_message_id ?? state.outboundMessageId,
      final: event.final,
    });
    if (!result.ok) {
      ctx.logPresentationFailed(sessionKey, "assistant", result.error ?? "stream-text failed");
    }
    return result;
  }

  /** task_status 兜底文案（task_text 缺失时；与 Electron mapTaskMilestoneText 对齐） */
  function buildTaskFallbackText(taskStatus?: string): string {
    const normalized = (taskStatus ?? "").toLowerCase();
    if (!normalized || normalized === "started") return "子任务已开始";
    if (normalized === "completed") return "子任务已完成";
    if (normalized === "failed") return "子任务失败";
    return `子任务更新（${taskStatus}）`;
  }

  async function handleTaskPresentationEvent(
    event: PresentationEvent,
  ): Promise<{ ok: boolean; error?: string }> {
    const sessionKey = event.session_key?.trim();
    if (!sessionKey) return { ok: false, error: "session_key is required" };
    if (!ctx.ordering.isPresentationEligible(sessionKey)) {
      return { ok: false, error: "presentation not supported for this session" };
    }

    const text = (event.task_text ?? "").trim() || buildTaskFallbackText(event.task_status);
    if (!text) return { ok: false, error: "task_text is required" };

    let state = ctx.sessionProgressMap.get(sessionKey);
    if (!state) {
      state = { typingActive: false };
      ctx.ordering.resetPresentationOrderingFields(state);
      ctx.sessionProgressMap.set(sessionKey, state);
    }

    const ordering = ctx.ordering.presentationOrderingEnabled(sessionKey);
    const sent = await sendMilestoneText(
      sessionKey,
      "task",
      text,
      state,
      ctx.sendMilestonePlainText,
      ctx.milestoneLogFn,
    );
    // task 只置 presentationProcessActive，不维护 thinkingOpen/activeToolNames，不单独 release
    if (ordering && sent) {
      state.presentationProcessActive = true;
    }
    return { ok: true };
  }

  async function handleMergeBatchPresentationEvent(
    event: PresentationEvent,
  ): Promise<{ ok: boolean; outbound_message_id?: string; error?: string }> {
    const sessionKey = event.session_key?.trim();
    if (!sessionKey) return { ok: false, error: "session_key is required" };

    const batch = ctx.mergeBatchBySession.get(sessionKey);
    if (!batch || ctx.isTerminalMergePhase(batch.phase)) {
      return { ok: false, error: "no active merge batch" };
    }

    try {
      await ctx.renderMergeBatchCardForSession(batch);
      return { ok: true, outbound_message_id: batch.cardMessageId };
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      ctx.logPresentationFailed(sessionKey, "merge_batch", reason);
      return { ok: false, error: reason };
    }
  }

  return {
    handleAssistantPresentationEvent,
    handleTaskPresentationEvent,
    handleMergeBatchPresentationEvent,
  };
}
