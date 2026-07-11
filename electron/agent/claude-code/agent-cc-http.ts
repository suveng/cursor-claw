/**
 * Claude Code SDK HTTP 服务端
 *
 * 包含：
 * - checkClaudeCodeApiKey：验证 API Key 有效性
 * - ensureClaudeCodeHttpServer / getCcAgentApiPort：内部 HTTP server 管理
 * - launchCcAgentFromHttp：从 HTTP 请求体解析并调用 launch handler
 * - registerCcLaunchHandler：依赖注入，避免与 agent-claude-sdk.ts 产生循环导入
 */
import * as http from "node:http"
import { join } from "node:path"
import { writeFileSync, mkdirSync } from "node:fs"
import { app } from "electron"
import { pushUiLog } from "../../app/ui-logger"
import { getChannel, getAgentResource, resolveChannelForSession } from "../../config/config-store"
import type { ClaudeCodeLaunchOptions } from "./agent-cc-types"
import {
  isOwnTaskChatType,
  parseInboundMessageIds,
  parseLaunchRequestBody,
  resolveLaunchModel,
  resolveLaunchWorkDir,
} from "../shared/launch-request-resolve"

// ── 依赖注入：launch handler ──────────────────────────────────────────────────

/** 注册的 launch 函数（由 agent-claude-sdk.ts 启动时注入） */
let _ccLaunchHandler: ((opts: ClaudeCodeLaunchOptions) => Promise<{ ok: boolean; error?: string }>) | null = null

/**
 * 注册 launch handler（依赖注入）。
 * agent-claude-sdk.ts 在模块加载末尾调用此函数注入 launchClaudeCodeAgent。
 */
export function registerCcLaunchHandler(
  fn: (opts: ClaudeCodeLaunchOptions) => Promise<{ ok: boolean; error?: string }>,
): void {
  _ccLaunchHandler = fn
}

/** dispatch handler（由 agent-claude-sdk.ts 注入） */
let _ccDispatchHandler: ((sessionKey: string, taskText: string, messageIds?: string[]) => Promise<{ ok: boolean; error?: string }>) | null = null

/** 注册 dispatch handler */
export function registerCcDispatchHandler(
  fn: (sessionKey: string, taskText: string, messageIds?: string[]) => Promise<{ ok: boolean; error?: string }>,
): void {
  _ccDispatchHandler = fn
}

// ── API Key 验证 ──────────────────────────────────────────────────────────────

/**
 * 通过 Anthropic Messages API 发送最小请求，验证 API Key 有效性。
 */
export async function checkClaudeCodeApiKey(apiKey: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const key = apiKey?.trim()
  if (!key) return { ok: false, error: "API Key 未配置" }

  try {
    const effectiveBaseUrl = baseUrl?.trim() || "https://api.anthropic.com"
    const url = `${effectiveBaseUrl}/v1/messages`
    const body = JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    })
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const https = require("https") as typeof import("https")
      const urlObj = new URL(url)
      const req = https.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port ? parseInt(urlObj.port) : 443,
          path: urlObj.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          timeout: 15000,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (c: Buffer) => chunks.push(c))
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8")
            try {
              const json = JSON.parse(text) as { error?: { message?: string; type?: string }; type?: string }
              if (res.statusCode === 200 || res.statusCode === 201) {
                resolve({ ok: true })
              } else if (res.statusCode === 401 || res.statusCode === 403) {
                resolve({ ok: false, error: `API Key 无效: ${json.error?.message ?? text}` })
              } else if (res.statusCode === 400 && json.error?.type === "invalid_request_error") {
                // 400 通常表示请求格式问题但 Key 有效（如 max_tokens 太小）
                resolve({ ok: true })
              } else {
                resolve({ ok: false, error: `验证失败 (HTTP ${res.statusCode}): ${json.error?.message ?? text}` })
              }
            } catch {
              if (res.statusCode && res.statusCode < 300) {
                resolve({ ok: true })
              } else {
                resolve({ ok: false, error: `响应解析失败 (HTTP ${res.statusCode})` })
              }
            }
          })
        },
      )
      req.on("error", (e) => resolve({ ok: false, error: e.message }))
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "验证超时" }) })
      req.end(body)
    })
    return result
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── HTTP 服务辅助 ─────────────────────────────────────────────────────────────

