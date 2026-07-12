import { Info, Rocket, FolderOpen, Bot, MessageSquare, CheckCircle2, Circle, ChevronRight } from "lucide-react"

export interface OnboardState {
  workspaceReady: boolean
  agentReady: boolean
  channelReady: boolean
}

interface Props {
  onboard: OnboardState | null
  onboardDismissed: boolean
  cliMigrationPending: boolean
  onSettings: (tab?: string) => void
  onDismissOnboard: () => void
  onDismissCliMigration: () => void
}

/** Dashboard 引导三步与 CLI 迁移提示 */
export default function DashboardOnboard({
  onboard, onboardDismissed, cliMigrationPending, onSettings, onDismissOnboard, onDismissCliMigration,
}: Props) {
  return (
    <>
      {/* 历史 CLI 绑定迁移提示（一次性 Banner） */}
      {cliMigrationPending && (
        <div className="mx-6 mb-3 rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Info size={16} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-medium text-amber-200">CLI 绑定已自动迁移</p>
                <p className="mt-1 text-xs text-gray-400">
                  已自动将历史 Cursor CLI 绑定迁移至 SDK / Claude Code，请检查各通道的 Agent 资源设置是否符合预期。
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => onSettings("channel")}
                className="rounded-lg bg-amber-600/20 px-2.5 py-1 text-xs text-amber-300 transition hover:bg-amber-600/30"
              >
                检查通道设置
              </button>
              <button
                onClick={() => onDismissCliMigration()}
                className="rounded px-1.5 py-0.5 text-xs text-gray-500 transition hover:bg-gray-800 hover:text-gray-300"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding checklist */}
      {onboard && !onboardDismissed && !(onboard.workspaceReady && onboard.agentReady && onboard.channelReady) && (
        <div className="mx-6 mb-3 rounded-xl border border-blue-800/50 bg-blue-950/20 p-4">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Rocket size={15} className="text-blue-400" />
              <span className="text-sm font-medium text-blue-200">开始使用 Cursor Claw</span>
            </div>
            <button onClick={() => onDismissOnboard()} className="rounded px-1.5 py-0.5 text-xs text-gray-500 transition hover:bg-gray-800 hover:text-gray-300">暂时隐藏</button>
          </div>
          <p className="mb-3 text-xs text-gray-500">完成以下三步配置，即可通过飞书 / 微信与 AI Agent 协作。</p>
          <div className="space-y-1.5">
            {(() => {
              const items = [
                { done: onboard.workspaceReady, icon: FolderOpen, label: "选择主工作目录", desc: "Agent 在此目录中工作", tab: "general" },
                { done: onboard.agentReady, icon: Bot, label: "配置 Agent 资源", desc: "Cursor SDK / Claude Code / Codex / OpenCode", tab: "agent" },
                { done: onboard.channelReady, icon: MessageSquare, label: "添加消息通道", desc: "接入飞书或微信并绑定 Agent 资源", tab: "channel" },
              ]
              const nextIdx = items.findIndex((it) => !it.done)
              return items.map((item, i) => {
                const isNext = i === nextIdx
                return (
                  <button
                    key={item.tab}
                    onClick={() => onSettings(item.tab)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                      item.done ? "border-green-800/40 bg-green-950/20"
                      : isNext ? "border-blue-500/70 bg-blue-950/30 hover:bg-blue-900/30"
                      : "border-gray-700 hover:border-blue-500 hover:bg-gray-800/40"}`}
                  >
                    {item.done
                      ? <CheckCircle2 size={16} className="shrink-0 text-green-400" />
                      : <Circle size={16} className={`shrink-0 ${isNext ? "text-blue-400" : "text-gray-600"}`} />}
                    <item.icon size={14} className={`shrink-0 ${item.done ? "text-green-400/70" : isNext ? "text-blue-300" : "text-gray-400"}`} />
                    <div className="min-w-0 flex-1">
                      <span className={`text-xs font-medium ${item.done ? "text-green-300/80" : isNext ? "text-blue-100" : "text-gray-200"}`}>{i + 1}. {item.label}</span>
                      <span className="ml-2 text-xs text-gray-600">{item.desc}</span>
                    </div>
                    {isNext && <span className="shrink-0 rounded bg-blue-600/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">下一步</span>}
                    {!item.done && <ChevronRight size={14} className={`shrink-0 ${isNext ? "text-blue-400" : "text-gray-600"}`} />}
                  </button>
                )
              })
            })()}
          </div>
        </div>
      )}

    </>
  )
}
