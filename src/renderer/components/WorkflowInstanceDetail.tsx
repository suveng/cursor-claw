import { useState } from "react"
import {
  X, Loader2, CheckCircle2, AlertTriangle, Pause, Clock, Play,
} from "lucide-react"
import type { WorkflowInstance, WorkflowStatus } from "../../workflow/workflow-types"

/** 实例状态图标与颜色（列表与详情共用） */
export const STATUS_STYLE: Record<WorkflowStatus, { color: string; Icon: typeof CheckCircle2 }> = {
  pending: { color: "text-gray-400", Icon: Clock },
  running: { color: "text-blue-400", Icon: Loader2 },
  paused: { color: "text-yellow-400", Icon: Pause },
  completed: { color: "text-green-400", Icon: CheckCircle2 },
  failed: { color: "text-red-400", Icon: AlertTriangle },
}

/** 实例状态中文标签 */
export const STATUS_LABEL: Record<WorkflowStatus, string> = {
  pending: "等待中", running: "运行中", paused: "已暂停", completed: "已完成", failed: "已失败",
}

interface WorkflowInstanceDetailProps {
  inst: WorkflowInstance
  defName: string
  onClose: () => void
  onDelete: () => void
}

/** 工作流实例详情弹窗；paused 状态展示恢复按钮 */
export default function WorkflowInstanceDetail({ inst, defName, onClose, onDelete }: WorkflowInstanceDetailProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const s = STATUS_STYLE[inst.status]

  /** 调用 IPC 恢复暂停实例；成功关闭弹窗（父级经 instance-updated 刷新列表） */
  const handleResume = async () => {
    if (busy || inst.status !== "paused") return
    setBusy(true)
    setError("")
    try {
      const result = await window.electronAPI.resumeWorkflowInstance(inst.id)
      if (!result.ok) {
        setError(result.error || "恢复失败")
        return
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl" style={{ maxHeight: "80vh" }}>
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <s.Icon size={15} className={`${s.color} ${inst.status === "running" ? "animate-spin" : ""}`} />
            <h3 className="text-sm font-semibold text-gray-200">{defName || inst.workflowId}</h3>
            <span className={`text-xs ${s.color}`}>{STATUS_LABEL[inst.status]}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4 text-xs">
          {error && <p className="rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-red-400">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-gray-600">实例ID</span><p className="font-mono text-gray-400">{inst.id}</p></div>
            <div><span className="text-gray-600">步骤</span><p className="text-gray-300">{inst.stepCount} / {inst.maxSteps}</p></div>
            <div><span className="text-gray-600">当前节点</span><p className="text-gray-300">{inst.currentNodeId ?? "-"}</p></div>
            <div><span className="text-gray-600">创建时间</span><p className="text-gray-400">{new Date(inst.createdAt).toLocaleString()}</p></div>
          </div>
          {inst.input && (
            <div><span className="text-gray-600">输入</span><pre className="mt-1 max-h-24 overflow-auto rounded-md bg-gray-800 p-2 text-gray-400">{inst.input}</pre></div>
          )}
          {inst.nodeHistory.length > 0 && (
            <div>
              <span className="text-gray-600">执行历史</span>
              <div className="mt-1 space-y-1">
                {inst.nodeHistory.map((h, i) => (
                  <div key={`${h.nodeId}-${h.attempt}-${i}`} className="flex items-center gap-2 rounded-md bg-gray-800/60 px-2 py-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${h.status === "completed" ? "bg-green-400" : h.status === "running" ? "bg-blue-400" : h.status === "rejected" ? "bg-yellow-400" : "bg-red-400"}`} />
                    <span className="flex-1 text-gray-300">{h.nodeId}</span>
                    <span className="text-gray-600">#{h.attempt}</span>
                    <span className="text-gray-500">{h.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
          {inst.status === "paused" && (
            <button
              onClick={() => void handleResume()}
              disabled={busy}
              className="mr-auto flex items-center gap-1.5 rounded-md bg-yellow-600/80 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-yellow-500 disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              恢复
            </button>
          )}
          <button onClick={onDelete} className="rounded-md px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-900/30">删除实例</button>
          <button onClick={onClose} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">关闭</button>
        </div>
      </div>
    </div>
  )
}
