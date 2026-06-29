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
