import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import type { PluginInventoryResult, PluginResourceInventory } from "../../shared/plugin-inventory-types"

interface Props {
  workspaceDir: string
  /** 强调展示的资源类型（Skills/MCP Tab 高亮对应区块） */
  highlight?: "skills" | "commands" | "agents" | "mcp" | "all"
}

/** 资源行：名称列表或空态 */
function ResourceRow({ label, items, active }: { label: string; items: string[]; active?: boolean }) {
  return (
    <div className={active ? "text-gray-400" : "text-gray-600"}>
      <span className={active ? "font-medium text-gray-300" : ""}>{label}</span>
      {items.length > 0 ? (
        <span className="ml-1 font-mono text-[10px] text-gray-500">{items.join(", ")}</span>
      ) : (
        <span className="ml-1 text-gray-700">—</span>
      )}
    </div>
  )
}

/** 单插件资源卡片 */
function PluginCard({ plugin, highlight }: { plugin: PluginResourceInventory; highlight: Props["highlight"] }) {
  const title = plugin.displayName ?? plugin.pluginId.split("@")[0]
  const ver = plugin.version ? `@${plugin.version}` : ""
  return (
    <div className="rounded border border-gray-700/50 bg-gray-900/50 px-3 py-2 space-y-1">
      <p className="text-xs font-medium text-gray-300">
        {title}
        <span className="text-gray-600">{ver}</span>
        <span className="ml-2 font-mono text-[10px] font-normal text-gray-600 truncate">{plugin.pluginId}</span>
      </p>
      <ResourceRow label="Skills" items={plugin.skills} active={highlight === "skills"} />
      <ResourceRow label="Commands" items={plugin.commands} active={highlight === "commands"} />
      <ResourceRow label="Agents" items={plugin.agents} active={highlight === "agents"} />
      <ResourceRow label="MCP" items={plugin.mcp} active={highlight === "mcp"} />
      {plugin.hooks.length > 0 && <ResourceRow label="Hooks" items={plugin.hooks} />}
      <p className="font-mono text-[10px] text-gray-700 break-all">{plugin.installPath}</p>
    </div>
  )
}

/** Claude Code 第三方插件只读清单（Settings Rules/Skills/MCP 共用） */
export default function SettingsPluginInventory({ workspaceDir, highlight = "all" }: Props) {
  const [data, setData] = useState<PluginInventoryResult | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.getPluginInventory(workspaceDir.trim())
      setData(res)
    } finally {
      setLoading(false)
    }
  }, [workspaceDir])

  useEffect(() => { void load() }, [load])

  const sources = data?.settingSources.join(", ") ?? "project, user, plugins"
  const patchOk = data?.importThirdPartyPluginsPatched ?? false

  return (
    <section className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-violet-200/90">Claude Code 第三方插件层（只读）</p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>
      <p className="text-gray-600 leading-relaxed">
        SDK 经 <span className="font-mono text-gray-500">settingSources: {sources}</span> 从
        <span className="font-mono text-gray-500"> ~/.claude/plugins/</span> 原生加载插件
        skills / commands / agents / hooks，无需同步到工作区 <span className="font-mono text-gray-500">.cursor/</span>。
        启用状态由项目 <span className="font-mono text-gray-500">.claude/settings.json</span> 的{" "}
        <span className="font-mono text-gray-500">enabledPlugins</span> 控制（与 Cursor IDE 一致）。
      </p>
      <p className={patchOk ? "text-gray-600" : "text-amber-500/90"}>
        importThirdPartyPlugins：{patchOk ? "已开启（headless SDK patch 生效）" : "未生效 — 插件 skills/commands 可能无法加载"}
      </p>
      {!workspaceDir.trim() && (
        <p className="text-amber-500/90">请先在「通用」配置主工作区，以解析项目 scope 插件绑定。</p>
      )}
      {data && data.plugins.length === 0 && (
        <p className="text-gray-600">当前工作区无已启用的 Claude Code 第三方插件。</p>
      )}
      {data && data.plugins.length > 0 && (
        <div className="space-y-2">
          {data.plugins.map((p) => (
            <PluginCard key={p.pluginId} plugin={p} highlight={highlight} />
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-700">
        会话创建时 UI 日志会输出 <span className="font-mono">[plugin-load]</span> 明细；每次 send 输出{" "}
        <span className="font-mono">[config]</span> 摘要。
      </p>
    </section>
  )
}
