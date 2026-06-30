import { useState, useEffect } from "react"
import { Loader2, ShieldCheck, ShieldAlert, X, Eye, EyeOff } from "lucide-react"

const inputCls = "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none transition focus:border-blue-500"

/** SDK Key 新建/编辑弹窗 */
export function SdkEditModal(props: {
  editing: AgentResource
  isNew: boolean
  showKey: boolean
  verifying: boolean
  verifyResult: { ok: boolean; email?: string; error?: string } | null
  onClose: () => void
  onChange: (next: AgentResource) => void
  onToggleShowKey: () => void
  onVerify: () => void
  onSave: () => void
}) {
  const { editing, isNew, showKey, verifying, verifyResult, onClose, onChange, onToggleShowKey, onVerify, onSave } = props
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-200">{isNew ? "添加 SDK Key" : "编辑 SDK Key"}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">名称</label>
            <input type="text" value={editing.name} onChange={(e) => onChange({ ...editing, name: e.target.value })} className={inputCls} placeholder="如：个人号 / 工作号" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">API Key</label>
            <div className="relative">
              <input type={showKey ? "text" : "password"} value={editing.apiKey ?? ""} onChange={(e) => onChange({ ...editing, apiKey: e.target.value })} placeholder="crsr_..." className={inputCls + " pr-9"} />
              <button type="button" onClick={onToggleShowKey} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => void onVerify()} disabled={verifying || !editing.apiKey?.trim()} className="flex items-center gap-1 rounded-md border border-gray-600 px-3 py-1.5 text-xs text-gray-300 transition hover:border-blue-500 hover:text-blue-400 disabled:opacity-50">
              {verifying ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
              {verifying ? "验证中..." : "验证"}
            </button>
            {verifyResult?.ok && <span className="flex items-center gap-1 text-xs text-green-400"><ShieldCheck size={13} />有效{verifyResult.email ? ` (${verifyResult.email})` : ""}</span>}
            {verifyResult && !verifyResult.ok && <span className="flex items-center gap-1 text-xs text-red-400"><ShieldAlert size={13} />{verifyResult.error}</span>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
          <button onClick={() => void onSave()} disabled={!editing.name.trim() || !editing.apiKey?.trim()} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">保存</button>
        </div>
      </div>
    </div>
  )
}

/** Claude Code Profile 新建/编辑弹窗 */
export function CcEditModal(props: {
  editing: AgentResource
  isNew: boolean
  showKey: boolean
  verifying: boolean
  verifyResult: { ok: boolean; error?: string } | null
  onClose: () => void
  onChange: (next: AgentResource) => void
  onToggleShowKey: () => void
  onVerify: () => void
  onSave: () => void
}) {
  const { editing, isNew, showKey, verifying, verifyResult, onClose, onChange, onToggleShowKey, onVerify, onSave } = props
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-200">{isNew ? "添加 CC Profile" : "编辑 CC Profile"}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">名称</label>
            <input type="text" value={editing.name} onChange={(e) => onChange({ ...editing, name: e.target.value })} className={inputCls} placeholder="如：个人号 / 工作号" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">API Key</label>
            <div className="relative">
              <input type={showKey ? "text" : "password"} value={editing.apiKey ?? ""} onChange={(e) => onChange({ ...editing, apiKey: e.target.value })} placeholder="sk-ant-..." className={inputCls + " pr-9"} />
              <button type="button" onClick={onToggleShowKey} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => void onVerify()} disabled={verifying || !editing.apiKey?.trim()} className="flex items-center gap-1 rounded-md border border-gray-600 px-3 py-1.5 text-xs text-gray-300 transition hover:border-blue-500 hover:text-blue-400 disabled:opacity-50">
              {verifying ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
              {verifying ? "验证中..." : "验证"}
            </button>
            {verifyResult?.ok && <span className="flex items-center gap-1 text-xs text-green-400"><ShieldCheck size={13} />有效</span>}
            {verifyResult && !verifyResult.ok && <span className="flex items-center gap-1 text-xs text-red-400"><ShieldAlert size={13} />{verifyResult.error}</span>}
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">API Base URL（选填）</label>
            <input type="text" value={editing.baseUrl ?? ""} onChange={(e) => onChange({ ...editing, baseUrl: e.target.value })} className={inputCls} placeholder="https://api.anthropic.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">默认模型（选填）</label>
            <input type="text" value={editing.model ?? ""} onChange={(e) => onChange({ ...editing, model: e.target.value })} className={inputCls} placeholder="claude-opus-4-5" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
          <button onClick={() => void onSave()} disabled={!editing.name.trim() || !editing.apiKey?.trim()} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">保存</button>
        </div>
      </div>
    </div>
  )
}

