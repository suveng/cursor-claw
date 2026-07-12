import { useState, useEffect, useRef, useCallback } from "react"
import { RefreshCw, Plus, Pencil, Trash2, X, Loader2, Play } from "lucide-react"
import SearchableSelect from "../components/SearchableSelect"

interface TaskItem {
  id: string; name: string; cron: string; content: string; enabled: boolean; independent?: boolean
  channelId?: string; model?: string; modelParams?: string
}

interface Props {
  taskChannels: ChannelConfig[]
  agentResources: AgentResource[]
  showAlert: (title: string, message: string) => Promise<void>
}

const inputCls = "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none transition focus:border-blue-500"

/** Settings 定时任务 Tab：列表、CRUD、Cron 预览与编辑弹窗 */
export default function SettingsTasksTab({ taskChannels, agentResources, showAlert }: Props) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [taskEditing, setTaskEditing] = useState<TaskItem | null>(null)
  const [taskCronValid, setTaskCronValid] = useState(true)
  const [cronPreviewRuns, setCronPreviewRuns] = useState<string[] | null>(null)
  const [cronPreviewErr, setCronPreviewErr] = useState<string | null>(null)
  const [cronPreviewLoading, setCronPreviewLoading] = useState(false)
  const cronPreviewReq = useRef(0)
  const cronPreviewTaskIdRef = useRef("")
  const [taskStatuses, setTaskStatuses] = useState<Record<string, { running: boolean; pid?: number; startedAt?: number }>>({})
  const [taskModelOptions, setTaskModelOptions] = useState<{ id: string; label: string; params: string }[]>([])
  const [loadingTaskModels, setLoadingTaskModels] = useState(false)

  const refreshTasks = useCallback(() => {
    window.electronAPI.getScheduledTasks().then(setTasks)
  }, [])

  useEffect(() => {
    refreshTasks()
    void window.electronAPI.getScheduledTaskStatus().then(setTaskStatuses)
    const unsub = window.electronAPI.onScheduledTaskStatus(setTaskStatuses)
    return () => { unsub() }
  }, [refreshTasks])

  const taskModalOpen = taskEditing !== null
  const taskIdForCronPreview = taskEditing?.id ?? ""
  const taskCronForPreview = taskEditing?.cron ?? ""

  useEffect(() => {
    if (!taskModalOpen) {
      cronPreviewTaskIdRef.current = ""
      setCronPreviewRuns(null)
      setCronPreviewErr(null)
      setCronPreviewLoading(false)
      return
    }
    const cron = taskCronForPreview.trim()
    if (!cron) {
      setCronPreviewRuns(null)
      setCronPreviewErr(null)
      setCronPreviewLoading(false)
      return
    }
    if (cronPreviewTaskIdRef.current !== taskIdForCronPreview) {
      cronPreviewTaskIdRef.current = taskIdForCronPreview
      setCronPreviewRuns(null)
      setCronPreviewErr(null)
    }
    const req = ++cronPreviewReq.current
    const t = setTimeout(async () => {
      if (req !== cronPreviewReq.current) return
      setCronPreviewLoading(true)
      setCronPreviewErr(null)
      try {
        const r = await window.electronAPI.previewCronNextRuns(cron)
        if (req !== cronPreviewReq.current) return
        if (r.ok) setCronPreviewRuns(r.runs)
        else { setCronPreviewRuns(null); setCronPreviewErr(r.error) }
      } finally {
        if (req === cronPreviewReq.current) setCronPreviewLoading(false)
      }
    }, 320)
    return () => clearTimeout(t)
  }, [taskModalOpen, taskIdForCronPreview, taskCronForPreview])

  const fetchTaskModels = async (channelId?: string) => {
    const channel = taskChannels.find((c) => c.id === channelId) ?? taskChannels[0]
    const resource = agentResources.find((r) => r.id === channel?.agentResourceId)
    setLoadingTaskModels(true)
    try {
      if (resource?.type === "sdk") {
        const r = await window.electronAPI.listSdkModels(resource.apiKey ?? "")
        if (r.ok && r.models.length > 0) setTaskModelOptions(r.models)
        else if (!r.ok) void showAlert("错误", r.error || "获取模型列表失败")
      } else if (resource?.type === "claude-code") {
        const models = await window.electronAPI.listCcModels()
        if (models.length > 0) setTaskModelOptions(models.map((m) => ({ ...m, params: "" })))
      } else {
        void showAlert("提示", "请先添加 SDK Key 或 Claude Agent Profile 后再选择模型")
      }
    } finally {
      setLoadingTaskModels(false)
    }
  }

  const openTaskAdd = () => {
    setTaskEditing({
      id: crypto.randomUUID(), name: "", cron: "", content: "", enabled: true, independent: true,
      channelId: taskChannels.find((c) => c.enabled)?.id ?? taskChannels[0]?.id,
    })
    setTaskCronValid(true)
    setTaskModelOptions([])
  }
  const openTaskEdit = (t: TaskItem) => { setTaskEditing({ ...t }); setTaskCronValid(true); setTaskModelOptions([]) }
  const handleTaskDelete = async (id: string) => {
    await window.electronAPI.saveScheduledTasks(tasks.filter((t) => t.id !== id)); refreshTasks()
  }
  const handleTaskToggle = async (id: string) => {
    await window.electronAPI.saveScheduledTasks(tasks.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t)); refreshTasks()
  }
  const handleTaskTrigger = async (id: string) => { await window.electronAPI.triggerScheduledTask(id) }
  const handleTaskSave = async () => {
    if (!taskEditing || !taskEditing.name.trim() || !taskEditing.cron.trim()) return
    const valid = await window.electronAPI.validateCron(taskEditing.cron.trim())
    setTaskCronValid(valid)
    if (!valid) return
    const exists = tasks.find((t) => t.id === taskEditing.id)
    const updated = exists ? tasks.map((t) => t.id === taskEditing.id ? taskEditing : t) : [...tasks, taskEditing]
    await window.electronAPI.saveScheduledTasks(updated)
    setTaskEditing(null); refreshTasks()
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">定时任务</h3>
          <button onClick={refreshTasks} className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white"><RefreshCw size={12} />刷新</button>
          <div className="flex-1" />
          <button onClick={openTaskAdd} className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500"><Plus size={12} />新增</button>
        </div>
        <div className="space-y-2">
          {tasks.map((t) => {
            const status = taskStatuses[t.id]
            const isRunning = !!status?.running
            return (
              <div key={t.id} className={`flex items-center justify-between rounded-lg border px-4 py-3 ${isRunning ? "border-green-700/50 bg-green-950/20" : "border-gray-700"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`truncate text-sm font-medium ${t.enabled ? "" : "text-gray-600 line-through"}`}>{t.name}</p>
                    <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">{t.cron}</span>
                    {t.channelId && <span className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-400">{taskChannels.find((c) => c.id === t.channelId)?.name ?? "通道已删除"}</span>}
                    {t.model && <span className="shrink-0 rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] text-purple-400">{t.model}</span>}
                    {t.independent !== false && <span className="shrink-0 rounded bg-indigo-900/40 px-1.5 py-0.5 text-[10px] text-indigo-400">独立</span>}
                    {isRunning && <span className="inline-flex items-center gap-1 shrink-0 rounded bg-green-900/40 px-1.5 py-0.5 text-[10px] text-green-400"><span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />运行中</span>}
                  </div>
                  <p className="truncate text-xs text-gray-500">{t.content.slice(0, 80)}{t.content.length > 80 ? "..." : ""}</p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <button onClick={() => handleTaskTrigger(t.id)} title="立即执行" className="rounded p-1 text-gray-500 transition hover:bg-blue-600/20 hover:text-blue-400"><Play size={13} /></button>
                  <button onClick={() => handleTaskToggle(t.id)} className={`rounded px-2 py-0.5 text-xs transition ${t.enabled ? "text-green-400 hover:bg-green-600/20" : "text-gray-500 hover:bg-gray-800"}`}>{t.enabled ? "启用" : "禁用"}</button>
                  <button onClick={() => openTaskEdit(t)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white"><Pencil size={13} /></button>
                  <button onClick={() => handleTaskDelete(t.id)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
          {tasks.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无定时任务</p>}
        </div>
      </section>

      {taskEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex w-full max-w-lg flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl" style={{ maxHeight: "80vh" }}>
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <h3 className="text-sm font-semibold text-gray-200">{tasks.find((t) => t.id === taskEditing.id) ? "编辑定时任务" : "新增定时任务"}</h3>
              <button onClick={() => setTaskEditing(null)} className="text-gray-500 hover:text-white"><X size={16} /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
              <div><label className="mb-1 block text-xs text-gray-500">任务名称</label><input type="text" value={taskEditing.name} onChange={(e) => setTaskEditing({ ...taskEditing, name: e.target.value })} className={inputCls} placeholder="日报推送" /></div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Cron 表达式</label>
                <input type="text" value={taskEditing.cron} onChange={(e) => { setTaskEditing({ ...taskEditing, cron: e.target.value }); setTaskCronValid(true) }} className={inputCls + (!taskCronValid ? " border-red-500" : "")} placeholder="0 9 * * 1-5" />
                {!taskCronValid && <p className="mt-1 text-xs text-red-400">Cron 表达式无效</p>}
                <p className="mt-1 text-xs text-gray-600">
                  五段：分 时 日 月 周（如 0 9 * * 1-5 = 工作日 9:00）。六段时在前面加「秒」：秒 分 时 日 月 周。
                  每 5 秒请用 <code className="rounded bg-gray-800 px-1">*/5 * * * * *</code>，勿用 <code className="rounded bg-gray-800 px-1">0/5</code>（在 node-cron 里会变成每分钟一次）。
                </p>
                <div className="mt-2 rounded-lg border border-gray-800 bg-gray-900/80 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-gray-500">最近 5 次触发（本地时间）</p>
                    {cronPreviewLoading && cronPreviewRuns && cronPreviewRuns.length > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-gray-500"><Loader2 size={11} className="animate-spin shrink-0" />更新中…</span>
                    )}
                  </div>
                  {cronPreviewLoading && (!cronPreviewRuns || cronPreviewRuns.length === 0) && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" />计算中…</p>
                  )}
                  {!cronPreviewLoading && cronPreviewErr && <p className="mt-1 text-xs text-amber-400/90">{cronPreviewErr}</p>}
                  {cronPreviewRuns && cronPreviewRuns.length > 0 && (
                    <ol className={`mt-1.5 list-decimal space-y-0.5 pl-4 font-mono text-[11px] leading-relaxed text-gray-400 ${cronPreviewLoading ? "opacity-70" : ""}`}>
                      {cronPreviewRuns.map((line, i) => <li key={`${line}-${i}`}>{line}</li>)}
                    </ol>
                  )}
                  <p className="mt-1.5 text-[10px] text-gray-600">由解析库推算，与 node-cron 在少数写法上可能略有差异，以实际日志为准。</p>
                </div>
              </div>
              <div><label className="mb-1 block text-xs text-gray-500">消息内容</label><textarea value={taskEditing.content} onChange={(e) => setTaskEditing({ ...taskEditing, content: e.target.value })} rows={6} className={inputCls + " font-mono text-xs leading-relaxed"} placeholder="要发送给 Agent 的消息..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">消息通道</label>
                  <select value={taskEditing.channelId ?? ""} onChange={(e) => { setTaskEditing({ ...taskEditing, channelId: e.target.value || undefined }); setTaskModelOptions([]) }} className={inputCls}>
                    <option value="">默认（第一个可用通道）</option>
                    {taskChannels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.enabled ? "" : "（已停用）"}</option>)}
                  </select>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <label className="block text-xs text-gray-500">模型</label>
                    <button onClick={() => void fetchTaskModels(taskEditing.channelId)} disabled={loadingTaskModels} className="flex items-center gap-1 rounded px-1.5 py-0 text-[10px] text-gray-500 transition hover:bg-gray-800 hover:text-white disabled:opacity-50">
                      {loadingTaskModels ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}获取
                    </button>
                  </div>
                  {taskModelOptions.length > 0
                    ? <SearchableSelect
                        value={taskEditing.model ? taskEditing.model + (taskEditing.modelParams ? "\0" + taskEditing.modelParams : "") : ""}
                        onChange={(key) => {
                          if (!key) { setTaskEditing({ ...taskEditing, model: undefined, modelParams: undefined }); return }
                          const sep = key.indexOf("\0")
                          setTaskEditing(sep >= 0
                            ? { ...taskEditing, model: key.slice(0, sep), modelParams: key.slice(sep + 1) }
                            : { ...taskEditing, model: key, modelParams: undefined })
                        }}
                        options={[{ id: "", label: "跟随通道主模型" }, ...taskModelOptions.map((o) => ({ id: o.id + (o.params ? "\0" + o.params : ""), label: o.label }))]}
                        placeholder="跟随通道主模型"
                      />
                    : <input type="text" value={taskEditing.model ?? ""} onChange={(e) => setTaskEditing({ ...taskEditing, model: e.target.value || undefined, modelParams: undefined })} placeholder="留空跟随通道主模型" className={inputCls} />}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={taskEditing.enabled} onChange={(e) => setTaskEditing({ ...taskEditing, enabled: e.target.checked })} className="rounded border-gray-600" />启用</label>
                <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={taskEditing.independent !== false} onChange={(e) => setTaskEditing({ ...taskEditing, independent: e.target.checked })} className="rounded border-gray-600" />独立运行</label>
              </div>
              <p className="text-[10px] text-gray-600">独立运行：触发时直接启动新 Agent 会话，不进入消息队列</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
              <button onClick={() => setTaskEditing(null)} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
              <button onClick={handleTaskSave} disabled={!taskEditing.name.trim() || !taskEditing.cron.trim()} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">保存</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
