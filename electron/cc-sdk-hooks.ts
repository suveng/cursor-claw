/**
 * Claude Agent SDK hooks 工厂与 UI 日志格式化
 * 供 buildQueryOptions 注入 options.hooks，刷新 watchdog 活动时钟。
 */
import type { HookCallback, HookEvent, HookInput, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk"
import type { CcSessionAgent } from "./agent-cc-types"
import { pushUiLog } from "./ui-logger"

/** hooks 工厂依赖；不 import agent-claude-sdk，避免循环依赖 */
export type CcSdkHooksDeps = {
  session: CcSessionAgent
  markActivity: (s: CcSessionAgent, source: string) => void
}

/** CC 前缀 hook UI 日志字段 */
export type CcHookUiLogInfo = {
  hook_event: string
  agent_type?: string
  tool_name?: string
  hook_name?: string
}

/** 格式化 CC hook UI 日志行 */
export function formatCcHookUiLog(sessionKey: string, info: CcHookUiLogInfo): string {
  const parts = [`[${sessionKey}]`, `hook_event=${info.hook_event}`]
  if (info.hook_name) parts.push(`hook_name=${info.hook_name}`)
  if (info.agent_type) parts.push(`agent_type=${info.agent_type}`)
  if (info.tool_name) parts.push(`tool_name=${info.tool_name}`)
  return parts.join(" ")
}

/** 从 HookInput 提取可观测字段（仅 SDK 实际存在的字段） */
function extractHookFields(input: HookInput): CcHookUiLogInfo {
  const info: CcHookUiLogInfo = { hook_event: input.hook_event_name }
  if (input.agent_type) info.agent_type = input.agent_type
  if ("tool_name" in input && typeof input.tool_name === "string") {
    info.tool_name = input.tool_name
  }
  return info
}

/** 单事件 hook 回调：刷新活动时钟 + UI 日志，不阻断工具 */
function makeHookCallback(deps: CcSdkHooksDeps, eventName: HookEvent): HookCallback {
  return async (input) => {
    deps.markActivity(deps.session, `hook:${eventName}`)
    pushUiLog("CC", "INFO", formatCcHookUiLog(deps.session.sessionKey, extractHookFields(input)))
    return { continue: true }
  }
}

/** 构建 SDK query options.hooks 表 */
export function buildCcSdkHooks(deps: CcSdkHooksDeps): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const matcher = (eventName: HookEvent): HookCallbackMatcher => ({
    hooks: [makeHookCallback(deps, eventName)],
  })
  return {
    SubagentStart: [matcher("SubagentStart")],
    PreToolUse: [matcher("PreToolUse")],
    PostToolUse: [matcher("PostToolUse")],
  }
}
