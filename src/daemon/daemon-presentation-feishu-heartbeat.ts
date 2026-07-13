/**
 * 飞书长任务心跳编排：优先 CardKit settings 续期，否则轻量 milestone「仍在处理中…」。
 * 与 sendMilestoneText ≥3s 节流协调；禁止假 SDK turn。
 */
import { LarkCardkitRenewal } from "../bridge/lark-cardkit-renewal.js";
import { sendMilestoneText } from "./daemon-presentation-milestone.js";
import type { SessionProgressState } from "./daemon-presentation-ordering.js";

/** 心跳降级文案（轻量、可识别，勿刷屏） */
export const FEISHU_HEARTBEAT_MILESTONE = "仍在处理中…";

export interface FeishuHeartbeatDeps {
  log: (level: string, ...args: unknown[]) => void;
  sessionProgressMap: Map<string, SessionProgressState>;
  resolveChannel: (sessionKey: string) =>
    | {
        type: "feishu";
        rt: {
          sender?: {
            renewStreamingCardSettings: (cardId: string, sequence: number) => Promise<boolean>;
          };
        };
        chatId?: string;
      }
    | { type: string };
  sendMilestonePlainText: (sessionKey: string, text: string) => Promise<boolean>;
  milestoneLogFn: (message: string) => void;
}

export interface FeishuHeartbeatApi {
  start: (sessionKey: string) => void;
  stop: (sessionKey: string) => void;
  noteOutbound: (sessionKey: string) => void;
}

/** 组装飞书心跳控制器（由 presentation handlers 持有） */
export function createFeishuHeartbeat(deps: FeishuHeartbeatDeps): FeishuHeartbeatApi {
  async function renew(sessionKey: string): Promise<void> {
    const state = deps.sessionProgressMap.get(sessionKey);
    if (!state?.typingActive) return;
    const ch = deps.resolveChannel(sessionKey);
    if (ch.type !== "feishu") return;

    // 优先流式 assistant 卡 settings 续期（用户侧无新消息）
    const sender = ch.rt.sender;
    if (sender && state.streamCardKitMode && state.cardId) {
      const seq = (state.cardSequence ?? 0) + 1;
      if (await sender.renewStreamingCardSettings(state.cardId, seq)) {
        state.cardSequence = seq;
        renewal.noteOutbound(sessionKey);
        return;
      }
    }

    // 其次工具进度卡
    if (sender && state.toolCards && state.toolCards.size > 0) {
      const card = state.toolCards.values().next().value;
      if (card?.cardEntityId) {
        const seq = card.cardSequence + 1;
        if (await sender.renewStreamingCardSettings(card.cardEntityId, seq)) {
          card.cardSequence = seq;
          renewal.noteOutbound(sessionKey);
          return;
        }
      }
    }

    // 思考卡
    if (sender && state.thinkingCardEntityId) {
      const seq = (state.thinkingCardSequence ?? 0) + 1;
      if (await sender.renewStreamingCardSettings(state.thinkingCardEntityId, seq)) {
        state.thinkingCardSequence = seq;
        renewal.noteOutbound(sessionKey);
        return;
      }
    }

    // 无可用 CardKit：轻量里程碑（走 ≥3s 节流 + Run 去重）
    const sent = await sendMilestoneText(
      sessionKey,
      "heartbeat",
      FEISHU_HEARTBEAT_MILESTONE,
      state,
      deps.sendMilestonePlainText,
      deps.milestoneLogFn,
    );
    if (sent) renewal.noteOutbound(sessionKey);
  }

  const renewal = new LarkCardkitRenewal({
    renew,
    log: deps.log,
  });

  return {
    start: (sk) => renewal.start(sk),
    stop: (sk) => renewal.stop(sk),
    noteOutbound: (sk) => renewal.noteOutbound(sk),
  };
}
