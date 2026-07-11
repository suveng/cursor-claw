/**
 * Agent launch 请求解析 SSOT
 * IM（Daemon 转发）与本地四入口共用 body / workDir / model 解析
 */
import * as path from "node:path"
import * as fs from "node:fs"
import { app } from "electron"
import { resolveChannelModel, effectiveWorkspaceDir, type MessageChannel, type ModelScenario } from "../../config/config-store"
import type { AgentResource } from "../../../src/shared/channel-types"
import type { ChatType, LaunchMeta } from "./agent-launcher"

/** 四引擎 launch 解析后的引擎类型标签 */
export type LaunchEngineKind = "sdk" | "claude-code" | "codex" | "opencode"

/** HTTP/本地 launch 请求体解析结果 */
export interface ParsedLaunchRequest {
  sessionKey: string
  chatType: ChatType
  taskMessage?: string
  senderOpenId?: string
  chatName?: string
  channelId?: string
  explicitWorkDir: string
  modelOverride?: string
  modelParamsOverride?: string
  useMain: boolean
  chatId: string
  messageIds?: string[]
  meta: LaunchMeta
}

/** 从 body 解析 message_ids 数组 */
export function parseInboundMessageIds(body: Record<string, unknown>): string[] | undefined {
  const raw = body.message_ids
  if (!Array.isArray(raw)) return undefined
  const ids = raw.filter((id): id is string => typeof id === "string" && !!id.trim()).map((id) => id.trim())
  return ids.length ? ids : undefined
}

/** 定时/临时/工作流类 chatType 视为自有任务（使用主工作目录策略） */
export function isOwnTaskChatType(chatType: ChatType): boolean {
  return chatType === "task" || chatType === "temp" || chatType === "workflow"
}

/** 解析 launch HTTP body 公共字段 */
export function parseLaunchRequestBody(body: Record<string, unknown>):
  | { ok: true; parsed: ParsedLaunchRequest }
  | { ok: false; error: string } {
  const sessionKey = typeof body.session_key === "string" ? body.session_key.trim() : ""
  if (!sessionKey) return { ok: false, error: "session_key is required" }

  const chatType = (typeof body.chat_type === "string" ? body.chat_type : "p2p") as ChatType
  const taskMessage = typeof body.task_text === "string" ? body.task_text : undefined
  const senderOpenId = typeof body.sender_open_id === "string" ? body.sender_open_id : undefined
  const chatName = typeof body.chat_name === "string" ? body.chat_name : undefined
  const channelId = typeof body.channel_id === "string" ? body.channel_id : undefined
  const explicitWorkDir = typeof body.working_directory === "string" ? body.working_directory.trim() : ""
  const modelOverride = typeof body.model === "string" ? body.model.trim() : undefined
  const modelParamsOverride = typeof body.model_params === "string" ? body.model_params : undefined
  const useMain = body.use_main_workspace === true
  const chatId = typeof body.chat_id === "string" ? body.chat_id.trim() : sessionKey.split("::")[0]
  const messageIds = parseInboundMessageIds(body)
  const meta: LaunchMeta = { chatId, chatType: chatType === "group" ? "group" : "p2p", messageIds }

  return {
    ok: true,
    parsed: {
      sessionKey, chatType, taskMessage, senderOpenId, chatName, channelId,
      explicitWorkDir, modelOverride, modelParamsOverride, useMain, chatId, messageIds, meta,
    },
  }
}

/** 校验指定路径为可读目录（/chat new -dir 与 others 指定目录共用） */
export function validateLaunchWorkspacePath(dir: string):
  | { ok: true; resolved: string }
  | { ok: false; error: string } {
  const trimmed = dir.trim()
  if (!trimmed) {
    return { ok: false, error: "工作目录未配置，请先在设置中配置主工作目录" }
  }
  const resolved = path.resolve(trimmed)
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: "目录不存在，请检查路径或省略 -dir 使用当前主会话目录" }
  }
  try {
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      return { ok: false, error: "指定路径不是目录，请改为有效的文件夹路径" }
    }
    fs.accessSync(resolved, fs.constants.R_OK)
  } catch {
    return { ok: false, error: "无法访问该目录，请检查权限或改用其他路径" }
  }
  return { ok: true, resolved }
}

