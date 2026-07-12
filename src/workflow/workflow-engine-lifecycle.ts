import type {
  WorkflowDefinition,
  WorkflowInstance,
} from "./workflow-types.js";
import {
  getDefinition,
  getInstance,
  saveInstance,
  listInstances,
} from "./workflow-store.js";
import { assignInstanceSessionKey } from "./workflow-session-key.js";
import { randomUUID } from "node:crypto";
import { buildStartPrompt } from "./workflow-engine-prompt.js";
import { enterFromNode, type EngineResult } from "./workflow-engine-advance.js";

/** 创建 pending 实例并落盘 */
export function createInstance(
  def: WorkflowDefinition,
  opts: {
    input?: string;
    workingDirectory?: string;
    notifyChatId?: string;
    sessionKey?: string;
    maxSteps?: number;
  },
): WorkflowInstance {
  const now = Date.now();
  const inst: WorkflowInstance = {
    id: randomUUID(),
    workflowId: def.id,
    status: "pending",
    currentNodeId: null,
    context: {},
    nodeHistory: [],
    sessionKey: opts.sessionKey,
    notifyChatId: opts.notifyChatId,
    workingDirectory: opts.workingDirectory || def.workingDirectory || process.cwd(),
    input: opts.input,
    maxSteps: opts.maxSteps ?? 50,
    stepCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  saveInstance(inst);
  return inst;
}

/**
 * 是否执行陈旧 running→paused。
 * 显式参数优先；否则读 WORKFLOW_AUTO_PAUSE_STALE；缺省 true。
 */
function isAutoPauseEnabled(override?: boolean): boolean {
  if (override !== undefined) return override;
  const env = process.env.WORKFLOW_AUTO_PAUSE_STALE;
  if (env === "0" || env?.toLowerCase() === "false") return false;
  if (env === "1" || env?.toLowerCase() === "true") return true;
  return true;
}

/** 启动工作流；首节点若为 Gateway 则自动路由至 task（不 spawn Gateway） */
export function startWorkflow(instanceId: string): EngineResult {
  const inst = getInstance(instanceId);
  if (!inst) return { failed: true, message: "实例不存在" };

  const def = getDefinition(inst.workflowId);
  if (!def || def.nodes.length === 0) {
    return { failed: true, message: "工作流定义无效或无节点" };
  }

  inst.status = "running";
  inst.updatedAt = Date.now();

  // 经 Gateway 解析到真正的 task 节点再组装 Prompt
  return enterFromNode(inst, def, def.nodes[0], inst.input ?? "");
}

/**
 * 崩溃恢复：将 running 实例标记为 paused。
 * @param autoPause 为 false 时跳过且不改写；省略则读环境变量/默认 true
 */
export function recoverStaleInstances(autoPause?: boolean): WorkflowInstance[] {
  if (!isAutoPauseEnabled(autoPause)) return [];

  const recovered: WorkflowInstance[] = [];
  for (const inst of listInstances()) {
    if (inst.status === "running") {
      inst.status = "paused";
      inst.updatedAt = Date.now();
      saveInstance(inst);
      recovered.push(inst);
    }
  }
  return recovered;
}

/** 恢复暂停的工作流 */
export function resumeWorkflow(instanceId: string): EngineResult {
  const inst = getInstance(instanceId);
  if (!inst) return { failed: true, message: "实例不存在" };
  if (inst.status !== "paused") return { failed: true, message: "工作流非暂停状态" };

  const def = getDefinition(inst.workflowId);
  if (!def) return { failed: true, message: "工作流定义不存在" };
  if (!inst.currentNodeId) return { failed: true, message: "无当前节点" };

  const node = def.nodes.find((n) => n.id === inst.currentNodeId);
  if (!node) return { failed: true, message: "当前节点定义不存在" };

  inst.status = "running";
  inst.updatedAt = Date.now();

  let toSave = inst;
  if (node.isolated) {
    toSave = assignInstanceSessionKey(inst, node.id);
  }
  saveInstance(toSave);

  return {
    prompt: buildStartPrompt(def, node, toSave),
    node,
    isolated: node.isolated ?? false,
  };
}
