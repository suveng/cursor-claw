import { resolveChannelForSession } from "../config/config-store"
import { deleteDefinition, getDefinition, getInstance, listDefinitions, listInstances } from "../workflow/workflow-file"
import { resumeWorkflowInstance, runWorkflowDefinition } from "../workflow/workflow-runner"
import type { WorkflowDefinition } from "../../src/workflow/workflow-types"
import { reportCommandResult } from "./command-handler-shared"

const WORKFLOW_SUBCMD_HELP =
  "💡 /workflow 子命令\n" +
  "🔹 /workflow ls — 列出工作流定义\n" +
  "🔹 /workflow info <序号|ID> — 查看定义详情\n" +
  "🔹 /workflow run <序号|ID> [初始输入] — 启动工作流\n" +
  "🔹 /workflow resume <实例ID|序号> — 恢复暂停的工作流\n" +
  "🔹 /workflow status [实例ID] — 查看实例状态\n" +
  "🔹 /workflow delete <序号|ID> — 删除工作流定义"

function resolveWorkflowDef(defs: WorkflowDefinition[], token: string | undefined): WorkflowDefinition | null {
  if (!token) return null
  const idx = parseTaskOneBasedIndex(token)
  if (idx !== null && idx >= 1 && idx <= defs.length) return defs[idx - 1]
  return defs.find((d) => d.id === token) ?? null
}