/** 将监听端口写入 userData/cc-agent-api-port.json */
function writeCcApiPortFile(port: number): void {
  try {
    const dir = app.getPath("userData")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "cc-agent-api-port.json"), JSON.stringify({ port }), "utf-8")
  } catch (e: unknown) {
    pushUiLog("CC", "WARN", `cc-agent-api-port 写入失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 读取 HTTP 请求 body 并以字符串 resolve */
function readCcApiBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

/** 向 HTTP 响应写入 JSON 数据 */
function jsonCcApi(res: http.ServerResponse, body: object, status = 200): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) })
  res.end(data)
}

// ── HTTP 请求处理 ─────────────────────────────────────────────────────────────

/** 从 HTTP 请求体解析参数并调用已注入的 launch handler（供 Daemon 统一 /api/agent/launch 委托） */
export async function launchCcAgentFromHttp(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!_ccLaunchHandler) return { ok: false, error: "launch handler 未注册" }

  const parsedResult = parseLaunchRequestBody(body)
  if (!parsedResult.ok) return parsedResult

  const {
    sessionKey, chatType, taskMessage, senderOpenId, chatName, channelId,
    explicitWorkDir, useMain, meta, modelOverride,
  } = parsedResult.parsed

  const channel = getChannel(channelId) ?? resolveChannelForSession(sessionKey)
  const resource = getAgentResource(channel?.agentResourceId)
  if (resource.type !== "claude-code") {
    return { ok: false, error: "请配置 Claude Agent 资源（设置 → Agent）" }
  }

  const apiKey = resource.apiKey?.trim() ?? ""
  if (!apiKey) return { ok: false, error: "API Key 未配置，请在 Claude Agent Profile 中填写" }

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
    engine: "claude-code",
    modelOverride,
    resource,
    channel,
    useMain,
    chatType,
    fallbackModel: "claude-sonnet-4-6",
  })

  return _ccLaunchHandler({
    sessionKey, chatType, meta, workspaceDir: workDirResult.workDir, useMainWorkspace: useMain,
    senderOpenId, chatName, taskMessage, apiKey, baseUrl, model,
  })
}

// ── HTTP server ────────────────────────────────────────────────────────────────

let ccApiServer: http.Server | null = null
let ccApiPort = 0

/** 启动 Claude Code Agent HTTP API 服务（幂等，重复调用无效） */
export function ensureClaudeCodeHttpServer(): void {
  if (ccApiServer) return
  ccApiServer = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      jsonCcApi(res, { ok: false, error: "method not allowed" }, 405)
      return
    }
    const pathname = req.url?.split("?")[0] ?? ""
    try {
      const raw = await readCcApiBody(req)
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
      if (pathname === "/api/cc/agent/dispatch") {
        const session_key = typeof body.session_key === "string" ? body.session_key.trim() : ""
        const task_text = typeof body.task_text === "string" ? body.task_text : ""
        if (!session_key) {
          jsonCcApi(res, { ok: false, error: "session_key is required" }, 400)
          return
        }
        if (!_ccDispatchHandler) {
          jsonCcApi(res, { ok: false, error: "dispatch handler 未注册" }, 500)
          return
        }
        const messageIds = parseInboundMessageIds(body)
        const result = await _ccDispatchHandler(session_key, task_text, messageIds)
        jsonCcApi(res, result, result.ok ? 200 : 400)
        return
      }
      if (pathname === "/api/cc/agent/launch") {
        const result = await launchCcAgentFromHttp(body)
        jsonCcApi(res, result, result.ok ? 200 : 400)
        return
      }
      jsonCcApi(res, { ok: false, error: "not found" }, 404)
    } catch (e: unknown) {
      jsonCcApi(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  ccApiServer.listen(0, "127.0.0.1", () => {
    const addr = ccApiServer!.address()
    ccApiPort = typeof addr === "object" && addr ? addr.port : 0
    writeCcApiPortFile(ccApiPort)
    pushUiLog("CC", "INFO", `Claude Agent API 监听 127.0.0.1:${ccApiPort}`)
  })
}

/** 获取 Claude Code Agent HTTP API 当前监听端口（0 表示未启动） */
export function getCcAgentApiPort(): number {
  return ccApiPort
}
