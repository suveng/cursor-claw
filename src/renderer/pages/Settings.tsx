import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import {
  ArrowLeft,
  FolderOpen,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  X,
  Settings as SettingsIcon,
  Network,
  FileCode2,
  Timer,
  Sparkles,
  Bot,
  Download,
  Play,
  BookOpen,
  ExternalLink,
  Copy,
  Info,
  Github,
  MessageSquare,
  Waypoints,
} from "lucide-react"
import SearchableSelect from "../components/SearchableSelect"
import WorkflowPanel from "../components/WorkflowPanel"
import AgentPanel from "../components/AgentPanel"
import SettingsEngineShell from "../components/SettingsEngineShell"
import SettingsRulesPanel from "../components/SettingsRulesPanel"
import SettingsSkillsPanel from "../components/SettingsSkillsPanel"
import SettingsMcpEngineBlock from "../components/SettingsMcpEngineBlock"
import { deriveBoundEngineTypes } from "../../shared/channel-types"
import ChannelPanel from "../components/ChannelPanel"
import WorkspaceSessionModal, { type SessionEntry } from "../components/WorkspaceSessionModal"
import TitleBar from "../components/TitleBar"
import useInlineModal from "../components/useInlineModal"
import { REQUIRED_FEISHU_SCOPES, FEISHU_SCOPES_JSON } from "../constants"

interface Props { onBack: () => void; initialTab?: string; onTabConsumed?: () => void }

type Tab = "general" | "channel" | "proxy" | "agent" | "rules" | "tasks" | "skills" | "mcp" | "workflows" | "setup" | "about"
type CloseWindowAction = "ask" | "minimize" | "quit"

interface TaskItem {
  id: string; name: string; cron: string; content: string; enabled: boolean; independent?: boolean
  channelId?: string; model?: string; modelParams?: string
}

const TABS: { id: Tab; label: string; icon: typeof SettingsIcon }[] = [
  { id: "general", label: "通用", icon: SettingsIcon },
  { id: "proxy", label: "网络", icon: Network },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "channel", label: "消息通道", icon: MessageSquare },
  { id: "rules", label: "Rules", icon: FileCode2 },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "mcp", label: "MCP", icon: Network },
  { id: "tasks", label: "定时任务", icon: Timer },
  { id: "workflows", label: "工作流", icon: Waypoints },
  { id: "setup", label: "帮助引导", icon: BookOpen },
  { id: "about", label: "关于", icon: Info },
]

