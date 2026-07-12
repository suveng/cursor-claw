import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowNode,
  WorkflowNextPayload,
  NodeExecution,
} from "./workflow-types.js";
import { getDefinition, getInstance, saveInstance } from "./workflow-store.js";
import { assignInstanceSessionKey } from "./workflow-session-key.js";
import { buildNextNodePrompt } from "./workflow-engine-prompt.js";
import { resolveGatewayNext } from "./workflow-gateway.js";

/** 引擎单步结果（启动 / 推进 / 驳回 / 恢复共用） */
export interface EngineResult {
  prompt?: string;
  done?: boolean;
  failed?: boolean;
  isolated?: boolean;
  node?: WorkflowNode;
  message?: string;
}

/** 按节点 ID 查定义内下标；未找到返回 -1 */
export function getNodeIndex(def: WorkflowDefinition, nodeId: string): number {
  return def.nodes.findIndex((n) => n.id === nodeId);
}

function failInstance(inst: WorkflowInstance, message: string): EngineResult {
  inst.status = "failed";
  inst.updatedAt = Date.now();
  saveInstance(inst);
  return { failed: true, message };
}

/**
 * 若节点为 gateway：求值路由并跳转，不 spawn；可连续穿过多个 gateway。
 * 返回最终应进入的 task 节点；失败则已落盘 failed。
 */
export function resolveToTaskNode(
  inst: WorkflowInstance,
  def: WorkflowDefinition,
  startNode: WorkflowNode,
  prevOutput: string,
): { ok: true; node: WorkflowNode } | { ok: false; result: EngineResult } {
  let node = startNode;
  let output = prevOutput;
  // 防止环路：最多穿过 nodes.length 次
  for (let i = 0; i < def.nodes.length + 1; i++) {
    if ((node.kind ?? "task") !== "gateway") {
      return { ok: true, node };
    }
    const resolved = resolveGatewayNext(def, inst, node, output);
    if (!resolved.ok || !resolved.nextNodeId) {
      return { ok: false, result: failInstance(inst, resolved.message ?? "Gateway 路由失败") };
    }
    const next = def.nodes.find((n) => n.id === resolved.nextNodeId);
    if (!next) {
      return {
        ok: false,
        result: failInstance(inst, `Gateway 目标节点「${resolved.nextNodeId}」不存在`),
      };
    }
    // gateway 自身不写 context；继续用同一 prevOutput 供后续 contains
    node = next;
  }
  return { ok: false, result: failInstance(inst, "Gateway 路由疑似成环，已终止") };
}

/**
 * 进入 task 节点：写 history、按需分配 sessionKey、组装 Prompt。
 * 调用前须已将 gateway 解析完毕。
 */
export function enterTaskNode(
  inst: WorkflowInstance,
  def: WorkflowDefinition,
  nextNode: WorkflowNode,
): EngineResult {
  inst.currentNodeId = nextNode.id;

  const exec: NodeExecution = {
    nodeId: nextNode.id,
    attempt: 1,
    status: "running",
    // 首节点无 context 时保留初始 input 形态，与历史 startWorkflow 对齐
    input:
      Object.keys(inst.context).length > 0
        ? { ...inst.context }
        : inst.input
          ? { raw: inst.input }
          : {},
    startedAt: Date.now(),
  };
  inst.nodeHistory.push(exec);

  if (nextNode.isolated) {
    const withKey = assignInstanceSessionKey(inst, nextNode.id);
    saveInstance(withKey);
    return {
      isolated: true,
      node: nextNode,
      prompt: buildNextNodePrompt(def, nextNode, withKey),
      message: "产物已提交，下一节点将由独立 Agent 处理",
    };
  }

  saveInstance(inst);
  return {
    prompt: buildNextNodePrompt(def, nextNode, inst),
    node: nextNode,
  };
}

/** 从候选节点起穿过 gateway 后进入 task（供 start / next 共用） */
export function enterFromNode(
  inst: WorkflowInstance,
  def: WorkflowDefinition,
  candidate: WorkflowNode,
  prevOutput = "",
): EngineResult {
  const resolved = resolveToTaskNode(inst, def, candidate, prevOutput);
  if (!resolved.ok) return resolved.result;
  return enterTaskNode(inst, def, resolved.node);
}

/** 处理 workflow_next：写产物并推进（遇 Gateway 自动路由，不 spawn） */
export function handleNext(instanceId: string, payload: WorkflowNextPayload): EngineResult {
  const inst = getInstance(instanceId);
  if (!inst || inst.status !== "running") return { failed: true, message: "工作流非运行状态" };

  const def = getDefinition(inst.workflowId);
  if (!def) return { failed: true, message: "工作流定义不存在" };

  const currentIdx = getNodeIndex(def, inst.currentNodeId!);
  if (currentIdx < 0) return { failed: true, message: "当前节点无效" };

  const currentNode = def.nodes[currentIdx];
  inst.context[currentNode.id] = payload.output;

  const lastExec = [...inst.nodeHistory].reverse().find(
    (h) => h.nodeId === currentNode.id && h.status === "running",
  );
  if (lastExec) {
    lastExec.status = "completed";
    lastExec.output = payload.output;
    lastExec.completedAt = Date.now();
  }

  inst.stepCount++;
  inst.updatedAt = Date.now();

  if (inst.stepCount >= inst.maxSteps) {
    return failInstance(inst, `全局步数达到上限 (${inst.maxSteps})，工作流已终止`);
  }

  const nextIdx = currentIdx + 1;
  if (nextIdx >= def.nodes.length) {
    inst.status = "completed";
    inst.currentNodeId = null;
    inst.completedAt = Date.now();
    saveInstance(inst);
    return { done: true, message: "工作流已完成" };
  }

  return enterFromNode(inst, def, def.nodes[nextIdx], payload.output);
}
