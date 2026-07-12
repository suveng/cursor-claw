import { useState, useEffect, useCallback } from "react"
import { RefreshCw, Terminal, ShieldCheck, ShieldAlert } from "lucide-react"
import type { AgentEngineType } from "../../shared/channel-types"
import {
  getMcpViewConfig,
  formatMcpScopeLabel,
  formatMcpStatusSourceLabel,
  type McpEngineType,
} from "../lib/mcp-view-strategy"
import SettingsMcpSdkSection from "./SettingsMcpSdkSection"

interface Props {
  engineType: AgentEngineType
  workspaceDir: string
}

/** 只读磁盘 MCP 块支持的引擎（Settings 不提供编辑） */
type DiskReadonlyEngine = Extract<McpEngineType, "claude-code" | "codex" | "opencode">

/** 各只读引擎配置文件路径说明 */
const DISK_READONLY_PATHS: Record<DiskReadonlyEngine, { global: string; projectSuffix: string; format: string }> = {
  "claude-code": {
    global: "~/.claude.json",
    projectSuffix: "/.mcp.json",
    format: "JSON",
  },
  codex: {
    global: "~/.codex/config.toml",
    projectSuffix: "/.codex/config.toml",
    format: "TOML",
  },
  opencode: {
    global: "~/.config/opencode/opencode.json",
    projectSuffix: "/opencode.json",
    format: "JSON",
  },
}

/** Settings MCP Tab：按引擎类型分块展示（SDK CRUD / 多引擎只读磁盘配置） */
export default function SettingsMcpEngineBlock({ engineType, workspaceDir }: Props) {
  switch (engineType) {
    case "sdk":
      return <SettingsMcpSdkSection workspaceDir={workspaceDir} />
    case "claude-code":
    case "codex":
    case "opencode":
      return <SettingsMcpDiskReadonly engineType={engineType} workspaceDir={workspaceDir} />
    default:
      return null
  }
}

/** 多引擎只读磁盘配置：getAgentMcpStatus 无 session 读盘 + 刷新 */
function SettingsMcpDiskReadonly({
  engineType,
  workspaceDir,
}: {
  engineType: DiskReadonlyEngine
  workspaceDir: string
}) {
  const viewConfig = getMcpViewConfig(engineType)
  const pathInfo = DISK_READONLY_PATHS[engineType]
  const ws = workspaceDir.trim()

  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [statusSource, setStatusSource] = useState<AgentMcpStatusResult["source"]>("disk")

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.getAgentMcpStatus("", false, engineType, ws)
      setServers(res.servers)
      setStatusSource(res.source)
    } finally {
      setLoading(false)
    }
  }, [engineType, ws])

  useEffect(() => { void loadStatus() }, [loadStatus])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 text-xs">
        <p className="font-medium text-gray-300">{viewConfig.title}</p>
        <p className="mt-1 text-gray-600">
          用户级：<span className="font-mono text-gray-500">{pathInfo.global}</span>；
          项目级：<span className="font-mono text-gray-500">{ws ? `${ws}${pathInfo.projectSuffix}` : "（需先配置主工作区）"}</span>
          （{pathInfo.format}）
        </p>
        <p className="mt-1 text-gray-600">设置页仅查看配置，请直接编辑上述文件。</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-300">MCP 服务器</span>
        <button
          onClick={() => void loadStatus()}
          disabled={loading}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />刷新
        </button>
        <span className="text-[10px] text-gray-600">来源：{formatMcpStatusSourceLabel(statusSource)}</span>
      </div>

      {servers.length === 0 ? (
        <p className="text-xs text-gray-600">{viewConfig.emptyHint(ws, !ws)}</p>
      ) : (
        <div className="space-y-1.5">
          {servers.map((s) => (
            <div key={s.name} className="flex items-center justify-between rounded-lg border border-gray-700 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                {s.type === "url"
                  ? (s.authenticated ? <ShieldCheck size={13} className="text-green-400 shrink-0" /> : <ShieldAlert size={13} className="text-amber-400 shrink-0" />)
                  : <Terminal size={13} className="text-gray-500 shrink-0" />}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-gray-300">{s.name}</span>
                    <span className="rounded bg-gray-800 px-1 py-0.5 text-[9px] text-gray-500">
                      {formatMcpScopeLabel(s, engineType)}
                    </span>
                  </div>
                  <p className="truncate text-[10px] text-gray-600">
                    {s.type === "url" ? s.url : `${s.command} ${(s.args ?? []).join(" ")}`}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
