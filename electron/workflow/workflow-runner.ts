import { BrowserWindow } from "electron"
import { getEnabledChannels } from "../config/config-store"
import { makeChatKey } from "../../src/shared/channel-types"
import { getDefinition, getInstance } from "./workflow-file"
import { createInstance, resumeWorkflow, startWorkflow } from "../../src/workflow/workflow-engine"
import { launchWorkflowAgent, notifyWorkflowChat } from "../session/session-dispatcher"

/** workflow_resume 结构化日志（入口/出口各一条，便于 grep） */
function logWorkflowResume(instanceId: string, ok?: boolean): void {
  const entry: { instance_id: string; source: "electron"; ok?: boolean } = {
    instance_id: instanceId,
    source: "electron",
  }
  if (ok !== undefined) entry.ok = ok
  console.log(JSON.stringify({ workflow_resume: entry }))
}

export async function runWorkflowDefinition(
  workflowId: string,
  opts?: { input?: string; workingDirectory?: string; notifyChatId?: string },
): Promise<{ ok: boolean; error?: string; instanceId?: string }> {
  const def = getDefinition(workflowId)
  if (!def) {
    return { ok: false, error: "工作流不存在" }
  }

  const mainUserChannel = getEnabledChannels().find((c) => c.mainUserEnabled && c.mainUserChatId?.trim())
  const notifyChatId = opts?.notifyChatId?.trim()
    || (mainUserChannel ? makeChatKey(mainUserChannel.id, mainUserChannel.mainUserChatId.trim()) : undefined)
  const inst = createInstance(def, {
    input: opts?.input?.trim() || undefined,
    workingDirectory: opts?.workingDirectory || def.workingDirectory,
    notifyChatId,
  })

  const result = startWorkflow(inst.id)
  if (result.failed) {
    return { ok: false, error: result.message || "启动失败" }
  }

  const fresh = getInstance(inst.id)
  if (fresh) {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("workflow:instance-updated", fresh))
  }

  if (result.node && result.prompt && fresh) {
    const launchResult = await launchWorkflowAgent({
      instanceId: inst.id,
      nodeId: result.node.id,
      nodeName: result.node.name,
      prompt: result.prompt,
      workingDirectory: fresh.workingDirectory,
      notifyChatId: fresh.notifyChatId,
      model: result.node.model,
      sessionKey: fresh.sessionKey,
    })
    if (!launchResult.ok) {
      return { ok: false, error: launchResult.error || "Agent 启动失败" }
    }
  }

  if (notifyChatId && result.node?.name) {
    void notifyWorkflowChat(notifyChatId, `🚀 工作流「${def.name}」已启动，第一个节点: ${result.node.name}`)
  }

  return { ok: true, instanceId: inst.id }
}

/** Electron 恢复 SSOT：引擎 resume + Agent 启动 + UI 广播（UI / 斜杠共用） */
export async function resumeWorkflowInstance(
  instanceId: string,
): Promise<{ ok: boolean; error?: string; instanceId?: string }> {
  const id = instanceId.trim()
  logWorkflowResume(id)

  const result = resumeWorkflow(id)
  if (result.failed) {
    logWorkflowResume(id, false)
    return { ok: false, error: result.message }
  }

  const fresh = getInstance(id)
  if (fresh) {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("workflow:instance-updated", fresh))
  }

  if (result.node && result.prompt && fresh) {
    const launchResult = await launchWorkflowAgent({
      instanceId: id,
      nodeId: result.node.id,
      nodeName: result.node.name,
      prompt: result.prompt,
      workingDirectory: fresh.workingDirectory,
      notifyChatId: fresh.notifyChatId,
      model: result.node.model,
      sessionKey: fresh.sessionKey,
    })
    if (!launchResult.ok) {
      logWorkflowResume(id, false)
      return { ok: false, error: `Agent 启动失败: ${launchResult.error || "未知错误"}` }
    }
  }

  if (fresh?.notifyChatId && result.node?.name) {
    void notifyWorkflowChat(fresh.notifyChatId, `▶️ 工作流已恢复，继续节点: ${result.node.name}`)
  }

  logWorkflowResume(id, true)
  return { ok: true, instanceId: id }
}
