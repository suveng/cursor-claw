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
import { resolve, join } from "node:path"
import { existsSync, writeFileSync, mkdirSync } from "node:fs"
import { app } from "electron"
import { pushUiLog } from "./ui-logger"
import { getChannel, getAgentResource, resolveChannelForSession, resolveChannelModel, effectiveWorkspaceDir, type ModelScenario } from "./config-store"
import type { ChatType, LaunchMeta } from "./agent-launcher"
import type { ClaudeCodeLaunchOptions } from "./agent-cc-types"

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

/** 从请求体中解析 message_ids 数组 */
function parseInboundMessageIds(body: Record<string, unknown>): string[] | undefined {
  const raw = body.message_ids
  if (!Array.isArray(raw)) return undefined
  const ids = raw.filter((id): id is string => typeof id === "string" && !!id.trim()).map((id) => id.trim())
  return ids.length ? ids : undefined
}

// ── HTTP 请求处理 ─────────────────────────────────────────────────────────────

/** 从 HTTP 请求体解析参数并调用已注入的 launch handler（供 Daemon 统一 /api/agent/launch 委托） */
export async function launchCcAgentFromHttp(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!_ccLaunchHandler) return { ok: false, error: "launch handler 未注册" }

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
  const messageIds = parseInboundMessageIds(body)
  const meta: LaunchMeta = { chatId, chatType: chatType === "group" ? "group" : "p2p", messageIds }

  // 从 channel 解析 resource（apiKey / baseUrl）
  const channel = getChannel(channelId) ?? resolveChannelForSession(sessionKey)
  const resource = getAgentResource(channel?.agentResourceId)
  if (resource.type !== "claude-code") {
    return { ok: false, error: "请配置 Claude Agent 资源（设置 → Agent）" }
  }

  const apiKey = resource.apiKey?.trim() ?? ""
  if (!apiKey) return { ok: false, error: "API Key 未配置，请在 Claude Agent Profile 中填写" }

  const baseUrl = resource.baseUrl?.trim() || undefined

  const isOwnTask = chatType === "task" || chatType === "temp" || chatType === "workflow"
  if (!useMain && !isOwnTask && !channel?.allowOthers) {
    return { ok: false, error: `通道「${channel?.name ?? "未知"}」未启用其他人使用` }
  }

  // 工作目录解析
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
        if (!dir) {
          workDir = effectiveWorkspaceDir(channel)
        } else {
          const resolved = resolve(dir)
          if (!existsSync(resolved)) return { ok: false, error: "目录不存在，请检查路径或省略 -dir 使用当前主会话目录" }
          workDir = resolved
        }
      }
    }
  } else if (chatType !== "temp" && !existsSync(workDir)) {
    mkdirSync(workDir, { recursive: true })
  }
  if (!workDir) return { ok: false, error: "工作目录未配置" }

  // 模型解析（优先 body > resource.model > channelModel > fallback）
  let model: string
  if (modelOverride) {
    model = modelOverride
  } else if (resource.model?.trim()) {
    model = resource.model.trim()
  } else {
    const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
    const resolved = resolveChannelModel(channel, scenario)
    model = resolved.model || "claude-sonnet-4-6"
  }

  return _ccLaunchHandler({
    sessionKey, chatType, meta, workspaceDir: workDir, useMainWorkspace: useMain,
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
