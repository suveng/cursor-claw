import { useState, useEffect, useCallback } from "react"
import {
  Plus, Pencil, Trash2, KeyRound,
} from "lucide-react"
import useInlineModal from "./useInlineModal"
import { SdkEditModal } from "./AgentResourceModals"
import AgentProfilePanels from "./AgentProfilePanels"

function newSdkId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => b.toString(16).padStart(2, "0")).join("")
  return `sdk_${hex}`
}

export default function AgentPanel() {
  const [resources, setResources] = useState<AgentResource[]>([])
  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [editing, setEditing] = useState<AgentResource | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; email?: string; error?: string } | null>(null)

  const { showAlert, showConfirm, ModalPortal } = useInlineModal()

  const reload = useCallback(async () => {
    const cfg = await window.electronAPI.getConfig()
    setResources((cfg.agentResources ?? []).filter((r) => r.type === "sdk"))
    setChannels(cfg.channels ?? [])
  }, [])

  useEffect(() => { void reload() }, [reload])

  /** 持久化 SDK 列表，保留既有 Profile 资源 */
  const persistSdk = async (sdkList: AgentResource[]) => {
    setResources(sdkList)
    const cfg = await window.electronAPI.getConfig()
    const profiles = (cfg.agentResources ?? []).filter((r) => r.type !== "sdk")
    await window.electronAPI.saveConfig({ agentResources: [...sdkList, ...profiles] })
  }

  const openAdd = () => {
    setEditing({ id: newSdkId(), type: "sdk", name: `SDK Key ${resources.length + 1}`, apiKey: "" })
    setIsNew(true)
    setVerifyResult(null)
  }

  const openEdit = (r: AgentResource) => { setEditing({ ...r }); setIsNew(false); setVerifyResult(null) }

  const handleDelete = async (r: AgentResource) => {
    const usedBy = channels.filter((c) => c.agentResourceId === r.id)
    if (usedBy.length > 0) {
      void showAlert("无法删除", `该资源正在被通道使用：${usedBy.map((c) => c.name).join("、")}。请先调整通道的 Agent 资源绑定。`)
      return
    }
    if (!await showConfirm("删除确认", `确定删除「${r.name}」吗？`)) return
    await persistSdk(resources.filter((x) => x.id !== r.id))
  }

  const handleVerify = async () => {
    if (!editing?.apiKey?.trim()) return
    setVerifying(true)
    setVerifyResult(null)
    try {
      const r = await window.electronAPI.checkSdkApiKey(editing.apiKey.trim())
      setVerifyResult(r)
      if (r.ok && r.email) setEditing((e) => e ? { ...e, email: r.email } : e)
    } finally {
      setVerifying(false)
    }
  }

  const handleSave = async () => {
    if (!editing || !editing.name.trim() || !editing.apiKey?.trim()) return
    const next = { ...editing, name: editing.name.trim(), apiKey: editing.apiKey.trim() }
    const exists = resources.some((r) => r.id === next.id)
    await persistSdk(exists ? resources.map((r) => r.id === next.id ? next : r) : [...resources, next])
    setEditing(null)
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">Cursor SDK</h3>
          <div className="flex-1" />
          <button onClick={openAdd} className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500"><Plus size={12} />添加 SDK Key</button>
        </div>
        <p className="text-xs text-gray-600">
          可添加多个 Cursor API Key（不同账号），消息通道可分别绑定。从{" "}
          <a href="https://cursor.com/dashboard/api?section=user-keys#user-api-keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Cursor Dashboard</a>
          {" "}获取 API Key。
        </p>
        <div className="space-y-2">
          {resources.map((r) => {
            const usedBy = channels.filter((c) => c.agentResourceId === r.id)
            return (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-700 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <KeyRound size={15} className="shrink-0 text-purple-400" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      {r.email && <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">{r.email}</span>}
                      {usedBy.length > 0 && <span className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-400">{usedBy.length} 个通道使用中</span>}
                    </div>
                    <p className="truncate font-mono text-xs text-gray-600">{r.apiKey ? `${r.apiKey.slice(0, 10)}...${r.apiKey.slice(-4)}` : "(未配置)"}</p>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <button onClick={() => openEdit(r)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white"><Pencil size={13} /></button>
                  <button onClick={() => void handleDelete(r)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
          {resources.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无 SDK Key</p>}
        </div>
      </section>

      <AgentProfilePanels channels={channels} />

      {editing && (
        <SdkEditModal
          editing={editing}
          isNew={isNew}
          showKey={showKey}
          verifying={verifying}
          verifyResult={verifyResult}
          onClose={() => setEditing(null)}
          onChange={(next) => { setEditing(next); setVerifyResult(null) }}
          onToggleShowKey={() => setShowKey(!showKey)}
          onVerify={() => void handleVerify()}
          onSave={() => void handleSave()}
        />
      )}
      {ModalPortal}
    </>
  )
}
