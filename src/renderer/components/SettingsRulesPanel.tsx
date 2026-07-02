import { useState, useEffect, useCallback } from "react"
import { RefreshCw, Plus, Pencil, Trash2, X } from "lucide-react"

interface Props {
  /** 主工作区路径（项目级 Rules 绑定） */
  workspaceDir: string
}

interface RuleFile {
  name: string
  content: string
}

/** Settings Rules Tab：主工作区 .cursor/rules/ 规则文件 CRUD */
export default function SettingsRulesPanel({ workspaceDir }: Props) {
  const [rules, setRules] = useState<RuleFile[]>([])
  const [ruleEditing, setRuleEditing] = useState<RuleFile | null>(null)
  const [ruleEditOriginalName, setRuleEditOriginalName] = useState<string | null>(null)

  const disabled = !workspaceDir.trim()

  const refreshRules = useCallback(() => {
    void window.electronAPI.getRules().then(setRules)
  }, [])

  // 面板挂载时拉取规则列表
  useEffect(() => {
    refreshRules()
  }, [refreshRules])

  // 工作区变更时刷新；未配置时清空避免残留
  useEffect(() => {
    if (workspaceDir.trim()) {
      refreshRules()
    } else {
      setRules([])
    }
  }, [workspaceDir, refreshRules])

  const openRuleAdd = () => {
    if (disabled) return
    setRuleEditOriginalName(null)
    setRuleEditing({ name: "", content: "" })
  }

  const openRuleEdit = (r: RuleFile) => {
    if (disabled) return
    setRuleEditOriginalName(r.name)
    setRuleEditing({ ...r })
  }

  const handleRuleDelete = async (name: string) => {
    if (disabled) return
    await window.electronAPI.deleteRule(name)
    refreshRules()
  }

  const handleRuleSave = async () => {
    if (!ruleEditing || !ruleEditing.name.trim()) return
    // 重命名时先删旧文件
    if (ruleEditOriginalName && ruleEditOriginalName !== ruleEditing.name) {
      await window.electronAPI.deleteRule(ruleEditOriginalName)
    }
    let name = ruleEditing.name.trim()
    if (!name.endsWith(".mdc") && !name.endsWith(".md")) name += ".mdc"
    await window.electronAPI.saveRule(name, ruleEditing.content)
    setRuleEditing(null)
    refreshRules()
  }

  const inputCls =
    "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none transition focus:border-blue-500"

  return (
    <>
      <section className="space-y-3">
        <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 text-xs">
          <p className="font-medium text-gray-300">项目级规则 · 主工作区</p>
          {workspaceDir.trim() ? (
            <>
              <p className="mt-1 font-mono text-[11px] text-gray-500 break-all">{workspaceDir}</p>
              <p className="mt-1.5 text-gray-600 leading-relaxed">
                规则写入主工作区 <span className="text-gray-500">.cursor/rules/</span>。
                SDK 会话的 cwd 可能来自通道或任务工作区；与主工作区不同时，此处修改不会作用于该会话。
              </p>
            </>
          ) : (
            <p className="mt-1 text-amber-500/90">请先在「通用」中配置主工作区后才能编辑规则。</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">Cursor Rules</h3>
          <button
            type="button"
            onClick={refreshRules}
            disabled={disabled}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={12} />
            刷新
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={openRuleAdd}
            disabled={disabled}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            <Plus size={12} />
            新增
          </button>
        </div>

        <p className="text-xs text-gray-600">
          管理主工作区 <span className="text-gray-500">.cursor/rules/</span> 下的规则文件
        </p>

        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.name}
              className="flex items-center justify-between rounded-lg border border-gray-700 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="truncate text-xs text-gray-500">
                  {r.content.slice(0, 80)}
                  {r.content.length > 80 ? "..." : ""}
                </p>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => openRuleEdit(r)}
                  disabled={disabled}
                  className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white disabled:opacity-40"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRuleDelete(r.name)}
                  disabled={disabled}
                  className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-red-400 disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="py-4 text-center text-xs text-gray-600">暂无 Rule 文件</p>
          )}
        </div>
      </section>

      {/* Rule 编辑弹窗 */}
      {ruleEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div
            className="flex w-full max-w-lg flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
            style={{ maxHeight: "80vh" }}
          >
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <h3 className="text-sm font-semibold text-gray-200">
                {ruleEditOriginalName ? "编辑 Rule" : "新增 Rule"}
              </h3>
              <button
                type="button"
                onClick={() => setRuleEditing(null)}
                className="text-gray-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-gray-500">文件名</label>
                <input
                  type="text"
                  value={ruleEditing.name}
                  onChange={(e) => setRuleEditing({ ...ruleEditing, name: e.target.value })}
                  className={inputCls}
                  placeholder="my-rule.mdc"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">内容</label>
                <textarea
                  value={ruleEditing.content}
                  onChange={(e) => setRuleEditing({ ...ruleEditing, content: e.target.value })}
                  rows={16}
                  className={inputCls + " font-mono text-xs leading-relaxed"}
                  placeholder={
                    "---\ndescription: My rule\nglobs: **/*.ts\nalwaysApply: false\n---\n\n# Rule content"
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-800 px-6 py-4">
              <button
                type="button"
                onClick={() => setRuleEditing(null)}
                className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleRuleSave()}
                disabled={!ruleEditing.name.trim()}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
