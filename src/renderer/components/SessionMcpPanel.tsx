import { useState, useEffect, useCallback } from "react"
import {
  RefreshCw,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  Network,
  Terminal,
  LogIn,
  Loader2,
  Wrench,
} from "lucide-react"
import { getMcpViewConfig, type McpEngineType } from "../lib/mcp-view-strategy"

export interface SessionMcpPanelProps {
  sessionKey: string
  workspaceDir?: string
  engineType: McpEngineType
  /** config.workspaceDir，会话 ws 为空时回退 */
  fallbackWorkspaceDir: string
}

type ToolState = {
  loading: boolean
  tools: { name: string; description?: string; params?: { name: string; type?: string; description?: string; required?: boolean }[] }[]
  error?: string
}

/** MCP 错误文案：过滤 CLI 提示，引导检查 mcp.json */
function formatMcpUiError(raw?: string): string {
  if (!raw) return "获取工具列表失败"
  if (raw.includes("cursor agent") || raw.includes("Cursor CLI")) {
    return "请检查 mcp.json 配置；URL 型 MCP 需 OAuth 时在 Cursor IDE 或 mcp-auth.json 完成授权"
  }
  return raw
}

/** 解析有效工作区：会话 ws 优先，空则 fallback */
function resolveEffectiveWorkspace(sessionWs: string | undefined, fallback: string): { ws: string; usingFallback: boolean } {
  const trimmed = sessionWs?.trim()
  if (trimmed) return { ws: trimmed, usingFallback: false }
  return { ws: fallback.trim(), usingFallback: true }
}

