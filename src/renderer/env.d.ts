/// <reference path="./types/mcp.d.ts" />

declare module "*.png" {
  const src: string
  export default src
}

import type { WorkflowDefinition, WorkflowInstance } from "../shared/workflow-types"

interface AgentResource {
  id: string
  /** sdk=Cursor SDK Key；claude-code/cc/codex/opencode=各引擎 Profile */
  type: "sdk" | "claude-code" | "codex" | "opencode"
  name: string
  apiKey?: string
  deployMode?: "embedded" | "external"
  opencodeHostname?: string
  opencodePort?: number
  providerId?: string
  email?: string
  /** 自定义 Anthropic 端点（仅 claude-code）；空值 = 使用 Anthropic 默认端点 */
  baseUrl?: string
  /** 默认模型（仅 claude-code）；空值 = 使用 SDK 默认 */
  model?: string
}

/** 注意：避免与 DOM 内置 MessageChannel 类型冲突，这里命名为 ChannelConfig */
interface ChannelConfig {
  id: string
  name: string
  enabled: boolean
  type: "feishu" | "wechat"
  larkAppId?: string
  larkAppSecret?: string
  larkAppQuickCreated?: boolean
  larkBotName?: string
  wechatToken?: string
  wechatAccountId?: string
  agentResourceId: string
  model: string
  modelParams: string
  othersModel: string
  othersModelParams: string
  mainUserEnabled: boolean
  mainUserChatId: string
  mainUserNewSession: boolean
  allowOthers: boolean
  othersWorkspaceMode: "isolated" | "specified"
  othersWorkspaceDir: string
  digitalIdentity: string
  workspaceDir: string
}

interface ChannelStatusInfo {
  id: string
  name: string
  type: "feishu" | "wechat"
  connected: boolean
  status: string
  mainUserBound: boolean
  botName?: string
}

interface AppConfig {
  agentResources: AgentResource[]
  channels: ChannelConfig[]
  workspaceDir: string
  /** 崩溃分析根目录，空=未配置 */
  crashAnalysisDir: string
  autoStart: boolean
  setupComplete: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
  closeWindowAction: "ask" | "minimize" | "quit"
  allowOthers: boolean
  digitalIdentity: string
  // 旧字段（Setup 向导兼容）
  larkAppId: string
  larkAppSecret: string
  larkAppQuickCreated: boolean
  larkReceiveId: string
  model: string
  modelParams: string
  agentNewSession: boolean
  feishuEnabled: boolean
  wechatEnabled: boolean
  wechatToken: string
  wechatAccountId: string
  agentMode: "sdk"
  cursorApiKey: string
  /** 历史 CLI 绑定已迁移，Dashboard 待展示一次性提示 Banner */
  cliMigrationPending?: boolean
}

interface ScheduledTask {
  id: string
  name: string
  cron: string
  content: string
  enabled: boolean
  independent?: boolean
  channelId?: string
  model?: string
  modelParams?: string
}

interface SkillTreeNode {
  name: string
  type: "file" | "directory"
  children?: SkillTreeNode[]
}

interface DaemonStatus {
  running: boolean
  starting?: boolean
  version?: string
  uptime?: number
  queueLength?: number
  hasChatId?: boolean
  agentRunning?: boolean
  agentPid?: number | null
  sessionAgentCount?: number
  cliAvailable?: boolean
  error?: string
  workspaceMismatch?: boolean
  daemonWorkspaceDir?: string
  channels?: ChannelStatusInfo[]
  feishuEnabled?: boolean
  feishuConnected?: boolean
  wechatEnabled?: boolean
  wechatStatus?: string
  wechatReady?: boolean
}

interface AppModalRequestPayload {
  requestId: string
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
  variant?: "info" | "error" | "warning"
}

interface ConfigSaveResult {
  ok: boolean
  needWorkspaceConfirm?: boolean
  oldWorkspaceDir?: string
  newWorkspaceDir?: string
  existingSessions?: { sessionKey: string; chatName?: string }[]
  deferredSetupComplete?: boolean
  workspaceDirChanged?: boolean
}

