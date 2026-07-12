import {
  getEnabledChannels, getAgentResource, updateChannel,
  resolveChannelForSession, type MessageChannel,
} from "../config/config-store"
import { listSdkModels } from "../agent/cursor-sdk/agent-sdk"
import { CLAUDE_CODE_MODEL_LIST } from "../agent/claude-code/agent-cc-types"
import { reportCommandResult, type ListedModel } from "./command-handler-shared"

const MODEL_SUBCMD_HELP =
  "💡 /model 子命令\n" +
  "🔹 /model ls — 列出可用模型与序号\n" +
  "🔹 /model info — 查看当前应用配置的模型\n" +
  "🔹 /model set <序号> — 按 /model ls 的 # 设置模型（写入配置，下次启动 Agent 生效）"

/** 飞书 /model 指令：仅 SDK / Claude Code 通道可列出模型 */
async function listCursorModelsForCommands(channel?: MessageChannel): Promise<{ ok: true; models: ListedModel[] } | { ok: false; error: string }> {
  const resource = getAgentResource(channel?.agentResourceId)
  if (!resource) {
    return { ok: false, error: "请先在设置中配置 SDK 或 Claude Code Agent 资源并绑定到通道" }
  }
  if (resource.type === "sdk") {
    const r = await listSdkModels(resource.apiKey ?? "", channel?.model, channel?.modelParams)
    if (!r.ok) return { ok: false, error: r.error || "SDK 获取模型列表失败" }
    return { ok: true, models: r.models }
  }
  if (resource.type === "claude-code") {
    const currentModel = channel?.model?.trim() || ""
    const models: ListedModel[] = CLAUDE_CODE_MODEL_LIST.map((m) => ({
      id: m.id,
      label: m.label,
      current: m.id === currentModel,
    }))
    return { ok: true, models }
  }
  return { ok: false, error: "请绑定 SDK 或 Claude Code Agent 资源" }
}

export async function handleFeishuModelCommand(port: number, messageId: string, raw: string, chatId?: string): Promise<void> {
  const parts = raw.trim().split(/\s+/).filter((p) => p.length > 0)
  const low = (s: string) => s.toLowerCase()

  const channel = chatId ? resolveChannelForSession(chatId) : getEnabledChannels()[0]
  if (!channel) {
    await reportCommandResult(port, messageId, false, "❌ 未找到当前会话所属的消息通道")
    return
  }

  if (parts.length <= 1) {
    await reportCommandResult(port, messageId, true, MODEL_SUBCMD_HELP)
    return
  }

  const sub = low(parts[1])
  if (sub === "help" || sub === "-h" || sub === "--help") {
    await reportCommandResult(port, messageId, true, MODEL_SUBCMD_HELP)
    return
  }

  if (sub === "info") {
    const cfgModel = channel.model?.trim() || "auto"
    const lines: string[] = [`📝 通道「${channel.name}」主模型: ${cfgModel}`]
    if (cfgModel === "auto") {
      lines.push("（auto：使用通道默认模型策略）")
    }
    const lr = await listCursorModelsForCommands(channel)
    if (lr.ok) {
      const hit = lr.models.findIndex((m) => m.id === cfgModel)
      if (hit >= 0) {
        lines.push(`对应列表序号: #${hit + 1}`)
        lines.push(`   ${lr.models[hit].id} — ${lr.models[hit].label}`)
      } else if (cfgModel !== "auto") {
        lines.push("（当前配置 id 不在本次列表中，若刚换模型列表可再执行 /model ls）")
      }
      const markedCurrent = lr.models.filter((m) => m.current)
      if (markedCurrent.length > 0) {
        lines.push(`标注 (current): ${markedCurrent.map((m) => m.id).join(", ")}`)
      }
    } else {
      lines.push(`⚠️ 无法拉取模型列表: ${lr.error}`)
    }
    await reportCommandResult(port, messageId, true, lines.join("\n"))
    return
  }

  if (sub === "ls") {
    const lr = await listCursorModelsForCommands(channel)
    if (!lr.ok) {
      await reportCommandResult(port, messageId, false, `❌ ${lr.error}`)
      return
    }
    const blocks = lr.models.map((m, i) => {
      const n = i + 1
      const tag = m.current ? "  ⭐current" : ""
      return [`#${n}`, `\t id · ${m.id}`, `\t说明 · ${m.label}${tag}`].join("\n")
    })
    const body = [`🧠 模型列表（共 ${lr.models.length} 个）`, "", ...blocks, "", "💡 设置：/model set <序号>"].join("\n")
    await reportCommandResult(port, messageId, true, body)
    return
  }

  if (sub === "set") {
    const lr = await listCursorModelsForCommands(channel)
    if (!lr.ok) {
      await reportCommandResult(port, messageId, false, `❌ ${lr.error}`)
      return
    }
    if (parts.length < 3) {
      await reportCommandResult(port, messageId, false, "💡 用法：/model set <序号>（数字见 /model ls 的 #）")
      return
    }
    const idx = parseInt(parts[2], 10)
    if (!Number.isInteger(idx) || idx < 1 || idx > lr.models.length) {
      await reportCommandResult(port, messageId, false, `😅 序号须为 1～${lr.models.length} 之间的整数（先 /model ls）`)
      return
    }
    const picked = lr.models[idx - 1]
    updateChannel(channel.id, { model: picked.id, modelParams: picked.params ?? "" })
    await reportCommandResult(port, messageId, true, [
      `✅ 已保存通道「${channel.name}」主模型（下次启动 Agent 生效）`,
      ` # · ${idx}`,
      ` id · ${picked.id}`,
      `说明 · ${picked.label}`,
      "",
      "若 Agent 正在运行，可 /stop 后由新消息再拉起以使用新模型。",
    ].join("\n"))
    return
  }

  await reportCommandResult(port, messageId, false, `😅 未知子命令: ${parts[1]}\n\n${MODEL_SUBCMD_HELP}`)
}

// ── Task 命令 ──────────────────────────────────────────────
