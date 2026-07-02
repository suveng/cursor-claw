import type { ReactNode } from "react"
import { Info } from "lucide-react"
import {
  type AgentEngineType,
  type AgentResource,
  type MessageChannel,
  RESOURCE_GROUP_LABELS,
  ENGINE_BLOCK_SUBTITLES,
  channelsBoundToEngineType,
} from "../../shared/channel-types"

/** Rules / Skills / MCP 三 Tab 共用的引擎分块外壳 */
export interface SettingsEngineShellProps {
  tab: "rules" | "skills" | "mcp"
  /** Tab 可见引擎子集（如 Rules/Skills 仅 sdk）；决定渲染哪些引擎块 */
  boundTypes: AgentEngineType[]
  /** 全量 deriveBoundEngineTypes 结果；用于区分「绑定无效」与「无本 Tab 适用引擎」 */
  allBoundTypes?: AgentEngineType[]
  channels: MessageChannel[]
  agentResources: AgentResource[]
  workspaceDir: string
  /** 通道上下文是否已加载；未完成前不渲染空态，避免首次进入闪烁 */
  channelContextLoaded?: boolean
  /** 外壳仅对 boundTypes 内引擎调用；未绑定引擎不渲染块 */
  renderEnginePanel: (engineType: AgentEngineType) => ReactNode
}

/** Tab 名称，用于空态引导文案 */
const TAB_LABELS: Record<SettingsEngineShellProps["tab"], string> = {
  rules: "Rules",
  skills: "Skills",
  mcp: "MCP",
}

/** 有通道绑定但无本 Tab 适用引擎时的专属引导（如 Rules/Skills 仅 SDK） */
const TAB_NO_APPLICABLE_ENGINE: Record<SettingsEngineShellProps["tab"], { title: string; body: string }> = {
  rules: {
    title: "当前无通道绑定 Cursor SDK",
    body: "Rules 仅适用于 Cursor SDK 通道。请在「消息通道」中将通道的 Agent 资源切换为 Cursor SDK，或新增绑定 SDK 的通道。",
  },
  skills: {
    title: "当前无通道绑定 Cursor SDK",
    body: "Skills 仅适用于 Cursor SDK 通道。请在「消息通道」中将通道的 Agent 资源切换为 Cursor SDK，或新增绑定 SDK 的通道。",
  },
  mcp: {
    title: "MCP 暂无可用的引擎绑定",
    body: "当前消息通道未绑定支持 MCP 配置的引擎。请在「消息通道」中检查 Agent 资源设置。",
  },
}

/** 琥珀色引导空态 */
function EngineShellEmptyGuide({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <div className="flex gap-2.5">
        <Info size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-amber-200/90">{title}</p>
          <p className="text-xs leading-relaxed text-amber-200/70">{body}</p>
        </div>
      </div>
    </div>
  )
}

/** 单个引擎分块：标题 + 说明 + 适用通道 + 子面板 */
function EngineBlock({
  engineType,
  channels,
  agentResources,
  renderEnginePanel,
}: {
  engineType: AgentEngineType
  channels: MessageChannel[]
  agentResources: AgentResource[]
  renderEnginePanel: (engineType: AgentEngineType) => ReactNode
}) {
  const boundChannels = channelsBoundToEngineType(engineType, channels, agentResources)
  const subtitle = ENGINE_BLOCK_SUBTITLES[engineType]

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-gray-300">{RESOURCE_GROUP_LABELS[engineType]}</h3>
        {subtitle && <p className="mt-1 text-xs text-gray-600">{subtitle}</p>}
        {boundChannels.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">
            适用于：{boundChannels.map((ch) => ch.name).join("、")}
          </p>
        )}
      </div>
      <div className="rounded-lg border border-gray-700/60">
        {renderEnginePanel(engineType)}
      </div>
    </section>
  )
}

/**
 * 设置页引擎感知分块外壳。
 * 无通道或绑定全部失效时展示引导空态；有绑定时按引擎类型分块渲染子面板。
 */
export default function SettingsEngineShell({
  tab,
  boundTypes,
  allBoundTypes,
  channels,
  agentResources,
  channelContextLoaded = true,
  renderEnginePanel,
}: SettingsEngineShellProps) {
  const tabLabel = TAB_LABELS[tab]
  const effectiveAllBound = allBoundTypes ?? boundTypes

  // 通道上下文未加载完成时不渲染空态，避免 [] 初始值误触发引导闪烁
  if (!channelContextLoaded) {
    return <p className="py-4 text-center text-xs text-gray-500">加载中…</p>
  }

  if (channels.length === 0) {
    return (
      <EngineShellEmptyGuide
        title={`${tabLabel} 配置需先绑定消息通道`}
        body="请先在「消息通道」标签页创建通道，并在通道设置中选择 Agent 资源（Cursor SDK / Claude Code / Codex / OpenCode）。绑定完成后，此处将按引擎类型展示对应配置入口。"
      />
    )
  }

  if (effectiveAllBound.length === 0) {
    return (
      <EngineShellEmptyGuide
        title={`${tabLabel} 暂无可用的引擎绑定`}
        body="当前消息通道的 Agent 资源绑定无效或资源已删除。请在「消息通道」中检查各通道的 Agent 资源设置，并确保所选资源仍存在于「Agent」标签页。"
      />
    )
  }

  if (boundTypes.length === 0) {
    const guide = TAB_NO_APPLICABLE_ENGINE[tab]
    return <EngineShellEmptyGuide title={guide.title} body={guide.body} />
  }

  return (
    <div className="space-y-6">
      {boundTypes.map((engineType) => (
        <EngineBlock
          key={engineType}
          engineType={engineType}
          channels={channels}
          agentResources={agentResources}
          renderEnginePanel={renderEnginePanel}
        />
      ))}
    </div>
  )
}
