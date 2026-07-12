// ── 多消息通道共享类型与工具 ─────────────────────────────
// Electron 主进程与 Daemon 子进程共用。

/** Agent 资源：N 个 SDK Key + N 个 Claude Code / Codex / OpenCode Profile */
export interface AgentResource {
  id: string;            // "sdk_<hex>" | "cc_<hex>" | "codex_<hex>" | "opencode_<hex>"
  type: "sdk" | "claude-code" | "codex" | "opencode";
  name: string;
  apiKey?: string;       // SDK / Profile 凭证
  /** 部署模式（仅 opencode）：内嵌启动本地 server 或连接外部实例 */
  deployMode?: "embedded" | "external";
  /** 内嵌 OpenCode server 主机名（仅 opencode + embedded） */
  opencodeHostname?: string;
  /** 内嵌 OpenCode server 端口（仅 opencode + embedded） */
  opencodePort?: number;
  /** Provider ID（仅 opencode），如 anthropic */
  providerId?: string;
  /** 校验成功后缓存的账号邮箱（仅展示用） */
  email?: string;
  /** 自定义 Anthropic 端点（仅 claude-code）；空值 = 使用 Anthropic 默认端点 */
  baseUrl?: string;
  /** 默认模型（仅 claude-code）；空值 = 使用 SDK 默认 */
  model?: string;
  /** daemon.log 绝对路径（Profile 级）；空 = 按工作目录 / userData 默认规则 */
  daemonLogPath?: string;
}

/** 消息通道：一个飞书自建应用 或 一个微信账号 */
export interface MessageChannel {
  id: string;            // "ch_<hex>"
  name: string;
  enabled: boolean;
  type: "feishu" | "wechat";
  // 飞书凭据
  larkAppId?: string;
  larkAppSecret?: string;
  larkAppQuickCreated?: boolean;
  /** 飞书机器人应用名缓存（凭据校验时解析，离线可显示） */
  larkBotName?: string;
  // 微信凭据
  wechatToken?: string;
  wechatAccountId?: string;
  /** 微信群聊入队：mention_required=须@机器人；all=全量入队（默认 mention_required） */
  wechatGroupEnqueueMode?: "mention_required" | "all";
  /** 微信机器人 @ 匹配别名，缺省用 name */
  wechatBotDisplayName?: string;
  // Agent 绑定
  agentResourceId: string;        // sdk / claude-code 资源 id
  model: string;                  // 主模型（"" / "auto" = 默认）
  modelParams: string;            // JSON 序列化的 {id,value}[]，仅 SDK
  othersModel: string;            // 其他人/群聊模型，空 = 跟随主模型
  othersModelParams: string;
  // 主用户（可选）
  mainUserEnabled: boolean;
  mainUserChatId: string;         // 原始 chatId（不含通道前缀）
  /** 主用户私聊每次新建会话（原全局 agentNewSession） */
  mainUserNewSession: boolean;
  // 其他人使用（通道级）
  allowOthers: boolean;
  /** 他人/群聊工作目录策略：isolated=按会话隔离临时目录；specified=指定目录 */
  othersWorkspaceMode: "isolated" | "specified";
  /** 仅 othersWorkspaceMode=specified 时生效；留空 = effectiveWorkspaceDir */
  othersWorkspaceDir: string;
  /** 对外身份规则，注入到其他人会话的临时工作目录 */
  digitalIdentity: string;
  // 工作目录，空 = 使用全局主工作目录
  workspaceDir: string;
}

/** 下发给 Daemon 的通道配置（含运行所需的全部字段） */
export interface DaemonChannelConfig {
  id: string;
  name: string;
  type: "feishu" | "wechat";
  appId?: string;
  appSecret?: string;
  wechatToken?: string;
  wechatAccountId?: string;
  /** 微信群聊入队策略；undefined 视为 mention_required */
  wechatGroupEnqueueMode?: "mention_required" | "all";
  /** @ 匹配别名，缺省用 name */
  wechatBotDisplayName?: string;
  mainUserEnabled: boolean;
  mainUserChatId: string;
  /** 是否响应其他人私聊及群聊 @ 消息 */
  allowOthers: boolean;
  /** 通道级工作目录，空 = 跟随全局 WORKSPACE_DIR */
  workspaceDir: string;
}

