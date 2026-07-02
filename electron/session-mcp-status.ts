/**
 * Session MCP 取数器（T5/T3）
 * 按 sessionKey + engineType 取运行时 MCP 状态：
 * - CC activeQuery → query.mcpServerStatus()（runtime；抛错降级 snapshot）
 * - CC idle → lastMcpServersSnapshot（snapshot）；无 snapshot → cc-mcp-loader 读盘（disk）
 * - SDK session → lastInjectedMcpServers + fetchMcpStatusMap probe（runtime）
 * - 无任何 session + engineType=claude-code → cc-mcp-loader 读盘（disk，需 workspaceDir hint）
 * - 无任何 session → 空态（disk），让 UI 显示空列表
 * 聚合 T1（cc-mcp-loader）/T2（agent-cc-session-registry）/T3（agent-sdk）/T4（mcp-status-map）能力。
 * T3：读 ~/.claude.json projects[ws] 审批门控，对 project scope 条目标记 enabled/disabled；
 *   user/local scope 始终 enabled；runtime/snapshot 未返回的 Pending approval 条目从读盘补全。
 */
import * as fs from "node:fs"
import * as path from "node:path"
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk"
import { getCcSession, getCcActiveQuery } from "./agent-cc-session-registry"
import { getSdkSession } from "./agent-sdk"
import { loadInlineCcMcpServers, readCcProjectApproval } from "./cc-mcp-loader"
import { fetchMcpStatusMap } from "./mcp-status-map"
import { buildSdkRuntimeEntries } from "./session-mcp-sdk-path"
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
 * connected→ready、needs-auth→needs_login，其余保留或原样透传（含 disabled 透传）。
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
 *   authenticated 首版不处理 OAuth。
 *   command/args/url 仅在 cfg 有值时写入，避免 UI 渲染 "undefined"。
 * T3：approved 入参控制 enabled 标记——approved=false 置 enabled:false（project scope 审批未通过）；
 *   未传向后兼容默认 true（user/local scope + SDK 路径无 CC 审批门控）。
 */
