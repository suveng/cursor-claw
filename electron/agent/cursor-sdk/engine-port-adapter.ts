/**
 * Cursor SDK Engine Port adapter — 实现 AgentEnginePort 六方法
 */
import type { Run } from "@cursor/sdk"
import { registerEnginePort } from "../shared/agent-engine-port"
import type {
  AgentEnginePort,
  LaunchRequest,
  RunEvent,
  RunTerminalContext,
  WatchdogConfig,
} from "../shared/run-lifecycle-types"
import { getAgentResource, resolveChannelForSession } from "../../config/config-store"
import {
  isOwnTaskChatType,
  resolveLaunchModel,
  resolveLaunchWorkDir,
} from "../shared/launch-request-resolve"
import { completeSdkFailureViaTemplate } from "./sdk-run-finalize"
import { armRunWatchdog } from "./sdk-run-watchdog"
import {
  completeSdkRunViaPort,
  getOrCreateSdkRunLifecycle,
} from "./sdk-run-port-lifecycle"
import type { SdkSessionAgent } from "./sdk-session-types"
import type { ChatType } from "../shared/agent-launcher"

export {
  applySdkStreamRunEvent,
  completeSdkRunViaPort,
  getOrCreateSdkRunLifecycle,
  notifySdkProcessingBusy,
} from "./sdk-run-port-lifecycle"

/** HTTP LaunchRequest → launchSdkAgent（动态 import 破环） */
async function launchSdkFromPortRequest(req: LaunchRequest): Promise<{ ok: boolean; error?: string }> {
  const channel = resolveChannelForSession(req.sessionKey)
  const resource = getAgentResource(channel?.agentResourceId)
  if (resource?.type !== "sdk") {
    return { ok: false, error: "请配置 SDK 资源（设置 → Agent）" }
  }

  const chatType = (req.chatType ?? "p2p") as ChatType
  const isOwnTask = isOwnTaskChatType(chatType)
  if (!req.useMainWorkspace && !isOwnTask && !channel?.allowOthers) {
    return { ok: false, error: `通道「${channel?.name ?? "未知"}」未启用其他人使用` }
  }

  const workDirResult = resolveLaunchWorkDir({
    sessionKey: req.sessionKey,
    chatType,
    explicitDir: req.workspaceDir,
    useMain: req.useMainWorkspace,
    channel,
  })
  if (!workDirResult.ok) return { ok: false, error: workDirResult.error }

  const { model, modelParams } = resolveLaunchModel({
    engine: "sdk",
    resource,
    channel,
    useMain: req.useMainWorkspace,
    chatType,
  })

  const { launchSdkAgent } = await import("./agent-sdk.js")
  return launchSdkAgent({
    sessionKey: req.sessionKey,
    chatType,
    meta: { messageIds: req.messageIds },
    workspaceDir: workDirResult.workDir,
    useMainWorkspace: req.useMainWorkspace,
    senderOpenId: req.senderOpenId,
    chatName: req.chatName,
    taskMessage: req.taskText,
    apiKey: resource.apiKey ?? "",
    model,
    modelParams,
  })
}

/** SDK run.stream → RunEvent 映射（呈现仍由 handleSdkEvent 负责） */
async function* mapSdkRunStream(session: SdkSessionAgent, run: Run): AsyncIterable<RunEvent> {
  yield { type: "run_started" }
  try {
    for await (const ev of run.stream()) {
      if (session.abortController.signal.aborted) break
      if (ev.type === "assistant") {
        for (const block of ev.message.content) {
          if (block.type === "text" && block.text) {
            yield { type: "stream_delta", delta: block.text }
          }
        }
      } else if (ev.type === "thinking" && ev.text) {
        yield { type: "thinking", delta: ev.text, status: "started" }
      } else if (ev.type === "tool_call") {
        yield { type: "tool", toolName: ev.name, status: ev.status }
      } else if (ev.type === "task") {
        yield { type: "task", status: ev.status, text: ev.text, seq: session.taskSeq }
      } else if (ev.type === "status") {
        const isErr = ev.status === "ERROR" || ev.status === "EXPIRED"
        if (isErr) yield { type: "run_failed", reason: "run_error", detail: ev.message }
        if (ev.status === "CANCELLED") yield { type: "run_cancelled", reason: ev.message }
      }
    }
    if (run.status === "finished") {
      yield { type: "run_succeeded", result: run.result }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    yield { type: "run_failed", reason: "run_error", detail: msg }
  }
}

/** Cursor SDK AgentEnginePort 实现 */
export const cursorEnginePort: AgentEnginePort = {
  launch: launchSdkFromPortRequest,

  async dispatch(sessionKey, taskText, messageIds) {
    const { dispatchToSdkAgent } = await import("./agent-sdk.js")
    return dispatchToSdkAgent(sessionKey, taskText, messageIds)
  },

  async stop(sessionKey, _source) {
    const { stopSdkSession } = await import("./sdk-run-lifecycle.js")
    stopSdkSession(sessionKey)
  },

  stream(session) {
    const s = session as SdkSessionAgent
    const run = s.run
    if (!run) return
    return mapSdkRunStream(s, run)
  },

  watchdog(session, _config: WatchdogConfig) {
    const s = session as SdkSessionAgent
    if (s.run && s.runGuardToken) armRunWatchdog(s, s.run, s.runGuardToken)
  },

  async complete(session, ctx: RunTerminalContext) {
    const s = session as SdkSessionAgent
    const run = s.run
    if (!run) {
      await getOrCreateSdkRunLifecycle(s).enterNotifying(ctx)
      return
    }
    if (ctx.source === "success" || run.status === "finished") {
      await completeSdkRunViaPort(s, run)
      return
    }
    if (!s.errorNotified && ctx.failure) {
      const archiveType =
        ctx.source === "watchdog" ? "sdk_timeout" as const
          : ctx.failure.reason === "user_cancelled" ? "sdk_cancelled" as const
            : "sdk_run_error" as const
      await completeSdkFailureViaTemplate(s, archiveType, ctx.failure.detail, run)
    }
    await completeSdkRunViaPort(s, run)
  },
}

/** 注册 Cursor SDK adapter 至全局 Engine Port 注册表 */
export function registerCursorEnginePort(): void {
  registerEnginePort("sdk", cursorEnginePort)
}
