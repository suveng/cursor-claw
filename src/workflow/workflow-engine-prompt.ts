import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowNode,
} from "./workflow-types.js";
import { readTemplate, renderTemplate } from "./template-utils.js";

/** 节点列表简报，供 Prompt 模板 NODES_BRIEF */
function buildNodesBrief(nodes: WorkflowNode[]): string {
  return nodes.map((n, i) => `${i + 1}. [${n.id}] ${n.name}`).join("\n");
}

/** 将实例 context 拼成可读前序产物块 */
function assembleContext(instance: WorkflowInstance): string {
  const entries = Object.entries(instance.context);
  if (entries.length === 0) return "(无前序产物)";
  return entries
    .map(([k, v]) => `**${k}**: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n\n");
}

/**
 * 简单条件块解析：仅布尔字典，保留 {{#if key}}…{{/if}}
 */
function parseConditionals(template: string, conditionals: Record<string, boolean>): string {
  return template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, content) => (conditionals[key] ? content : ""),
  );
}

/**
 * 将 `{{config.key}}` 替换为定义 config 值；缺失键→空串并 WARN。
 * 不改动既有 `{{WORD}}` 的 renderTemplate 行为。
 */
export function applyConfigPlaceholders(
  text: string,
  config?: Record<string, string>,
): string {
  return text.replace(/\{\{config\.(\w+)\}\}/g, (_, key: string) => {
    if (config && Object.prototype.hasOwnProperty.call(config, key)) {
      return config[key] ?? "";
    }
    console.warn(`[workflow] config 占位符缺失: {{config.${key}}} → 空串`);
    return "";
  });
}

/** 取节点上次产出：优先 context，其次 nodeHistory 最近 completed */
function resolveLastNodeOutput(instance: WorkflowInstance, nodeId: string): string {
  const fromCtx = instance.context[nodeId];
  if (typeof fromCtx === "string" && fromCtx.length > 0) return fromCtx;
  if (fromCtx != null && typeof fromCtx !== "string") {
    return JSON.stringify(fromCtx);
  }
  const last = [...instance.nodeHistory]
    .reverse()
    .find((h) => h.nodeId === nodeId && h.status === "completed" && h.output != null);
  if (!last?.output) return "(无)";
  return typeof last.output === "string" ? last.output : JSON.stringify(last.output);
}

/** 组装节点 Prompt（启动 / 推进 / 驳回共用） */
function buildNodePrompt(
  def: WorkflowDefinition,
  node: WorkflowNode,
  instance: WorkflowInstance,
  opts: {
    attempt?: number;
    rejectFromNodeName?: string;
    reason?: string;
    useInitialInput?: boolean;
  } = {},
): string {
  const isRetry = Boolean(opts.rejectFromNodeName);
  const hasConfig = Boolean(def.config && Object.keys(def.config).length > 0);

  const attemptSuffix =
    opts.attempt && opts.attempt > 1 ? `（第 ${opts.attempt} 次执行）` : "";

  const conditionals: Record<string, boolean> = { isRetry, hasConfig };

  // 先对节点 prompt 做 config 二次替换，再写入模板
  const nodePrompt = applyConfigPlaceholders(node.prompt, def.config);

  const stringData: Record<string, string> = {
    WORKFLOW_NAME: def.name,
    INSTANCE_ID: instance.id,
    NODE_NAME: node.name,
    ATTEMPT_SUFFIX: attemptSuffix,
    REJECT_FROM_NODE_NAME: opts.rejectFromNodeName ?? "",
    REASON: opts.reason ?? "无说明",
    NODE_PROMPT: nodePrompt,
    LAST_NODE_OUTPUT: isRetry ? resolveLastNodeOutput(instance, node.id) : "",
    INPUT:
      opts.useInitialInput && instance.input
        ? instance.input
        : assembleContext(instance),
    CONFIG_VARS: hasConfig
      ? Object.entries(def.config!)
          .map(([k, v]) => `- **${k}**: ${v}`)
          .join("\n")
      : "",
    NODES_BRIEF: buildNodesBrief(def.nodes),
  };

  const rawTemplate = readTemplate("workflow/node-prompt.md");
  const templateWithParsedLogic = parseConditionals(rawTemplate, conditionals);
  return renderTemplate(templateWithParsedLogic, stringData);
}

/** 首节点 / 恢复：优先使用初始 input */
export function buildStartPrompt(
  def: WorkflowDefinition,
  node: WorkflowNode,
  instance: WorkflowInstance,
): string {
  return buildNodePrompt(def, node, instance, { useInitialInput: true });
}

/** 驳回重跑 Prompt（含上次本节点产出） */
export function buildRetryPrompt(
  def: WorkflowDefinition,
  node: WorkflowNode,
  instance: WorkflowInstance,
  attempt: number,
  rejectFromNodeName: string,
  reason: string,
): string {
  return buildNodePrompt(def, node, instance, {
    attempt,
    rejectFromNodeName,
    reason,
  });
}

/** 推进到下一节点时的 Prompt */
export function buildNextNodePrompt(
  def: WorkflowDefinition,
  node: WorkflowNode,
  instance: WorkflowInstance,
): string {
  return buildStartPrompt(def, node, instance);
}
