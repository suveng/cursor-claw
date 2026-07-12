import { resolveChannelForSession } from "../config/config-store"
import { McpServerEntry, getMcpServerList, getMcpEnabledMap, getMcpStatusMap, toggleMcpServer, deleteMcpServer, saveMcpServer } from "../mcp/mcp-manager"
import { formatMcpHealthDisplayIm } from "../../src/shared/mcp-health-label"
import { reportCommandResult } from "./command-handler-shared"

const MCP_SUBCMD_HELP = [
  "📦 MCP 服务器管理",
  "",
  "  /mcp ls              列出所有 MCP 服务器",
  "  /mcp info <序号|名称>  查看详情",
  "  /mcp enable <序号|名称> 启用",
  "  /mcp disable <序号|名称> 禁用",
  "  /mcp delete <序号|名称> 删除",
  '  /mcp add <json>       添加（如 /mcp add {"name":"test","command":"npx","args":["-y","xxx"]}）',
].join("\n")

function resolveMcpTarget(list: McpServerEntry[], token: string): McpServerEntry | null {
  const idx = parseInt(token, 10)
  if (!isNaN(idx) && idx >= 1 && idx <= list.length) return list[idx - 1]
  return list.find((s) => s.name.toLowerCase() === token.toLowerCase()) ?? null
}

/** 飞书 /mcp 错误文案：不出现「需要 CLI」类表述 */
function formatMcpCommandError(raw?: string): string {
  const msg = (raw ?? "").trim()
  if (!msg || /CLI|agent.*未安装|请安装.*CLI|需要.*CLI/i.test(msg)) {
    return "请检查 mcp.json 配置，并确保通道已绑定 SDK 或 Claude Code 资源"
  }
  return msg
}

export async function handleFeishuMcpCommand(port: number, messageId: string, raw: string, chatId?: string): Promise<void> {
  const parts = raw.trim().split(/\s+/).filter((p) => p.length > 0)

  if (parts.length <= 1) { await reportCommandResult(port, messageId, true, MCP_SUBCMD_HELP); return }
  const sub = parts[1].toLowerCase()
  if (sub === "help" || sub === "-h") { await reportCommandResult(port, messageId, true, MCP_SUBCMD_HELP); return }

  if (sub === "ls" || sub === "list") {
    const list = getMcpServerList()
    const [enabledMap, statusMap] = await Promise.all([getMcpEnabledMap(), getMcpStatusMap()])
    if (list.length === 0) { await reportCommandResult(port, messageId, true, "📭 暂无 MCP 服务器\n\n💡 可在设置页 MCP Tab 或编辑 mcp.json 添加配置"); return }
    const lines = list.map((s, i) => {
      const flag = enabledMap[s.name] === false ? "🔴" : "🟢"
      const src = s.source === "global" ? "[G]" : "[P]"
      const detail = s.type === "url" ? s.url : s.command
      const health = enabledMap[s.name] === false ? "disabled" : (statusMap[s.name] ?? "")
      return `  ${i + 1}. ${flag} ${src} ${s.name}  (${detail})  ${formatMcpHealthDisplayIm(health)}`
    })
    await reportCommandResult(port, messageId, true, `📦 MCP 服务器列表：\n${lines.join("\n")}`)
    return
  }

  if (sub === "info") {
    const list = getMcpServerList()
    const token = parts[2]
    if (!token) { await reportCommandResult(port, messageId, false, "用法: /mcp info <序号|名称>"); return }
    const target = resolveMcpTarget(list, token)
    if (!target) { await reportCommandResult(port, messageId, false, `❌ 找不到: ${token}`); return }
    const [enabledMap, statusMap] = await Promise.all([getMcpEnabledMap(), getMcpStatusMap()])
    const lines = [
      `📦 ${target.name}`,
      `  类型: ${target.type}`,
      `  来源: ${target.source}`,
      `  开关: ${enabledMap[target.name] === false ? "🔴 已禁用" : "🟢 已启用"}`,
      `  健康: ${formatMcpHealthDisplayIm(enabledMap[target.name] === false ? "disabled" : statusMap[target.name])}`,
    ]
    if (target.type === "url") lines.push(`  URL: ${target.url}`)
    else lines.push(`  命令: ${target.command} ${(target.args ?? []).join(" ")}`)
    if (target.env && Object.keys(target.env).length > 0) {
      lines.push(`  环境变量: ${Object.keys(target.env).join(", ")}`)
    }
    await reportCommandResult(port, messageId, true, lines.join("\n"))
    return
  }

  if (sub === "enable" || sub === "disable") {
    const list = getMcpServerList()
    const token = parts[2]
    if (!token) { await reportCommandResult(port, messageId, false, `用法: /mcp ${sub} <序号|名称>`); return }
    const target = resolveMcpTarget(list, token)
    if (!target) { await reportCommandResult(port, messageId, false, `❌ 找不到: ${token}`); return }
    const enabled = sub === "enable"
    const result = await toggleMcpServer(target.name, enabled)
    await reportCommandResult(port, messageId, result.ok,
      result.ok ? `✅ ${target.name} 已${enabled ? "启用" : "禁用"}` : `❌ ${formatMcpCommandError(result.output)}`)
    return
  }

  if (sub === "delete" || sub === "rm") {
    const list = getMcpServerList()
    const token = parts[2]
    if (!token) { await reportCommandResult(port, messageId, false, "用法: /mcp delete <序号|名称>"); return }
    const target = resolveMcpTarget(list, token)
    if (!target) { await reportCommandResult(port, messageId, false, `❌ 找不到: ${token}`); return }
    deleteMcpServer(target.name, target.source as "global" | "project")
    await reportCommandResult(port, messageId, true, `🗑️ ${target.name} 已删除`)
    return
  }

  if (sub === "add") {
    const jsonStr = raw.replace(/^\/mcp\s+add\s*/i, "").trim()
    if (!jsonStr) {
      await reportCommandResult(port, messageId, false, '用法: /mcp add {"name":"xxx","command":"npx","args":[...]}')
      return
    }
    try {
      const parsed = JSON.parse(jsonStr)
      const name = parsed.name as string
      if (!name) { await reportCommandResult(port, messageId, false, "❌ 缺少 name 字段"); return }
      const { name: _, ...entry } = parsed
      saveMcpServer(name, entry, "project")
      await reportCommandResult(port, messageId, true, `✅ ${name} 已添加`)
    } catch (e: unknown) {
      await reportCommandResult(port, messageId, false, `❌ JSON 解析失败: ${e instanceof Error ? e.message : e}`)
    }
    return
  }

  await reportCommandResult(port, messageId, false, `😅 未知子命令: ${sub}\n\n${MCP_SUBCMD_HELP}`)
}

// ── Workflow 命令 ────────────────────────────────────────────
