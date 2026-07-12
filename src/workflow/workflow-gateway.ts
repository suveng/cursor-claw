/**
 * Gateway 极简条件路由：不 spawn Agent，按 routes[].when 选下一节点。
 */
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowNode,
} from "./workflow-types.js";

export interface GatewayResolveResult {
  ok: boolean;
  nextNodeId?: string;
  message?: string;
}

/** 将 context / output 值规范为字符串，便于 contains 判断 */
function asText(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * 求值单条 when：
 * - always / true
 * - contains <子串>（对上一节点 output）
 * - context.<nodeId> contains <子串>
 */
function matchWhen(
  when: string,
  prevOutput: string,
  instance: WorkflowInstance,
): boolean {
  const w = when.trim();
  if (w === "always" || w === "true") return true;

  const ctxMatch = /^context\.(\S+)\s+contains\s+(.+)$/s.exec(w);
  if (ctxMatch) {
    const hay = asText(instance.context[ctxMatch[1]]);
    return hay.includes(ctxMatch[2]);
  }

  const containsMatch = /^contains\s+(.+)$/s.exec(w);
  if (containsMatch) {
    return prevOutput.includes(containsMatch[1]);
  }

  return false;
}

/**
 * 对 gateway 节点求值：首条命中 routes；否则 defaultNext；皆无则失败。
 * @param prevOutput 上一 task 节点刚写入的 output（无则空串）
 */
export function resolveGatewayNext(
  def: WorkflowDefinition,
  instance: WorkflowInstance,
  gatewayNode: WorkflowNode,
  prevOutput = "",
): GatewayResolveResult {
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const routes = gatewayNode.routes ?? [];

  for (const route of routes) {
    if (!matchWhen(route.when, prevOutput, instance)) continue;
    if (!nodeIds.has(route.next)) {
      return {
        ok: false,
        message: `Gateway「${gatewayNode.name}」路由 next「${route.next}」不存在`,
      };
    }
    return { ok: true, nextNodeId: route.next };
  }

  if (gatewayNode.defaultNext) {
    if (!nodeIds.has(gatewayNode.defaultNext)) {
      return {
        ok: false,
        message: `Gateway「${gatewayNode.name}」defaultNext「${gatewayNode.defaultNext}」不存在`,
      };
    }
    return { ok: true, nextNodeId: gatewayNode.defaultNext };
  }

  return {
    ok: false,
    message: `Gateway「${gatewayNode.name}」无命中路由且未配置 defaultNext`,
  };
}
