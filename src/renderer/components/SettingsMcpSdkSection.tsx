import { useState, useEffect, useCallback } from "react"
import {
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  LogIn,
  Loader2,
  Terminal,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react"
import SettingsPluginInventory from "./SettingsPluginInventory"
import { getMcpViewConfig } from "../lib/mcp-view-strategy"

type McpScope = "global" | "project"

interface McpEditState {
  name: string
  scope: McpScope
  type: "command" | "url"
  command: string
  args: string
  url: string
  originalName?: string
}

interface Props {
  workspaceDir: string
}

/** SDK 引擎：Settings MCP global/project CRUD + 插件说明区 */
export default function SettingsMcpSdkSection({ workspaceDir }: Props) {
  const viewConfig = getMcpViewConfig("sdk")

  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<McpEditState | null>(null)
  const [loginPending, setLoginPending] = useState<Record<string, boolean>>({})
  const [loginOutput, setLoginOutput] = useState<string | null>(null)

  /** 按主工作区拉取用户级 + 项目级 MCP 配置列表 */
  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.listMcpForWorkspace(workspaceDir.trim())
      setServers(list)
    } finally {
      setLoading(false)
    }
  }, [workspaceDir])

  useEffect(() => { void loadList() }, [loadList])

  const openAdd = (scope: McpScope) => {
    setEditing({ name: "", scope, type: "command", command: "", args: "", url: "" })
  }

  const openEdit = (s: McpServerEntry) => {
    setEditing({
      name: s.name,
      scope: s.source,
      type: s.type,
      command: s.command ?? "",
      args: (s.args ?? []).join(" "),
      url: s.url ?? "",
      originalName: s.name,
    })
  }

  /** 将表单转为 ~/.cursor/mcp.json 或项目 .cursor/mcp.json 的条目结构 */
  const buildRawConfig = (form: McpEditState): Record<string, unknown> => {
    if (form.type === "url") return { url: form.url.trim() }
    const cfg: Record<string, unknown> = { command: form.command.trim() }
    const args = form.args.trim().split(/\s+/).filter(Boolean)
    if (args.length > 0) cfg.args = args
    return cfg
  }

  /** 新增或重命名保存；重命名时先删旧条目再写入 */
  const handleSave = async () => {
    if (!editing || !editing.name.trim()) return
    const name = editing.name.trim()
    if (editing.originalName && editing.originalName !== name) {
      await window.electronAPI.deleteMcpServer(editing.originalName)
    }
    await window.electronAPI.saveMcpServer(name, buildRawConfig(editing), editing.scope)
    setEditing(null)
    void loadList()
  }

  /** 从用户级配置删除指定 MCP 服务器 */
  const handleDelete = async (name: string) => {
    await window.electronAPI.deleteMcpServer(name)
    void loadList()
  }

  /** 切换 MCP 启用/禁用状态（写入配置 enabled 字段） */
  const handleToggle = async (s: McpServerEntry) => {
    await window.electronAPI.toggleMcp(s.name, s.enabled === false)
    void loadList()
  }

  /** HTTP/OAuth 类 MCP：触发 CLI 登录并展示输出 */
  const handleLogin = (name: string) => {
    setLoginPending((p) => ({ ...p, [name]: true }))
    window.electronAPI.loginMcp(name, workspaceDir.trim() || undefined).then((res) => {
      setLoginPending((p) => ({ ...p, [name]: false }))
      setLoginOutput(res.output)
      if (res.ok) void loadList()
    })
  }

  const globalServers = servers.filter((s) => s.source === "global")
  const projectServers = servers.filter((s) => s.source === "project")

  const renderServerRow = (s: McpServerEntry) => (
    <div key={`${s.source}-${s.name}`} className="flex items-center justify-between rounded-lg border border-gray-700 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        {s.type === "url"
          ? (s.authenticated ? <ShieldCheck size={13} className="text-green-400 shrink-0" /> : <ShieldAlert size={13} className="text-amber-400 shrink-0" />)
          : <Terminal size={13} className="text-gray-500 shrink-0" />}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-gray-300">{s.name}</span>
            <span className="rounded bg-gray-800 px-1 py-0.5 text-[9px] text-gray-500">{s.source === "global" ? "用户级" : "项目级"}</span>
            {s.enabled === false && <span className="text-[9px] text-gray-600">已禁用</span>}
          </div>
          <p className="truncate text-[10px] text-gray-600">{s.type === "url" ? s.url : `${s.command} ${(s.args ?? []).join(" ")}`}</p>
        </div>
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-1">
        {s.type === "url" && !s.authenticated && (
          loginPending[s.name]
            ? <Loader2 size={13} className="animate-spin text-blue-400" />
            : <button onClick={() => handleLogin(s.name)} className="rounded p-1 text-gray-500 hover:text-blue-400" title="OAuth 授权"><LogIn size={13} /></button>
        )}
        <button onClick={() => handleToggle(s)} className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-800" title={s.enabled === false ? "启用" : "禁用"}>
          {s.enabled === false ? "启用" : "禁用"}
        </button>
        <button onClick={() => openEdit(s)} className="rounded p-1 text-gray-500 hover:text-white"><Pencil size={13} /></button>
        <button onClick={() => void handleDelete(s.name)} className="rounded p-1 text-gray-500 hover:text-red-400"><Trash2 size={13} /></button>
      </div>
    </div>
  )

  const renderGroup = (title: string, hint: string, scope: McpScope, items: McpServerEntry[]) => (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-gray-400">{title}</h4>
        <button onClick={() => openAdd(scope)} disabled={scope === "project" && !workspaceDir.trim()} className="flex items-center gap-0.5 rounded bg-blue-600/80 px-2 py-0.5 text-[10px] text-white hover:bg-blue-500 disabled:opacity-40"><Plus size={10} />新增</button>
      </div>
      <p className="text-[10px] text-gray-600">{hint}</p>
      <div className="space-y-1.5">
        {items.map(renderServerRow)}
        {items.length === 0 && <p className="py-3 text-center text-xs text-gray-600">暂无配置</p>}
      </div>
    </section>
  )

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 text-xs">
        <p className="font-medium text-gray-300">{viewConfig.title}</p>
        <p className="mt-1 text-gray-600">
          用户级：<span className="font-mono text-gray-500">~/.cursor/mcp.json</span>；
          项目级：<span className="font-mono text-gray-500">{workspaceDir.trim() ? `${workspaceDir}/.cursor/mcp.json` : "（需先配置主工作区）"}</span>
        </p>
        <p className="mt-1 text-gray-600">
          SDK 加载顺序：inline 注入 &gt; 插件层（settingSources: plugins）&gt; 项目级 &gt; 用户级。
          HTTP/OAuth 类经 inline 注入；stdio 类默认由 settingSources 加载；含{" "}
          <span className="font-mono text-gray-500">${"{CLAUDE_PLUGIN_ROOT}"}</span> 的插件 MCP 经 inline 兜底。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-300">MCP 服务器</span>
        <button onClick={() => void loadList()} disabled={loading} className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />刷新
        </button>
      </div>

      {loginOutput && (
        <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2 text-[10px] text-gray-400">{loginOutput}</pre>
      )}

      {renderGroup("用户级（global）", "写入 ~/.cursor/mcp.json，全工作区可用。", "global", globalServers)}
      {renderGroup("项目级（project）", workspaceDir.trim() ? `写入 ${workspaceDir}/.cursor/mcp.json，覆盖同名用户级条目。` : "请先在「通用」配置主工作区。", "project", projectServers)}

      <SettingsPluginInventory workspaceDir={workspaceDir} highlight="mcp" />

      <p className="text-[10px] text-gray-600">保存 mcp.json 后下轮 SDK 会话生效；插件 MCP 见上方清单。</p>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
            <h4 className="text-sm font-medium text-gray-300">{editing.originalName ? "编辑 MCP" : "新增 MCP"}</h4>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="名称" className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200" />
            <select value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value as McpScope })} className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200">
              <option value="global">用户级（~/.cursor/mcp.json）</option>
              <option value="project" disabled={!workspaceDir.trim()}>项目级（主工作区 .cursor/mcp.json）</option>
            </select>
            <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as "command" | "url" })} className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200">
              <option value="command">stdio / command</option>
              <option value="url">HTTP / SSE</option>
            </select>
            {editing.type === "command" ? (
              <>
                <input value={editing.command} onChange={(e) => setEditing({ ...editing, command: e.target.value })} placeholder="command（如 npx）" className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200" />
                <input value={editing.args} onChange={(e) => setEditing({ ...editing, args: e.target.value })} placeholder="args（空格分隔）" className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200" />
              </>
            ) : (
              <input value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} placeholder="https://..." className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200" />
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800">取消</button>
              <button onClick={() => void handleSave()} disabled={!editing.name.trim()} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
