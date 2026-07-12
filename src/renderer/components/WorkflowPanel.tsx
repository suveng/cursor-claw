import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, X, Play, Loader2 } from "lucide-react"
import type { WorkflowDefinition, WorkflowInstance } from "../../workflow/workflow-types"
import WorkflowDefEditor, { emptyWorkflowDef } from "./WorkflowDefEditor"
import WorkflowInstanceDetail, { STATUS_STYLE, STATUS_LABEL } from "./WorkflowInstanceDetail"

const inputCls = "w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"

// ── Run Launch Dialog ───────────────────────────────────────

function RunLaunchDialog({ def, busy, onConfirm, onCancel }: {
  def: WorkflowDefinition
  busy?: boolean
  onConfirm: (input: string) => void
  onCancel: () => void
}) {
  const [input, setInput] = useState("")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-200">启动工作流</h3>
          <button onClick={onCancel} disabled={busy} className="text-gray-500 hover:text-white disabled:opacity-40"><X size={16} /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-gray-300">{def.name}</p>
          <div>
            <label className="mb-1 block text-xs text-gray-500">初始输入（选填）</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={4}
              disabled={busy}
              className={inputCls + " text-xs"}
              placeholder="将作为工作流实例的初始输入..."
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-5 py-3">
          <button onClick={onCancel} disabled={busy} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white disabled:opacity-40">取消</button>
          <button onClick={() => onConfirm(input.trim())} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            确定启动
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Panel ──────────────────────────────────────────────

type SubTab = "definitions" | "instances"

export default function WorkflowPanel() {
  const [subTab, setSubTab] = useState<SubTab>("definitions")
  const [defs, setDefs] = useState<WorkflowDefinition[]>([])
  const [instances, setInstances] = useState<WorkflowInstance[]>([])
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null)
  const [viewInst, setViewInst] = useState<WorkflowInstance | null>(null)
  const [runningDef, setRunningDef] = useState<WorkflowDefinition | null>(null)
  const [runBusy, setRunBusy] = useState(false)
  const [runError, setRunError] = useState("")
  const [autoPause, setAutoPause] = useState(true)

  const refreshDefs = useCallback(async () => {
    setDefs(await window.electronAPI.getWorkflowDefinitions())
  }, [])

  const refreshInstances = useCallback(async () => {
    setInstances(await window.electronAPI.getWorkflowInstances())
  }, [])

  useEffect(() => {
    void window.electronAPI.getConfig().then((cfg) => {
      setAutoPause(cfg.workflowAutoPauseStale !== false)
    })
  }, [])

  useEffect(() => {
    if (subTab === "definitions") void refreshDefs()
    else void refreshInstances()
  }, [subTab, refreshDefs, refreshInstances])

  useEffect(() => {
    return window.electronAPI.onWorkflowInstanceUpdate((updated) => {
      setInstances((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
      setViewInst((prev) => (prev && prev.id === updated.id ? updated : prev))
    })
  }, [])

  const toggleAutoPause = async (checked: boolean) => {
    setAutoPause(checked)
    await window.electronAPI.saveConfig({ workflowAutoPauseStale: checked })
  }

  const saveDef = async (d: WorkflowDefinition) => {
    await window.electronAPI.saveWorkflowDefinition(d)
    setEditing(null)
    void refreshDefs()
  }

  const deleteDef = async (id: string) => {
    await window.electronAPI.deleteWorkflowDefinition(id)
    void refreshDefs()
  }

  const deleteInst = async (id: string) => {
    await window.electronAPI.deleteWorkflowInstance(id)
    setViewInst(null)
    void refreshInstances()
  }

  const handleRunConfirm = async (input: string) => {
    if (!runningDef || runBusy) return
    setRunBusy(true)
    setRunError("")
    try {
      const result = await window.electronAPI.runWorkflow(runningDef.id, input || undefined)
      if (!result.ok) {
        setRunError(result.error || "启动失败")
        return
      }
      setRunningDef(null)
      setSubTab("instances")
      void refreshInstances()
    } finally {
      setRunBusy(false)
    }
  }

  const defNameMap = Object.fromEntries(defs.map((d) => [d.id, d.name]))

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-300">工作流</h3>
          <div className="flex rounded-md border border-gray-700 text-xs">
            <button onClick={() => setSubTab("definitions")} className={`px-3 py-1 rounded-l-md transition ${subTab === "definitions" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>定义</button>
            <button onClick={() => setSubTab("instances")} className={`px-3 py-1 rounded-r-md transition ${subTab === "instances" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}>实例</button>
          </div>
          {subTab === "definitions" && (
            <button onClick={() => setEditing(emptyWorkflowDef())} className="ml-auto flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">
              <Plus size={13} />新建
            </button>
          )}
          {subTab === "instances" && (
            <button onClick={() => void refreshInstances()} className="ml-auto flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white">
              刷新
            </button>
          )}
        </div>

        {/* 自动 paused 开关 + 驳回说明（R4/R5） */}
        <div className="space-y-1 rounded-md border border-gray-800 bg-gray-800/20 px-3 py-2 text-[11px] text-gray-500">
          <label className="flex items-center gap-2 text-gray-400 select-none">
            <input
              type="checkbox"
              checked={autoPause}
              onChange={(e) => void toggleAutoPause(e.target.checked)}
              className="rounded border-gray-600"
            />
            启动时自动暂停陈旧 running 实例
          </label>
          <p>开启后应用/Daemon 启动会将未正常结束的 running 标为 paused（首次升级可能批量暂停）。关闭则启动不改写 running。</p>
          <p>驳回重跑时 Prompt 会附带「上次本节点产出」，便于对照修正。</p>
        </div>

        {subTab === "definitions" && (
          <div className="space-y-1.5">
            {runError && <p className="rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">{runError}</p>}
            {defs.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无工作流定义</p>}
            {defs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-200">{d.name}</p>
                  <p className="truncate text-[11px] text-gray-600">{d.description || `${d.nodes.length} 个节点`}</p>
                </div>
                <button onClick={() => { setRunError(""); setRunningDef(d) }} title="启动工作流" className="shrink-0 text-gray-500 hover:text-blue-400"><Play size={14} /></button>
                <button onClick={() => setEditing({ ...d })} className="shrink-0 text-gray-500 hover:text-blue-400"><Pencil size={14} /></button>
                <button onClick={() => void deleteDef(d.id)} className="shrink-0 text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}

        {subTab === "instances" && (
          <div className="space-y-1.5">
            {instances.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无运行实例</p>}
            {instances.map((inst) => {
              const s = STATUS_STYLE[inst.status]
              return (
                <div key={inst.id} onClick={() => { void refreshDefs().then(() => setViewInst(inst)) }} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-2.5 hover:border-gray-700">
                  <s.Icon size={15} className={`shrink-0 ${s.color} ${inst.status === "running" ? "animate-spin" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-200">{defNameMap[inst.workflowId] || inst.workflowId}</p>
                    <p className="truncate text-[11px] text-gray-600">{STATUS_LABEL[inst.status]} · 步骤 {inst.stepCount}/{inst.maxSteps}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-gray-600">{new Date(inst.updatedAt).toLocaleString()}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {editing && <WorkflowDefEditor initial={editing} onSave={(d) => void saveDef(d)} onCancel={() => setEditing(null)} />}
      {runningDef && <RunLaunchDialog def={runningDef} busy={runBusy} onConfirm={(input) => void handleRunConfirm(input)} onCancel={() => !runBusy && setRunningDef(null)} />}
      {viewInst && <WorkflowInstanceDetail inst={viewInst} defName={defNameMap[viewInst.workflowId] ?? ""} onClose={() => setViewInst(null)} onDelete={() => void deleteInst(viewInst.id)} />}
    </>
  )
}

