import { useState, useEffect, useCallback } from "react"
import {
  Plus, Pencil, Trash2, RefreshCw, MessageSquare, Bird, ExternalLink,
} from "lucide-react"
import useInlineModal from "./useInlineModal"
import { emptyChannel } from "./channel-panel-helpers"
import { ChannelEditModal } from "./ChannelEditModal"

export default function ChannelPanel() {
  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [resources, setResources] = useState<AgentResource[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, ChannelStatusInfo>>({})
  const [editing, setEditing] = useState<ChannelConfig | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const { showAlert, showConfirm, ModalPortal } = useInlineModal()

  const reload = useCallback(async () => {
    const cfg = await window.electronAPI.getConfig()
    // 旧迁移通道可能缺少通道级字段，展示时兜底
    setChannels((cfg.channels ?? []).map((c) => ({
      ...c,
      allowOthers: c.allowOthers ?? cfg.allowOthers ?? false,
      othersWorkspaceMode: c.othersWorkspaceMode ?? "isolated",
      othersWorkspaceDir: c.othersWorkspaceDir ?? "",
      digitalIdentity: c.digitalIdentity ?? cfg.digitalIdentity ?? "",
      ...(c.type === "wechat"
        ? { wechatGroupEnqueueMode: c.wechatGroupEnqueueMode ?? "mention_required" }
        : {}),
    })))
    setResources(cfg.agentResources ?? [])
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const sync = (s: DaemonStatus) => {
      if (!s.channels) return
      const m: Record<string, ChannelStatusInfo> = {}
      for (const c of s.channels) m[c.id] = c
      setStatusMap(m)
    }
    window.electronAPI.getDaemonStatus().then(sync)
    const unsub = window.electronAPI.onDaemonStatus(sync)
    return () => unsub()
  }, [])

  const persistChannels = async (next: ChannelConfig[]) => {
    setChannels(next)
    await window.electronAPI.saveConfig({ channels: next })
  }

  const handleToggle = async (id: string) => {
    await persistChannels(channels.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c))
  }

  const handleDelete = async (c: ChannelConfig) => {
    if (!await showConfirm("删除确认", `确定删除通道「${c.name}」吗？该通道的消息将不再接收。`)) return
    await persistChannels(channels.filter((x) => x.id !== c.id))
  }

  const openAdd = (type: "feishu" | "wechat") => {
    setShowAddMenu(false)
    const count = channels.filter((c) => c.type === type).length
    const base = type === "feishu" ? "飞书" : "微信"
    const ch = emptyChannel(type, count > 0 ? `${base} ${count + 1}` : base)
    // 新建通道默认绑定首个 SDK 或 Claude Code 资源
    const defaultRes = resources.find((r) => r.type === "sdk") ?? resources.find((r) => r.type === "claude-code")
    if (defaultRes) ch.agentResourceId = defaultRes.id
    setEditing(ch)
    setIsNew(true)
  }

  const openEdit = (c: ChannelConfig) => { setEditing({ ...c }); setIsNew(false) }

  const handleSave = async (next: ChannelConfig) => {
    const exists = channels.some((c) => c.id === next.id)
    await persistChannels(exists ? channels.map((c) => c.id === next.id ? next : c) : [...channels, next])
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">消息通道</h3>
          <button onClick={() => void reload()} className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white"><RefreshCw size={12} />刷新</button>
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setShowAddMenu(!showAddMenu)} className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500"><Plus size={12} />添加通道</button>
            {showAddMenu && (
              <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
                <button onClick={() => openAdd("feishu")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-800"><Bird size={13} className="text-blue-400" />飞书通道</button>
                <button onClick={() => openAdd("wechat")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-800"><MessageSquare size={13} className="text-green-400" />微信通道</button>
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-600">每个通道绑定一个 Agent 资源与独立模型；通道配置保存后 Daemon 将自动重启生效。</p>

        <div className="space-y-2">
          {channels.map((c) => {
            const st = statusMap[c.id]
            const resource = resources.find((r) => r.id === c.agentResourceId)
            const credMissing = c.type === "feishu" ? !(c.larkAppId && c.larkAppSecret) : !c.wechatToken
            return (
              <div key={c.id} className="rounded-lg border border-gray-700 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    {c.type === "feishu" ? <Bird size={16} className="shrink-0 text-blue-400" /> : <MessageSquare size={16} className="shrink-0 text-green-400" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        {!c.enabled
                          ? <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">已停用</span>
                          : credMissing
                            ? <span className="shrink-0 rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-400">凭据未配置</span>
                            : st
                              ? <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${st.connected ? "bg-green-900/40 text-green-400" : "bg-yellow-900/40 text-yellow-400"}`}>{st.connected ? "已连接" : st.status}</span>
                              : <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">未运行</span>}
                        {c.mainUserEnabled && c.mainUserChatId && <span className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-400">主用户已绑定</span>}
                        {c.allowOthers && <span className="shrink-0 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-400">其他人可用</span>}
                      </div>
                      <p className="flex items-center gap-1 truncate text-xs text-gray-500">
                        {c.type === "feishu" && c.larkAppId && (
                          <>
                            <a
                              href={`https://open.feishu.cn/app/${c.larkAppId}`}
                              target="_blank"
                              rel="noreferrer"
                              title={`打开飞书开发者后台 (${c.larkAppId})`}
                              className="inline-flex shrink-0 items-center gap-0.5 text-blue-400/80 hover:text-blue-300 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {st?.botName || c.larkBotName || c.larkAppId.slice(0, 12) + "…"}
                              <ExternalLink size={10} />
                            </a>
                            <span className="text-gray-700">·</span>
                          </>
                        )}
                        <span className="truncate">{resource?.name ?? "未绑定资源"} · 主模型 {c.model || "auto"}{c.othersModel ? ` · 其他人 ${c.othersModel}` : ""}{c.workspaceDir ? ` · 📁${c.workspaceDir.split(/[\\/]/).pop()}` : ""}</span>
                      </p>
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <button onClick={() => openEdit(c)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white"><Pencil size={13} /></button>
                    <button onClick={() => void handleDelete(c)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-red-400"><Trash2 size={13} /></button>
                    <button
                      onClick={() => void handleToggle(c.id)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${c.enabled ? "bg-green-500" : "bg-gray-600"}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${c.enabled ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {channels.length === 0 && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <button
                onClick={() => openAdd("feishu")}
                className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-600 px-4 py-8 transition hover:border-blue-500 hover:bg-blue-950/20"
              >
                <Bird size={28} className="text-blue-400" />
                <span className="text-sm font-medium text-gray-200">飞书通道</span>
                <span className="text-center text-xs text-gray-500">通过飞书自建应用收发消息<br />支持私聊和群聊</span>
                <span className="mt-1 rounded-md bg-blue-600/20 px-3 py-1 text-xs font-medium text-blue-300">点击创建</span>
              </button>
              <button
                onClick={() => openAdd("wechat")}
                className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-600 px-4 py-8 transition hover:border-green-500 hover:bg-green-950/20"
              >
                <MessageSquare size={28} className="text-green-400" />
                <span className="text-sm font-medium text-gray-200">微信通道</span>
                <span className="text-center text-xs text-gray-500">扫码绑定 ClawBot 接入微信<br />支持私聊</span>
                <span className="mt-1 rounded-md bg-green-600/20 px-3 py-1 text-xs font-medium text-green-300">点击创建</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {editing && (
        <ChannelEditModal
          channel={editing}
          isNew={isNew}
          resources={resources}
          onClose={() => setEditing(null)}
          onSave={async (c) => { await handleSave(c); setEditing(null) }}
          onSaveDraft={async (c) => { await handleSave(c); setEditing({ ...c }) }}
          showAlert={showAlert}
          showConfirm={showConfirm}
        />
      )}
      {ModalPortal}
    </>
  )
}