interface ElectronAPI {
  getAppVersion(): Promise<string>
  checkAppUpdate(): Promise<
    | { status: "dev"; currentVersion: string; message: string }
    | { status: "error"; currentVersion: string; message: string }
    | { status: "latest"; currentVersion: string; latestVersion: string }
    | {
        status: "available"
        currentVersion: string
        latestVersion: string
        htmlUrl: string
        applyHint: string
        releaseNotes: string
      }
    | {
        status: "ready"
        currentVersion: string
        latestVersion: string
        htmlUrl: string
        applyHint: string
        releaseNotes: string
      }
  >
  applyAppUpdate(): Promise<{ ok: boolean; error?: string; message?: string }>
  onUpdaterProgress(cb: (percent: number) => void): () => void
  onUpdaterError(cb: (message: string) => void): () => void
  onUpdaterStatus(cb: (payload: { kind: "available" } | { kind: "downloaded"; version: string } | { kind: "downloading" }) => void): () => void
  getConfig(): Promise<AppConfig>
  saveConfig(config: Partial<AppConfig>): Promise<ConfigSaveResult>
  markCliMigrationNotified(): Promise<{ ok: boolean }>
  setAutoStart(enabled: boolean): Promise<{ ok: boolean }>
  applyWorkspaceSwitch(workspaceDir: string, stopOldSessions: boolean): Promise<{ ok: boolean; error?: string }>
  respondWindowClose(payload: { action: "minimize" | "quit" | "cancel"; remember: boolean }): Promise<void>
  selectDirectory(): Promise<string | null>
  injectWorkspace(): Promise<{ results: { file: string; action: "created" | "updated" | "skipped"; message: string }[] }>
  startDaemon(): Promise<{ ok: boolean; error?: string }>
  stopDaemon(): Promise<void>
  stopAgent(): Promise<{ ok: boolean }>
  getSessionAgents(): Promise<{ sessionKey: string; pid: number; startedAt: number; chatType: string; lastActivityAt: number; chatName?: string; workspaceDir?: string; engineType: "sdk" | "claude-code" | "codex" | "opencode" }[]>
  stopSessionAgent(sessionKey: string): Promise<{ ok: boolean }>
  stopAllSessionAgents(): Promise<{ ok: boolean }>
  onSessionAgents(cb: (list: { sessionKey: string; pid: number; startedAt: number; chatType: string; lastActivityAt: number; chatName?: string; workspaceDir?: string; engineType: "sdk" | "claude-code" | "codex" | "opencode" }[]) => void): () => void
  getDaemonStatus(): Promise<DaemonStatus>
  getLogBuffer(): Promise<string[]>
  getQueueMessages(): Promise<{ index: number; fileId: string; preview: string; sessionKey?: string; chatType?: string; timestamp?: number; senderOpenId?: string }[]>
  deleteQueueMessage(fileId: string): Promise<boolean>
  clearQueueMessages(): Promise<number>
  checkSdkApiKey(apiKey: string): Promise<{ ok: boolean; email?: string; error?: string }>
  listSdkModels(apiKey: string, currentModel?: string, currentParams?: string): Promise<{ ok: boolean; models: { id: string; label: string; params: string; current: boolean }[]; error?: string }>
  /** 校验 Claude Code API Key 有效性 */
  checkCcApiKey(apiKey: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }>
  /** 列出 Claude Code 可用模型（静态列表，无需 apiKey） */
  listCcModels(): Promise<Array<{ id: string; label: string }>>
  /** 列出 Codex 可用模型（静态清单，无需 apiKey） */
  listCodexModels(): Promise<Array<{ id: string; label: string }>>
  getScheduledTasks(): Promise<ScheduledTask[]>
  saveScheduledTasks(tasks: ScheduledTask[]): Promise<{ ok: boolean }>
  validateCron(expression: string): Promise<boolean>
  previewCronNextRuns(expression: string): Promise<{ ok: true; runs: string[] } | { ok: false; error: string }>
  triggerScheduledTask(taskId: string): Promise<{ ok: boolean; error?: string }>
  getScheduledTaskStatus(): Promise<Record<string, { running: boolean; pid?: number; startedAt?: number }>>
  onScheduledTaskStatus(cb: (statuses: Record<string, { running: boolean; pid?: number; startedAt?: number }>) => void): () => void
  getMcpServers(): Promise<McpServerEntry[]>
  listMcpForWorkspace(workspaceDir: string): Promise<McpServerEntry[]>
  saveMcpServer(name: string, entry: Record<string, unknown>, source: "global" | "project"): Promise<{ ok: boolean }>
  deleteMcpServer(name: string): Promise<{ ok: boolean }>
  loginMcp(name: string, workspaceDir?: string): Promise<{ ok: boolean; output: string }>
  toggleMcp(name: string, enabled: boolean): Promise<{ ok: boolean; output: string }>
  getMcpEnabledMap(force?: boolean): Promise<Record<string, boolean>>
  getMcpStatusMap(force?: boolean, workspaceDir?: string): Promise<Record<string, string>>
  /** 按 sessionKey 取运行时 MCP 状态（CC runtime/snapshot/disk、SDK 注入快照；force 跳过 probe 缓存） */
  getAgentMcpStatus(
    sessionKey: string,
    force?: boolean,
    engineType?: string,
    workspaceDir?: string,
  ): Promise<AgentMcpStatusResult>
  getMcpTools(name: string, workspaceDir?: string): Promise<{ ok: boolean; tools: { name: string; description?: string; params?: { name: string; type?: string; description?: string; required?: boolean }[] }[]; error?: string }>
  getRules(): Promise<{ name: string; content: string }[]>
  saveRule(name: string, content: string): Promise<{ ok: boolean }>
  deleteRule(name: string): Promise<{ ok: boolean }>
  getSkills(): Promise<{ name: string; content: string }[]>
  getSkillTree(): Promise<SkillTreeNode[]>
  readSkillFile(skillName: string, relativePath: string): Promise<{ ok: boolean; content?: string; error?: string }>
  saveSkillFile(skillName: string, relativePath: string, content: string): Promise<{ ok: boolean }>
  deleteSkillFile(skillName: string, relativePath: string): Promise<{ ok: boolean; error?: string }>
  createSkillDir(skillName: string, relativePath: string): Promise<{ ok: boolean }>
  saveSkill(name: string, content: string): Promise<{ ok: boolean }>
  renameSkill(oldName: string, newName: string): Promise<{ ok: boolean }>
  deleteSkill(name: string): Promise<{ ok: boolean }>
  onMcpLoginComplete(cb: (data: { serverName: string; ok: boolean }) => void): () => void
  onDaemonStatus(cb: (status: DaemonStatus) => void): () => void
  onDaemonLog(cb: (line: string) => void): () => void
  onWechatStatus(cb: (status: string, channelId?: string) => void): () => void
  onWechatQrCode(cb: (dataUrl: string, channelId?: string) => void): () => void
  onBindResult(cb: (data: { ok: boolean; value: string; channelId?: string }) => void): () => void
  onWindowCloseConfirm(cb: () => void): () => void
  onAppModalRequest(cb: (payload: AppModalRequestPayload) => void): () => void
  respondAppModal(requestId: string, response: number): Promise<void>
  startTempConnection(appId: string, appSecret: string): Promise<{ ok: boolean; chatId?: string; error?: string }>
  stopTempConnection(): Promise<{ ok: boolean }>
  windowMinimize(): Promise<void>
  windowMaximize(): Promise<void>
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>
  onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void