function toEntry(
  name: string,
  cfg: Record<string, unknown>,
  source: "global" | "project",
  approved?: boolean,
): McpServerEntry {
  const type: "command" | "url" = cfg.url ? "url" : "command"
  const entry: McpServerEntry = {
    name,
    type,
    source,
    authenticated: false,
    rawConfig: cfg,
    // ponytail: approved 仅 false 时置 enabled:false；undefined/true 均 true（向后兼容）
    enabled: approved !== false,
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
function mapStatusToEntries(
  statuses: McpServerStatus[],
  approvedMap?: Map<string, boolean>,
): McpServerEntry[] {
  return statuses.map((s) =>
    toEntry(s.name, (s.config ?? {}) as Record<string, unknown>, "project", approvedMap?.get(s.name)),
  )
}

/** CC snapshot：lastMcpServersSnapshot → McpServerEntry[]；diskCfgs 用于补全缺 config 的项 */
function mapSnapshotToEntries(
  snapshot: McpSnapshotItem[],
  diskCfgs?: Record<string, Record<string, unknown>>,
  approvedMap?: Map<string, boolean>,
): McpServerEntry[] {
  return snapshot.map((s) =>
    toEntry(s.name, resolveSnapshotConfig(s, diskCfgs), "project", approvedMap?.get(s.name)),
  )
}

/** inline/注入快照 → McpServerEntry[]（SDK runtime 与 CC disk fallback 共用；status 由 probe/空态决定） */
function mapInjectedToEntries(
  cfgs: Record<string, Record<string, unknown>>,
  approvedMap?: Map<string, boolean>,
): McpServerEntry[] {
  return Object.entries(cfgs).map(([name, cfg]) =>
    toEntry(name, cfg ?? {}, "project", approvedMap?.get(name)),
  )
}

/** 从带 status 字段的列表构造 statusMap（仅 CC runtime/snapshot 调用；映射 CC 枚举→UI 词汇） */
function buildStatusMap(items: Array<{ name: string; status: string }>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const it of items) map[it.name] = mapCcStatusToUi(it.status)
  return map
}

/**
 * 读 {ws}/.mcp.json 的 server names（project scope 判定依据）。
 * ponytail: 与 cc-mcp-loader.filterApprovedProjectMcp 同样接受重复读盘——.mcp.json 小文件，
 *   避免新建 scope 标注抽象层；容错策略沿用 readMcpServersBlock（缺失/解析失败返回空集合）。
 */
function readProjectMcpNames(workspaceDir: string): Set<string> {
  try {
    const p = path.join(workspaceDir, ".mcp.json")
    if (!fs.existsSync(p)) return new Set()
    const cfg = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>
    const servers = (cfg.mcpServers ?? cfg.servers ?? {}) as Record<string, unknown>
    return new Set(Object.keys(servers))
  } catch {
    return new Set()
  }
}

/**
 * 计算全量 MCP 条目的审批标记（project scope 按 ~/.claude.json projects[ws] 审批门控）。
 * - user/local scope（不在 {ws}/.mcp.json）：始终 approved=true（02 §八·（二）user/local）
 * - project scope（在 {ws}/.mcp.json）：enableAll→true；disabled 命中→false；
 *   enabled 命中→true；均未命中→false（Pending approval，未加载但展示层需可见）
 * ponytail: 审批判定 inline 不抽策略类；project scope 判定靠 readProjectMcpNames 读 .mcp.json。
 */
function buildApprovedMap(
  names: string[],
  workspaceDir: string,
  approval: { enabled: string[]; disabled: string[]; enableAll: boolean },
): Map<string, boolean> {
  const projectNames = readProjectMcpNames(workspaceDir)
  const result = new Map<string, boolean>()
  for (const name of names) {
    if (!projectNames.has(name)) {
      // user/local scope：始终启用
      result.set(name, true)
      continue
    }
    // project scope：按审批门控判定
    if (approval.enableAll) result.set(name, true)
    else if (approval.disabled.includes(name)) result.set(name, false)
    else if (approval.enabled.includes(name)) result.set(name, true)
    else result.set(name, false) // Pending approval
  }
  return result
}

/**
 * 补全 statusMap/servers 中缺失的 disabled 条目（Pending approval 未加载，runtime/snapshot 不含）。
 * ponytail: 内联补全不抽策略类——existingNames 由调用侧构造（runtime status / snapshot item name），
 *   抽象需传多种集合类型，YAGNI；直接遍历 approvedMap 的 false 项补 toEntry+statusMap。
 */
function appendDisabledPending(
  allCfgs: Record<string, Record<string, unknown>>,
  approvedMap: Map<string, boolean>,
  existingNames: Set<string>,
  servers: McpServerEntry[],
  statusMap: Record<string, string>,
): void {
  for (const [name, approved] of approvedMap) {
    if (existingNames.has(name) || approved) continue
    servers.push(toEntry(name, allCfgs[name] ?? {}, "project", false))
    statusMap[name] = "disabled"
  }
}

/** 从 approvedMap 构造 disk 路径的 statusMap（无 runtime 探测，disabled 条目靠审批标记） */
function buildDiskStatusMap(approvedMap: Map<string, boolean>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [name, approved] of approvedMap) if (!approved) map[name] = "disabled"
  return map
}

