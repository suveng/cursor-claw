import { useState } from "react"
import { Plus, Pencil, Trash2, KeyRound } from "lucide-react"
import { OpenCodeEditModal } from "./AgentResourceModals"
import useInlineModal from "./useInlineModal"

/** 生成 OpenCode Profile 本地 id（与主进程 newOpencodeResourceId 格式一致） */
function newOpencodeResourceId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => b.toString(16).padStart(2, "0")).join("")
  return `opencode_${hex}`
}

interface Props {
  channels: ChannelConfig[]
  resources: AgentResource[]
  onPersist: (next: AgentResource[]) => Promise<void>
}

/** OpenCode Profile CRUD 区块（从 AgentProfilePanels 拆出以控制单文件行数） */
export default function AgentOpencodeProfileSection({ channels, resources, onPersist }: Props) {
  const [editing, setEditing] = useState<AgentResource | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const { showAlert, showConfirm, ModalPortal } = useInlineModal()

  const guardDelete = async (r: AgentResource): Promise<boolean> => {
    const usedBy = channels.filter((c) => c.agentResourceId === r.id)
    if (usedBy.length > 0) {
      void showAlert("无法删除", `该资源正在被通道使用：${usedBy.map((c) => c.name).join("、")}。请先调整通道的 Agent 资源绑定。`)
      return false
    }
    return showConfirm("删除确认", `确定删除「${r.name}」吗？`)
  }

  const openAdd = () => {
    setEditing({
      id: newOpencodeResourceId(),
      type: "opencode",
      name: `OpenCode Profile ${resources.length + 1}`,
      apiKey: "",
      providerId: "anthropic",
      deployMode: "embedded",
      opencodeHostname: "127.0.0.1",
      opencodePort: 4096,
    })
    setIsNew(true)
    setShowKey(false)
  }

  const handleSave = async () => {
    if (!editing || !editing.name.trim() || !editing.apiKey?.trim() || !editing.providerId?.trim()) return
    const next = {
      ...editing,
      name: editing.name.trim(),
      apiKey: editing.apiKey.trim(),
      providerId: editing.providerId.trim(),
      model: editing.model?.trim() || undefined,
      baseUrl: editing.baseUrl?.trim() || undefined,
      deployMode: editing.deployMode ?? "embedded",
      opencodeHostname: editing.opencodeHostname?.trim() || "127.0.0.1",
      opencodePort: editing.opencodePort ?? 4096,
    }
    const exists = resources.some((r) => r.id === next.id)
    const list = exists ? resources.map((r) => (r.id === next.id ? next : r)) : [...resources, next]
    await onPersist(list)
    setEditing(null)
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">OpenCode</h3>
          <div className="flex-1" />
          <button onClick={openAdd} className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500"><Plus size={12} />添加 OpenCode Profile</button>
        </div>
        <p className="text-xs text-gray-600">可添加多个 OpenCode Profile，支持内嵌或外部部署；消息通道可分别绑定。</p>
        <div className="space-y-2">
          {resources.map((r) => {
            const usedBy = channels.filter((c) => c.agentResourceId === r.id)
            return (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-700 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <KeyRound size={15} className="shrink-0 text-violet-400" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      {usedBy.length > 0 && <span className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-400">{usedBy.length} 个通道使用中</span>}
                    </div>
                    <p className="truncate font-mono text-xs text-gray-600">{r.apiKey ? `${r.apiKey.slice(0, 10)}...${r.apiKey.slice(-4)}` : "(未配置)"}</p>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <button onClick={() => { setEditing({ ...r }); setIsNew(false); setShowKey(false) }} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white"><Pencil size={13} /></button>
                  <button onClick={() => void guardDelete(r).then((ok) => ok && onPersist(resources.filter((x) => x.id !== r.id)))} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
          {resources.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无 OpenCode Profile</p>}
        </div>
      </section>

      {editing && (
        <OpenCodeEditModal
          editing={editing}
          isNew={isNew}
          showKey={showKey}
          onClose={() => setEditing(null)}
          onChange={setEditing}
          onToggleShowKey={() => setShowKey(!showKey)}
          onSave={() => void handleSave()}
        />
      )}
      {ModalPortal}
    </>
  )
}