/** 活跃会话 MCP 只读面板：列表、状态、刷新、OAuth、工具折叠 */
export default function SessionMcpPanel({
  sessionKey,
  workspaceDir,
  engineType,
  fallbackWorkspaceDir,
}: SessionMcpPanelProps) {
  const viewConfig = getMcpViewConfig(engineType)
  const { ws: effectiveWs, usingFallback } = resolveEffectiveWorkspace(workspaceDir, fallbackWorkspaceDir)

  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, string>>({})
  const [statusLoading, setStatusLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tools, setTools] = useState<Record<string, ToolState>>({})
  const [loginPending, setLoginPending] = useState<Record<string, boolean>>({})
  const [loginOutput, setLoginOutput] = useState<string | null>(null)

  const loadMcp = useCallback(async (force = false) => {
    // codex supported=false 已 early return；CC/SDK 统一走 agent:mcp-status（透传 force/engineType/workspaceDir）
    if (!viewConfig.supported) return
    setRefreshing(true)
    setStatusLoading(true)
    try {
      const res = await window.electronAPI.getAgentMcpStatus(sessionKey, force, engineType, effectiveWs)
      setServers(res.servers)
      setStatusMap(res.statusMap)
    } finally {
      setStatusLoading(false)
      setRefreshing(false)
    }
  }, [sessionKey, engineType, effectiveWs, viewConfig.supported])

  useEffect(() => {
    if (!viewConfig.supported) return
    void loadMcp(false)
  }, [sessionKey, viewConfig.supported, loadMcp])

  const toggleExpand = async (name: string) => {
    if (expanded === name) {
      setExpanded(null)
      return
    }
    setExpanded(name)
    if (!tools[name]) {
      setTools((p) => ({ ...p, [name]: { loading: true, tools: [] } }))
      const res = await window.electronAPI.getMcpTools(name, effectiveWs)
      setTools((p) => ({
        ...p,
        [name]: { loading: false, tools: res.tools, error: res.ok ? undefined : formatMcpUiError(res.error) },
      }))
    }
  }

  const handleLogin = (name: string) => {
    setLoginPending((p) => ({ ...p, [name]: true }))
    window.electronAPI.loginMcp(name, effectiveWs).then((res) => {
      setLoginPending((p) => ({ ...p, [name]: false }))
      setLoginOutput(res.output)
      if (res.ok) {
        setServers((prev) => prev.map((s) => (s.name === name ? { ...s, authenticated: true } : s)))
        void loadMcp(true)
      }
    })
  }

  if (!viewConfig.supported) {
    return (
      <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2">
        <p className="text-xs text-gray-500">{viewConfig.unsupportedMessage}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium text-gray-400">{viewConfig.title}</span>
        <button
          onClick={() => void loadMcp(true)}
          disabled={refreshing}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-500 transition hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
        >
          <RefreshCw size={10} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "刷新中" : "刷新"}
        </button>
        {usingFallback && (
          <span className="text-[10px] text-amber-500/80">使用主工作区 MCP 配置</span>
        )}
      </div>

      {loginOutput && (
        <pre className="mb-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2 text-[10px] text-gray-400">{loginOutput}</pre>
      )}

      {servers.length === 0 ? (
        <p className="text-xs text-gray-600">{viewConfig.emptyHint(effectiveWs, usingFallback)}</p>
      ) : (
        <div className="space-y-1.5">
          {servers.map((s) => {
            const isOpen = expanded === s.name
            const toolState = tools[s.name]
            const rawStatus = statusMap[s.name]
            const isReady = rawStatus === "ready" || rawStatus === "enabled"
            const statusColor = !rawStatus ? "text-gray-600" : isReady ? "text-green-400" : rawStatus === "disabled" ? "text-gray-500" : rawStatus === "needs_login" ? "text-amber-400" : "text-red-400"
            const statusLabel = !rawStatus ? "—" : isReady ? "ready" : rawStatus === "disabled" ? "disabled" : rawStatus === "needs_login" ? "需授权" : rawStatus
            // 审批未启用：enabled===false 表示审批门控未放行（project scope 未在白名单/被禁用），未注入运行
            const approvalDisabled = s.enabled === false
            // 「未启用」标签：审批未启用且 runtime status 未标 disabled 时补显，避免与 statusLabel 重复
            const showApprovalDisabledTag = approvalDisabled && statusLabel !== "disabled"

            return (
              <div key={s.name} className={`rounded border border-gray-700/50 overflow-hidden${approvalDisabled ? " opacity-60" : ""}`}>
                <div className="flex items-center justify-between px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <button onClick={() => void toggleExpand(s.name)} className="shrink-0 text-gray-500 hover:text-gray-300">
                      <ChevronDown size={12} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {s.type === "url"
                      ? (s.enabled && s.authenticated ? <ShieldCheck size={12} className="text-green-400" /> : s.enabled ? <ShieldAlert size={12} className="text-amber-400" /> : <Network size={12} className="text-gray-500" />)
                      : <Terminal size={12} className="text-gray-500" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`truncate text-xs font-medium ${approvalDisabled ? "text-gray-500" : "text-gray-300"}`}>{s.name}</span>
                        <span className="rounded bg-gray-800 px-1 py-0.5 text-[9px] text-gray-500">{s.source === "global" ? "全局" : "项目"}</span>
                        {!statusLoading && showApprovalDisabledTag && (
                          <span className="rounded bg-gray-800/80 px-1 py-0.5 text-[9px] text-gray-500">未启用</span>
                        )}
                        {!statusLoading && <span className={`text-[9px] ${statusColor}`}>{statusLabel}</span>}
                      </div>
                      <p className="truncate text-[10px] text-gray-600">{s.type === "url" ? s.url : `${s.command} ${(s.args ?? []).join(" ")}`}</p>
                    </div>
                  </div>
                  {s.type === "url" && s.enabled !== false && !s.authenticated && rawStatus === "needs_login" && (
                    loginPending[s.name]
                      ? <Loader2 size={12} className="animate-spin text-blue-400" />
                      : (
                        <button onClick={() => handleLogin(s.name)} className="flex items-center gap-0.5 rounded bg-blue-600/80 px-1.5 py-0.5 text-[10px] text-white hover:bg-blue-500">
                          <LogIn size={10} />授权
                        </button>
                      )
                  )}
                </div>
                {isOpen && (
                  <div className="border-t border-gray-700/40 bg-gray-900/30 px-2.5 py-1.5">
                    {toolState?.loading ? (
                      <div className="flex items-center gap-1 text-[10px] text-gray-500"><Loader2 size={10} className="animate-spin" />获取工具…</div>
                    ) : toolState?.error ? (
                      <p className="text-[10px] text-gray-500">{toolState.error}</p>
                    ) : toolState && toolState.tools.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {toolState.tools.map((t) => (
                          <span key={t.name} className="inline-flex items-center gap-0.5 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400" title={t.description ?? t.name}>
                            <Wrench size={8} />{t.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-600">无已注册工具</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