  // ── Workflow ──────────────────────────────────────────
  getWorkflowDefinitions(): Promise<WorkflowDefinition[]>
  saveWorkflowDefinition(def: WorkflowDefinition): Promise<{ ok: boolean }>
  deleteWorkflowDefinition(id: string): Promise<{ ok: boolean }>
  getWorkflowInstances(): Promise<WorkflowInstance[]>
  getWorkflowInstance(id: string): Promise<WorkflowInstance | undefined>
  saveWorkflowInstance(inst: WorkflowInstance): Promise<{ ok: boolean }>
  deleteWorkflowInstance(id: string): Promise<{ ok: boolean }>
  runWorkflow(workflowId: string, input?: string): Promise<{ ok: boolean; error?: string; instanceId?: string }>
  onWorkflowInstanceUpdate(cb: (inst: WorkflowInstance) => void): () => void

  testBind(channelId?: string): Promise<{ ok: boolean; error?: string }>
  fetchFeishuAppInfo(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string; openId?: string; error?: string }>
  testWechat(): Promise<{ ok: boolean; error?: string }>
  startChannelBind(channelId: string): Promise<{ ok: boolean; chatId?: string; error?: string }>
  cancelChannelBind(channelId: string): Promise<{ ok: boolean }>
  unbindChannel(channelId: string): Promise<{ ok: boolean }>
  feishuRegisterApp(preset?: { name?: string; desc?: string }): Promise<{ ok: boolean; appId?: string; appSecret?: string; error?: string }>
  feishuRegisterAppCancel(): Promise<{ ok: boolean }>
  onFeishuSetupQrCode(cb: (url: string) => void): () => void
  onFeishuSetupStatus(cb: (status: string) => void): () => void
  wechatQrLogin(): Promise<{ ok: boolean; botToken?: string; accountId?: string; baseUrl?: string; error?: string }>
  wechatQrLoginCancel(): Promise<{ ok: boolean }>
  wechatWaitFirstMessage(token: string, accountId: string, channelId?: string): Promise<{ ok: boolean; chatId?: string; error?: string }>
  wechatCancelWaitMessage(): Promise<{ ok: boolean }>
  onWechatSetupQrCode(cb: (url: string) => void): () => void
  onWechatSetupStatus(cb: (status: string) => void): () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
