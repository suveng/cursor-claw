/**
 * Gateway 节点字段编辑（kind / routes / defaultNext）
 * 从 DefEditor 拆出以守单文件 ≤300。
 */
import type { WorkflowNode, WorkflowRoute } from "../../workflow/workflow-types"

const inputCls =
  "w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"

interface Props {
  node: WorkflowNode
  nodeIds: string[]
  onChange: (patch: Partial<WorkflowNode>) => void
}

/** Gateway：条件路由 + 默认下一节点；when 支持 always/true、contains、context.x contains */
export default function WorkflowGatewayFields({ node, nodeIds, onChange }: Props) {
  const routes = node.routes ?? []

  const updateRoute = (idx: number, patch: Partial<WorkflowRoute>) => {
    const next = routes.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    onChange({ routes: next })
  }

  return (
    <div className="space-y-3 rounded-md border border-gray-800 bg-gray-800/40 p-3">
      <p className="text-[11px] text-gray-500">
        Gateway 不启动 Agent：按 routes 条件跳转；when 支持 always / contains 子串 / context.节点ID contains 子串。
      </p>
      <div>
        <label className="mb-1 block text-xs text-gray-500">节点类型</label>
        <select
          value={node.kind ?? "task"}
          onChange={(e) =>
            onChange({
              kind: e.target.value === "gateway" ? "gateway" : "task",
              ...(e.target.value !== "gateway" ? { routes: undefined, defaultNext: undefined } : {}),
            })
          }
          className={inputCls}
        >
          <option value="task">task（执行 Agent）</option>
          <option value="gateway">gateway（条件路由）</option>
        </select>
      </div>
      {(node.kind ?? "task") === "gateway" && (
        <>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-gray-500">路由 routes</label>
              <button
                type="button"
                className="text-xs text-blue-400"
                onClick={() =>
                  onChange({ routes: [...routes, { when: "always", next: nodeIds[0] ?? "" }] })
                }
              >
                + 添加
              </button>
            </div>
            <div className="space-y-1.5">
              {routes.map((r, idx) => (
                <div key={idx} className="flex flex-col gap-1 rounded border border-gray-700 p-2">
                  <input
                    className={inputCls + " font-mono text-[11px]"}
                    value={r.when}
                    placeholder="when：always / contains xxx"
                    onChange={(e) => updateRoute(idx, { when: e.target.value })}
                  />
                  <div className="flex items-center gap-1">
                    <select
                      className={inputCls + " flex-1"}
                      value={r.next}
                      onChange={(e) => updateRoute(idx, { next: e.target.value })}
                    >
                      <option value="">选择 next 节点</option>
                      {nodeIds.map((id) => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-red-400"
                      onClick={() => onChange({ routes: routes.filter((_, i) => i !== idx) })}
                    >
                      删
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">defaultNext（未命中时）</label>
            <select
              className={inputCls}
              value={node.defaultNext ?? ""}
              onChange={(e) => onChange({ defaultNext: e.target.value || undefined })}
            >
              <option value="">（无）</option>
              {nodeIds.filter((id) => id !== node.id).map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  )
}
