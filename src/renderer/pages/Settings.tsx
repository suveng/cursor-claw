import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import {
  ArrowLeft, CheckCircle2, Settings as SettingsIcon, Network, FileCode2,
  Timer, Sparkles, Bot, BookOpen, Info, MessageSquare, Waypoints,
} from "lucide-react"
import WorkflowPanel from "../components/WorkflowPanel"
import AgentPanel from "../components/AgentPanel"
import SettingsEngineShell from "../components/SettingsEngineShell"
import SettingsRulesPanel from "../components/SettingsRulesPanel"
import SettingsSkillsPanel from "../components/SettingsSkillsPanel"
import SettingsMcpEngineBlock from "../components/SettingsMcpEngineBlock"
import SettingsMcpDaemonGuide from "../components/SettingsMcpDaemonGuide"
import { deriveBoundEngineTypes } from "../../shared/channel-types"
import ChannelPanel from "../components/ChannelPanel"
import WorkspaceSessionModal, { type SessionEntry } from "../components/WorkspaceSessionModal"
import TitleBar from "../components/TitleBar"
import useInlineModal from "../components/useInlineModal"
import SettingsGeneralTab from "./SettingsGeneralTab"
import SettingsProxyTab from "./SettingsProxyTab"
import SettingsTasksTab from "./SettingsTasksTab"
import SettingsSetupTab from "./SettingsSetupTab"
import SettingsAboutTab from "./SettingsAboutTab"

interface Props { onBack: () => void; initialTab?: string; onTabConsumed?: () => void }

type Tab = "general" | "channel" | "proxy" | "agent" | "rules" | "tasks" | "skills" | "mcp" | "workflows" | "setup" | "about"
type CloseWindowAction = "ask" | "minimize" | "quit"

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

/** 设置页壳：Tab 导航 + 共享 load/save；各 Tab 内容下沉到 Settings*Tab */
export default function Settings({ onBack, initialTab, onTabConsumed }: Props) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "general")
  useEffect(() => {
    if (initialTab) { setTab(initialTab as Tab); onTabConsumed?.() }
  }, [initialTab, onTabConsumed])

  const [workspaceDir, setWorkspaceDir] = useState("")
  const [crashAnalysisDir, setCrashAnalysisDir] = useState("")
  const [proxy, setProxy] = useState("")
  const [noProxy, setNoProxy] = useState("localhost,127.0.0.1,feishu.cn")
  const [closeWindowAction, setCloseWindowAction] = useState<CloseWindowAction>("ask")
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [wsSwitch, setWsSwitch] = useState<{ old: string; new: string; sessions: SessionEntry[] } | null>(null)
  const [firstFeishuAppId, setFirstFeishuAppId] = useState("")
  const [taskChannels, setTaskChannels] = useState<ChannelConfig[]>([])
  const [agentResources, setAgentResources] = useState<AgentResource[]>([])
  const [channelContextLoaded, setChannelContextLoaded] = useState(false)
  const { showAlert, ModalPortal } = useInlineModal()
  const [saved, setSaved] = useState(false)
  const loaded = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

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
  const sdkBoundTypes = boundTypes.includes("sdk") ? (["sdk"] as const) : []

  useEffect(() => {
    const unsub3 = window.electronAPI.onDaemonStatus?.(() => {
      window.electronAPI.getConfig().then((cfg) => {
        setWorkspaceDir((prev) => prev !== cfg.workspaceDir ? cfg.workspaceDir : prev)
      })
    })
    return () => { unsub3?.() }
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
    if (tab === "rules" || tab === "skills" || tab === "mcp" || tab === "tasks") loadChannelContext()
  }, [tab, loadChannelContext])

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
            {tab === "general" && (
              <SettingsGeneralTab
                workspaceDir={workspaceDir}
                crashAnalysisDir={crashAnalysisDir}
                autoLaunch={autoLaunch}
                closeWindowAction={closeWindowAction}
                onSelectDir={() => void selectDir()}
                onSelectCrashAnalysisDir={() => void selectCrashAnalysisDir()}
                onClearCrashAnalysisDir={() => setCrashAnalysisDir("")}
                onAutoLaunchToggle={() => void handleAutoLaunchToggle()}
                onCloseWindowAction={setCloseWindowAction}
              />
            )}
            {tab === "channel" && <ChannelPanel />}
            {tab === "proxy" && (
              <SettingsProxyTab proxy={proxy} noProxy={noProxy} inputCls={inputCls} onProxy={setProxy} onNoProxy={setNoProxy} />
            )}
            {tab === "agent" && <AgentPanel />}
            {tab === "rules" && (
              <SettingsEngineShell
                tab="rules" allBoundTypes={boundTypes} boundTypes={[...sdkBoundTypes]}
                channels={taskChannels} agentResources={agentResources} workspaceDir={workspaceDir}
                channelContextLoaded={channelContextLoaded}
                renderEnginePanel={(engineType) => engineType === "sdk" ? <SettingsRulesPanel workspaceDir={workspaceDir} /> : null}
              />
            )}
            {tab === "tasks" && (
              <SettingsTasksTab taskChannels={taskChannels} agentResources={agentResources} showAlert={showAlert} />
            )}
            {tab === "skills" && (
              <SettingsEngineShell
                tab="skills" allBoundTypes={boundTypes} boundTypes={[...sdkBoundTypes]}
                channels={taskChannels} agentResources={agentResources} workspaceDir={workspaceDir}
                channelContextLoaded={channelContextLoaded}
                renderEnginePanel={(engineType) => engineType === "sdk" ? <SettingsSkillsPanel workspaceDir={workspaceDir} /> : null}
              />
            )}
            {tab === "mcp" && (
              <>
                <SettingsMcpDaemonGuide />
                <SettingsEngineShell
                  tab="mcp" allBoundTypes={boundTypes} boundTypes={boundTypes}
                  channels={taskChannels} agentResources={agentResources} workspaceDir={workspaceDir}
                  channelContextLoaded={channelContextLoaded}
                  renderEnginePanel={(engineType) => (
                    <SettingsMcpEngineBlock engineType={engineType} workspaceDir={workspaceDir} />
                  )}
                />
              </>
            )}
            {tab === "workflows" && <WorkflowPanel />}
            {tab === "setup" && (
              <SettingsSetupTab firstFeishuAppId={firstFeishuAppId} onNavigateTab={(t) => setTab(t as Tab)} />
            )}
            {tab === "about" && <SettingsAboutTab />}
          </div>
        </div>
      </div>

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
          if (!res.ok) { void showAlert("错误", res.error ?? "切换工作目录失败"); return }
          setWorkspaceDir(dir)
        }}
      />
      {ModalPortal}
    </div>
  )
}
