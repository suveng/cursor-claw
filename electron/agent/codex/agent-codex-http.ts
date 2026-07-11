/**
 * Codex SDK HTTP 服务端
 *
 * 包含：
 * - ensureCodexHttpServer / getCodexAgentApiPort：内部 HTTP server 管理
 * - launchCodexAgentFromHttp：从 HTTP 请求体解析并调用 launch handler
 * - registerCodexLaunchHandler / registerCodexDispatchHandler：依赖注入，避免与 agent-codex-sdk.ts 循环导入
 */
import * as http from "node:http"
import { join } from "node:path"
import { writeFileSync, mkdirSync } from "node:fs"
import { app } from "electron"
import { pushUiLog } from "../../app/ui-logger"
import {
  getChannel, getAgentResource, isCodexResourceId, resolveChannelForSession,
} from "../../config/config-store"
import type { CodexLaunchOptions } from "./agent-codex-types"
import {
  isOwnTaskChatType,
  parseInboundMessageIds,
  parseLaunchRequestBody,
  resolveLaunchModel,
  resolveLaunchWorkDir,
} from "../shared/launch-request-resolve"

// ── 依赖注入：launch / dispatch handler ─────────────────────────────────────

/** 注册的 launch 函数（由 agent-codex-sdk.ts 启动时注入） */
let _codexLaunchHandler: ((opts: CodexLaunchOptions) => Promise<{ ok: boolean; error?: string }>) | null = null

/** 注册 launch handler（依赖注入） */
export function registerCodexLaunchHandler(
  fn: (opts: CodexLaunchOptions) => Promise<{ ok: boolean; error?: string }>,
): void {
  _codexLaunchHandler = fn
}

/** 注册的 dispatch 函数 */
let _codexDispatchHandler: ((sessionKey: string, taskText: string, messageIds?: string[]) => Promise<{ ok: boolean; error?: string }>) | null = null

/** 注册 dispatch handler */
export function registerCodexDispatchHandler(
  fn: (sessionKey: string, taskText: string, messageIds?: string[]) => Promise<{ ok: boolean; error?: string }>,
): void {
  _codexDispatchHandler = fn
}

// ── HTTP 服务辅助 ─────────────────────────────────────────────────────────────

/** 将监听端口写入 userData/codex-agent-api-port.json */
function writeCodexApiPortFile(port: number): void {
  try {
    const dir = app.getPath("userData")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "codex-agent-api-port.json"), JSON.stringify({ port }), "utf-8")
  } catch (e: unknown) {
    pushUiLog("Codex", "WARN", `codex-agent-api-port 写入失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 读取 HTTP 请求 body 并以字符串 resolve */
function readCodexApiBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

/** 向 HTTP 响应写入 JSON 数据 */
function jsonCodexApi(res: http.ServerResponse, body: object, status = 200): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) })
  res.end(data)
}

// ── HTTP 请求处理 ─────────────────────────────────────────────────────────────

/** 从 HTTP 请求体解析参数并调用已注入的 launch handler */
export async function launchCodexAgentFromHttp(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!_codexLaunchHandler) return { ok: false, error: "launch handler 未注册" }

  const parsedResult = parseLaunchRequestBody(body)
  if (!parsedResult.ok) return parsedResult

  const {
    sessionKey, chatType, taskMessage, senderOpenId, chatName, channelId,
    explicitWorkDir, useMain, meta, modelOverride,
  } = parsedResult.parsed

  const channel = getChannel(channelId) ?? resolveChannelForSession(sessionKey)
  const boundId = channel?.agentResourceId
  const resource = getAgentResource(boundId)
  if (!resource || resource.type !== "codex") {
    if (boundId && isCodexResourceId(boundId) && !resource) {
      return { ok: false, error: "通道绑定的 Codex Profile 已删除，请在设置中重新选择" }
    }
    return { ok: false, error: "请配置 Codex Agent 资源（设置 → Agent）" }
  }

  const apiKey = resource.apiKey?.trim() ?? ""
  if (!apiKey) return { ok: false, error: "API Key 未配置，请在 Codex Agent Profile 中填写" }

  const baseUrl = resource.baseUrl?.trim() || undefined

  const isOwnTask = isOwnTaskChatType(chatType)
  if (!useMain && !isOwnTask && !channel?.allowOthers) {
    return { ok: false, error: `通道「${channel?.name ?? "未知"}」未启用其他人使用` }
  }

  const workDirResult = resolveLaunchWorkDir({
    sessionKey, chatType, explicitDir: explicitWorkDir, useMain, channel,
  })
  if (!workDirResult.ok) return { ok: false, error: workDirResult.error }

  const { model } = resolveLaunchModel({
    engine: "codex",
    modelOverride,
    resource,
    channel,
    useMain,
    chatType,
    fallbackModel: "gpt-5",
  })

  return _codexLaunchHandler({
    sessionKey, chatType, meta, workspaceDir: workDirResult.workDir, useMainWorkspace: useMain,
    senderOpenId, chatName, taskMessage, apiKey, baseUrl, model,
  })
}

// ── HTTP server ────────────────────────────────────────────────────────────────

let codexApiServer: http.Server | null = null
let codexApiPort = 0

/** 启动 Codex Agent HTTP API 服务（幂等，重复调用无效） */
export function ensureCodexHttpServer(): void {
  if (codexApiServer) return
  codexApiServer = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      jsonCodexApi(res, { ok: false, error: "method not allowed" }, 405)
      return
    }
    const pathname = req.url?.split("?")[0] ?? ""
    try {
      const raw = await readCodexApiBody(req)
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
      if (pathname === "/api/codex/agent/dispatch") {
        const session_key = typeof body.session_key === "string" ? body.session_key.trim() : ""
        const task_text = typeof body.task_text === "string" ? body.task_text : ""
        if (!session_key) {
          jsonCodexApi(res, { ok: false, error: "session_key is required" }, 400)
          return
        }
        if (!_codexDispatchHandler) {
          jsonCodexApi(res, { ok: false, error: "dispatch handler 未注册" }, 500)
          return
        }
        const messageIds = parseInboundMessageIds(body)
        const result = await _codexDispatchHandler(session_key, task_text, messageIds)
        jsonCodexApi(res, result, result.ok ? 200 : 400)
        return
      }
      if (pathname === "/api/codex/agent/launch") {
        const result = await launchCodexAgentFromHttp(body)
        jsonCodexApi(res, result, result.ok ? 200 : 400)
        return
      }
      jsonCodexApi(res, { ok: false, error: "not found" }, 404)
    } catch (e: unknown) {
      jsonCodexApi(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  codexApiServer.listen(0, "127.0.0.1", () => {
    const addr = codexApiServer!.address()
    codexApiPort = typeof addr === "object" && addr ? addr.port : 0
    writeCodexApiPortFile(codexApiPort)
    pushUiLog("Codex", "INFO", `Codex Agent API 监听 127.0.0.1:${codexApiPort}`)
  })
}

/** 获取 Codex Agent HTTP API 当前监听端口（0 表示未启动） */
export function getCodexAgentApiPort(): number {
  return codexApiPort
}
