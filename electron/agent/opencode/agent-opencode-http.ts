/**
 * OpenCode SDK HTTP 服务端（仿 agent-codex-http.ts）。
 */
import * as http from "node:http"
import { resolve, join } from "node:path"
import { existsSync, writeFileSync, mkdirSync } from "node:fs"
import { app } from "electron"
import { pushUiLog } from "../../app/ui-logger"
import {
  getChannel, getAgentResource, isOpencodeResourceId, resolveChannelForSession,
  resolveChannelModel, effectiveWorkspaceDir, type ModelScenario,
} from "../../config/config-store"
import type { ChatType, LaunchMeta } from "../shared/agent-launcher"
import type { OpencodeLaunchOptions } from "./agent-opencode-types"
import { OPENCODE_DEFAULT_MODEL } from "./agent-opencode-types"
import { parseModelRef } from "./agent-opencode-utils"

let _launchHandler: ((opts: OpencodeLaunchOptions) => Promise<{ ok: boolean; error?: string }>) | null = null
let _dispatchHandler: ((sessionKey: string, taskText: string, messageIds?: string[]) => Promise<{ ok: boolean; error?: string }>) | null = null

export function registerOpencodeLaunchHandler(
  fn: (opts: OpencodeLaunchOptions) => Promise<{ ok: boolean; error?: string }>,
): void {
  _launchHandler = fn
}

export function registerOpencodeDispatchHandler(
  fn: (sessionKey: string, taskText: string, messageIds?: string[]) => Promise<{ ok: boolean; error?: string }>,
): void {
  _dispatchHandler = fn
}

