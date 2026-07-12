import { useState, useEffect, useCallback } from "react"
import { Plus, Trash2, X, ChevronDown, FolderOpen } from "lucide-react"
import type { WorkflowDefinition, WorkflowNode } from "../../workflow/workflow-types"
import SearchableSelect from "./SearchableSelect"
import WorkflowGatewayFields from "./WorkflowGatewayFields"

const inputCls = "w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"

function uid(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

function emptyNode(): WorkflowNode {
  return { id: uid(), name: "", prompt: "", maxRetries: 1, kind: "task" }
}

/** 新建空白工作流定义 */
export function emptyWorkflowDef(): WorkflowDefinition {
  return { id: uid(), name: "", nodes: [emptyNode()], createdAt: Date.now(), updatedAt: Date.now(), config: {} }
}

interface DefEditorProps {
  initial: WorkflowDefinition
  onSave: (d: WorkflowDefinition) => void
  onCancel: () => void
}

/** 工作流定义编辑弹窗（节点列表 + 单节点配置） */
export default function WorkflowDefEditor({ initial, onSave, onCancel }: DefEditorProps) {
  const [def, setDef] = useState<WorkflowDefinition>(() => ({
    ...initial,
    config: initial.config ?? {},
    nodes: initial.nodes.length ? initial.nodes : [emptyNode()],
  }))
  const [activeNodeIdx, setActiveNodeIdx] = useState(0)
  const [defaultDir, setDefaultDir] = useState("")
  const [defaultModel, setDefaultModel] = useState("")
  const [modelOptions, setModelOptions] = useState<{ id: string; label: string }[]>([])

  const modelLabel = useCallback((id: string) => modelOptions.find((o) => o.id === id)?.label || id, [modelOptions])

  useEffect(() => {
    void window.electronAPI.getConfig().then(async (cfg) => {
      setDefaultDir(cfg.workspaceDir || "未配置")
      setDefaultModel(cfg.model || "auto")
      const resources = cfg.agentResources ?? []
      const sdkRes = resources.find((r) => r.type === "sdk" && r.apiKey?.trim())
      if (sdkRes) {
        const res = await window.electronAPI.listSdkModels(sdkRes.apiKey!, cfg.model, cfg.modelParams)
        if (res.ok) setModelOptions(res.models.map((m) => ({ id: m.id, label: m.label || m.id })))
      } else {
        const models = await window.electronAPI.listCcModels()
        if (models.length > 0) setModelOptions(models.map((m) => ({ id: m.id, label: m.label || m.id })))
      }
    })
  }, [])

  const pickDir = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) setDef({ ...def, workingDirectory: dir })
  }

  const [cfgEntries, setCfgEntries] = useState(() =>
    Object.entries(initial.config ?? {}).map(([key, value]) => ({ key, value }))
  )
  const updateCfgEntry = (idx: number, field: "key" | "value", val: string) =>
    setCfgEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: val } : e)))
  const removeCfgEntry = (idx: number) =>
    setCfgEntries((prev) => prev.filter((_, i) => i !== idx))
  const addCfgEntry = () => setCfgEntries((prev) => [...prev, { key: "", value: "" }])
  const cfgToRecord = () => {
    const r: Record<string, string> = {}
    for (const { key, value } of cfgEntries) if (key.trim()) r[key.trim()] = value
    return r
  }

  const updateNode = (idx: number, patch: Partial<WorkflowNode>) => {
    const nodes = [...def.nodes]
    nodes[idx] = { ...nodes[idx], ...patch }
    setDef({ ...def, nodes })
  }

  const removeNode = (idx: number) => {
    if (def.nodes.length <= 1) return
    const nodes = def.nodes.filter((_, i) => i !== idx)
    setDef({ ...def, nodes })
    if (activeNodeIdx >= nodes.length) setActiveNodeIdx(nodes.length - 1)
    else if (activeNodeIdx === idx) setActiveNodeIdx(Math.max(0, idx - 1))
  }

  const addNode = () => {
    const n = emptyNode()
    setDef({ ...def, nodes: [...def.nodes, n] })
    setActiveNodeIdx(def.nodes.length)
  }

  const moveNode = (from: number, to: number) => {
    if (to < 0 || to >= def.nodes.length) return
    const nodes = [...def.nodes]
    const [moved] = nodes.splice(from, 1)
    nodes.splice(to, 0, moved)
    setDef({ ...def, nodes })
    setActiveNodeIdx(to)
  }

  // gateway 可不填 prompt；task 仍要求名称+prompt
  const canSave = def.name.trim() && def.nodes.every((n) => {
    if ((n.kind ?? "task") === "gateway") return Boolean(n.name.trim())
    return Boolean(n.name.trim() && n.prompt.trim())
  })
  const activeNode = def.nodes[activeNodeIdx]
  const isGateway = (activeNode?.kind ?? "task") === "gateway"

  const getInheritedModel = (nodeIdx: number): string => {
    for (let i = nodeIdx - 1; i >= 0; i--) {
      if (def.nodes[i].model) return modelLabel(def.nodes[i].model!)
    }
    return modelLabel(defaultModel)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex w-full max-w-4xl flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
          <h3 className="text-sm font-semibold text-gray-200">{initial.createdAt === def.createdAt && !initial.name ? "新建工作流" : "编辑工作流"}</h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-72 shrink-0 space-y-3 overflow-y-auto border-r border-gray-800 p-4">
            <div>
              <label className="mb-1 block text-xs text-gray-500">名称 *</label>
              <input type="text" value={def.name} onChange={(e) => setDef({ ...def, name: e.target.value })} className={inputCls} placeholder="例如：代码审查流程" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">描述</label>
              <input type="text" value={def.description ?? ""} onChange={(e) => setDef({ ...def, description: e.target.value })} className={inputCls} placeholder="简要说明工作流用途" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">工作目录 <span className="text-gray-600">（默认：{defaultDir}）</span></label>
              <div className="flex gap-1.5">
                <input type="text" value={def.workingDirectory ?? ""} onChange={(e) => setDef({ ...def, workingDirectory: e.target.value })} className={inputCls + " flex-1"} placeholder={defaultDir} />
                <button type="button" onClick={pickDir} className="shrink-0 rounded-md border border-gray-700 bg-gray-800 px-2 text-gray-400 hover:border-blue-500 hover:text-blue-400"><FolderOpen size={14} /></button>
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs text-gray-500">环境变量</label>
                <button onClick={addCfgEntry} className="text-xs text-blue-400 hover:text-blue-300"><Plus size={12} /></button>
              </div>
              {cfgEntries.length > 0 && (
                <div className="space-y-1">
                  {cfgEntries.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <input type="text" value={entry.key} onChange={(e) => updateCfgEntry(idx, "key", e.target.value)} className="w-20 shrink-0 rounded border border-gray-700 bg-gray-800 px-1.5 py-1 font-mono text-[11px] text-gray-200 outline-none focus:border-blue-500" placeholder="KEY" />
                      <span className="text-[10px] text-gray-600">=</span>
                      <input type="text" value={entry.value} onChange={(e) => updateCfgEntry(idx, "value", e.target.value)} className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 px-1.5 py-1 font-mono text-[11px] text-gray-200 outline-none focus:border-blue-500" placeholder="value" />
                      <button onClick={() => removeCfgEntry(idx)} className="shrink-0 text-gray-600 hover:text-red-400"><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs text-gray-500">节点列表</label>
                <button onClick={addNode} className="text-xs text-blue-400 hover:text-blue-300"><Plus size={12} /></button>
              </div>
              <div className="space-y-0.5">
                {def.nodes.map((node, idx) => (
                  <div
                    key={node.id}
                    onClick={() => setActiveNodeIdx(idx)}
                    className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition ${idx === activeNodeIdx ? "bg-blue-600/20 text-blue-300" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${idx === activeNodeIdx ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-400"}`}>{idx + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{node.name || "未命名节点"}{(node.kind ?? "task") === "gateway" ? " · gw" : ""}</span>
                    {def.nodes.length > 1 && (
                      <button onClick={(e) => { e.stopPropagation(); removeNode(idx) }} className="invisible shrink-0 text-gray-600 hover:text-red-400 group-hover:visible"><Trash2 size={11} /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {activeNode && (
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">{activeNodeIdx + 1}</span>
                <h4 className="text-sm font-medium text-gray-200">节点配置</h4>
                <span className="text-[11px] font-mono text-gray-600">#{activeNode.id}</span>
                <div className="ml-auto flex gap-1">
                  <button onClick={() => moveNode(activeNodeIdx, activeNodeIdx - 1)} disabled={activeNodeIdx === 0} className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-white disabled:opacity-30" title="上移"><ChevronDown size={14} className="rotate-180" /></button>
                  <button onClick={() => moveNode(activeNodeIdx, activeNodeIdx + 1)} disabled={activeNodeIdx === def.nodes.length - 1} className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-white disabled:opacity-30" title="下移"><ChevronDown size={14} /></button>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">节点名称 *</label>
                  <input type="text" value={activeNode.name} onChange={(e) => updateNode(activeNodeIdx, { name: e.target.value })} className={inputCls} placeholder="例如：代码审查" />
                </div>
                <WorkflowGatewayFields
                  node={activeNode}
                  nodeIds={def.nodes.map((n) => n.id)}
                  onChange={(patch) => updateNode(activeNodeIdx, patch)}
                />
                {!isGateway && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Prompt *</label>
                      <textarea
                        value={activeNode.prompt}
                        onChange={(e) => updateNode(activeNodeIdx, { prompt: e.target.value })}
                        rows={8}
                        className={inputCls + " font-mono text-xs leading-relaxed"}
                        placeholder="该节点的 Agent 指令；可用 {{config.KEY}}"
                      />
                    </div>
                    <div className="flex items-end gap-4">
                      <div className="w-28 shrink-0">
                        <label className="mb-1 block text-xs text-gray-500">最大重试</label>
                        <input type="number" min={0} value={activeNode.maxRetries} onChange={(e) => updateNode(activeNodeIdx, { maxRetries: parseInt(e.target.value) || 0 })} className={inputCls} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-xs text-gray-500">模型</label>
                        {activeNodeIdx === 0 || activeNode.isolated ? (
                          <SearchableSelect
                            value={activeNode.model ?? ""}
                            onChange={(v) => updateNode(activeNodeIdx, { model: v || undefined })}
                            options={modelOptions}
                            placeholder={activeNodeIdx === 0 ? `默认: ${modelLabel(defaultModel)}` : `继承: ${getInheritedModel(activeNodeIdx)}`}
                          />
                        ) : (
                          <div className="flex h-[34px] items-center rounded-md border border-gray-700/50 bg-gray-800/50 px-3 text-xs text-gray-400">
                            继承：{getInheritedModel(activeNodeIdx)}
                          </div>
                        )}
                      </div>
                    </div>
                    {activeNodeIdx > 0 && (
                      <label className="flex items-center gap-2 text-xs text-gray-400 select-none">
                        <input type="checkbox" checked={activeNode.isolated ?? false} onChange={(e) => {
                          const isolated = e.target.checked
                          updateNode(activeNodeIdx, isolated ? { isolated } : { isolated: false, model: undefined })
                        }} className="rounded border-gray-600" />
                        隔离运行（独立 Agent 会话，可单独设置模型）
                      </label>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-3">
          <button onClick={onCancel} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
          <button onClick={() => onSave({ ...def, config: cfgToRecord(), updatedAt: Date.now() })} disabled={!canSave} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">保存</button>
        </div>
      </div>
    </div>
  )
}
