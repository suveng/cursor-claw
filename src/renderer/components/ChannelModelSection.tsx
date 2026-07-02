import { useState, useEffect, useCallback, useRef } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { RESOURCE_GROUP_LABELS } from "../../shared/channel-types"
import SearchableSelect from "./SearchableSelect"

const inputCls = "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none transition focus:border-blue-500"

interface ModelOption { id: string; label: string; params: string }

interface Props {
  /** 打开弹窗时的通道快照，用于 Profile → Cursor 切回时恢复持久化模型字段 */
  channel: ChannelConfig
  draft: ChannelConfig
  set: (p: Partial<ChannelConfig>) => void
  resources: AgentResource[]
  showAlert: (title: string, message: string) => Promise<void>
}

/** Profile 型资源：模型由 Profile 管理，通道层不拉列表 */
function isProfileResource(type?: AgentResource["type"]): boolean {
  return type === "claude-code" || type === "codex" || type === "opencode"
}

const modelKey = (id: string, params: string) => id + (params ? "\0" + params : "")
const parseModelKey = (key: string): { id: string; params: string } => {
  const sep = key.indexOf("\0")
  return sep >= 0 ? { id: key.slice(0, sep), params: key.slice(sep + 1) } : { id: key, params: "" }
}

/**
 * 通道编辑弹窗 — Agent 资源与模型区块。
 * Cursor SDK：通道级主/其他人模型 + 获取列表；Profile（CC/Codex）：只读说明，不拉列表。
 */