function writePortFile(port: number): void {
  try {
    const dir = app.getPath("userData")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opencode-agent-api-port.json"), JSON.stringify({ port }), "utf-8")
  } catch (e: unknown) {
    pushUiLog("OpenCode", "WARN", `opencode-agent-api-port 写入失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

function jsonRes(res: http.ServerResponse, body: object, status = 200): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) })
  res.end(data)
}

function parseMessageIds(body: Record<string, unknown>): string[] | undefined {
  const raw = body.message_ids
  if (!Array.isArray(raw)) return undefined
  const ids = raw.filter((id): id is string => typeof id === "string" && !!id.trim()).map((id) => id.trim())
  return ids.length ? ids : undefined
}

export async function launchOpencodeAgentFromHttp(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!_launchHandler) return { ok: false, error: "launch handler 未注册" }

  const sessionKey = typeof body.session_key === "string" ? body.session_key.trim() : ""
  if (!sessionKey) return { ok: false, error: "session_key is required" }

  const chatType = (typeof body.chat_type === "string" ? body.chat_type : "p2p") as ChatType
  const taskMessage = typeof body.task_text === "string" ? body.task_text : undefined
  const senderOpenId = typeof body.sender_open_id === "string" ? body.sender_open_id : undefined
  const chatName = typeof body.chat_name === "string" ? body.chat_name : undefined
  const channelId = typeof body.channel_id === "string" ? body.channel_id : undefined
  const explicitDir = typeof body.working_directory === "string" ? body.working_directory.trim() : ""
  const modelOverride = typeof body.model === "string" ? body.model.trim() : undefined
  const useMain = body.use_main_workspace === true
  const chatId = typeof body.chat_id === "string" ? body.chat_id.trim() : sessionKey.split("::")[0]
  const messageIds = parseMessageIds(body)
  const meta: LaunchMeta = { chatId, chatType: chatType === "group" ? "group" : "p2p", messageIds }

  const channel = getChannel(channelId) ?? resolveChannelForSession(sessionKey)
  const boundId = channel?.agentResourceId
  const resource = getAgentResource(boundId)
  if (!resource || resource.type !== "opencode") {
    if (boundId && isOpencodeResourceId(boundId) && !resource) {
      return { ok: false, error: "通道绑定的 OpenCode Profile 已删除，请在设置中重新选择" }
    }
    return { ok: false, error: "请配置 OpenCode Agent 资源（设置 → Agent）" }
  }

  const apiKey = resource.apiKey?.trim() ?? ""
  const providerId = resource.providerId?.trim() ?? ""
  if (!apiKey) return { ok: false, error: "API Key 未配置，请在 OpenCode Profile 中填写" }
  if (!providerId) return { ok: false, error: "Provider ID 未配置，请在 OpenCode Profile 中填写" }

  const isOwnTask = chatType === "task" || chatType === "temp" || chatType === "workflow"
  if (!useMain && !isOwnTask && !channel?.allowOthers) {
    return { ok: false, error: `通道「${channel?.name ?? "未知"}」未启用其他人使用` }
  }

  let workDir = explicitDir
  if (!workDir) {
    if (useMain || isOwnTask) {
      workDir = effectiveWorkspaceDir(channel)
    } else {
      const mode = channel?.othersWorkspaceMode ?? "isolated"
      if (mode === "isolated") {
        const safeChatId = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")
        workDir = join(app.getPath("userData"), "workspaces", safeChatId)
        if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true })
      } else {
        const dir = channel?.othersWorkspaceDir?.trim() ?? ""
        workDir = dir ? resolve(dir) : effectiveWorkspaceDir(channel)
        if (dir && !existsSync(workDir)) return { ok: false, error: "目录不存在，请检查路径" }
      }
    }
  } else if (chatType !== "temp" && !existsSync(workDir)) {
    mkdirSync(workDir, { recursive: true })
  }
  if (!workDir) return { ok: false, error: "工作目录未配置" }

  let model: string
  if (modelOverride) model = modelOverride
  else if (resource.model?.trim()) model = resource.model.trim()
  else {
    const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
    const resolved = resolveChannelModel(channel, scenario)
    model = resolved.model || OPENCODE_DEFAULT_MODEL
  }

  return _launchHandler({
    sessionKey,
    chatType,
    meta,
    workspaceDir: workDir,
    useMainWorkspace: useMain,
    senderOpenId,
    chatName,
    taskMessage,
    providerId,
    apiKey,
    model,
    deployMode: resource.deployMode ?? "embedded",
    opencodeHostname: resource.opencodeHostname,
    opencodePort: resource.opencodePort,
    baseUrl: resource.baseUrl?.trim() || undefined,
    profileResourceId: resource.id,
  })
}

let apiServer: http.Server | null = null
let apiPort = 0

export function ensureOpencodeHttpServer(): void {
  if (apiServer) return
  apiServer = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      jsonRes(res, { ok: false, error: "method not allowed" }, 405)
      return
    }
    const pathname = req.url?.split("?")[0] ?? ""
    try {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
      if (pathname === "/api/opencode/agent/dispatch") {
        const session_key = typeof body.session_key === "string" ? body.session_key.trim() : ""
        const task_text = typeof body.task_text === "string" ? body.task_text : ""
        if (!session_key) {
          jsonRes(res, { ok: false, error: "session_key is required" }, 400)
          return
        }
        if (!_dispatchHandler) {
          jsonRes(res, { ok: false, error: "dispatch handler 未注册" }, 500)
          return
        }
        const result = await _dispatchHandler(session_key, task_text, parseMessageIds(body))
        jsonRes(res, result, result.ok ? 200 : 400)
        return
      }
      if (pathname === "/api/opencode/agent/launch") {
        const result = await launchOpencodeAgentFromHttp(body)
        jsonRes(res, result, result.ok ? 200 : 400)
        return
      }
      jsonRes(res, { ok: false, error: "not found" }, 404)
    } catch (e: unknown) {
      jsonRes(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  apiServer.listen(0, "127.0.0.1", () => {
    const addr = apiServer!.address()
    apiPort = typeof addr === "object" && addr ? addr.port : 0
    writePortFile(apiPort)
    pushUiLog("OpenCode", "INFO", `OpenCode Agent API 监听 127.0.0.1:${apiPort}`)
  })
}

export function getOpencodeAgentApiPort(): number {
  return apiPort
}
