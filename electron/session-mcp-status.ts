/**
 * Session MCP 取数器（T5）
 * 按 sessionKey + engineType 取运行时 MCP 状态：
 * - CC activeQuery → query.mcpServerStatus()（runtime；抛错降级 snapshot）
 * - CC idle → lastMcpServersSnapshot（snapshot）；无 snapshot → cc-mcp-loader 读盘（disk）
 * - SDK session → lastInjectedMcpServers + fetchMcpStatusMap probe（runtime）
 * - 无任何 session + engineType=claude-code → cc-mcp-loader 读盘（disk，需 workspaceDir hint）
 * - 无任何 session → 空态（disk），让 UI 显示空列表
 * 聚合 T1（cc-mcp-loader）/T2（agent-cc-session-registry）/T3（agent-sdk）/T4（mcp-status-map）能力。
 */
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk"
import { getCcSession, getCcActiveQuery } from "./agent-cc-session-registry"
import { getSdkSession } from "./agent-sdk"
import { loadInlineCcMcpServers } from "./cc-mcp-loader"
import { fetchMcpStatusMap } from "./mcp-status-map"
import type { McpServerEntry } from "./mcp-types"

/** 取数来源：runtime=运行时探测 / snapshot=session 缓存 / disk=读盘 */
export type McpStatusSource = "runtime" | "snapshot" | "disk"

/** getSessionMcpStatus 返回结构（展示层按 source 三态渲染） */
export interface AgentMcpStatusResult {
  servers: McpServerEntry[]
  statusMap: Record<string, string>
  source: McpStatusSource
}

/** CC session MCP 快照元素（与 CcSessionAgent.lastMcpServersSnapshot 元素结构对齐） */
interface McpSnapshotItem {
  name: string
  status: string
  config?: unknown
  scope?: string
  tools?: unknown[]
}

/** config 是否为空（缺字段或空对象） */
function isEmptyConfig(cfg: unknown): boolean {
  return !cfg || (typeof cfg === "object" && Object.keys(cfg as object).length === 0)
}

/**
 * CC SDK status 枚举 → UI 展示词汇（仅 buildStatusMap 使用；SDK probe 路径不经此映射）。
 * connected→ready、needs-auth→needs_login，其余保留或原样透传。
 */
function mapCcStatusToUi(status: string): string {
  switch (status) {
    case "connected":
      return "ready"
    case "needs-auth":
      return "needs_login"
    case "failed":
    case "pending":
    case "disabled":
      return status
    default:
      return status
  }
}

/**
 * 通用字段提取：从 config-like 对象构造 McpServerEntry。
 * ponytail: 兼容 stdio（command/args/env）与 http/sse（url/headers），不区分 CC/SDK 配置源；
 *   source 统一标 "project"（CC .mcp.json + ~/.claude.json 合并、SDK .cursor/mcp.json project 覆盖），
 *   authenticated 首版不处理 OAuth，enabled 默认 true。
 *   command/args/url 仅在 cfg 有值时写入，避免 UI 渲染 "undefined"。
 */
function toEntry(name: string, cfg: Record<string, unknown>, source: "global" | "project"): McpServerEntry {
  const type: "command" | "url" = cfg.url ? "url" : "command"
  const entry: McpServerEntry = {
    name,
    type,
    source,
    authenticated: false,
    rawConfig: cfg,
    enabled: true,
  }
  if (cfg.url) entry.url = cfg.url as string
  else entry.command = (cfg.command as string | undefined) ?? "" // 缺 command 时用空串，避免 UI 渲染 "undefined"
  if (cfg.args) entry.args = cfg.args as string[]
  if (cfg.env) entry.env = cfg.env as Record<string, string>
  return entry
}

/** snapshot 项缺 config 时从读盘结果按 name 补全 */
function resolveSnapshotConfig(
  item: McpSnapshotItem,
  diskCfgs?: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const snapCfg = item.config as Record<string, unknown> | undefined
  if (!isEmptyConfig(snapCfg)) return snapCfg!
  return diskCfgs?.[item.name] ?? {}
}

/** CC runtime：McpServerStatus[] → McpServerEntry[]（statusMap 由调用侧从 status 字段构造） */
function mapStatusToEntries(statuses: McpServerStatus[]): McpServerEntry[] {
  return statuses.map((s) => toEntry(s.name, (s.config ?? {}) as Record<string, unknown>, "project"))
}

