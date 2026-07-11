/**
 * 会话调度 — Agent 启动链路
 * 任务/工作流/chat new 统一经 launchSdkAgentFromHttp 网关
 */
import {
  getChannel, getAgentResource, isCodexResourceId, isOpencodeResourceId, resolveChannelForSession,
  type MessageChannel,
} from "../config/config-store"
import { parseChatKey } from "../../src/shared/channel-types"
import { broadcastLog } from "../app/ui-logger"
import { type ChatType, type LaunchMeta } from "../agent/shared/agent-launcher"
import { launchSdkAgentFromHttp } from "../agent/cursor-sdk/agent-sdk-http"
import {
  buildLaunchRequestBody,
  isOwnTaskChatType,
  resolveLaunchModel,
  resolveLaunchWorkDir,
  type LaunchEngineKind,
} from "../agent/shared/launch-request-resolve"
import { extractChatId } from "./session-dispatcher-shared"
import { cachedLock } from "./session-dispatcher-lifecycle"
import { httpPost } from "../daemon/daemon-client"

interface LaunchAgentParams {
  sessionKey: string
  chatType: ChatType
  meta?: LaunchMeta
  useMainWorkspace?: boolean
  senderOpenId?: string
  chatName?: string
  taskMessage?: string
  channelId?: string
  modelOverride?: string
  modelParamsOverride?: string
  workingDirectory?: string
}

/** 本地 Agent 启动 SSOT：组装 launchBody 后委托统一网关 */
async function launchAgent(p: LaunchAgentParams): Promise<{ ok: boolean; error?: string }> {
  const { sessionKey, chatType, senderOpenId, chatName, taskMessage } = p
  const useMain = p.useMainWorkspace ?? (chatType === "p2p")

  const channel: MessageChannel | undefined = getChannel(p.channelId) ?? resolveChannelForSession(sessionKey)
  const boundId = channel?.agentResourceId
  const resource = getAgentResource(boundId)
  if (!resource) {
    if (boundId && isCodexResourceId(boundId)) {
      return { ok: false, error: "通道绑定的 Codex Profile 已删除，请在设置中重新选择" }
    }
    if (boundId && isOpencodeResourceId(boundId)) {
      return { ok: false, error: "通道绑定的 OpenCode Profile 已删除，请在设置中重新选择" }
    }
    return { ok: false, error: "请配置 SDK 资源（设置 → Agent）" }
  }
  if (resource.type !== "sdk" && resource.type !== "claude-code" && resource.type !== "codex" && resource.type !== "opencode") {
    return { ok: false, error: "请配置 SDK 资源（设置 → Agent）" }
  }
  if (!resource.apiKey?.trim()) {
    return { ok: false, error: "通道绑定的资源未配置 API Key（设置 → Agent）" }
  }
  if (resource.type === "opencode" && !resource.providerId?.trim()) {
    return { ok: false, error: "通道绑定的 OpenCode Profile 未配置 Provider ID（设置 → Agent）" }
  }

  const isOwnTask = isOwnTaskChatType(chatType)
  if (!useMain && !isOwnTask && !channel?.allowOthers) {
    return { ok: false, error: `通道「${channel?.name ?? "未知"}」未启用其他人使用` }
  }

  const workDirResult = resolveLaunchWorkDir({
    sessionKey,
    chatType,
    explicitDir: p.workingDirectory ?? "",
    useMain,
    channel,
  })
  if (!workDirResult.ok) return { ok: false, error: workDirResult.error }

  const engine = resource.type as LaunchEngineKind
  const { model, modelParams } = resolveLaunchModel({
    engine,
    modelOverride: p.modelOverride,
    modelParamsOverride: p.modelParamsOverride,
    resource,
    channel,
    useMain,
    chatType,
  })

  const launchBody = buildLaunchRequestBody({
    sessionKey,
    chatType,
    taskMessage,
    senderOpenId,
    chatName,
    channelId: p.channelId ?? channel?.id,
    useMain,
    chatId: extractChatId(sessionKey),
    model,
    modelParams,
    workDir: workDirResult.workDir,
    messageIds: p.meta?.messageIds,
  })

  // 统一经 agent-sdk-http 网关（resolveBoundAgentResourceType 路由四引擎）
  return launchSdkAgentFromHttp(launchBody)
}

/** IM/Daemon 路径启动会话 Agent */
export async function launchSessionAgent(
  sessionKey: string, chatType: ChatType,
  meta?: LaunchMeta,
  useMainWorkspace?: boolean, senderOpenId?: string,
): Promise<{ ok: boolean; error?: string }> {
  return launchAgent({ sessionKey, chatType, meta, useMainWorkspace, senderOpenId })
}

/** 定时任务 / 临时会话等独立 Agent 启动 */
export async function launchIndependentAgent(
  taskId: string, taskName: string, message: string, type: ChatType = "task",
  chatId?: string, channelId?: string, model?: string, modelParams?: string,
  workingDirectory?: string,
): Promise<{ ok: boolean; error?: string }> {
  return launchAgent({
    sessionKey: taskId, chatType: type, chatName: taskName, taskMessage: message,
    meta: { chatId: chatId ?? taskName, chatType: type },
    channelId, modelOverride: model, modelParamsOverride: modelParams,
    workingDirectory,
  })
}

/** 工作流节点 Agent 启动 */
export async function launchWorkflowAgent(p: {
  instanceId: string; nodeId: string; nodeName: string
  prompt: string; workingDirectory: string
  notifyChatId?: string; model?: string
}): Promise<{ ok: boolean; error?: string }> {
  const sessionKey = `${p.notifyChatId || "wf"}::wf_${p.instanceId}_${p.nodeId}`
  return launchAgent({
    sessionKey, chatType: "workflow",
    chatName: `WF: ${p.nodeName}`,
    taskMessage: p.prompt,
    workingDirectory: p.workingDirectory,
    meta: { chatId: p.notifyChatId || sessionKey, chatType: "workflow" },
    channelId: p.notifyChatId ? parseChatKey(extractChatId(p.notifyChatId)).channelId : undefined,
    modelOverride: p.model,
  })
}

/** 工作流节点完成/失败时向群聊发通知 */
export async function notifyWorkflowChat(chatId: string, text: string): Promise<void> {
  const lock = cachedLock()
  if (!lock?.port) return
  try {
    await httpPost(`http://127.0.0.1:${lock.port}/api/send-text`, { text, session_key: chatId }, 5000)
  } catch (e: unknown) {
    broadcastLog(`[WF Notify] 发送通知失败: ${e instanceof Error ? e.message : String(e)}`, "WARN")
  }
}