export async function handleFeishuWorkflowCommand(
  port: number,
  messageId: string,
  raw: string,
  chatId?: string,
): Promise<void> {
  const parts = raw.trim().split(/\s+/).filter((p) => p.length > 0)
  const low = (s: string) => s.toLowerCase()

  if (parts.length <= 1) {
    await reportCommandResult(port, messageId, true, WORKFLOW_SUBCMD_HELP)
    return
  }

  const sub = low(parts[1])
  if (sub === "help" || sub === "-h" || sub === "--help") {
    await reportCommandResult(port, messageId, true, WORKFLOW_SUBCMD_HELP)
    return
  }

  const defs = listDefinitions()

  if (sub === "ls" || sub === "list") {
    if (defs.length === 0) {
      await reportCommandResult(port, messageId, true, "📭 当前还没有工作流定义～")
      return
    }
    const lines = defs.map((d, i) => `#${i + 1}\t📋 ${d.name} · ${d.nodes.length} 节点 · ID: ${d.id}`)
    await reportCommandResult(port, messageId, true, `🔀 工作流一览（共 ${defs.length} 条）\n\n${lines.join("\n")}\n\n✨ 详情：/workflow info <序号>`)
    return
  }

  if (sub === "info" || sub === "get") {
    const target = resolveWorkflowDef(defs, parts[2])
    if (!target) {
      await reportCommandResult(port, messageId, false, "💡 用法：/workflow info <序号|ID>")
      return
    }
    const idx = defs.findIndex((d) => d.id === target.id) + 1
    const nodeLines = target.nodes.map((n, i) => `   ${i + 1}. ${n.name} (${n.id})`).join("\n")
    const body = [
      `📋 工作流详情 #${idx}`,
      `📝 名称 · ${target.name}`,
      target.description ? `📄 描述 · ${target.description}` : "",
      `📁 目录 · ${target.workingDirectory || "(默认工作目录)"}`,
      `🔗 ID · ${target.id}`,
      `🧩 节点 (${target.nodes.length})`,
      nodeLines,
    ].filter(Boolean).join("\n")
    await reportCommandResult(port, messageId, true, body)
    return
  }

  if (sub === "run") {
    const target = resolveWorkflowDef(defs, parts[2])
    if (!target) {
      await reportCommandResult(port, messageId, false, "💡 用法：/workflow run <序号|ID> [初始输入]")
      return
    }
    const input = parts.slice(3).join(" ").trim() || undefined
    const result = await runWorkflowDefinition(target.id, { input, notifyChatId: chatId })
    if (!result.ok) {
      await reportCommandResult(port, messageId, false, `❌ 启动失败: ${result.error}`)
      return
    }
    await reportCommandResult(
      port,
      messageId,
      true,
      `🚀 工作流「${target.name}」已启动\n实例 ID: ${result.instanceId}${input ? `\n初始输入: ${input}` : ""}`,
      chatId,
    )
    return
  }

  if (sub === "resume") {
    const token = parts[2]
    if (!token) {
      await reportCommandResult(port, messageId, false, "💡 用法：/workflow resume <实例ID|序号>")
      return
    }
    const instances = listInstances().sort((a, b) => b.updatedAt - a.updatedAt)
    const idx = parseTaskOneBasedIndex(token)
    const inst = instances.find((i) => i.id === token)
      ?? (idx !== null && idx >= 1 && idx <= instances.length ? instances[idx - 1] : undefined)
    if (!inst) {
      await reportCommandResult(port, messageId, false, "❌ 实例不存在")
      return
    }
    // 斜杠入口结构化日志（与 workflow-runner 的 electron 源区分）
    console.log(JSON.stringify({ workflow_resume: { instance_id: inst.id, source: "slash" } }))
    const result = await resumeWorkflowInstance(inst.id)
    console.log(JSON.stringify({ workflow_resume: { instance_id: inst.id, source: "slash", ok: result.ok } }))
    if (!result.ok) {
      await reportCommandResult(port, messageId, false, `❌ ${result.error}`)
      return
    }
    const fresh = getInstance(inst.id)
    const def = fresh ? getDefinition(fresh.workflowId) : undefined
    const nodeName = def?.nodes.find((n) => n.id === fresh?.currentNodeId)?.name
      || fresh?.currentNodeId
      || "(无)"
    await reportCommandResult(
      port,
      messageId,
      true,
      `✅ 工作流已恢复，继续节点: ${nodeName}\n实例 ID: ${inst.id}`,
      chatId,
    )
    return
  }

  if (sub === "status") {
    const instances = listInstances().sort((a, b) => b.updatedAt - a.updatedAt)
    const token = parts[2]
    if (token) {
      const idx = parseTaskOneBasedIndex(token)
      const inst = instances.find((i) => i.id === token)
        ?? (idx !== null && idx >= 1 && idx <= instances.length ? instances[idx - 1] : undefined)
      if (!inst) {
        await reportCommandResult(port, messageId, false, "❌ 找不到该实例")
        return
      }
      const def = getDefinition(inst.workflowId)
      const body = [
        `📊 实例状态`,
        `📋 工作流 · ${def?.name || inst.workflowId}`,
        `💠 状态 · ${inst.status}`,
        `🔗 ID · ${inst.id}`,
        `📍 当前节点 · ${inst.currentNodeId || "(无)"}`,
        `📈 步数 · ${inst.stepCount}/${inst.maxSteps}`,
        inst.input ? `✉️ 输入 · ${inst.input}` : "",
      ].filter(Boolean).join("\n")
      await reportCommandResult(port, messageId, true, body)
      return
    }
    if (instances.length === 0) {
      await reportCommandResult(port, messageId, true, "📭 暂无工作流实例")
      return
    }
    const lines = instances.slice(0, 10).map((inst, i) => {
      const def = getDefinition(inst.workflowId)
      return `#${i + 1}\t${def?.name || inst.workflowId} · ${inst.status} · ${inst.id.slice(0, 8)}…`
    })
    await reportCommandResult(port, messageId, true, `📊 工作流实例（最近 ${lines.length} 条）\n\n${lines.join("\n")}\n\n✨ 详情：/workflow status <实例ID>`)
    return
  }

  if (sub === "delete" || sub === "del") {
    const target = resolveWorkflowDef(defs, parts[2])
    if (!target) {
      await reportCommandResult(port, messageId, false, "💡 用法：/workflow delete <序号|ID>")
      return
    }
    if (!deleteDefinition(target.id)) {
      await reportCommandResult(port, messageId, false, "❌ 删除失败")
      return
    }
    await reportCommandResult(port, messageId, true, `✅ 工作流「${target.name}」已删除`)
    return
  }

  await reportCommandResult(port, messageId, false, `😅 未知子命令: ${sub}\n\n${WORKFLOW_SUBCMD_HELP}`)
}
