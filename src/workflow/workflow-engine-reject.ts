import type {
  WorkflowDefinition,
  WorkflowRejectPayload,
  NodeExecution,
  WorkflowNode,
} from "./workflow-types.js";
import { getDefinition, getInstance, saveInstance } from "./workflow-store.js";
import { assignInstanceSessionKey } from "./workflow-session-key.js";
import { buildRetryPrompt } from "./workflow-engine-prompt.js";
import { getNodeIndex, type EngineResult } from "./workflow-engine-advance.js";
import type { WorkflowInstance } from "./workflow-types.js";

/** 统计某节点因驳回产生的重跑次数 */
function getNodeRetryCount(instance: WorkflowInstance, nodeId: string): number {
  return instance.nodeHistory.filter(
    (h) => h.nodeId === nodeId && h.rejectFromNodeId,
  ).length;
}

/** 节点是否为 Gateway（不 spawn Agent） */
function isGateway(node: WorkflowNode): boolean {
  return (node.kind ?? "task") === "gateway";
}

/**
 * 解析驳回回退目标：禁止落在 gateway 上再组装 Prompt / spawn。
 * - 显式指定 gateway → 可读失败
 * - 默认上一节点为 gateway → 继续向前回退到最近 task
 */
function resolveRejectTarget(
  def: WorkflowDefinition,
  currentIdx: number,
  targetNodeId: string | undefined,
): { ok: true; node: WorkflowNode } | { ok: false; message: string } {
  let targetIdx: number;
  if (targetNodeId) {
    targetIdx = getNodeIndex(def, targetNodeId);
    if (targetIdx < 0 || targetIdx >= currentIdx) {
      return {
        ok: false,
        message: `回退目标节点 "${targetNodeId}" 无效（必须在当前节点之前）`,
      };
    }
    const explicit = def.nodes[targetIdx];
    // 显式指定 Gateway：不可作为重跑落点（R7）
    if (isGateway(explicit)) {
      return {
        ok: false,
        message: `回退目标「${explicit.name}」是 Gateway 节点，不能作为驳回重跑目标；请指定具体任务节点`,
      };
    }
    return { ok: true, node: explicit };
  }

  targetIdx = currentIdx - 1;
  if (targetIdx < 0) {
    return { ok: false, message: "已是第一个节点，无法回退" };
  }

  // 默认回退：跳过连续 Gateway，落在最近 task
  while (targetIdx >= 0 && isGateway(def.nodes[targetIdx])) {
    targetIdx--;
  }
  if (targetIdx < 0) {
    return {
      ok: false,
      message: "回退路径上仅有 Gateway 节点，无法驳回重跑（Gateway 不启动 Agent）",
    };
  }
  return { ok: true, node: def.nodes[targetIdx] };
}

/** 处理 workflow_reject：回退到 task 并组装重跑 Prompt（禁止对 gateway spawn） */
export function handleReject(instanceId: string, payload: WorkflowRejectPayload): EngineResult {
  const inst = getInstance(instanceId);
  if (!inst || inst.status !== "running") return { failed: true, message: "工作流非运行状态" };

  const def = getDefinition(inst.workflowId);
  if (!def) return { failed: true, message: "工作流定义不存在" };

  const currentIdx = getNodeIndex(def, inst.currentNodeId!);
  if (currentIdx < 0) return { failed: true, message: "当前节点无效" };

  const currentNode = def.nodes[currentIdx];

  const resolved = resolveRejectTarget(def, currentIdx, payload.targetNodeId);
  if (!resolved.ok) return { failed: true, message: resolved.message };
  const targetNode = resolved.node;

  const lastExec = [...inst.nodeHistory].reverse().find(
    (h) => h.nodeId === currentNode.id && h.status === "running",
  );
  if (lastExec) {
    lastExec.status = "rejected";
    lastExec.rejectReason = payload.reason;
    lastExec.completedAt = Date.now();
  }

  const retryCount = getNodeRetryCount(inst, targetNode.id);
  const maxRetries = targetNode.maxRetries ?? 2;
  if (retryCount >= maxRetries) {
    inst.status = "failed";
    inst.updatedAt = Date.now();
    saveInstance(inst);
    return {
      failed: true,
      message: `节点「${targetNode.name}」已达最大重试次数 (${maxRetries})，工作流终止`,
    };
  }

  inst.stepCount++;
  inst.updatedAt = Date.now();

  if (inst.stepCount >= inst.maxSteps) {
    inst.status = "failed";
    saveInstance(inst);
    return { failed: true, message: `全局步数达到上限 (${inst.maxSteps})，工作流已终止` };
  }

  inst.currentNodeId = targetNode.id;

  const exec: NodeExecution = {
    nodeId: targetNode.id,
    attempt: retryCount + 2,
    status: "running",
    input: { ...inst.context },
    rejectReason: payload.reason,
    rejectFromNodeId: currentNode.id,
    startedAt: Date.now(),
  };
  inst.nodeHistory.push(exec);

  // 此处 target 已保证为 task，不会对 gateway buildRetryPrompt / spawn
  const prompt = buildRetryPrompt(
    def,
    targetNode,
    inst,
    retryCount + 2,
    currentNode.name,
    payload.reason,
  );

  if (targetNode.isolated) {
    const withKey = assignInstanceSessionKey(inst, targetNode.id);
    saveInstance(withKey);
    return {
      isolated: true,
      node: targetNode,
      prompt,
      message: `节点「${targetNode.name}」驳回重跑（独立 Agent）`,
    };
  }

  saveInstance(inst);
  return { prompt, node: targetNode };
}
