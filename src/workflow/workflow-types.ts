// ── 工作流数据模型 ─────────────────────────────────────────

/** Gateway 条件路由条目 */
export interface WorkflowRoute {
  when: string
  next: string
}

export interface WorkflowNode {
  id: string
  name: string
  prompt: string
  model?: string
  maxRetries: number
  isolated?: boolean
  /** 默认 task；gateway 不跑 Agent，仅条件路由 */
  kind?: "task" | "gateway"
  routes?: WorkflowRoute[]
  defaultNext?: string
}

export interface WorkflowDefinition {
  id: string
  name: string
  description?: string
  workingDirectory?: string
  config?: Record<string, string>
  nodes: WorkflowNode[]
  createdAt: number
  updatedAt: number
}

export interface NodeExecution {
  nodeId: string
  attempt: number
  status: "running" | "completed" | "rejected" | "failed"
  input: Record<string, unknown>
  output?: unknown
  rejectReason?: string
  rejectFromNodeId?: string
  startedAt: number
  completedAt?: number
}

export type WorkflowStatus = "pending" | "running" | "paused" | "completed" | "failed"

export interface WorkflowInstance {
  id: string
  workflowId: string
  status: WorkflowStatus
  currentNodeId: string | null
  context: Record<string, unknown>
  nodeHistory: NodeExecution[]
  sessionKey?: string
  notifyChatId?: string
  workingDirectory: string
  input?: string
  maxSteps: number
  stepCount: number
  createdAt: number
  updatedAt: number
  completedAt?: number
}

// ── 引擎信号 ───────────────────────────────────────────────

export interface WorkflowNextPayload {
  output: string
}

export interface WorkflowRejectPayload {
  reason: string
  targetNodeId?: string
}

/** 模板/YAML/JSON 中 prompt 可为 string 或 string[]（数组加载时 join） */
export type WorkflowPromptInput = string | string[]

export function normalizePrompt(prompt: WorkflowPromptInput | undefined): string {
  if (prompt == null) {
    return ""
  }
  if (Array.isArray(prompt)) {
    return prompt.join("\n")
  }
  return prompt
}

/** 规范化定义：缺省 kind=task；gateway 校验 next 指向存在节点 */
export function normalizeWorkflowDefinition(def: WorkflowDefinition): WorkflowDefinition {
  const nodeIds = new Set((def.nodes ?? []).map((n) => n.id))
  return {
    ...def,
    nodes: (def.nodes ?? []).map((n) => {
      const kind = n.kind === "gateway" ? "gateway" : "task"
      if (kind === "gateway") {
        for (const r of n.routes ?? []) {
          if (r.next && !nodeIds.has(r.next)) {
            throw new Error(`Gateway 节点「${n.id}」路由 next「${r.next}」不存在`)
          }
        }
        if (n.defaultNext && !nodeIds.has(n.defaultNext)) {
          throw new Error(`Gateway 节点「${n.id}」defaultNext「${n.defaultNext}」不存在`)
        }
      }
      return {
        ...n,
        kind,
        prompt: normalizePrompt(n.prompt as WorkflowPromptInput),
        maxRetries: n.maxRetries ?? 2,
        ...(n.routes ? { routes: n.routes } : {}),
        ...(n.defaultNext ? { defaultNext: n.defaultNext } : {}),
      }
    }),
  }
}
