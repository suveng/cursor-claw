import {
  Play, Square, Wifi, WifiOff, Bot, MessageSquare, Loader2, Trash2,
} from "lucide-react"

const CHANNEL_STATUS_TEXT: Record<string, string> = {
  connected: "在线",
  connecting: "连接中",
  qr_pending: "待扫码",
  logging_in: "登录中",
  disconnected: "已断开",
  error: "错误",
}

export function StatusCard({
  icon: Icon,
  label,
  value,
  color,
  sub,
  action,
}: {
  icon: typeof Wifi
  label: string
  value: string
  color: "green" | "red" | "blue" | "yellow" | "gray"
  sub?: string
  action?: React.ReactNode
}) {
  const colors: Record<string, string> = {
    green: "text-green-400",
    red: "text-red-400",
    blue: "text-blue-400",
    yellow: "text-yellow-400",
    gray: "text-gray-500",
  }

  const dotColors: Record<string, string> = {
    green: "bg-green-400",
    red: "bg-red-400",
    blue: "bg-blue-400",
    yellow: "bg-yellow-400",
    gray: "bg-gray-600",
  }

  return (
    <div className="flex h-[88px] flex-col rounded-lg border border-gray-800 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} className={colors[color]} />
          <span className="text-xs text-gray-500">{label}</span>
        </div>
        <div className="min-w-0">{action}</div>
      </div>
      <div className="mt-auto">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 shrink-0 rounded-full ${dotColors[color]}`} />
          <span className={`text-sm font-medium ${colors[color]}`}>{value}</span>
        </div>
        <div className="mt-1 h-4 truncate text-xs text-gray-600">{sub ?? "\u00A0"}</div>
      </div>
    </div>
  )
}


interface Props {
  status: DaemonStatus
  isStarting: boolean
  starting: boolean
  stopping: boolean
  stoppingAgent: boolean
  clearingQueue: boolean
  sessionListLength: number
  formatUptime: (seconds?: number) => string
  onStart: () => void
  onStop: () => void
  onStopAgent: (e: React.MouseEvent) => void
  onToggleChannels: () => void
  onToggleSessions: () => void
  onToggleQueue: () => void
  onClearQueue: (e: React.MouseEvent) => void
}

/** Dashboard 四状态卡片（Daemon / 通道 / Agent / 队列） */
export default function DashboardStatusCards({
  status, isStarting, starting, stopping, stoppingAgent, clearingQueue,
  sessionListLength, formatUptime, onStart, onStop, onStopAgent,
  onToggleChannels, onToggleSessions, onToggleQueue, onClearQueue,
}: Props) {
  return (
      {/* Status cards */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4">
        <StatusCard
          icon={status.running ? Wifi : WifiOff}
          label="Daemon"
          value={status.running ? "运行中" : isStarting ? "启动中" : "已停止"}
          color={status.running ? "green" : isStarting ? "yellow" : "red"}
          sub={
            status.running
              ? [
                  `uptime ${formatUptime(status.uptime)}`,
                  status.workspaceMismatch
                    ? (status.daemonWorkspaceDir
                      ? `目录与设置不一致（Daemon: ${status.daemonWorkspaceDir}）`
                      : "工作目录与设置不一致")
                    : "",
                ].filter(Boolean).join(" · ")
              : status.error
          }
          action={status.running ? (
            <button
              onClick={onStop}
              disabled={stopping}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-red-400 transition hover:bg-red-600/20 disabled:opacity-50"
              title="停止 Daemon"
            >
              {stopping ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}
              停止
            </button>
          ) : isStarting ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-yellow-400" title="正在启动 Daemon">
              <Loader2 size={10} className="animate-spin" />
              启动中
            </span>
          ) : (
            <button
              onClick={onStart}
              disabled={starting}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-green-400 transition hover:bg-green-600/20 disabled:opacity-50"
              title="启动 Daemon"
            >
              {starting ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
              启动
            </button>
          )}
        />
        <div
          onClick={onToggleChannels}
          className={(status.channels ?? []).length > 0 ? "cursor-pointer" : ""}
        >
          <StatusCard
            icon={(status.channels ?? []).some((c) => c.connected) ? Wifi : WifiOff}
            label="消息通道"
            value={(() => {
              const chs = status.channels ?? []
              if (chs.length === 0) return status.running ? "未配置通道" : "等待连接"
              const ok = chs.filter((c) => c.connected).length
              if (ok === chs.length) return chs.length === 1 ? `${chs[0].name} 已连接` : `${ok}/${chs.length} 通道在线`
              if (ok > 0) return `${ok}/${chs.length} 通道在线`
              return status.running ? "通道连接中" : "等待连接"
            })()}
            color={(() => {
              const chs = status.channels ?? []
              const ok = chs.filter((c) => c.connected).length
              if (ok > 0 && ok === chs.length) return "green"
              if (ok > 0 || (status.running && chs.length > 0)) return "yellow"
              return "gray"
            })()}
            sub={(() => {
              const chs = status.channels ?? []
              if (chs.length === 0) return "等待目标"
              return chs.map((c) => `${c.name}${c.connected ? "✓" : c.status === "qr_pending" ? "(扫码)" : "…"}`).join(" · ")
            })()}
          />
        </div>
        <div onClick={onToggleSessions} className={sessionListLength > 0 || status.agentRunning ? "cursor-pointer" : ""}>
          <StatusCard
            icon={Bot}
            label="Agent"
            value={
              sessionListLength > 0
                ? `${sessionListLength} 个会话`
                : status.agentRunning ? `会话中 PID:${status.agentPid}` : "空闲"
            }
            color={status.agentRunning || sessionListLength > 0 ? "blue" : "gray"}
            sub={sessionListLength > 0 ? "点击查看详情" : "等待消息"}
            action={status.agentRunning || sessionListLength > 0 ? (
              <button
                onClick={(e) => { e.stopPropagation(); onStopAgent() }}
                disabled={stoppingAgent}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-red-400 transition hover:bg-red-600/20 disabled:opacity-50"
                title="停止全部 Agent"
              >
                {stoppingAgent ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}
                停止
              </button>
            ) : undefined}
          />
        </div>
        <div onClick={onToggleQueue} className="cursor-pointer">
          <StatusCard
            icon={MessageSquare}
            label="消息队列"
            value={String(status.queueLength ?? 0)}
            color={status.queueLength ? "yellow" : "gray"}
            sub={status.queueLength ? "点击查看详情" : "待处理消息"}
            action={status.queueLength ? (
              <button
                onClick={onClearQueue}
                disabled={clearingQueue}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-red-400 transition hover:bg-red-600/20 disabled:opacity-50"
                title="清空队列"
              >
                {clearingQueue ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                清空
              </button>
            ) : undefined}
          />
        </div>
      </div>

  )
}

export { CHANNEL_STATUS_TEXT }
