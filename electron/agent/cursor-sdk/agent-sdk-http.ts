/**
 * SDK Agent HTTP 桥接（对称 agent-cc-http.ts）
 * launch/dispatch 经动态 import 避免与 agent-sdk 循环依赖。
 */
import * as http from "node:http"
import { resolve, join } from "node:path"
import { existsSync, writeFileSync, mkdirSync } from "node:fs"
import { app } from "electron"
import {
  getChannel, getAgentResource, isCodexResourceId, isOpencodeResourceId,
  resolveChannelForSession, resolveChannelModel, effectiveWorkspaceDir,
  type ModelScenario,
} from "../../config/config-store"
import { type ChatType, type LaunchMeta } from "../shared/agent-launcher"
import { launchCcAgentFromHttp } from "../claude-code/agent-cc-http"
import { dispatchToClaudeCodeAgent } from "../claude-code/agent-claude-sdk"
import { launchCodexAgentFromHttp } from "../codex/agent-codex-http"
import { dispatchToCodexAgent } from "../codex/agent-codex-sdk"
import { launchOpencodeAgentFromHttp } from "../opencode/agent-opencode-http"
import { dispatchToOpencodeAgent } from "../opencode/agent-opencode-sdk"
import { pushUiLog } from "../../app/ui-logger"

let agentApiServer: http.Server | null = null
let agentApiPort = 0

