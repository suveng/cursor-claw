/**
 * OpenCode SDK 公共类型（仿 agent-codex-types）。
 */
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { ChatType, LaunchMeta } from "../shared/agent-launcher"
import type { ContextUsageState } from "../cursor-sdk/context-usage"

/** launchOpencodeAgent 入参 */
export interface OpencodeLaunchOptions {
  sessionKey: string
  chatType: ChatType
  meta?: LaunchMeta
  workspaceDir: string
  useMainWorkspace?: boolean
  senderOpenId?: string
  chatName?: string
  taskMessage?: string
  providerId: string
  apiKey: string
  model?: string
  deployMode: "embedded" | "external"
  opencodeHostname?: string
  opencodePort?: number
  baseUrl?: string
  profileResourceId?: string
}

/** 内嵌 server + client 句柄 */
export interface OpencodeClientBundle {
  client: OpencodeClient
  server?: { url: string; close(): void }
  deployMode: "embedded" | "external"
}

/** Profile model 空时默认（providerID/modelID） */
export const OPENCODE_DEFAULT_MODEL = "anthropic/claude-3-5-sonnet-20241022"

/** OpenCode 会话运行时状态 */
export interface OpencodeSessionAgent {
  sessionKey: string
  opencodeSessionId: string | null
  activeClient: OpencodeClient | null
  embeddedServer?: { url: string; close(): void }
  deployMode: "embedded" | "external"
  providerId: string
  apiKey: string
  model?: string
  profileResourceId?: string
  opencodeHostname?: string
  opencodePort?: number
  /** 最后一次用户 prompt，供主进程重启 recover 重发 */
  lastTaskMessage?: string
  startedAt: number
  lastActivityAt: number
  chatType: ChatType
  workspaceDir?: string
  senderOpenId?: string
  chatName?: string
  meta?: LaunchMeta
  useMainWorkspace?: boolean
  abortController: AbortController
  f41Stream: boolean
  streamBuffer: string
  outboundMessageId?: string
  toolPresentationOutboundIds?: Map<string, string>
  streamId?: string
  streamLastPostAt?: number
  streamPostTimer?: ReturnType<typeof setTimeout>
  streamPostChain?: Promise<void>
  errorNotified?: boolean
  lastStatus?: { status: string; message?: string }
  lastTool?: { name: string; status: string }
  residentMode: boolean
  pendingDispatch: boolean
  runStartedAt?: number
  seenProcessEvent?: boolean
  presentationDeferStream?: boolean
  thinkingOpen?: boolean
  contextUsage: ContextUsageState
  contextUsagePeakTokens?: number
  contextUsageFromRunTotal?: number
  contextLimitTokens?: number
  inboundMessageIds?: string[]
  runFinalizing?: boolean
  failureArchiveDone?: boolean
  runGuardToken?: string
  watchdogState: "running" | "draining" | "cancelling"
  watchdogStateAt: number
  watchdogTimedOut?: boolean
  logAgg: { kind: "thinking" | "text" | null; buf: string }
  eventLoopRunning?: boolean
}