/** CC snapshot：lastMcpServersSnapshot → McpServerEntry[]；diskCfgs 用于补全缺 config 的项 */
function mapSnapshotToEntries(
  snapshot: McpSnapshotItem[],
  diskCfgs?: Record<string, Record<string, unknown>>,
): McpServerEntry[] {
  return snapshot.map((s) => toEntry(s.name, resolveSnapshotConfig(s, diskCfgs), "project"))
}

/** inline/注入快照 → McpServerEntry[]（SDK runtime 与 CC disk fallback 共用；status 由 probe/空态决定） */
function mapInjectedToEntries(cfgs: Record<string, Record<string, unknown>>): McpServerEntry[] {
  return Object.entries(cfgs).map(([name, cfg]) => toEntry(name, cfg ?? {}, "project"))
}

/** 从带 status 字段的列表构造 statusMap（仅 CC runtime/snapshot 调用；映射 CC 枚举→UI 词汇） */
function buildStatusMap(items: Array<{ name: string; status: string }>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const it of items) map[it.name] = mapCcStatusToUi(it.status)
  return map
}

/**
 * 按 sessionKey 取运行时 MCP 状态（展示层统一入口）。
 * dispatch 顺序：CC session（runtime→snapshot→disk）→ SDK session（runtime+force probe）
 * → CC 无 session 读盘 fallback（engineType hint）→ 空态。
 */
export async function getSessionMcpStatus(
  sessionKey: string,
  force?: boolean,
  engineType?: string,
  workspaceDir?: string,
): Promise<AgentMcpStatusResult> {
  const ccSession = getCcSession(sessionKey)
  const sdkSession = getSdkSession(sessionKey)

  // 1) CC 路径：activeQuery 优先 runtime，抛错降级 snapshot；idle 用 snapshot；均无则读盘
  if (ccSession) {
    const query = getCcActiveQuery(sessionKey)
    if (query) {
      try {
        const statuses = await query.mcpServerStatus()
        return { servers: mapStatusToEntries(statuses), statusMap: buildStatusMap(statuses), source: "runtime" }
      } catch {
        // ponytail: mcpServerStatus() 抛错时优雅降级到 snapshot，不 crash
      }
    }
    const snapshot = ccSession.lastMcpServersSnapshot
    if (snapshot && snapshot.length > 0) {
      // snapshot 仅含 {name,status}，缺 config 时读盘按 name 合并（失败降级，不抛错）
      let diskCfgs: Record<string, Record<string, unknown>> = {}
      try {
        diskCfgs = loadInlineCcMcpServers(ccSession.workspaceDir ?? "") as Record<string, Record<string, unknown>>
      } catch {
        // 读盘失败：仅用 snapshot name/status，command 行不显示 undefined
      }
      return {
        servers: mapSnapshotToEntries(snapshot, diskCfgs),
        statusMap: buildStatusMap(snapshot),
        source: "snapshot",
      }
    }
    // snapshot 缺失 → 读盘（loadInlineCcMcpServers 已 resolve 路径，避免重建 buildEntry）
    const cfgs = loadInlineCcMcpServers(ccSession.workspaceDir ?? "")
    const servers = mapInjectedToEntries(cfgs as Record<string, Record<string, unknown>>)
    return { servers, statusMap: {}, source: "disk" }
  }

  // 2) SDK 路径：注入快照转 entries，状态走 fetchMcpStatusMap probe（force 透传，默认 30s 缓存）
  if (sdkSession) {
    const injected = sdkSession.lastInjectedMcpServers ?? {}
    const servers = mapInjectedToEntries(injected as Record<string, Record<string, unknown>>)
    const statusMap = await fetchMcpStatusMap(force ?? false, servers, sdkSession.workspaceDir ?? "", "sdk")
    return { servers, statusMap, source: "runtime" }
  }

  // 3) CC 无 session 读盘 fallback：UI engineType=claude-code 时按 workspaceDir 展示磁盘配置
  if (!ccSession && !sdkSession && engineType === "claude-code") {
    const ws = (workspaceDir ?? "").trim()
    if (ws) {
      const cfgs = loadInlineCcMcpServers(ws)
      const servers = mapInjectedToEntries(cfgs as Record<string, Record<string, unknown>>)
      return { servers, statusMap: {}, source: "disk" }
    }
  }

  // 4) 无任何 session → 空态（disk），UI 显示空列表
  return { servers: [], statusMap: {}, source: "disk" }
}
