import type { WorkflowInstance } from "./workflow-types.js";

/**
 * 工作流 isolated 节点 sessionKey 格式 SSOT
 * 与 electron/session/session-dispatcher-launch.ts launchWorkflowAgent 对齐
 */
export function buildWorkflowSessionKey(
  notifyChatId: string | undefined,
  instanceId: string,
  nodeId: string,
): string {
  return `${notifyChatId || "wf"}::wf_${instanceId}_${nodeId}`;
}

/** 为实例写入当前节点的 sessionKey 并返回新对象 */
export function assignInstanceSessionKey(
  inst: WorkflowInstance,
  nodeId: string,
): WorkflowInstance {
  return {
    ...inst,
    sessionKey: buildWorkflowSessionKey(inst.notifyChatId, inst.id, nodeId),
  };
}