/** 解析 launch 工作目录（explicit / 主目录 / 他人隔离或指定目录） */
export function resolveLaunchWorkDir(opts: {
  sessionKey: string
  chatType: ChatType
  explicitDir: string
  useMain: boolean
  channel?: MessageChannel
  /** OpenCode 路径缺失时的定制文案（保持引擎差异） */
  othersDirMissingError?: string
}): { ok: true; workDir: string } | { ok: false; error: string } {
  const { sessionKey, chatType, explicitDir, useMain, channel } = opts
  const isOwnTask = isOwnTaskChatType(chatType)
  const dirMissingError = opts.othersDirMissingError
    ?? "目录不存在，请检查路径或省略 -dir 使用当前主会话目录"

  if (explicitDir) {
    const workDir = explicitDir
    if (chatType !== "temp" && !fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true })
    if (!workDir) return { ok: false, error: "工作目录未配置" }
    return { ok: true, workDir }
  }

  if (useMain || isOwnTask) {
    const workDir = effectiveWorkspaceDir(channel)
    if (!workDir) return { ok: false, error: "工作目录未配置" }
    return { ok: true, workDir }
  }

  const mode = channel?.othersWorkspaceMode ?? "isolated"
  if (mode === "isolated") {
    const safeChatId = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")
    const workDir = path.join(app.getPath("userData"), "workspaces", safeChatId)
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true })
    return { ok: true, workDir }
  }

  const dir = channel?.othersWorkspaceDir?.trim() ?? ""
  if (!dir) {
    const workDir = effectiveWorkspaceDir(channel)
    if (!workDir.trim()) {
      return { ok: false, error: "工作目录未配置，请先在设置中配置主工作目录" }
    }
    return { ok: true, workDir }
  }

  if (dirMissingError === "目录不存在，请检查路径") {
    const workDir = path.resolve(dir)
    if (!fs.existsSync(workDir)) return { ok: false, error: dirMissingError }
    return { ok: true, workDir }
  }

  const check = validateLaunchWorkspacePath(dir)
  if (!check.ok) return check
  return { ok: true, workDir: check.resolved }
}

/** 解析 launch 模型与 modelParams（按引擎类型分支） */
export function resolveLaunchModel(opts: {
  engine: LaunchEngineKind
  modelOverride?: string
  modelParamsOverride?: string
  resource: Pick<AgentResource, "type" | "model">
  channel?: MessageChannel
  useMain: boolean
  chatType: ChatType
  fallbackModel?: string
}): { model: string; modelParams: string } {
  const { engine, modelOverride, modelParamsOverride, resource, channel, useMain, chatType, fallbackModel } = opts
  const isOwnTask = isOwnTaskChatType(chatType)

  if (modelOverride?.trim()) {
    return { model: modelOverride.trim(), modelParams: modelParamsOverride ?? "" }
  }

  if (engine === "codex") {
    if (resource.model?.trim()) {
      return { model: resource.model.trim(), modelParams: "" }
    }
    const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
    const resolved = resolveChannelModel(channel, scenario)
    return { model: resolved.model || fallbackModel || "gpt-5", modelParams: resolved.modelParams }
  }

  if (engine === "opencode") {
    if (resource.model?.trim()) {
      return { model: resource.model.trim(), modelParams: "" }
    }
    const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
    const resolved = resolveChannelModel(channel, scenario)
    return { model: resolved.model || fallbackModel || "", modelParams: "" }
  }

  if (engine === "claude-code") {
    if (resource.model?.trim()) {
      return { model: resource.model.trim(), modelParams: "" }
    }
    const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
    const resolved = resolveChannelModel(channel, scenario)
    return { model: resolved.model || fallbackModel || "claude-sonnet-4-6", modelParams: "" }
  }

  // sdk
  const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
  const resolved = resolveChannelModel(channel, scenario)
  return { model: resolved.model, modelParams: resolved.modelParams }
}

/** 组装 launch HTTP body（本地 launchAgent 与 Daemon 转发字段一致） */
export function buildLaunchRequestBody(opts: {
  sessionKey: string
  chatType: ChatType
  taskMessage?: string
  senderOpenId?: string
  chatName?: string
  channelId?: string
  useMain: boolean
  chatId: string
  model: string
  modelParams: string
  workDir: string
  messageIds?: string[]
}): Record<string, unknown> {
  return {
    session_key: opts.sessionKey,
    task_text: opts.taskMessage,
    chat_type: opts.chatType,
    chat_id: opts.chatId,
    sender_open_id: opts.senderOpenId,
    use_main_workspace: opts.useMain,
    channel_id: opts.channelId,
    model: opts.model,
    model_params: opts.modelParams,
    working_directory: opts.workDir,
    chat_name: opts.chatName,
    ...(opts.messageIds?.length && { message_ids: opts.messageIds }),
  }
}
