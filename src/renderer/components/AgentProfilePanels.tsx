import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, KeyRound } from "lucide-react"
import useInlineModal from "./useInlineModal"
import { CcEditModal, CodexEditModal } from "./AgentResourceModals"
import AgentOpencodeProfileSection from "./AgentOpencodeProfileSection"

/** 生成 Claude Code Profile 本地 id（与主进程 newClaudeCodeResourceId 格式一致） */
function newCcResourceId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => b.toString(16).padStart(2, "0")).join("")
  return `cc_${hex}`
}

/** 生成 Codex Profile 本地 id（与主进程 newCodexResourceId 格式一致） */
function newCodexResourceId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => b.toString(16).padStart(2, "0")).join("")
  return `codex_${hex}`
}

interface Props {
  channels: ChannelConfig[]
}

/**
 * Claude Code / Codex Profile 资源管理区块。
 * 与 Cursor SDK 区块分离，避免 AgentPanel 超 300 行。
 */
export default function AgentProfilePanels({ channels }: Props) {
  const [ccResources, setCcResources] = useState<AgentResource[]>([])
  const [codexResources, setCodexResources] = useState<AgentResource[]>([])
  const [opencodeResources, setOpencodeResources] = useState<AgentResource[]>([])

  const [editingCc, setEditingCc] = useState<AgentResource | null>(null)
  const [isNewCc, setIsNewCc] = useState(false)
  const [showCcKey, setShowCcKey] = useState(false)
  const [verifyingCc, setVerifyingCc] = useState(false)
  const [verifyResultCc, setVerifyResultCc] = useState<{ ok: boolean; error?: string } | null>(null)

  const [editingCodex, setEditingCodex] = useState<AgentResource | null>(null)
  const [isNewCodex, setIsNewCodex] = useState(false)
  const [showCodexKey, setShowCodexKey] = useState(false)

  const { showAlert, showConfirm, ModalPortal } = useInlineModal()

  const reload = useCallback(async () => {
    const cfg = await window.electronAPI.getConfig()
    const all = cfg.agentResources ?? []
    setCcResources(all.filter((r) => r.type === "claude-code"))
    setCodexResources(all.filter((r) => r.type === "codex"))
    setOpencodeResources(all.filter((r) => r.type === "opencode"))
  }, [])

  useEffect(() => { void reload() }, [reload])

  /** 持久化 Profile 列表，保留既有 SDK 资源 */
  const persistProfiles = async (ccList: AgentResource[], codexList: AgentResource[], opencodeList: AgentResource[]) => {
    const cfg = await window.electronAPI.getConfig()
    const sdkList = (cfg.agentResources ?? []).filter((r) => r.type === "sdk")
    setCcResources(ccList)
    setCodexResources(codexList)
    setOpencodeResources(opencodeList)
    await window.electronAPI.saveConfig({ agentResources: [...sdkList, ...ccList, ...codexList, ...opencodeList] })
  }

  const guardDelete = async (r: AgentResource): Promise<boolean> => {
    const usedBy = channels.filter((c) => c.agentResourceId === r.id)
    if (usedBy.length > 0) {
      void showAlert("无法删除", `该资源正在被通道使用：${usedBy.map((c) => c.name).join("、")}。请先调整通道的 Agent 资源绑定。`)
      return false
    }
    if (!await showConfirm("删除确认", `确定删除「${r.name}」吗？`)) return false
    return true
  }

  // ── Claude Code Profile ──

  const openCcAdd = () => {
    setEditingCc({ id: newCcResourceId(), type: "claude-code", name: `CC Profile ${ccResources.length + 1}`, apiKey: "" })
    setIsNewCc(true)
    setShowCcKey(false)
    setVerifyResultCc(null)
  }

  const openCcEdit = (r: AgentResource) => {
    setEditingCc({ ...r })
    setIsNewCc(false)
    setShowCcKey(false)
    setVerifyResultCc(null)
  }

  const handleCcDelete = async (r: AgentResource) => {
    if (!await guardDelete(r)) return
    await persistProfiles(ccResources.filter((x) => x.id !== r.id), codexResources, opencodeResources)
  }

  const handleCcVerify = async () => {
    if (!editingCc?.apiKey?.trim()) return
    setVerifyingCc(true)
    setVerifyResultCc(null)
    try {
      const r = await window.electronAPI.checkCcApiKey(editingCc.apiKey.trim(), editingCc.baseUrl?.trim() || undefined)
      setVerifyResultCc(r)
    } finally {
      setVerifyingCc(false)
    }
  }

  const handleCcSave = async () => {
    if (!editingCc || !editingCc.name.trim() || !editingCc.apiKey?.trim()) return
    const next = {
      ...editingCc,
      name: editingCc.name.trim(),
      apiKey: editingCc.apiKey.trim(),
      baseUrl: editingCc.baseUrl?.trim() || undefined,
      model: editingCc.model?.trim() || undefined,
    }
    const exists = ccResources.some((r) => r.id === next.id)
    const nextCc = exists ? ccResources.map((r) => (r.id === next.id ? next : r)) : [...ccResources, next]
    await persistProfiles(nextCc, codexResources, opencodeResources)
    setEditingCc(null)
  }

  // ── Codex Profile ──

  const openCodexAdd = () => {
    setEditingCodex({ id: newCodexResourceId(), type: "codex", name: `Codex Profile ${codexResources.length + 1}`, apiKey: "" })
    setIsNewCodex(true)
    setShowCodexKey(false)
  }

  const openCodexEdit = (r: AgentResource) => {
    setEditingCodex({ ...r })
    setIsNewCodex(false)
    setShowCodexKey(false)
  }

  const handleCodexDelete = async (r: AgentResource) => {
    if (!await guardDelete(r)) return
    await persistProfiles(ccResources, codexResources.filter((x) => x.id !== r.id), opencodeResources)
  }

  const handleCodexSave = async () => {
    if (!editingCodex || !editingCodex.name.trim() || !editingCodex.apiKey?.trim()) return
    const next = {
      ...editingCodex,
      name: editingCodex.name.trim(),
      apiKey: editingCodex.apiKey.trim(),
      baseUrl: editingCodex.baseUrl?.trim() || undefined,
      model: editingCodex.model?.trim() || undefined,
    }
    const exists = codexResources.some((r) => r.id === next.id)
    const nextCodex = exists ? codexResources.map((r) => (r.id === next.id ? next : r)) : [...codexResources, next]
    await persistProfiles(ccResources, nextCodex, opencodeResources)
    setEditingCodex(null)
  }

  const renderProfileRow = (r: AgentResource, accent: string, onEdit: () => void, onDelete: () => void) => {
    const usedBy = channels.filter((c) => c.agentResourceId === r.id)
    return (
      <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-700 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <KeyRound size={15} className={`shrink-0 ${accent}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{r.name}</p>
              {usedBy.length > 0 && <span className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-400">{usedBy.length} 个通道使用中</span>}
            </div>
            <p className="truncate font-mono text-xs text-gray-600">{r.apiKey ? `${r.apiKey.slice(0, 10)}...${r.apiKey.slice(-4)}` : "(未配置)"}</p>
            {(r.baseUrl || r.model) && (
              <p className="truncate text-xs text-gray-600">
                {r.baseUrl && <span className="mr-2">{r.baseUrl}</span>}
                {r.model && <span className="rounded bg-gray-800 px-1 py-0.5 text-[10px]">{r.model}</span>}
              </p>
            )}
          </div>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <button onClick={onEdit} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white"><Pencil size={13} /></button>
          <button onClick={() => void onDelete()} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-red-400"><Trash2 size={13} /></button>
        </div>
      </div>
    )
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">Claude Agent</h3>
          <div className="flex-1" />
          <button onClick={openCcAdd} className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500"><Plus size={12} />添加 CC Profile</button>
        </div>
        <p className="text-xs text-gray-600">
          可添加多个 Claude Agent API Key（不同账号），消息通道可分别绑定。从{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Anthropic Console</a>
          {" "}获取 API Key。
        </p>
        <div className="space-y-2">
          {ccResources.map((r) => renderProfileRow(r, "text-orange-400", () => openCcEdit(r), () => handleCcDelete(r)))}
          {ccResources.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无 CC Profile</p>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">Codex</h3>
          <div className="flex-1" />
          <button onClick={openCodexAdd} className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500"><Plus size={12} />添加 Codex Profile</button>
        </div>
        <p className="text-xs text-gray-600">
          可添加多个 OpenAI Codex API Key（不同账号），消息通道可分别绑定。从{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">OpenAI Platform</a>
          {" "}获取 API Key。
        </p>
        <div className="space-y-2">
          {codexResources.map((r) => renderProfileRow(r, "text-cyan-400", () => openCodexEdit(r), () => handleCodexDelete(r)))}
          {codexResources.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无 Codex Profile</p>}
        </div>
      </section>

      <AgentOpencodeProfileSection
        channels={channels}
        resources={opencodeResources}
        onPersist={(list) => persistProfiles(ccResources, codexResources, list)}
      />

      {editingCc && (
        <CcEditModal
          editing={editingCc}
          isNew={isNewCc}
          showKey={showCcKey}
          verifying={verifyingCc}
          verifyResult={verifyResultCc}
          onClose={() => setEditingCc(null)}
          onChange={(next) => { setEditingCc(next); setVerifyResultCc(null) }}
          onToggleShowKey={() => setShowCcKey(!showCcKey)}
          onVerify={() => void handleCcVerify()}
          onSave={() => void handleCcSave()}
        />
      )}

      {editingCodex && (
        <CodexEditModal
          editing={editingCodex}
          isNew={isNewCodex}
          showKey={showCodexKey}
          onClose={() => setEditingCodex(null)}
          onChange={setEditingCodex}
          onToggleShowKey={() => setShowCodexKey(!showCodexKey)}
          onSave={() => void handleCodexSave()}
        />
      )}

      {ModalPortal}
    </>
  )
}
