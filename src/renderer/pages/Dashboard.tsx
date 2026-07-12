import { useState, useEffect, useCallback } from "react"
import { Settings, RefreshCw } from "lucide-react"
import logoUrl from "../assets/logo.png"
import TitleBar from "../components/TitleBar"
import DashboardOnboard, { type OnboardState } from "./DashboardOnboard"
import DashboardStatusCards from "./DashboardStatusCards"
import DashboardDetailPanels from "./DashboardDetailPanels"
import DashboardLogPanel from "./DashboardLogPanel"

interface Props {
  /** 打开设置页，可指定初始 Tab */
  onSettings: (tab?: string) => void
  /** 当前是否为可见页面（从设置页返回时立即刷新） */
  active?: boolean
}

/** Dashboard 壳：订阅 Daemon/日志状态，组装引导 / 状态卡 / 详情 / 日志 */
export default function Dashboard({ onSettings, active }: Props) {
  const [status, setStatus] = useState<DaemonStatus>({ running: false })
  const [logLines, setLogLines] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [actionError, setActionError] = useState("")
  const [queueMessages, setQueueMessages] = useState<{ index: number; fileId: string; preview: string; sessionKey?: string; chatType?: string; timestamp?: number; senderOpenId?: string }[]>([])
  const [showQueue, setShowQueue] = useState(false)
  const [showChannels, setShowChannels] = useState(false)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [onboard, setOnboard] = useState<OnboardState | null>(null)
  const [onboardDismissed, setOnboardDismissed] = useState(false)
  const [cliMigrationPending, setCliMigrationPending] = useState(false)
  const [stoppingAgent, setStoppingAgent] = useState(false)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [sessionList, setSessionList] = useState<{ sessionKey: string; pid: number; startedAt: number; chatType: string; lastActivityAt: number; chatName?: string; workspaceDir?: string; engineType: "sdk" | "claude-code" }[]>([])
  const [fallbackWorkspaceDir, setFallbackWorkspaceDir] = useState("")

  const refreshOnboard = useCallback(async () => {
    const cfg = await window.electronAPI.getConfig()
    const channels = cfg.channels ?? []
    const channelReady = channels.some((c) => c.enabled && (c.type === "feishu"
      ? !!(c.larkAppId?.trim() && c.larkAppSecret?.trim())
      : !!c.wechatToken?.trim()))
    const resources = cfg.agentResources ?? []
    const agentReady = resources.some(
      (r) =>
        (r.type === "sdk" || r.type === "claude-code" || r.type === "codex" || r.type === "opencode") &&
        !!r.apiKey?.trim(),
    )
    setOnboard({
      workspaceReady: !!cfg.workspaceDir?.trim(),
      agentReady,
      channelReady,
    })
    setFallbackWorkspaceDir(cfg.workspaceDir?.trim() ?? "")
    setCliMigrationPending(!!cfg.cliMigrationPending)
  }, [])

  useEffect(() => {
    if (active) void refreshOnboard()
  }, [active, refreshOnboard])

  useEffect(() => {
    const refresh = async () => {
      const s = await window.electronAPI.getDaemonStatus()
      setStatus(s)
      window.electronAPI.getSessionAgents().then(setSessionList).catch(() => {})
      await refreshOnboard()
      if (s.queueLength && s.queueLength > 0) {
        setQueueMessages(await window.electronAPI.getQueueMessages())
      } else {
        setQueueMessages([])
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    window.electronAPI.getLogBuffer().then((buf) => {
      if (buf.length > 0) setLogLines(buf.slice(-300))
    })
    const unsub = window.electronAPI.onDaemonStatus(setStatus)
    const unsubLog = window.electronAPI.onDaemonLog((line) => {
      setLogLines((prev) => {
        const next = [...prev, line]
        return next.length > 300 ? next.slice(-300) : next
      })
    })
    window.electronAPI.getSessionAgents().then(setSessionList).catch(() => {})
    const unsubSessions = window.electronAPI.onSessionAgents?.((list: typeof sessionList) => setSessionList(list))
    return () => { clearInterval(timer); unsub(); unsubLog(); unsubSessions?.() }
  }, [refreshOnboard])

  const refreshQueueMessages = async () => {
    const msgs = await window.electronAPI.getQueueMessages()
    setQueueMessages(msgs)
    return msgs
  }

  const handleStart = async () => {
    setStarting(true)
    setActionError("")
    try {
      const result = await window.electronAPI.startDaemon()
      if (result.ok) setStatus(await window.electronAPI.getDaemonStatus())
      else {
        setActionError(result.error ?? "启动失败")
        setOnboardDismissed(false)
        void refreshOnboard()
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e))
      setOnboardDismissed(false)
      void refreshOnboard()
    }
    setStarting(false)
  }

  const handleStop = async () => {
    setStopping(true)
    await window.electronAPI.stopDaemon()
    setStatus({ running: false })
    setStopping(false)
  }

  const handleRefresh = async () => {
    const s = await window.electronAPI.getDaemonStatus()
    setStatus(s)
    if (s.queueLength && s.queueLength > 0) setQueueMessages(await window.electronAPI.getQueueMessages())
    else setQueueMessages([])
  }

  const handleStopAgent = async () => {
    setStoppingAgent(true)
    try {
      await Promise.all([window.electronAPI.stopAgent(), window.electronAPI.stopAllSessionAgents()])
      setSessionList([])
      setStatus(await window.electronAPI.getDaemonStatus())
    } catch { /* ignore */ }
    setStoppingAgent(false)
  }

  const formatUptime = (seconds?: number): string => {
    if (!seconds) return "-"
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  const formatTimestamp = (ts?: number) => {
    if (!ts) return ""
    return new Date(ts).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
  }

  const getSessionLabel = (msg: { sessionKey?: string; chatType?: string }) => {
    if (!msg.sessionKey) return "未知会话"
    const parts = msg.sessionKey.split("::")
    const dir = parts[1]?.split(/[\\/]/).pop() || ""
    const chatLabel = msg.chatType === "group" ? "群聊" : msg.chatType === "task" ? "定时" : "私聊"
    return `${chatLabel}${dir ? ` 📁${dir}` : ""}`
  }

  const isStarting = starting || !!status.starting

  return (
    <div className="flex h-screen flex-col">
      <TitleBar>
        <div className="flex flex-1 items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="logo" className="h-6 w-6" />
            <h1 className="text-lg font-semibold">Cursor Claw</h1>
            {status.version && <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">v{status.version}</span>}
          </div>
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <button onClick={() => void handleRefresh()} className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-800 hover:text-white" title="刷新状态"><RefreshCw size={16} /></button>
            <button onClick={() => onSettings()} className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-800 hover:text-white" title="设置"><Settings size={16} /></button>
          </div>
        </div>
      </TitleBar>

      {actionError && (
        <div className="mx-6 mt-3 rounded-lg border border-red-800 bg-red-950/50 px-4 py-2 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <DashboardStatusCards
        status={status} isStarting={isStarting} starting={starting} stopping={stopping}
        stoppingAgent={stoppingAgent} clearingQueue={clearingQueue}
        sessionListLength={sessionList.length} formatUptime={formatUptime}
        onStart={() => void handleStart()} onStop={() => void handleStop()}
        onStopAgent={(e) => { e.stopPropagation(); void handleStopAgent() }}
        onToggleChannels={() => {
          if ((status.channels ?? []).length === 0) return
          const next = !showChannels
          setShowChannels(next)
          if (next) { setShowQueue(false); setShowSessions(false) }
        }}
        onToggleSessions={() => {
          if (sessionList.length === 0 && !status.agentRunning) return
          const next = !showSessions
          setShowSessions(next)
          if (next) { setShowQueue(false); setShowChannels(false); void refreshQueueMessages() }
        }}
        onToggleQueue={() => {
          if (!showQueue) { void refreshQueueMessages(); setShowSessions(false); setShowChannels(false) }
          setShowQueue(!showQueue)
        }}
        onClearQueue={async (e) => {
          e.stopPropagation()
          setClearingQueue(true)
          await window.electronAPI.clearQueueMessages()
          setQueueMessages([])
          setStatus((prev) => ({ ...prev, queueLength: 0 }))
          setClearingQueue(false)
        }}
      />

      <DashboardOnboard
        onboard={onboard} onboardDismissed={onboardDismissed} cliMigrationPending={cliMigrationPending}
        onSettings={onSettings} onDismissOnboard={() => setOnboardDismissed(true)}
        onDismissCliMigration={async () => {
          await window.electronAPI.markCliMigrationNotified()
          setCliMigrationPending(false)
        }}
      />

      <DashboardDetailPanels
        status={status} showChannels={showChannels} showSessions={showSessions} showQueue={showQueue}
        sessionList={sessionList} queueMessages={queueMessages} expandedSession={expandedSession}
        fallbackWorkspaceDir={fallbackWorkspaceDir} formatTimestamp={formatTimestamp}
        getSessionLabel={getSessionLabel}
        getSessionQueueMessages={(sessionKey) => queueMessages.filter((m) => m.sessionKey === sessionKey)}
        onSettings={onSettings}
        onStopAllSessions={async () => { await window.electronAPI.stopAllSessionAgents(); setSessionList([]) }}
        onToggleSessionExpand={async (sessionKey) => {
          if (expandedSession === sessionKey) { setExpandedSession(null); return }
          if (queueMessages.length === 0) await refreshQueueMessages()
          setExpandedSession(sessionKey)
        }}
        onDeleteQueueMessage={async (fileId, e) => {
          e.stopPropagation()
          await window.electronAPI.deleteQueueMessage(fileId)
          setQueueMessages((prev) => prev.filter((m) => m.fileId !== fileId))
          setStatus((prev) => ({ ...prev, queueLength: Math.max(0, (prev.queueLength ?? 1) - 1) }))
        }}
      />

      <DashboardLogPanel
        logLines={logLines}
        onCopy={() => void navigator.clipboard.writeText(logLines.join("\n"))}
        onClear={() => setLogLines([])}
      />
    </div>
  )
}