export default function Settings({ onBack, initialTab, onTabConsumed }: Props) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "general")

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab as Tab)
      onTabConsumed?.()
    }
  }, [initialTab, onTabConsumed])

  const [workspaceDir, setWorkspaceDir] = useState("")
  const [crashAnalysisDir, setCrashAnalysisDir] = useState("")
  const [proxy, setProxy] = useState("")
  const [noProxy, setNoProxy] = useState("localhost,127.0.0.1,feishu.cn")
  const [closeWindowAction, setCloseWindowAction] = useState<CloseWindowAction>("ask")
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [wsSwitch, setWsSwitch] = useState<{ old: string; new: string; sessions: SessionEntry[] } | null>(null)
  /** 帮助引导页飞书控制台链接用 */
  const [firstFeishuAppId, setFirstFeishuAppId] = useState("")
  const [taskChannels, setTaskChannels] = useState<ChannelConfig[]>([])
  const [agentResources, setAgentResources] = useState<AgentResource[]>([])
  /** rules/skills/mcp 通道上下文是否已加载（避免首次进入空态闪烁） */
  const [channelContextLoaded, setChannelContextLoaded] = useState(false)
  const { showAlert, ModalPortal } = useInlineModal()

  const [appVersion, setAppVersion] = useState("")
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateCheck, setUpdateCheck] = useState<Awaited<ReturnType<typeof window.electronAPI.checkAppUpdate>> | null>(null)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [updateDownloadPct, setUpdateDownloadPct] = useState<number | null>(null)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const updateDownloadingRef = useRef(false)

  const [saved, setSaved] = useState(false)
  /** 任务编辑弹窗的模型选项（按所选通道的 Agent 资源拉取） */
  const [taskModelOptions, setTaskModelOptions] = useState<{ id: string; label: string; params: string }[]>([])
  const [loadingTaskModels, setLoadingTaskModels] = useState(false)

  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [taskEditing, setTaskEditing] = useState<TaskItem | null>(null)
  const [taskCronValid, setTaskCronValid] = useState(true)
  const [cronPreviewRuns, setCronPreviewRuns] = useState<string[] | null>(null)
  const [cronPreviewErr, setCronPreviewErr] = useState<string | null>(null)
  const [cronPreviewLoading, setCronPreviewLoading] = useState(false)
  const cronPreviewReq = useRef(0)
  const cronPreviewTaskIdRef = useRef("")
  const [taskStatuses, setTaskStatuses] = useState<Record<string, { running: boolean; pid?: number; startedAt?: number }>>({})

  const loaded = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  const refreshTasks = useCallback(() => {
    window.electronAPI.getScheduledTasks().then(setTasks)
  }, [])

  /** rules/skills/mcp/tasks 共用：拉取通道绑定与主工作区 */
  const loadChannelContext = useCallback(() => {
    void window.electronAPI.getConfig().then((cfg) => {
      setTaskChannels(cfg.channels ?? [])
      setAgentResources(cfg.agentResources ?? [])
      setWorkspaceDir(cfg.workspaceDir)
      setChannelContextLoaded(true)
    })
  }, [])

  const boundTypes = useMemo(
    () => deriveBoundEngineTypes(taskChannels, agentResources),
    [taskChannels, agentResources],
  )
  /** Rules/Skills 仅 SDK 引擎块可见 */
  const sdkBoundTypes = boundTypes.includes("sdk") ? (["sdk"] as const) : []

  useEffect(() => {
    void window.electronAPI.getAppVersion().then(setAppVersion)
  }, [])


  useEffect(() => {
    updateDownloadingRef.current = updateDownloading
  }, [updateDownloading])

  useEffect(() => {
    const offS = window.electronAPI.onUpdaterStatus((s) => {
      if (s.kind === "downloading") {
        setUpdateDownloading(true)
        setUpdateDownloadPct(null)
        setUpdateMsg("正在下载更新…")
      }
      if (s.kind === "downloaded") {
        setUpdateDownloading(false)
        setUpdateDownloadPct(null)
        setUpdateMsg(`新版本 v${s.version} 已下载，可立即安装。`)
        void window.electronAPI.checkAppUpdate().then((r) => {
          if (r.status === "ready" || r.status === "available") {
            setUpdateCheck(r)
          }
        })
      }
    })
    const offP = window.electronAPI.onUpdaterProgress((pct) => {
      if (!updateDownloadingRef.current) {
        return
      }
      const p = Math.round(pct)
      setUpdateDownloadPct(p)
      setUpdateMsg(`正在下载更新… ${p}%`)
    })
    const offE = window.electronAPI.onUpdaterError((m) => {
      setUpdateDownloading(false)
      setUpdateDownloadPct(null)
      setUpdateMsg((prev) => (prev ? `${prev}\n${m}` : m))
    })
    return () => {
      offS()
      offP()
      offE()
    }
  }, [])

  useEffect(() => {
    if (tab !== "about") {
      return
    }
    void window.electronAPI.checkAppUpdate().then((r) => {
      if (r.status === "ready") {
        setUpdateCheck(r)
        setUpdateDownloading(false)
        setUpdateDownloadPct(null)
        setUpdateMsg(`新版本 v${r.latestVersion} 已下载，可立即安装。`)
      } else if (r.status === "available") {
        setUpdateCheck(r)
        if (!updateDownloading) {
          setUpdateMsg(`发现新版本 v${r.latestVersion}，当前 v${r.currentVersion}。`)
        }
      } else if (r.status === "latest") {
        setUpdateCheck(r)
        setUpdateDownloading(false)
        setUpdateDownloadPct(null)
      }
    })
  }, [tab])

  useEffect(() => {
    const unsub2 = window.electronAPI.onScheduledTaskStatus(setTaskStatuses)
    const unsub3 = window.electronAPI.onDaemonStatus?.(() => {
      window.electronAPI.getConfig().then((cfg) => {
        setWorkspaceDir((prev) => prev !== cfg.workspaceDir ? cfg.workspaceDir : prev)
      })
    })
    return () => { unsub2(); unsub3?.() }
  }, [])

  useEffect(() => {
    if (tab === "general" || tab === "setup") window.electronAPI.getConfig().then((config) => {
      setWorkspaceDir(config.workspaceDir)
      setCrashAnalysisDir(config.crashAnalysisDir ?? "")
      setProxy(config.httpProxy || config.httpsProxy || "")
      setNoProxy(config.noProxy || "localhost,127.0.0.1,feishu.cn")
      setCloseWindowAction(config.closeWindowAction ?? "ask")
      setAutoLaunch(config.autoStart ?? false)
      setFirstFeishuAppId(config.channels?.find((c) => c.type === "feishu")?.larkAppId ?? config.larkAppId ?? "")
      loaded.current = true
    })
    if (tab === "rules" || tab === "skills" || tab === "mcp" || tab === "tasks") {
      loadChannelContext()
    }
    if (tab === "tasks") {
      refreshTasks()
      void window.electronAPI.getScheduledTaskStatus().then(setTaskStatuses)
    }
  }, [tab, refreshTasks, loadChannelContext])

  const autoSave = useCallback(() => {
    if (!loaded.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const r = await window.electronAPI.saveConfig({
        workspaceDir: workspaceDir.trim(),
        crashAnalysisDir: crashAnalysisDir.trim(),
        httpProxy: proxy.trim(), httpsProxy: proxy.trim(), noProxy: noProxy.trim(),
        closeWindowAction,
      })
      if (r.needWorkspaceConfirm && r.oldWorkspaceDir !== undefined && r.newWorkspaceDir !== undefined) {
        setWsSwitch({ old: r.oldWorkspaceDir, new: r.newWorkspaceDir, sessions: r.existingSessions ?? [] })
        setWorkspaceDir(r.oldWorkspaceDir)
      }
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    }, 500)
  }, [workspaceDir, crashAnalysisDir, proxy, noProxy, closeWindowAction])

  useEffect(() => { autoSave() }, [autoSave])

  const handleCheckUpdate = async () => {
    setUpdateBusy(true)
    setUpdateMsg(null)
    setUpdateCheck(null)
    setUpdateDownloadPct(null)
    setUpdateDownloading(false)
    try {
      const r = await window.electronAPI.checkAppUpdate()
      setUpdateCheck(r)
      if (r.status === "latest") {
        setUpdateMsg(`已是最新 v${r.latestVersion}。`)
      } else if (r.status === "dev") {
        setUpdateMsg(r.message)
      } else if (r.status === "error") {
        setUpdateMsg(r.message)
      } else if (r.status === "available") {
        setUpdateMsg(`发现新版本 v${r.latestVersion}，当前 v${r.currentVersion}。`)
      } else if (r.status === "ready") {
        setUpdateMsg(`新版本 v${r.latestVersion} 已下载，可立即安装。`)
      }
    } finally {
      setUpdateBusy(false)
    }
  }

  const handleApplyUpdate = async () => {
    setUpdateBusy(true)
    setUpdateMsg("正在连接更新服务器…")
    try {
      const res = await window.electronAPI.applyAppUpdate()
      if (res.ok) {
        setUpdateMsg(res.message ?? "已触发更新流程。")
        setUpdateCheck(null)
      } else {
        setUpdateDownloading(false)
        setUpdateDownloadPct(null)
        setUpdateMsg(res.error ?? "更新失败")
      }
    } finally {
      setUpdateBusy(false)
    }
  }

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
        if (r.ok) {
          setCronPreviewRuns(r.runs)
        } else {
          setCronPreviewRuns(null)
          setCronPreviewErr(r.error)
        }
      } finally {
        if (req === cronPreviewReq.current) setCronPreviewLoading(false)
      }
    }, 320)
    return () => clearTimeout(t)
  }, [taskModalOpen, taskIdForCronPreview, taskCronForPreview])

  /** 按任务所选通道的 Agent 资源拉取模型列表 */
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

  const selectDir = async () => { const d = await window.electronAPI.selectDirectory(); if (d) setWorkspaceDir(d) }
  const selectCrashAnalysisDir = async () => {
    const d = await window.electronAPI.selectDirectory()
    if (d) setCrashAnalysisDir(d)
  }

  const handleAutoLaunchToggle = async () => {
    const next = !autoLaunch
    setAutoLaunch(next)
    await window.electronAPI.setAutoStart(next)
  }

  // ── Tasks ──
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
    const updated = tasks.filter((t) => t.id !== id)
    await window.electronAPI.saveScheduledTasks(updated); refreshTasks()
  }
  const handleTaskToggle = async (id: string) => {
    const updated = tasks.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t)
    await window.electronAPI.saveScheduledTasks(updated); refreshTasks()
  }
  const handleTaskTrigger = async (id: string) => {
    await window.electronAPI.triggerScheduledTask(id)
  }
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

  const inputCls = "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none transition focus:border-blue-500"

  return (
    <div className="flex h-screen flex-col">
      <TitleBar>
        <div className="flex flex-1 items-center gap-3">
          <button onClick={onBack} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}><ArrowLeft size={18} /></button>
          <h1 className="text-lg font-semibold">设置</h1>
          <div className="flex-1" />
          {saved && <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={14} />已保存</span>}
        </div>
      </TitleBar>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-36 shrink-0 border-r border-gray-800 py-3">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition ${tab === t.id ? "bg-gray-800/70 font-medium text-white" : "text-gray-400 hover:bg-gray-800/40 hover:text-gray-200"}`}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-xl space-y-6">

            {/* ═══ General ═══ */}
            {tab === "general" && (<>
              <section className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">主工作目录</label>
                  <div onClick={selectDir} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-700 px-4 py-3 transition hover:border-blue-500">
                    <FolderOpen size={18} className="text-blue-400" /><span className="truncate text-sm">{workspaceDir || "点击选择..."}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">主用户私聊时使用此目录，群聊和其他用户使用自动创建的临时目录</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">崩溃分析目录</label>
                  <div className="flex items-center gap-2">
                    <div onClick={selectCrashAnalysisDir} className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-gray-700 px-4 py-3 transition hover:border-blue-500">
                      <FolderOpen size={18} className="text-blue-400" /><span className="truncate text-sm">{crashAnalysisDir || "未配置（跳过归档）"}</span>
                    </div>
                    {crashAnalysisDir && (
                      <button type="button" onClick={() => setCrashAnalysisDir("")} className="shrink-0 rounded-lg border border-gray-700 px-3 py-3 text-xs text-gray-400 transition hover:border-gray-500 hover:text-gray-200">清除</button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-600">Agent 处理失败时将相关日志片段导出到此目录；留空则跳过归档</p>
                </div>
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">启动</h3>
                <div className="flex items-center justify-between rounded-lg border border-gray-700 px-4 py-3">
                  <div className="min-w-0 pr-3">
                    <p className="text-sm font-medium">开机自启</p>
                    <p className="text-xs text-gray-500">系统登录后自动启动 Cursor Claw；应用启动后自动拉起 Daemon 并连接消息通道</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoLaunch}
                    onClick={handleAutoLaunchToggle}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${autoLaunch ? "bg-green-500" : "bg-gray-600"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${autoLaunch ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                  </button>
                </div>
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">关闭主窗口</h3>
                <p className="text-xs text-gray-600">点击窗口右上角关闭时的行为（可从系统托盘再次打开窗口）。</p>
                <div className="space-y-2">
                  {([
                    { v: "ask" as const, t: "每次询问", d: "弹窗选择最小化到托盘或退出应用" },
                    { v: "minimize" as const, t: "总是最小化到托盘", d: "直接隐藏窗口，不弹窗" },
                    { v: "quit" as const, t: "总是退出应用", d: "关闭窗口并退出（含 Daemon、托盘）" },
                  ]).map((opt) => (
                    <label
                      key={opt.v}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${closeWindowAction === opt.v ? "border-blue-500 bg-blue-500/10" : "border-gray-700 hover:border-gray-600"}`}
                    >
                      <input
                        type="radio"
                        name="closeWindowAction"
                        checked={closeWindowAction === opt.v}
                        onChange={() => setCloseWindowAction(opt.v)}
                        className="mt-1 rounded-full border-gray-600"
                      />
                      <div>
                        <p className="text-sm font-medium">{opt.t}</p>
                        <p className="text-xs text-gray-500">{opt.d}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </section>
              <p className="text-xs text-gray-500">关闭窗口相关选项保存后立即生效。其余设置自动保存，部分项需重启 Daemon 后生效。</p>
            </>)}

            {/* ═══ Channel ═══ */}
            {tab === "channel" && <ChannelPanel />}

            {/* ═══ Proxy ═══ */}
            {tab === "proxy" && (<>
              <section className="space-y-4">
                <h3 className="text-sm font-medium text-gray-300">代理设置</h3>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">HTTP / HTTPS 代理</label>
                  <input type="text" value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="http://127.0.0.1:1080" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">NO_PROXY</label>
                  <input type="text" value={noProxy} onChange={(e) => setNoProxy(e.target.value)} placeholder="localhost,127.0.0.1,feishu.cn" className={inputCls} />
                </div>
              </section>
            </>)}

            {/* ═══ Agent ═══ */}
            {tab === "agent" && <AgentPanel />}

            {/* ═══ Rules ═══ */}
            {tab === "rules" && (
              <SettingsEngineShell
                tab="rules"
                allBoundTypes={boundTypes}
                boundTypes={[...sdkBoundTypes]}
                channels={taskChannels}
                agentResources={agentResources}
                workspaceDir={workspaceDir}
                channelContextLoaded={channelContextLoaded}
                renderEnginePanel={(engineType) =>
                  engineType === "sdk" ? <SettingsRulesPanel workspaceDir={workspaceDir} /> : null
                }
              />
            )}

            {/* ═══ Tasks ═══ */}
            {tab === "tasks" && (<>
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
                        <button onClick={() => handleTaskToggle(t.id)} className={`rounded px-2 py-0.5 text-xs transition ${t.enabled ? "text-green-400 hover:bg-green-600/20" : "text-gray-500 hover:bg-gray-800"}`}>
                          {t.enabled ? "启用" : "禁用"}
                        </button>
                        <button onClick={() => openTaskEdit(t)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white"><Pencil size={13} /></button>
                        <button onClick={() => handleTaskDelete(t.id)} className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    )
                  })}
                  {tasks.length === 0 && <p className="py-4 text-center text-xs text-gray-600">暂无定时任务</p>}
                </div>
              </section>
            </>)}

            {/* ═══ Skills ═══ */}
            {tab === "skills" && (
              <SettingsEngineShell
                tab="skills"
                allBoundTypes={boundTypes}
                boundTypes={[...sdkBoundTypes]}
                channels={taskChannels}
                agentResources={agentResources}
                workspaceDir={workspaceDir}
                channelContextLoaded={channelContextLoaded}
                renderEnginePanel={(engineType) =>
                  engineType === "sdk" ? <SettingsSkillsPanel workspaceDir={workspaceDir} /> : null
                }
              />
            )}

            {/* ═══ MCP ═══ */}
            {tab === "mcp" && (
              <SettingsEngineShell
                tab="mcp"
                allBoundTypes={boundTypes}
                boundTypes={boundTypes}
                channels={taskChannels}
                agentResources={agentResources}
                workspaceDir={workspaceDir}
                channelContextLoaded={channelContextLoaded}
                renderEnginePanel={(engineType) => (
                  <SettingsMcpEngineBlock engineType={engineType} workspaceDir={workspaceDir} />
                )}
              />
            )}

            {/* ═══ Workflows ═══ */}
            {tab === "workflows" && <WorkflowPanel />}

            {/* ═══ Setup Guide ═══ */}
            {tab === "setup" && (<>
              <section className="space-y-4">
                <h3 className="text-sm font-medium text-gray-300">配置指引</h3>
                <div className="rounded-lg border border-gray-700 p-4 space-y-2">
                  <p className="text-sm text-gray-400">按以下顺序完成配置：</p>
                  <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-500">
                    <li><button onClick={() => setTab("general")} className="text-blue-400 hover:underline">通用</button> — 选择主工作目录</li>
                    <li><button onClick={() => setTab("agent")} className="text-blue-400 hover:underline">Agent</button> — 配置 Agent 资源（Cursor SDK / Claude Code / Codex / OpenCode）</li>
                    <li><button onClick={() => setTab("channel")} className="text-blue-400 hover:underline">消息通道</button> — 接入飞书 / 微信，绑定 Agent 资源与模型</li>
                  </ol>
                  <p className="text-xs text-gray-600">完成后回到主页启动 Daemon 即可使用。以下为飞书手动建应用时需要的权限与事件配置参考。</p>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300">应用权限</h3>
                  <div className="flex items-center gap-2">
                    {firstFeishuAppId.trim() && (
                      <a href={`https://open.feishu.cn/app/${firstFeishuAppId.trim()}/auth`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-blue-400">
                        <ExternalLink size={12} />前往设置权限
                      </a>
                    )}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(FEISHU_SCOPES_JSON)
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white"
                    >
                      <Copy size={12} />复制权限 JSON
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-800 divide-y divide-gray-800">
                  {REQUIRED_FEISHU_SCOPES.map((p) => (
                    <div key={p.scope} className="flex items-center justify-between px-3 py-2">
                      <code className="text-xs text-blue-400">{p.scope}</code>
                      <span className="text-xs text-gray-500">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300">事件订阅</h3>
                  {firstFeishuAppId.trim() && (
                    <a href={`https://open.feishu.cn/app/${firstFeishuAppId.trim()}/event`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-blue-400">
                      <ExternalLink size={12} />前往设置事件订阅
                    </a>
                  )}
                </div>
                <div className="rounded-lg border border-gray-800 divide-y divide-gray-800">
                  <div className="px-3 py-2 flex items-center justify-between">
                    <code className="text-xs text-blue-400">im.message.receive_v1</code>
                    <span className="text-xs text-gray-500">接收消息 v2.0</span>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300">读取用户发给机器人的单聊消息</span>
                    <span className="text-xs text-emerald-400">需开通</span>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300">获取群组中用户@机器人消息</span>
                    <span className="text-xs text-emerald-400">需开通</span>
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-500 space-y-1">
                    <div>订阅方式：<span className="text-gray-300">应用身份</span></div>
                    <div>回调类型：<span className="text-gray-300">长连接（WebSocket）</span></div>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">参考文档</h3>
                <div className="flex flex-wrap gap-2">
                  <a href="https://github.com/lk-eternal/cursor-claw" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-blue-400">
                    <ExternalLink size={12} />项目 GitHub
                  </a>
                </div>
              </section>
            </>)}

            {tab === "about" && (<>
              <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">应用更新</h3>
                <p className="text-xs text-gray-600">
                  当前 <span className="font-mono text-gray-400">v{appVersion || "…"}</span>
                  ，可检查是否有新版本。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={updateBusy || updateDownloading}
                    onClick={() => void handleCheckUpdate()}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-2 text-sm transition hover:border-blue-500 hover:bg-gray-800 disabled:opacity-50"
                  >
                    {updateBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    检查更新
                  </button>
                  {updateCheck?.status === "available" && (
                    <button
                      type="button"
                      disabled={updateBusy || updateDownloading}
                      onClick={() => void handleApplyUpdate()}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-500 bg-blue-500/15 px-4 py-2 text-sm text-blue-200 transition hover:bg-blue-500/25 disabled:opacity-50"
                    >
                      立即更新
                    </button>
                  )}
                  {updateCheck?.status === "ready" && (
                    <button
                      type="button"
                      disabled={updateBusy}
                      onClick={() => void handleApplyUpdate()}
                      className="inline-flex items-center gap-2 rounded-lg border border-green-500 bg-green-500/15 px-4 py-2 text-sm text-green-200 transition hover:bg-green-500/25 disabled:opacity-50"
                    >
                      立即安装
                    </button>
                  )}
                </div>
                {(updateCheck?.status === "available" || updateCheck?.status === "ready") && updateCheck.releaseNotes && (
                  <div className="rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2">
                    <p className="mb-1.5 text-xs font-medium text-gray-300">更新内容</p>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-400">{updateCheck.releaseNotes}</p>
                  </div>
                )}
                {updateMsg && (
                  <div className="space-y-2">
                    <p className="whitespace-pre-wrap rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2 text-xs text-gray-400">{updateMsg}</p>
                    {updateDownloading && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-[width] duration-300 ease-out"
                          style={{ width: updateDownloadPct === null ? "0%" : `${updateDownloadPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">项目信息</h3>
                <a
                  href="https://github.com/lk-eternal/cursor-claw"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-2 text-sm text-gray-300 transition hover:border-blue-500 hover:bg-gray-800 hover:text-blue-400"
                >
                  <Github size={16} />
                  GitHub 仓库
                  <ExternalLink size={12} className="text-gray-500" />
                </a>
              </section>
            </>)}

          </div>
        </div>
      </div>

      {/* ═══ Task Edit Modal ═══ */}
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
                      <span className="flex items-center gap-1 text-[11px] text-gray-500">
                        <Loader2 size={11} className="animate-spin shrink-0" />
                        更新中…
                      </span>
                    )}
                  </div>
                  {cronPreviewLoading && (!cronPreviewRuns || cronPreviewRuns.length === 0) && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      <Loader2 size={12} className="animate-spin" />计算中…
                    </p>
                  )}
                  {!cronPreviewLoading && cronPreviewErr && (
                    <p className="mt-1 text-xs text-amber-400/90">{cronPreviewErr}</p>
                  )}
                  {cronPreviewRuns && cronPreviewRuns.length > 0 && (
                    <ol className={`mt-1.5 list-decimal space-y-0.5 pl-4 font-mono text-[11px] leading-relaxed text-gray-400 ${cronPreviewLoading ? "opacity-70" : ""}`}>
                      {cronPreviewRuns.map((line, i) => (
                        <li key={`${line}-${i}`}>{line}</li>
                      ))}
                    </ol>
                  )}
                  <p className="mt-1.5 text-[10px] text-gray-600">由解析库推算，与 node-cron 在少数写法上可能略有差异，以实际日志为准。</p>
                </div>
              </div>
              <div><label className="mb-1 block text-xs text-gray-500">消息内容</label><textarea value={taskEditing.content} onChange={(e) => setTaskEditing({ ...taskEditing, content: e.target.value })} rows={6} className={inputCls + " font-mono text-xs leading-relaxed"} placeholder="要发送给 Agent 的消息..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">消息通道</label>
                  <select
                    value={taskEditing.channelId ?? ""}
                    onChange={(e) => { setTaskEditing({ ...taskEditing, channelId: e.target.value || undefined }); setTaskModelOptions([]) }}
                    className={inputCls}
                  >
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

      <WorkspaceSessionModal
        open={wsSwitch !== null}
        oldPath={wsSwitch?.old ?? ""}
        newPath={wsSwitch?.new ?? ""}
        sessions={wsSwitch?.sessions ?? []}
        onCancel={() => setWsSwitch(null)}
        onSwitch={async (stopOld) => {
          const dir = wsSwitch?.new ?? ""
          const res = await window.electronAPI.applyWorkspaceSwitch(dir, stopOld)
          setWsSwitch(null)
          if (!res.ok) {
            void showAlert("错误", res.error ?? "切换工作目录失败")
            return
          }
          setWorkspaceDir(dir)
        }}
      />
      {ModalPortal}
    </div>
  )
}
