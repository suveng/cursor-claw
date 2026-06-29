/**
 * Claude Agent Presentation 时序编排
 * 对称 agent-sdk PRESENTATION_ORDERING；从 agent-cc-stream 拆出以满足单文件 ≤300 行。
 */
import type { CcSessionAgent } from "./agent-cc-types"
import {
  presentationOrderingEligible,
  shouldDeferCcAssistantPost,
} from "./agent-cc-utils"
import {
  clearStreamPostTimer,
  scheduleStreamPost,
  flushStreamPost,
} from "./agent-cc-stream"

/** 流式推送间隔（与 agent-cc-stream 一致） */
const STREAM_POST_INTERVAL_MS = 400

/** 首包未见过程事件时短窗等待 tool/thinking */
function scheduleCcPreambleRelease(session: CcSessionAgent): void {
  if (!session.f41Stream) return
  clearStreamPostTimer(session)
  session.streamPostTimer = setTimeout(() => {
    session.streamPostTimer = undefined
    if (shouldDeferCcAssistantPost(session)) return
    scheduleStreamPost(session, false)
  }, STREAM_POST_INTERVAL_MS)
}

/** Presentation 编排-aware 的 assistant delta 追加 */
export function appendCcAssistantStreamDelta(session: CcSessionAgent, delta: string): void {
  session.streamBuffer += delta
  if (shouldDeferCcAssistantPost(session)) return
  const awaitingFirst = presentationOrderingEligible(session)
    && !session.outboundMessageId && !session.seenProcessEvent
  if (awaitingFirst) { scheduleCcPreambleRelease(session); return }
  scheduleStreamPost(session, false)
}

/** 过程事件结束后释放延迟的 assistant 流 */
export async function flushDeferredStreamPost(session: CcSessionAgent): Promise<void> {
  if (!session.streamBuffer.trim()) return
  await flushStreamPost(session, false)
}

/** thinking/tool 完成后尝试释放延迟 assistant 流 */
export function maybeReleaseDeferredAssistant(session: CcSessionAgent): void {
  if (!presentationOrderingEligible(session) || !session.seenProcessEvent) return
  void flushDeferredStreamPost(session)
}