/**
 * 按 sessionKey 取运行时 MCP 状态（展示层统一入口）。
 * dispatch 顺序：CC session（runtime→snapshot→disk）→ SDK session（runtime+force probe）
 * → CC 无 session 读盘 fallback（engineType hint）→ 空态。
 * T3：CC 三态路径读 readCcProjectApproval 标记 project scope enabled/disabled；
 *   runtime/snapshot 补全 Pending approval 的 disabled 条目；SDK 路径无 CC 审批门控不变。
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
    const ws = ccSession.workspaceDir ?? ""
    // T3：读审批状态供三态路径标记 project scope enabled/disabled（ws 空时容错全 enabled）
    const approval = ws ? readCcProjectApproval(ws) : { enabled: [], disabled: [], enableAll: false }
    const query = getCcActiveQuery(sessionKey)
    if (query) {
      try {
        const statuses = await query.mcpServerStatus()
        const diskCfgs = loadInlineCcMcpServers(ws) as Record<string, Record<string, unknown>>
        const approvedMap = buildApprovedMap(Object.keys(diskCfgs), ws, approval)
        const servers = mapStatusToEntries(statuses, approvedMap)
        const statusMap = buildStatusMap(statuses)
        // 补全 runtime 未返回的 Pending approval 条目（disabled 未加载，runtime list 不含）
        appendDisabledPending(diskCfgs, approvedMap, new Set(statuses.map((s) => s.name)), servers, statusMap)
        return { servers, statusMap, source: "runtime" }
      } catch {
        // ponytail: mcpServerStatus() 抛错时优雅降级到 snapshot，不 crash
      }
    }
    const snapshot = ccSession.lastMcpServersSnapshot
    if (snapshot && snapshot.length > 0) {
      // snapshot 仅含 {name,status}，缺 config 时读盘按 name 合并（失败降级，不抛错）
      let diskCfgs: Record<string, Record<string, unknown>> = {}
      try {
        diskCfgs = loadInlineCcMcpServers(ws) as Record<string, Record<string, unknown>>
      } catch {
        // 读盘失败：仅用 snapshot name/status，command 行不显示 undefined
      }
      const approvedMap = buildApprovedMap(Object.keys(diskCfgs), ws, approval)
      const servers = mapSnapshotToEntries(snapshot, diskCfgs, approvedMap)
      const statusMap = buildStatusMap(snapshot)
      appendDisabledPending(diskCfgs, approvedMap, new Set(snapshot.map((s) => s.name)), servers, statusMap)
      return { servers, statusMap, source: "snapshot" }
    }
    // snapshot 缺失 → 读盘（loadInlineCcMcpServers 已 resolve 路径，避免重建 buildEntry）
    const cfgs = loadInlineCcMcpServers(ws) as Record<string, Record<string, unknown>>
    const approvedMap = buildApprovedMap(Object.keys(cfgs), ws, approval)
    const servers = mapInjectedToEntries(cfgs, approvedMap)
    return { servers, statusMap: buildDiskStatusMap(approvedMap), source: "disk" }
  }

  // 2) SDK 路径：磁盘合并列表 + inline 快照标注，状态走 fetchMcpStatusMap probe
  if (sdkSession) {
    const ws = sdkSession.workspaceDir ?? ""
    const injected = sdkSession.lastInjectedMcpServers ?? {}
    const servers = buildSdkRuntimeEntries(ws, injected as Record<string, unknown>)
    const statusMap = await fetchMcpStatusMap(force ?? false, servers, ws, "sdk")
    return { servers, statusMap, source: "runtime" }
  }

  // 3) CC 无 session 读盘 fallback：UI engineType=claude-code 时按 workspaceDir 展示磁盘配置
  if (!ccSession && !sdkSession && engineType === "claude-code") {
    const ws = (workspaceDir ?? "").trim()
    if (ws) {
      const cfgs = loadInlineCcMcpServers(ws) as Record<string, Record<string, unknown>>
      const approvedMap = buildApprovedMap(Object.keys(cfgs), ws, readCcProjectApproval(ws))
      const servers = mapInjectedToEntries(cfgs, approvedMap)
      return { servers, statusMap: buildDiskStatusMap(approvedMap), source: "disk" }
    }
  }

  // 4) 无任何 session → 空态（disk），UI 显示空列表
  return { servers: [], statusMap: {}, source: "disk" }
}
