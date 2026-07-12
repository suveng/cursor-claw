import { Bird, MessageSquare, ChevronRight, Clock, Trash2, Loader2 } from "lucide-react"
import SessionMcpPanel from "../components/SessionMcpPanel"
import { CHANNEL_STATUS_TEXT } from "./DashboardStatusCards"

interface SessionInfo {
  sessionKey: string; pid: number; startedAt: number; chatType: string; lastActivityAt: number
  chatName?: string; workspaceDir?: string; engineType: "sdk" | "claude-code"
}

interface QueueMsg {
  index: number; fileId: string; preview: string; sessionKey?: string; chatType?: string
  timestamp?: number; senderOpenId?: string
}

interface Props {
  status: DaemonStatus
  showChannels: boolean
  showSessions: boolean
  showQueue: boolean
  sessionList: SessionInfo[]
  queueMessages: QueueMsg[]
  expandedSession: string | null
  fallbackWorkspaceDir: string
  formatTimestamp: (ts?: number) => string
  getSessionLabel: (msg: { sessionKey?: string; chatType?: string }) => string
  getSessionQueueMessages: (sessionKey: string) => QueueMsg[]
  onSettings: (tab?: string) => void
  onStopAllSessions: () => void
  onToggleSessionExpand: (sessionKey: string) => void
  onDeleteQueueMessage: (fileId: string, e: React.MouseEvent) => void
}

/** Dashboard 通道/会话/队列展开详情面板 */
export default function DashboardDetailPanels(p: Props) {
  const {
    status, showChannels, showSessions, showQueue, sessionList, queueMessages,
    expandedSession, fallbackWorkspaceDir, formatTimestamp, getSessionLabel,
    getSessionQueueMessages, onSettings, onStopAllSessions, onToggleSessionExpand, onDeleteQueueMessage,
  } = p
  return (
    <>
      {showChannels && (status.channels ?? []).length > 0 && (
        <div className="mx-6 rounded-xl border border-gray-800 bg-gray-900/80 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">消息通道详情</span>
            <button onClick={() => onSettings("channel")} className="text-xs text-blue-400 hover:text-blue-300">管理通道</button>
          </div>
          <div className="space-y-1.5">
            {(status.channels ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-800/60 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  {c.type === "feishu" ? <Bird size={14} className="shrink-0 text-blue-400" /> : <MessageSquare size={14} className="shrink-0 text-green-400" />}
                  <span className="truncate text-xs text-gray-300">{c.name}</span>
                  {c.botName && <span className="truncate text-[10px] text-gray-500">{c.botName}</span>}
                  {c.mainUserBound && <span className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-400">主用户</span>}
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${c.connected ? "bg-green-900/40 text-green-400" : c.status === "error" ? "bg-red-900/40 text-red-400" : "bg-yellow-900/40 text-yellow-400"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${c.connected ? "bg-green-400" : c.status === "error" ? "bg-red-400" : "bg-yellow-400"}`} />
                  {c.connected ? "在线" : (CHANNEL_STATUS_TEXT[c.status] ?? c.status ?? "未连接")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showSessions && sessionList.length > 0 && (
        <div className="mx-6 rounded-xl border border-gray-800 bg-gray-900/80 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">活跃会话</span>
            <button onClick={() => void onStopAllSessions()} className="text-xs text-red-400 hover:text-red-300">全部停止</button>
          </div>
          <div className="space-y-1.5">
            {sessionList.map((s) => {
              const pendingMsgs = getSessionQueueMessages(s.sessionKey)
              const hasPending = pendingMsgs.length > 0
              const isExpanded = expandedSession === s.sessionKey
              return (
                <div key={s.sessionKey}>
                  <div
                    className="flex cursor-pointer items-center justify-between rounded-lg bg-gray-800/60 px-3 py-2 hover:bg-gray-800/80"
                    onClick={() => onToggleSessionExpand(s.sessionKey)}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className={`h-2 w-2 rounded-full ${s.chatType === "group" ? "bg-green-400" : s.chatType === "task" ? "bg-yellow-400" : "bg-blue-400"}`} />
                      <span className="truncate text-xs text-gray-300" title={s.sessionKey}>
                        {s.chatType === "group" ? "群聊" : s.chatType === "task" ? "定时" : "私聊"} {s.chatName || (s.sessionKey.length > 20 ? s.sessionKey.slice(0, 20) + "…" : s.sessionKey)}
                        {s.workspaceDir && s.chatType === "p2p" && <span className="ml-1 text-[10px] text-gray-500" title={s.workspaceDir}>📁{s.workspaceDir.split(/[\\/]/).pop()}</span>}
                      </span>
                      <span className="text-xs text-gray-600">PID:{s.pid}</span>
                      {hasPending && (
                        <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-yellow-500/90 px-1 text-[10px] font-bold text-gray-900">
                          {pendingMsgs.length}
                        </span>
                      )}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); window.electronAPI.stopSessionAgent(s.sessionKey) }} className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-600/20" title="停止此会话">
                      <Square size={10} />
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="ml-4 mt-1 space-y-2 border-l-2 border-blue-700/40 pl-3">
                      <SessionMcpPanel
                        sessionKey={s.sessionKey}
                        workspaceDir={s.workspaceDir}
                        engineType={s.engineType}
                        fallbackWorkspaceDir={fallbackWorkspaceDir}
                      />
                      {hasPending && (
                        <div className="space-y-1 border-l-2 border-yellow-700/40 pl-3">
                          {pendingMsgs.map((msg) => (
                            <div key={msg.fileId} className="group flex items-start justify-between gap-2 rounded bg-gray-800/40 px-2.5 py-1.5">
                              <div className="min-w-0 flex-1">
                                <span className="text-[10px] text-gray-500">{formatTimestamp(msg.timestamp)}</span>
                                <p className="truncate text-xs text-gray-300">{msg.preview}</p>
                              </div>
                              <button
                                onClick={(e) => onDeleteQueueMessage(msg.fileId, e)}
                                className="shrink-0 rounded p-0.5 text-gray-600 opacity-0 transition hover:bg-red-600/20 hover:text-red-400 group-hover:opacity-100"
                                title="删除此消息"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Queue messages */}
      {showQueue && (
        <div className="mx-6 rounded-xl border border-gray-800 bg-gray-900/80 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">全局消息队列</span>
            <span className="text-xs text-gray-600">{queueMessages.length} 条</span>
          </div>
          {queueMessages.length === 0 ? (
            <p className="text-center text-xs text-gray-600">队列为空</p>
          ) : (
            <div className="space-y-1.5">
              {queueMessages.map((msg) => (
                <div key={msg.fileId || msg.index} className="group flex items-start justify-between gap-2 rounded-lg bg-gray-800/60 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-blue-400">{getSessionLabel(msg)}</span>
                      <span className="text-[10px] text-gray-500">{formatTimestamp(msg.timestamp)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-gray-300">{msg.preview}</p>
                  </div>
                  <button
                    onClick={(e) => onDeleteQueueMessage(msg.fileId, e)}
                    className="shrink-0 rounded p-0.5 text-gray-600 opacity-0 transition hover:bg-red-600/20 hover:text-red-400 group-hover:opacity-100"
                    title="删除此消息"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </>
  )
}