export default function ChannelModelSection({ channel, draft, set, resources, showAlert }: Props) {
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  const boundResource = draft.agentResourceId
    ? resources.find((r) => r.id === draft.agentResourceId)
    : undefined
  /** Profile 删除后不 fallback 到其他资源，仅提示重选 */
  const resourceMissing = !!draft.agentResourceId && !boundResource
  const resource = boundResource

  const isCcProfile = resource?.type === "claude-code"
  const isCodexProfile = resource?.type === "codex"
  const isOpencodeProfile = resource?.type === "opencode"
  const isSdkChannel = resource?.type === "sdk"

  // 持久化模型字段快照，供 Profile → Cursor 切回时回显
  const persistedModels = useRef({
    model: channel.model,
    modelParams: channel.modelParams,
    othersModel: channel.othersModel,
    othersModelParams: channel.othersModelParams,
  })

  /** 拉取 Cursor 模型列表；Profile 不触发任何列表 IPC */
  const fetchModels = useCallback(async () => {
    if (isProfileResource(resource?.type)) return
    setLoadingModels(true)
    try {
      if (resource?.type === "sdk") {
        const r = await window.electronAPI.listSdkModels(resource.apiKey ?? "", draft.model, draft.modelParams)
        if (r.ok && r.models.length > 0) setModelOptions(r.models)
        else if (!r.ok) void showAlert("错误", r.error || "获取模型列表失败")
      }
    } finally {
      setLoadingModels(false)
    }
  }, [resource, draft.model, draft.modelParams, showAlert])

  useEffect(() => {
    setModelOptions([])
  }, [draft.agentResourceId])

  /** 切换资源：切至 Profile 清空通道模型 draft；从 Profile 切回 Cursor 恢复打开弹窗时的持久化值 */
  const handleResourceChange = (newId: string) => {
    const newResource = resources.find((r) => r.id === newId)
    if (isProfileResource(newResource?.type)) {
      set({
        agentResourceId: newId,
        model: "",
        modelParams: "",
        othersModel: "",
        othersModelParams: "",
      })
    } else if (isProfileResource(resource?.type)) {
      const p = persistedModels.current
      set({
        agentResourceId: newId,
        model: p.model ?? "",
        modelParams: p.modelParams ?? "",
        othersModel: p.othersModel ?? "",
        othersModelParams: p.othersModelParams ?? "",
      })
    } else {
      set({ agentResourceId: newId })
    }
  }

  const groupedTypes: AgentResource["type"][] = ["sdk", "claude-code", "codex", "opencode"]

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-gray-400">Agent 资源与模型</h4>
        {isSdkChannel && (
          <button
            onClick={() => void fetchModels()}
            disabled={loadingModels}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white disabled:opacity-50"
          >
            {loadingModels ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            获取模型列表
          </button>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-500">Agent 资源</label>
        <select value={draft.agentResourceId} onChange={(e) => handleResourceChange(e.target.value)} className={inputCls}>
          {resourceMissing && (
            <option value={draft.agentResourceId}>（资源已删除，请重新选择）</option>
          )}
          {groupedTypes.map((type) => {
            const items = resources.filter((r) => r.type === type)
            if (items.length === 0) return null
            return (
              <optgroup key={type} label={RESOURCE_GROUP_LABELS[type]}>
                {items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.type === "sdk" && r.email ? ` (${r.email})` : ""}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
        {resourceMissing && (
          <p className="mt-1 text-xs text-amber-500">⚠ 绑定的 Agent 资源已不存在，请重新选择 Profile，保存前不会自动切换其他资源。</p>
        )}
        {resource?.type === "sdk" && (
          <p className="mt-1 text-xs text-amber-500/80">⚠ SDK 不支持单独设置代理，请根据网络环境选择模型或使用 TUN 模式。</p>
        )}
      </div>

      {isCcProfile && resource && (
        <div className="space-y-1.5 rounded-lg border border-gray-700/50 bg-gray-800/30 px-3 py-2.5">
          <p className="text-xs text-gray-400">
            模型由 Profile「{resource.name}」统一管理，通道层无需再选模型。
          </p>
          {resource.model ? (
            <p className="text-xs text-gray-500">
              默认模型：
              <span className="ml-1 rounded bg-gray-800 px-1 py-0.5 font-mono text-[10px] text-gray-300">{resource.model}</span>
            </p>
          ) : (
            <p className="text-xs text-gray-600">Profile 未配置默认模型，执行时使用 Claude Code SDK 内置默认。</p>
          )}
        </div>
      )}

      {isCodexProfile && resource && (
        <div className="space-y-1.5 rounded-lg border border-gray-700/50 bg-gray-800/30 px-3 py-2.5">
          <p className="text-xs text-gray-400">
            模型由 Profile「{resource.name}」统一管理，通道层无需再选模型。
          </p>
          {resource.model ? (
            <p className="text-xs text-gray-500">
              默认模型：
              <span className="ml-1 rounded bg-gray-800 px-1 py-0.5 font-mono text-[10px] text-gray-300">{resource.model}</span>
            </p>
          ) : (
            <p className="text-xs text-gray-600">Profile 未配置默认模型，执行时使用 OpenCode SDK 内置默认。</p>
          )}
        </div>
      )}

      {isOpencodeProfile && resource && (
        <div className="space-y-1.5 rounded-lg border border-gray-700/50 bg-gray-800/30 px-3 py-2.5">
          <p className="text-xs text-gray-400">
            模型与部署由 Profile「{resource.name}」统一管理（{resource.deployMode === "external" ? "外部" : "内嵌"}模式）。
          </p>
          {resource.model ? (
            <p className="text-xs text-gray-500">
              默认模型：
              <span className="ml-1 rounded bg-gray-800 px-1 py-0.5 font-mono text-[10px] text-gray-300">{resource.model}</span>
            </p>
          ) : (
            <p className="text-xs text-gray-600">Profile 未配置默认模型，执行时使用 OpenCode 推荐默认。</p>
          )}
        </div>
      )}

      {isSdkChannel && (
        <>
          <div>
            <label className="mb-1 block text-xs text-gray-500">主模型 <span className="text-gray-600">— 主用户私聊 / 定时任务默认</span></label>
            {modelOptions.length > 0
              ? <SearchableSelect
                  value={modelKey(draft.model, draft.modelParams)}
                  onChange={(key) => { const { id, params } = parseModelKey(key); set({ model: id, modelParams: params }) }}
                  options={modelOptions.map((o) => ({ id: modelKey(o.id, o.params), label: o.label }))}
                  placeholder="选择模型..."
                />
              : <input type="text" value={draft.model} onChange={(e) => set({ model: e.target.value, modelParams: "" })} placeholder="auto" className={inputCls} />}
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">其他人模型 <span className="text-gray-600">— 其他用户私聊 & 群聊</span></label>
            {modelOptions.length > 0
              ? <SearchableSelect
                  value={draft.othersModel ? modelKey(draft.othersModel, draft.othersModelParams) : ""}
                  onChange={(key) => {
                    if (!key) { set({ othersModel: "", othersModelParams: "" }); return }
                    const { id, params } = parseModelKey(key)
                    set({ othersModel: id, othersModelParams: params })
                  }}
                  options={[{ id: "", label: "跟随主模型" }, ...modelOptions.map((o) => ({ id: modelKey(o.id, o.params), label: o.label }))]}
                  placeholder="跟随主模型"
                />
              : <input type="text" value={draft.othersModel} onChange={(e) => set({ othersModel: e.target.value, othersModelParams: "" })} placeholder="留空则跟随主模型" className={inputCls} />}
          </div>
        </>
      )}
    </div>
  )
}
