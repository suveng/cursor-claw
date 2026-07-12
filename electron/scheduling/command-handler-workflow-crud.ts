/**
 * /workflow create|update：解析 YAML/JSON 正文并落盘定义。
 * 与 MCP manage_workflows 共用 parseWorkflowDefinitionText。
 */
import { randomUUID } from "node:crypto";
import { getDefinition, saveDefinition } from "../workflow/workflow-file";
import { parseWorkflowDefinitionText } from "../../src/workflow/workflow-parse";
import { normalizeWorkflowDefinition } from "../../src/workflow/workflow-types";
import { reportCommandResult } from "./command-handler-shared";

/** 去掉「/workflow create|update …」命令头，保留多行 YAML/JSON 正文 */
export function extractWorkflowDefinitionBody(raw: string, sub: "create" | "update"): string {
  const trimmed = raw.trim();
  // 匹配 /workflow|/wf + create|update[+id] 后的余文
  const re =
    sub === "create"
      ? /^\/(?:workflow|wf)\s+create\s*/i
      : /^\/(?:workflow|wf)\s+update\s+\S+\s*/i;
  return trimmed.replace(re, "").trim();
}

/** 斜杠 create：正文 → 新定义 */
export async function handleWorkflowCreate(
  port: number,
  messageId: string,
  raw: string,
): Promise<void> {
  const body = extractWorkflowDefinitionBody(raw, "create");
  if (!body) {
    await reportCommandResult(
      port,
      messageId,
      false,
      "💡 用法：/workflow create\n<YAML 或 JSON 工作流定义>",
    );
    return;
  }
  try {
    const parsed = parseWorkflowDefinitionText(body);
    const now = Date.now();
    const def = normalizeWorkflowDefinition({
      ...parsed,
      id: parsed.id || randomUUID(),
      name: parsed.name || "未命名工作流",
      createdAt: now,
      updatedAt: now,
    });
    saveDefinition(def);
    await reportCommandResult(
      port,
      messageId,
      true,
      `✅ 工作流「${def.name}」已创建\nID: ${def.id}\n节点: ${def.nodes.map((n) => n.name).join(" → ")}`,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await reportCommandResult(
      port,
      messageId,
      false,
      `❌ 解析或保存失败（请提供 YAML 或 JSON）: ${msg}`,
    );
  }
}

/** 斜杠 update <id>：正文覆盖已有定义 */
export async function handleWorkflowUpdate(
  port: number,
  messageId: string,
  raw: string,
  idToken: string | undefined,
): Promise<void> {
  if (!idToken) {
    await reportCommandResult(
      port,
      messageId,
      false,
      "💡 用法：/workflow update <id>\n<YAML 或 JSON 工作流定义>",
    );
    return;
  }
  const existing = getDefinition(idToken);
  if (!existing) {
    await reportCommandResult(port, messageId, false, `❌ 工作流 "${idToken}" 不存在`);
    return;
  }
  const body = extractWorkflowDefinitionBody(raw, "update");
  if (!body) {
    await reportCommandResult(
      port,
      messageId,
      false,
      "💡 用法：/workflow update <id>\n<YAML 或 JSON 工作流定义>",
    );
    return;
  }
  try {
    const patch = parseWorkflowDefinitionText(body);
    const updated = normalizeWorkflowDefinition({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      nodes: patch.nodes?.length ? patch.nodes : existing.nodes,
    });
    saveDefinition(updated);
    await reportCommandResult(port, messageId, true, `✅ 工作流「${updated.name}」已更新`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await reportCommandResult(
      port,
      messageId,
      false,
      `❌ 解析或保存失败（请提供 YAML 或 JSON）: ${msg}`,
    );
  }
}
