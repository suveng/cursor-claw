/**
 * tool/thinking presentation-event 处理（从 daemon.ts 抽出）。
 */
import { formatToolMilestoneText, mergeShellToolDetail, normalizePresentationToolName, shouldSuppressToolStartedPresentation } from "../shared/tool-presentation.js";
import { sendMilestoneText } from "./daemon-presentation-milestone.js";
import { THINKING_SUMMARY_MAX_CHARS } from "./daemon-presentation-types.js";
import type { PresentationEvent, PresentationHandlerCtx } from "./daemon-presentation-types.js";

export function createProcessPresentationHandlers(ctx: PresentationHandlerCtx) {
  async function handleToolPresentationEvent(
    event: PresentationEvent,
  ): Promise<{ ok: boolean; outbound_message_id?: string; error?: string }> {
    const sessionKey = event.session_key?.trim();
    if (!sessionKey) return { ok: false, error: "session_key is required" };
    if (!event.tool_name?.trim()) return { ok: false, error: "tool_name is required" };
    if (!ctx.ordering.isPresentationEligible(sessionKey)) {
      return { ok: false, error: "presentation not supported for this session" };
    }
    const toolName = normalizePresentationToolName(event.tool_name.trim());
    const status = event.tool_status ?? "started";

    let state = ctx.sessionProgressMap.get(sessionKey);
    if (!state) {
      state = { typingActive: false };
      ctx.ordering.resetPresentationOrderingFields(state);
      ctx.sessionProgressMap.set(sessionKey, state);
    }

    if (!state.toolCards) state.toolCards = new Map();

    const ordering = ctx.ordering.presentationOrderingEnabled(sessionKey);

    if (status === "started") {
      state.toolCards.delete(toolName);
    }

    // edit/write/delete：started 仅更新 ordering 闩，不向 IM 发「已开始」
    if (status === "started" && shouldSuppressToolStartedPresentation(toolName)) {
      if (ordering) {
        if (!state.activeToolNames) state.activeToolNames = new Set();
        state.activeToolNames.add(toolName);
        state.presentationProcessActive = true;
      }
      return { ok: true };
    }

    // 飞书抑制 / 微信：不走 CardKit，里程碑文本 + ordering 闩（真实出站后 mirror CardKit）
    if (ctx.ordering.isFeishuProcessPresentationSuppressed(sessionKey, "tool") || ctx.ordering.isWechatPresentationSession(sessionKey)) {
      const formattedText = formatToolMilestoneText(
        toolName,
        status,
        {
          tool_shell_command: event.tool_shell_command,
          tool_shell_cwd: event.tool_shell_cwd,
          tool_task_description: event.tool_task_description,
          tool_file_path: event.tool_file_path,
        },
      );
      const sent = await sendMilestoneText(
        sessionKey,
        "tool",
        formattedText,
        state,
        ctx.sendMilestonePlainText,
        ctx.milestoneLogFn,
      );
      if (ordering && sent) {
        if (!state.activeToolNames) state.activeToolNames = new Set();
        if (status === "started") {
          state.activeToolNames.add(toolName);
          state.presentationProcessActive = true;
        } else if (status === "completed" || status === "failed") {
          state.activeToolNames.delete(toolName);
        }
      }
      if (sent) ctx.notePresentationOutbound?.(sessionKey);
      // Rev2 end-only：过程 idle 不再 mid-run release assistant，仅更新闩锁
      return { ok: true };
    }

    // CardKit 路径：ordering 闩与 activeToolNames 仅在此处更新
    if (ordering) {
      if (!state.activeToolNames) state.activeToolNames = new Set();
      if (status === "started") {
        state.activeToolNames.add(toolName);
        state.presentationProcessActive = true;
      } else if (status === "completed" || status === "failed") {
        state.activeToolNames.delete(toolName);
      }
    }

    const ch = ctx.resolveChannel(sessionKey);
    if (ch.type !== "feishu" || !ch.rt.sender || !ch.chatId) {
      ctx.logPresentationFailed(sessionKey, "tool", "feishu channel unavailable");
      return { ok: false, error: "feishu channel required" };
    }

    const toolCard = status !== "started" ? state.toolCards.get(toolName) : undefined;
    const outHint = event.outbound_message_id ?? toolCard?.cardMessageId;
    const existing =
      toolCard && outHint
        ? { ...toolCard, cardMessageId: outHint }
        : undefined;

    const replyAnchor = existing ? undefined : ctx.getPresentationReplyAnchor(sessionKey);

    const shellDetail = mergeShellToolDetail(
      event.tool_shell_command
        ? {
          tool_shell_command: event.tool_shell_command,
          tool_shell_cwd: event.tool_shell_cwd,
          tool_shell_output: event.tool_shell_output,
        }
        : undefined,
      toolCard
        ? {
          command: toolCard.shellCommand,
          cwd: toolCard.shellCwd,
          output: toolCard.shellOutput,
        }
        : undefined,
    );

    try {
      const result = await ch.rt.sender.renderToolProgressCard(
        ch.chatId,
        toolName,
        status,
        existing,
        replyAnchor,
        shellDetail,
      );
      if (!result) {
        ctx.logPresentationFailed(sessionKey, "tool", "CardKit render failed");
        return { ok: false, error: "tool card render failed" };
      }
      if (!existing && (state.outboundMessageId || state.assistantCardReleased)) {
        ctx.ordering.logPresentationOrderViolation({
          sessionKey,
          streamId: state.streamId,
          assistantMsgId: state.outboundMessageId ?? "",
          processKind: "tool",
          processMsgId: result.cardMessageId,
          orderingEnabled: ordering,
        });
      }
      state.toolCards.set(toolName, {
        ...result,
        shellCommand: shellDetail?.command,
        shellCwd: shellDetail?.cwd,
        shellOutput: shellDetail?.output,
      });
      if (status === "completed" || status === "failed") {
        state.toolCards.delete(toolName);
      }
      ctx.trackMessageSession(result.cardMessageId, sessionKey);
      ctx.notePresentationOutbound?.(sessionKey);
      // Rev2 end-only：过程 idle 不再 mid-run release assistant
      return { ok: true, outbound_message_id: result.cardMessageId };
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      ctx.logPresentationFailed(sessionKey, "tool", reason);
      return { ok: false, error: reason };
    }
  }

  async function handleThinkingPresentationEvent(
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
      ctx.ordering.resetPresentationOrderingFields(state);
      ctx.sessionProgressMap.set(sessionKey, state);
    }

    const ordering = ctx.ordering.presentationOrderingEnabled(sessionKey);

    // 飞书 / 微信：thinking 零 IM 出站（Electron 仍 POST 并 markProcessEventSeen 置闩）
    if (ctx.ordering.isFeishuProcessPresentationSuppressed(sessionKey, "thinking") || ctx.ordering.isWechatPresentationSession(sessionKey)) {
      if (ordering) {
        if (event.delta && !state.thinkingOpen) {
          state.thinkingOpen = true;
          state.presentationProcessActive = true;
        }
        if (event.final) {
          state.thinkingOpen = false;
        }
      }
      return { ok: true };
    }

    // CardKit 路径：ordering 闩与 thinkingOpen 仅在此处更新
    if (ordering) {
      if (event.delta && !state.thinkingOpen) {
        state.thinkingOpen = true;
        state.presentationProcessActive = true;
      }
      if (event.final) {
        state.thinkingOpen = false;
      }
    }

    if (!event.delta) {
      return { ok: true, outbound_message_id: event.outbound_message_id };
    }

    const ch = ctx.resolveChannel(sessionKey);
    if (ch.type !== "feishu" || !ch.rt.sender || !ch.chatId) {
      ctx.logPresentationFailed(sessionKey, "thinking", "feishu channel unavailable");
      return { ok: false, error: "feishu channel required" };
    }

    state.thinkingBuffer = (state.thinkingBuffer ?? "") + event.delta;
    const now = Date.now();
    const throttle = ctx.ordering.streamTextThrottleMs();
    if (!event.final && state.thinkingLastPushAt != null && now - state.thinkingLastPushAt < throttle) {
      return { ok: true, outbound_message_id: state.thinkingCardMessageId ?? event.outbound_message_id };
    }

    const summary = state.thinkingBuffer.length > THINKING_SUMMARY_MAX_CHARS
      ? `…${state.thinkingBuffer.slice(-THINKING_SUMMARY_MAX_CHARS)}`
      : state.thinkingBuffer;

    const outHint = event.outbound_message_id ?? state.thinkingCardMessageId;
    const existing =
      state.thinkingCardEntityId && outHint
        ? {
            cardEntityId: state.thinkingCardEntityId,
            cardMessageId: outHint,
            cardSequence: state.thinkingCardSequence ?? 0,
          }
        : undefined;

    const replyAnchor = existing ? undefined : ctx.getPresentationReplyAnchor(sessionKey);

    try {
      const result = await ch.rt.sender.renderThinkingCard(
        ch.chatId,
        summary,
        existing,
        replyAnchor,
        event.final,
      );
      if (!result) {
        ctx.logPresentationFailed(sessionKey, "thinking", "CardKit render failed");
        return { ok: false, error: "thinking card render failed" };
      }
      if (!existing && (state.outboundMessageId || state.assistantCardReleased)) {
        ctx.ordering.logPresentationOrderViolation({
          sessionKey,
          streamId: state.streamId,
          assistantMsgId: state.outboundMessageId ?? "",
          processKind: "thinking",
          processMsgId: result.cardMessageId,
          orderingEnabled: ordering,
        });
      }
      state.thinkingCardEntityId = result.cardEntityId;
      state.thinkingCardMessageId = result.cardMessageId;
      state.thinkingCardSequence = result.cardSequence;
      state.thinkingLastPushAt = now;
      ctx.trackMessageSession(result.cardMessageId, sessionKey);
      ctx.notePresentationOutbound?.(sessionKey);
      // Rev2 end-only：过程 idle 不再 mid-run release assistant
      return { ok: true, outbound_message_id: result.cardMessageId };
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      ctx.logPresentationFailed(sessionKey, "thinking", reason);
      return { ok: false, error: reason };
    }
  }
  return { handleToolPresentationEvent, handleThinkingPresentationEvent };
}