/** Daemon 上报的通道状态 */
export interface ChannelStatusInfo {
  id: string;
  name: string;
  type: "feishu" | "wechat";
  connected: boolean;
  /** wechat: disconnected/qr_pending/logging_in/connected/error；feishu: connected/connecting */
  status: string;
  mainUserBound: boolean;
  /** 飞书机器人应用名（app_name，群内显示名） */
  botName?: string;
}

// ── chatKey：全局唯一聊天标识 `${channelId}|${rawChatId}` ──

export const CHAT_KEY_SEP = "|";

export function makeChatKey(channelId: string, chatId: string): string {
  if (!channelId) return chatId;
  return `${channelId}${CHAT_KEY_SEP}${chatId}`;
}

export function parseChatKey(chatKey: string): { channelId?: string; chatId: string } {
  const idx = chatKey.indexOf(CHAT_KEY_SEP);
  if (idx > 0 && chatKey.startsWith("ch_")) {
    return { channelId: chatKey.slice(0, idx), chatId: chatKey.slice(idx + 1) };
  }
  return { chatId: chatKey };
}

/** 从 sessionKey（`chatKey` 或 `chatKey::workspaceDir`）解析 channelId */
export function channelIdFromSessionKey(sessionKey: string): string | undefined {
  const idx = sessionKey.indexOf("::");
  const chatKey = idx > 0 ? sessionKey.slice(0, idx) : sessionKey;
  return parseChatKey(chatKey).channelId;
}

// ── Agent 引擎类型与通道绑定推导 ──────────────────────

/** 四类可绑定 Agent 引擎 */
export type AgentEngineType = AgentResource["type"];

/** optgroup / 资源分组标签 SSOT（与 Agent 标签页命名一致） */
export const RESOURCE_GROUP_LABELS: Record<AgentEngineType, string> = {
  sdk: "Cursor SDK",
  "claude-code": "Claude Code Profile",
  codex: "Codex Profile",
  opencode: "OpenCode Profile",
};

/** Settings 引擎分块说明文案 */
export const ENGINE_BLOCK_SUBTITLES: Partial<Record<AgentEngineType, string>> = {
  sdk: "规则 / Skills / MCP 配置入口",
  "claude-code": "Claude Agent MCP 配置（只读查看）",
  codex: "Codex MCP（暂不支持在设置中管理）",
  opencode: "OpenCode MCP 配置（首版只读说明）",
};

/** 引擎展示固定顺序 */
const ENGINE_DISPLAY_ORDER: AgentEngineType[] = ["sdk", "claude-code", "codex", "opencode"];

/** 解析通道绑定的引擎类型；资源 id 失效时返回 undefined */
function resolveChannelEngineType(
  channel: MessageChannel,
  agentResources: AgentResource[],
): AgentEngineType | undefined {
  if (!channel.agentResourceId) return undefined;
  return agentResources.find((r) => r.id === channel.agentResourceId)?.type;
}

/**
 * 由通道绑定推导应展示的引擎类型列表。
 * enabled 与否均计入；绑定失效跳过；去重后按 sdk→claude-code→codex→opencode 返回。
 */
export function deriveBoundEngineTypes(
  channels: MessageChannel[],
  agentResources: AgentResource[],
): AgentEngineType[] {
  const bound = new Set<AgentEngineType>();
  for (const ch of channels) {
    const type = resolveChannelEngineType(ch, agentResources);
    if (type) bound.add(type);
  }
  return ENGINE_DISPLAY_ORDER.filter((t) => bound.has(t));
}

/** 列出绑定指定引擎的通道（保持 channels 数组顺序，供 Settings 副标题） */
export function channelsBoundToEngineType(
  engineType: AgentEngineType,
  channels: MessageChannel[],
  agentResources: AgentResource[],
): MessageChannel[] {
  return channels.filter((ch) => resolveChannelEngineType(ch, agentResources) === engineType);
}