function writeAgentApiPortFile(port: number): void {
  try {
    const dir = app.getPath("userData")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "agent-api-port.json"), JSON.stringify({ port }), "utf-8")
  } catch (e: unknown) {
    pushUiLog("SDK", "WARN", `agent-api-port 写入失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function readAgentApiBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

function jsonAgentApi(res: http.ServerResponse, body: object, status = 200): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) })
  res.end(data)
}

function parseInboundMessageIds(body: Record<string, unknown>): string[] | undefined {
  const raw = body.message_ids
  if (!Array.isArray(raw)) return undefined
  const ids = raw.filter((id): id is string => typeof id === "string" && !!id.trim()).map((id) => id.trim())
  return ids.length ? ids : undefined
}

const LEGACY_CLI_BIND_ERROR =
  "通道仍绑定已废弃的 Cursor CLI，请在设置中将 Agent 资源改为 SDK 或 Claude Code Profile"
const CODEX_PROFILE_MISSING_ERROR =
  "通道绑定的 Codex Profile 已删除，请在设置中重新选择"
const OPENCODE_PROFILE_MISSING_ERROR =
  "通道绑定的 OpenCode Profile 已删除，请在设置中重新选择"

type BoundAgentRoute = "sdk" | "claude-code" | "codex" | "opencode" | "cli" | "codex-missing" | "opencode-missing"

function resolveBoundAgentResourceType(sessionKey: string, channelId?: string): BoundAgentRoute {
  const channel = getChannel(channelId) ?? resolveChannelForSession(sessionKey)
  const boundId = channel?.agentResourceId
  if (boundId === "cli") return "cli"
  if (boundId && isCodexResourceId(boundId)) {
    const codexResource = getAgentResource(boundId)
    if (!codexResource) return "codex-missing"
    if ((codexResource as { type?: string }).type === "cli") return "cli"
    return "codex"
  }
  if (boundId && isOpencodeResourceId(boundId)) {
    const opencodeResource = getAgentResource(boundId)
    if (!opencodeResource) return "opencode-missing"
    if ((opencodeResource as { type?: string }).type === "cli") return "cli"
    return "opencode"
  }
  const resource = getAgentResource(boundId)
  if ((resource as { type?: string } | undefined)?.type === "cli") return "cli"
  if (resource?.type === "claude-code") return "claude-code"
  if (resource?.type === "codex") return "codex"
  if (resource?.type === "opencode") return "opencode"
  return "sdk"
}

async function dispatchAgentFromHttp(
  sessionKey: string,
  taskText: string,
  messageIds?: string[],
): Promise<{ ok: boolean; error?: string }> {
  const route = resolveBoundAgentResourceType(sessionKey)
  if (route === "cli") return { ok: false, error: LEGACY_CLI_BIND_ERROR }
  if (route === "codex-missing") return { ok: false, error: CODEX_PROFILE_MISSING_ERROR }
  if (route === "opencode-missing") return { ok: false, error: OPENCODE_PROFILE_MISSING_ERROR }
  if (route === "claude-code") return dispatchToClaudeCodeAgent(sessionKey, taskText, messageIds)
  if (route === "codex") return dispatchToCodexAgent(sessionKey, taskText, messageIds)
  if (route === "opencode") return dispatchToOpencodeAgent(sessionKey, taskText, messageIds)
  const { dispatchToSdkAgent } = await import("./agent-sdk")
  return dispatchToSdkAgent(sessionKey, taskText, messageIds)
}

export async function launchSdkAgentFromHttp(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const sessionKey = typeof body.session_key === "string" ? body.session_key.trim() : ""
  if (!sessionKey) return { ok: false, error: "session_key is required" }

  const chatType = (typeof body.chat_type === "string" ? body.chat_type : "p2p") as ChatType
  const taskMessage = typeof body.task_text === "string" ? body.task_text : undefined
  const senderOpenId = typeof body.sender_open_id === "string" ? body.sender_open_id : undefined
  const chatName = typeof body.chat_name === "string" ? body.chat_name : undefined
  const channelId = typeof body.channel_id === "string" ? body.channel_id : undefined
  const explicitDir = typeof body.working_directory === "string" ? body.working_directory.trim() : ""
  const modelOverride = typeof body.model === "string" ? body.model : undefined
  const modelParamsOverride = typeof body.model_params === "string" ? body.model_params : undefined
  const useMain = body.use_main_workspace === true
  const chatId = typeof body.chat_id === "string" ? body.chat_id.trim() : sessionKey.split("::")[0]
  const messageIds = parseInboundMessageIds(body)
  const meta: LaunchMeta = { chatId, chatType: chatType === "group" ? "group" : "p2p", messageIds }

  const route = resolveBoundAgentResourceType(sessionKey, channelId)
  if (route === "cli") return { ok: false, error: LEGACY_CLI_BIND_ERROR }
  if (route === "codex-missing") return { ok: false, error: CODEX_PROFILE_MISSING_ERROR }
  if (route === "opencode-missing") return { ok: false, error: OPENCODE_PROFILE_MISSING_ERROR }
  if (route === "claude-code") return launchCcAgentFromHttp(body)
  if (route === "codex") return launchCodexAgentFromHttp(body)
  if (route === "opencode") return launchOpencodeAgentFromHttp(body)

  const channel = getChannel(channelId) ?? resolveChannelForSession(sessionKey)
  const resource = getAgentResource(channel?.agentResourceId)
  if (resource.type !== "sdk") {
    return { ok: false, error: "请配置 SDK、Claude Code、Codex 或 OpenCode 资源（设置 → Agent）" }
  }

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

  let model: string
  let modelParams: string
  if (modelOverride?.trim()) {
    model = modelOverride.trim()
    modelParams = modelParamsOverride ?? ""
  } else {
    const scenario: ModelScenario = useMain || isOwnTask ? "primary" : "others"
    const resolved = resolveChannelModel(channel, scenario)
    model = resolved.model
    modelParams = resolved.modelParams
  }

  const { launchSdkAgent } = await import("./agent-sdk")
  return launchSdkAgent({
    sessionKey, chatType, meta, workspaceDir: workDir, useMainWorkspace: useMain,
    senderOpenId, chatName, taskMessage,
    apiKey: resource.apiKey ?? "", model, modelParams,
  })
}

export function getAgentSdkApiPort(): number {
  return agentApiPort
}

/** 应用 init 启动 Agent API HTTP server */
export function ensureAgentSdkHttpServer(): void {
  if (agentApiServer) return
  agentApiServer = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      jsonAgentApi(res, { ok: false, error: "method not allowed" }, 405)
      return
    }
    const pathname = req.url?.split("?")[0] ?? ""
    try {
      const raw = await readAgentApiBody(req)
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
      if (pathname === "/api/agent/dispatch") {
        const session_key = typeof body.session_key === "string" ? body.session_key.trim() : ""
        const task_text = typeof body.task_text === "string" ? body.task_text : ""
        if (!session_key) {
          jsonAgentApi(res, { ok: false, error: "session_key is required" }, 400)
          return
        }
        const messageIds = parseInboundMessageIds(body)
        const result = await dispatchAgentFromHttp(session_key, task_text, messageIds)
        jsonAgentApi(res, result, result.ok ? 200 : 400)
        return
      }
      if (pathname === "/api/agent/launch") {
        const result = await launchSdkAgentFromHttp(body)
        jsonAgentApi(res, result, result.ok ? 200 : 400)
        return
      }
      jsonAgentApi(res, { ok: false, error: "not found" }, 404)
    } catch (e: unknown) {
      jsonAgentApi(res, { ok: false, error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  agentApiServer.listen(0, "127.0.0.1", () => {
    const addr = agentApiServer!.address()
    agentApiPort = typeof addr === "object" && addr ? addr.port : 0
    writeAgentApiPortFile(agentApiPort)
    pushUiLog("SDK", "INFO", `Agent API 监听 127.0.0.1:${agentApiPort}`)
  })
}