/** Codex Profile 新建/编辑弹窗（apiKey 与 model 独立字段保存；模型下拉消费硬编码 CODEX_MODEL_LIST） */
export function CodexEditModal(props: {
  editing: AgentResource
  isNew: boolean
  showKey: boolean
  onClose: () => void
  onChange: (next: AgentResource) => void
  onToggleShowKey: () => void
  onSave: () => void
}) {
  const { editing, isNew, showKey, onClose, onChange, onToggleShowKey, onSave } = props
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; label: string }>>([])
  const CUSTOM_MODEL = "__custom__"

  // 静态清单经 IPC 暴露，不做运行时 API 拉取
  useEffect(() => {
    void window.electronAPI.listCodexModels().then(setModelOptions)
  }, [])

  const modelInList = modelOptions.some((m) => m.id === editing.model)
  const selectValue = !editing.model ? "" : modelInList ? editing.model : CUSTOM_MODEL

  const handleModelSelect = (value: string) => {
    if (value === CUSTOM_MODEL) {
      onChange({ ...editing, model: modelInList ? "" : editing.model })
      return
    }
    onChange({ ...editing, model: value })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-200">{isNew ? "添加 Codex Profile" : "编辑 Codex Profile"}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">名称</label>
            <input type="text" value={editing.name} onChange={(e) => onChange({ ...editing, name: e.target.value })} className={inputCls} placeholder="如：个人号 / 工作号" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">API Key</label>
            <div className="relative">
              <input type={showKey ? "text" : "password"} value={editing.apiKey ?? ""} onChange={(e) => onChange({ ...editing, apiKey: e.target.value })} placeholder="sk-..." className={inputCls + " pr-9"} />
              <button type="button" onClick={onToggleShowKey} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">API Base URL（选填）</label>
            <input type="text" value={editing.baseUrl ?? ""} onChange={(e) => onChange({ ...editing, baseUrl: e.target.value })} className={inputCls} placeholder="https://api.openai.com/v1" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">默认模型（选填）</label>
            <select value={selectValue} onChange={(e) => handleModelSelect(e.target.value)} className={inputCls}>
              <option value="">使用清单默认（gpt-5.5）</option>
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              <option value={CUSTOM_MODEL}>自定义模型 ID…</option>
            </select>
            {selectValue === CUSTOM_MODEL && (
              <input
                type="text"
                value={editing.model ?? ""}
                onChange={(e) => onChange({ ...editing, model: e.target.value })}
                className={inputCls + " mt-2"}
                placeholder="如：gpt-5.4-2026-03-05"
              />
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
          <button onClick={() => void onSave()} disabled={!editing.name.trim() || !editing.apiKey?.trim()} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">保存</button>
        </div>
      </div>
    </div>
  )
}

/** OpenCode Profile 新建/编辑弹窗 */
export function OpenCodeEditModal(props: {
  editing: AgentResource
  isNew: boolean
  showKey: boolean
  onClose: () => void
  onChange: (next: AgentResource) => void
  onToggleShowKey: () => void
  onSave: () => void
}) {
  const { editing, isNew, showKey, onClose, onChange, onToggleShowKey, onSave } = props
  const deployMode = editing.deployMode ?? "embedded"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-200">{isNew ? "添加 OpenCode Profile" : "编辑 OpenCode Profile"}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">名称</label>
            <input type="text" value={editing.name} onChange={(e) => onChange({ ...editing, name: e.target.value })} className={inputCls} placeholder="如：个人号 / 工作号" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">部署模式</label>
            <select value={deployMode} onChange={(e) => onChange({ ...editing, deployMode: e.target.value as "embedded" | "external" })} className={inputCls}>
              <option value="embedded">内嵌（自动启动本地 OpenCode 服务）</option>
              <option value="external">外部（连接已有 OpenCode 服务）</option>
            </select>
          </div>
          {deployMode === "embedded" ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Hostname</label>
                <input type="text" value={editing.opencodeHostname ?? "127.0.0.1"} onChange={(e) => onChange({ ...editing, opencodeHostname: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Port</label>
                <input type="number" value={editing.opencodePort ?? 4096} onChange={(e) => onChange({ ...editing, opencodePort: Number(e.target.value) || 4096 })} className={inputCls} />
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-gray-500">Base URL</label>
              <input type="text" value={editing.baseUrl ?? ""} onChange={(e) => onChange({ ...editing, baseUrl: e.target.value })} className={inputCls} placeholder="http://localhost:4096" />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-gray-500">Provider ID</label>
            <input type="text" value={editing.providerId ?? ""} onChange={(e) => onChange({ ...editing, providerId: e.target.value })} className={inputCls} placeholder="anthropic" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">API Key</label>
            <div className="relative">
              <input type={showKey ? "text" : "password"} value={editing.apiKey ?? ""} onChange={(e) => onChange({ ...editing, apiKey: e.target.value })} className={inputCls + " pr-9"} />
              <button type="button" onClick={onToggleShowKey} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">默认模型（选填，provider/model）</label>
            <input type="text" value={editing.model ?? ""} onChange={(e) => onChange({ ...editing, model: e.target.value })} className={inputCls} placeholder="anthropic/claude-3-5-sonnet-20241022" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
          <button onClick={() => void onSave()} disabled={!editing.name.trim() || !editing.apiKey?.trim() || !editing.providerId?.trim()} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">保存</button>
        </div>
      </div>
    </div>
  )
}
