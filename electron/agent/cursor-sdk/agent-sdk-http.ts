/**
 * SDK Agent HTTP 桥接（对称 agent-cc-http.ts）
 * launch/dispatch 经动态 import 避免与 agent-sdk 循环依赖。
 */
import * as http from "node:http"
import { join } from "node:path"
import { writeFileSync, mkdirSync } from "node:fs"
import { app } from "electron"
import {
  getConfig, getChannel, getAgentResource, isCodexResourceId, isOpencodeResourceId,
  resolveChannelForSession,
} from "../../config/config-store"
import { launchCcAgentFromHttp } from "../claude-code/agent-cc-http"
import { dispatchToClaudeCodeAgent } from "../claude-code/agent-claude-sdk"
import { launchCodexAgentFromHttp } from "../codex/agent-codex-http"
import { dispatchToCodexAgent } from "../codex/agent-codex-sdk"
import { launchOpencodeAgentFromHttp } from "../opencode/agent-opencode-http"
import { dispatchToOpencodeAgent } from "../opencode/agent-opencode-sdk"
import { pushUiLog } from "../../app/ui-logger"
import {
  isOwnTaskChatType,
  parseInboundMessageIds,
  parseLaunchRequestBody,
  resolveLaunchModel,
  resolveLaunchWorkDir,
} from "../shared/launch-request-resolve"
import { getEnginePort } from "../shared/agent-engine-port"
import { registerCursorEnginePort } from "./engine-port-adapter"
import { registerCcEnginePort } from "../claude-code/engine-port-adapter"
import { registerCodexEnginePort } from "../codex/engine-port-adapter"
import { registerOpencodeEnginePort } from "../opencode/engine-port-adapter"
import { getMcpStatusMap } from "../../mcp/mcp-manager"

registerCcEnginePort()
registerCodexEnginePort()
registerOpencodeEnginePort()

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
  const port = getEnginePort(route)
  if (port) return port.dispatch(sessionKey, taskText, messageIds)
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
  const parsedResult = parseLaunchRequestBody(body)
  if (!parsedResult.ok) return parsedResult

  const {
    sessionKey, chatType, taskMessage, senderOpenId, chatName, channelId,
    explicitWorkDir, useMain, meta,
  } = parsedResult.parsed

  const route = resolveBoundAgentResourceType(sessionKey, channelId)
  const port = getEnginePort(route)
  if (port) {
    return port.launch({
      sessionKey,
      taskText: taskMessage,
      chatType,
      messageIds: parsedResult.parsed.messageIds,
      workspaceDir: explicitWorkDir,
      useMainWorkspace: useMain,
      senderOpenId,
      chatName,
    })
  }
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

  const isOwnTask = isOwnTaskChatType(chatType)
  if (!useMain && !isOwnTask && !channel?.allowOthers) {
    return { ok: false, error: `通道「${channel?.name ?? "未知"}」未启用其他人使用` }
  }

  const workDirResult = resolveLaunchWorkDir({
    sessionKey, chatType, explicitDir: explicitWorkDir, useMain, channel,
  })
  if (!workDirResult.ok) return { ok: false, error: workDirResult.error }

  const { model, modelParams } = resolveLaunchModel({
    engine: "sdk",
    modelOverride: parsedResult.parsed.modelOverride,
    modelParamsOverride: parsedResult.parsed.modelParamsOverride,
    resource,
    channel,
    useMain,
    chatType,
  })

  const { launchSdkAgent } = await import("./agent-sdk")
  return launchSdkAgent({
    sessionKey, chatType, meta, workspaceDir: workDirResult.workDir, useMainWorkspace: useMain,
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
  registerCursorEnginePort()
  // 长驻空闲后台预热：与 HTTP 网关同生命周期启动（timer.unref）
  void import("./sdk-resident-bg-warmup").then((m) => m.startResidentBgWarmup())
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
      if (pathname === "/api/command/execute") {
        const { handleCommandExecuteHttp } = await import("./agent-command-http")
        const cmdResult = await handleCommandExecuteHttp(body)
        jsonAgentApi(res, cmdResult.body, cmdResult.httpStatus)
        return
      }
      if (pathname === "/api/mcp/status-map") {
        // Daemon fetchElectronMcpStatusMap 健康探测；直接委托 getMcpStatusMap，不经 IPC/.fcmd
        const workspaceDir =
          typeof body.workspaceDir === "string" ? body.workspaceDir.trim() || undefined : undefined
        const force = body.force === true
        try {
          const statusMap = await getMcpStatusMap(force, workspaceDir)
          jsonAgentApi(res, { ok: true, statusMap }, 200)
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          jsonAgentApi(res, { ok: false, error: msg || "获取 MCP 健康状态失败" }, 503)
        }
        return
      }
      if (pathname === "/api/sdk-warmup") {
        const { warmupSdkAfterBind } = await import("./sdk-warmup")
        const source = typeof body.source === "string" ? body.source.trim() : "unknown"
        const channelId = typeof body.channel_id === "string" ? body.channel_id.trim() : ""
        const workspaceOverride = typeof body.workspace_dir === "string" ? body.workspace_dir.trim() : ""
        const channel = channelId ? getChannel(channelId) : undefined
        const resource = getAgentResource(channel?.agentResourceId)
        const workspaceDir = workspaceOverride || channel?.workspaceDir?.trim() || getConfig().workspaceDir?.trim() || ""
        const apiKey = resource?.type === "sdk" ? resource.apiKey?.trim() : ""
        warmupSdkAfterBind({ apiKey, workspaceDir, source })
        jsonAgentApi(res, { ok: true }, 200)
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
