/**
 * OpenCode SDK HTTP 服务端（仿 agent-codex-http.ts）。
 */
import * as http from "node:http"
import { join } from "node:path"
import { writeFileSync, mkdirSync } from "node:fs"
import { app } from "electron"
import { pushUiLog } from "../../app/ui-logger"
import {
  getChannel, getAgentResource, isOpencodeResourceId, resolveChannelForSession,
} from "../../config/config-store"
import type { OpencodeLaunchOptions } from "./agent-opencode-types"
import { OPENCODE_DEFAULT_MODEL } from "./agent-opencode-types"
import {
  isOwnTaskChatType,
  parseInboundMessageIds,
  parseLaunchRequestBody,
  resolveLaunchModel,
  resolveLaunchWorkDir,
} from "../shared/launch-request-resolve"

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

export async function launchOpencodeAgentFromHttp(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!_launchHandler) return { ok: false, error: "launch handler 未注册" }

  const parsedResult = parseLaunchRequestBody(body)
  if (!parsedResult.ok) return parsedResult

  const {
    sessionKey, chatType, taskMessage, senderOpenId, chatName, channelId,
    explicitWorkDir, useMain, meta, modelOverride,
  } = parsedResult.parsed

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

  const isOwnTask = isOwnTaskChatType(chatType)
  if (!useMain && !isOwnTask && !channel?.allowOthers) {
    return { ok: false, error: `通道「${channel?.name ?? "未知"}」未启用其他人使用` }
  }

  const workDirResult = resolveLaunchWorkDir({
    sessionKey,
    chatType,
    explicitDir: explicitWorkDir,
    useMain,
    channel,
    othersDirMissingError: "目录不存在，请检查路径",
  })
  if (!workDirResult.ok) return { ok: false, error: workDirResult.error }

  const { model } = resolveLaunchModel({
    engine: "opencode",
    modelOverride,
    resource,
    channel,
    useMain,
    chatType,
    fallbackModel: OPENCODE_DEFAULT_MODEL,
  })

  return _launchHandler({
    sessionKey,
    chatType,
    meta,
    workspaceDir: workDirResult.workDir,
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
        const result = await _dispatchHandler(session_key, task_text, parseInboundMessageIds(body))
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
