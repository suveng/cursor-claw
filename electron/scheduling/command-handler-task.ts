import { randomUUID } from "node:crypto"
import {
  getEnabledChannels, resolveChannelForSession, type ScheduledTask,
} from "../config/config-store"
import { validateCron, readTasksFromFile, writeTasksToFile, previewCronNextRuns, getNextCronFireLabel } from "./cron-scheduler"
import { reportCommandResult } from "./command-handler-shared"

const TASK_SUBCMD_HELP =
  "💡 可用指令\n" +
  "🔹 /task 显示本说明\n" +
  "🔹 /task ls 列出所有任务\n" +
  "🔹 /task info <序号> 查看详情\n" +
  "🔹 /task run <序号> 立即触发一次\n" +
  "🔹 /task stop <序号> 停止任务\n" +
  "🔹 /task start <序号> 启动任务\n" +
  "🔹 /task delete <序号> 删除任务\n" +
  "🔹 /task create <名称> <cron> <内容> 创建任务\n" +
  "🔹 /task update <序号> [-name 值] [-cron 值] [-content 值] 更新任务"

function parseTaskOneBasedIndex(s: string | undefined): number | null {
  if (s === undefined || s === "") return null
  const n = parseInt(s, 10)
  if (!Number.isInteger(n) || n < 1) return null
  return n
}

function parseTaskCreateArgs(parts: string[]):
  | { ok: true; name: string; cron: string; content: string }
  | { ok: false; error: string } {
  const afterCreate = parts.slice(2)
  if (afterCreate.length < 1 + 5 + 1) {
    return { ok: false, error: "❌ 参数不足：/task create <名称> <cron五或六段> <内容>" }
  }
  for (const cronLen of [6, 5] as const) {
    if (afterCreate.length < cronLen + 2) continue
    for (let nameLen = 1; nameLen <= afterCreate.length - cronLen - 1; nameLen++) {
      const name = afterCreate.slice(0, nameLen).join(" ").trim()
      if (!name) continue
      const cronToks = afterCreate.slice(nameLen, nameLen + cronLen)
      const cronExpr = cronToks.join(" ").trim()
      if (!validateCron(cronExpr)) continue
      const content = afterCreate.slice(nameLen + cronLen).join(" ").trim()
      if (!content) return { ok: false, error: "任务内容不能为空" }
      return { ok: true, name, cron: cronExpr, content }
    }
  }
  return { ok: false, error: "无法解析：请保证「名称」「cron（连续 5 或 6 段）」「内容」三部分，且 cron 能通过校验" }
}

function parseTaskUpdateArgs(parts: string[]):
  | { ok: true; oneBasedIndex: number; updates: { name?: string; cron?: string; content?: string } }
  | { ok: false; error: string } {
  if (parts.length < 4) {
    return { ok: false, error: "💡 用法：/task update <序号> [-name 值] [-cron 值] [-content 值]" }
  }
  const idx = parseTaskOneBasedIndex(parts[2])
  if (idx === null) return { ok: false, error: "❌ 序号须为正整数" }
  const known = new Set(["-name", "-cron", "-content"])
  let i = 3
  const updates: { name?: string; cron?: string; content?: string } = {}
  while (i < parts.length) {
    const flag = parts[i].toLowerCase()
    if (!known.has(flag)) {
      return { ok: false, error: `❌ 未知选项: ${parts[i]}（仅支持 -name -cron -content）` }
    }
    i++
    const valBuf: string[] = []
    while (i < parts.length) {
      const t = parts[i]
      if (t.startsWith("-") && known.has(t.toLowerCase())) break
      valBuf.push(t)
      i++
    }
    if (valBuf.length === 0) return { ok: false, error: `❌ ${flag} 缺少取值` }
    const val = valBuf.join(" ").trim()
    if (flag === "-name") updates.name = val
    else if (flag === "-cron") updates.cron = val
    else updates.content = val
  }
  if (Object.keys(updates).length === 0) {
    return { ok: false, error: "❌ 至少指定一项：-name / -cron / -content" }
  }
  return { ok: true, oneBasedIndex: idx, updates }
}

const TASK_PREVIEW_BULLETS = ["①", "②", "③", "④", "⑤"] as const
function taskPreviewBullet(i: number): string { return TASK_PREVIEW_BULLETS[i] ?? `${i + 1}.` }
function formatTaskStatusLine(enabled: boolean): string { return enabled ? "✅ 运行中" : "⏸️ 已停止" }

export type TaskRunFn = (task: ScheduledTask, content: string) => Promise<{ ok: boolean; error?: string }>
export type TaskEnqueueFn = (content: string, chatId?: string) => Promise<{ ok: boolean; error?: string }>

export async function handleFeishuTaskCommand(
  port: number, messageId: string, raw: string, taskRunFn: TaskRunFn, chatId?: string, taskEnqueueFn?: TaskEnqueueFn,
): Promise<void> {
  const parts = raw.trim().split(/\s+/).filter((p) => p.length > 0)
  const low = (s: string) => s.toLowerCase()

  if (parts.length <= 1) { await reportCommandResult(port, messageId, true, TASK_SUBCMD_HELP); return }
  const sub = low(parts[1])
  if (sub === "help" || sub === "-h" || sub === "--help") { await reportCommandResult(port, messageId, true, TASK_SUBCMD_HELP); return }

  let tasks = readTasksFromFile()

  if (sub === "ls") {
    if (tasks.length === 0) {
      await reportCommandResult(port, messageId, true, "📭 当前还没有定时任务～\n\n💡 需要的话可以用：\n   /task create <名称> <cron> <内容>")
      return
    }
    const blocks = tasks.map((t, i) => {
      const n = i + 1
      return [
        "┈┈┈┈┈┈┈┈┈┈",
        `#${n}\t📋 名称 · ${t.name}`,
        `\t💠 状态 · ${formatTaskStatusLine(t.enabled)}`,
        `\t🔄 Cron · ${t.cron}`,
        `\t⏱️ 下次 · ${t.enabled ? getNextCronFireLabel(t.cron) : "-"}`
      ].join("\n")
    })
    const header = `⏰ 定时任务一览（共 ${tasks.length} 条）`
    await reportCommandResult(port, messageId, true, `${header}\n\n${blocks.join("\n\n")}\n\n✨ 看某条详情：/task info <序号>`)
    return
  }

  if (sub === "info") {
    const idx = parseTaskOneBasedIndex(parts[2])
    if (idx === null) { await reportCommandResult(port, messageId, false, "💡 用法：/task info <序号>（数字见 /task ls 的 #）"); return }
    if (tasks.length === 0) { await reportCommandResult(port, messageId, false, "📭 还没有任何任务，先用 /task ls 确认一下吧～"); return }
    if (idx > tasks.length) { await reportCommandResult(port, messageId, false, `😅 序号 ${idx} 对应的任务不存在哦（当前共 ${tasks.length} 条）`); return }
    const t = tasks[idx - 1]
    let scheduleSection = ""
    const prev = previewCronNextRuns(t.cron)
    if (prev.ok) {
      const lines = prev.runs.map((r, i) => `   ${taskPreviewBullet(i)} ${r}`)
      scheduleSection = `⏱️ 最近计划触发（${prev.runs.length} 次预览）\n${lines.join("\n")}`
    }
    const body = [
      `📋 任务详情  #${idx}`, "",
      `📝 名称 · ${t.name}`,
      `💠 状态 · ${formatTaskStatusLine(t.enabled)}`,
      `🔄 Cron · ${t.cron}`,
      scheduleSection, "",
      "✉️ 任务内容", "────────────", t.content,
    ].join("\n")
    await reportCommandResult(port, messageId, true, body)
    return
  }

  if (sub === "run") {
    const idx = parseTaskOneBasedIndex(parts[2])
    if (idx === null) { await reportCommandResult(port, messageId, false, "💡 用法：/task run <序号>（数字见 /task ls 的 #）"); return }
    if (idx > tasks.length) { await reportCommandResult(port, messageId, false, `😅 序号 ${idx} 对应的任务不存在哦（共 ${tasks.length} 条）`); return }
    const t = tasks[idx - 1]
    const nowStr = new Date().toLocaleString("zh-CN")
    const content = `[定时任务: ${t.name}] (手动触发: ${nowStr})\n\n${t.content}`
    if (t.independent !== false) {
      const result = await taskRunFn(t, content)
      if (result.ok) {
        await reportCommandResult(port, messageId, true, `🚀 已独立启动任务 #${idx} ${t.name}`)
      } else {
        await reportCommandResult(port, messageId, false, `❌ 独立启动失败: ${result.error}`)
      }
    } else {
      const enqueue = taskEnqueueFn ?? (async (c) => {
        await httpPost(`http://127.0.0.1:${port}/enqueue`, { content: c, chatId, chatType: chatId ? "p2p" : undefined })
        return { ok: true }
      })
      const result = await enqueue(content, chatId)
      if (result.ok) {
        await reportCommandResult(port, messageId, true, `🚀 已手动触发任务 #${idx} ${t.name}`)
      } else {
        await reportCommandResult(port, messageId, false, `❌ 触发失败: ${result.error}`)
      }
    }
    return
  }

  if (sub === "stop") {
    const idx = parseTaskOneBasedIndex(parts[2])
    if (idx === null) { await reportCommandResult(port, messageId, false, "💡 用法：/task stop <序号>（数字见 /task ls 的 #）"); return }
    if (idx > tasks.length) { await reportCommandResult(port, messageId, false, `😅 序号 ${idx} 对应的任务不存在哦（共 ${tasks.length} 条）`); return }
    const name = tasks[idx - 1].name
    tasks = tasks.map((t, j) => (j === idx - 1 ? { ...t, enabled: false } : t))
    writeTasksToFile(tasks)
    await reportCommandResult(port, messageId, true, `⏸️ 已停止任务 #${idx} ${name}`)
    return
  }

  if (sub === "start") {
    const idx = parseTaskOneBasedIndex(parts[2])
    if (idx === null) { await reportCommandResult(port, messageId, false, "💡 用法：/task start <序号>（数字见 /task ls 的 #）"); return }
    if (idx > tasks.length) { await reportCommandResult(port, messageId, false, `😅 序号 ${idx} 对应的任务不存在哦（共 ${tasks.length} 条）`); return }
    const name = tasks[idx - 1].name
    const cron = tasks[idx - 1].cron
    tasks = tasks.map((t, j) => (j === idx - 1 ? { ...t, enabled: true } : t))
    writeTasksToFile(tasks)
    const next = getNextCronFireLabel(cron)
    await reportCommandResult(port, messageId, true, `✅ 已启动任务 #${idx} ${name}\n下次执行: ${next}`)
    return
  }

  if (sub === "delete") {
    const idx = parseTaskOneBasedIndex(parts[2])
    if (idx === null) { await reportCommandResult(port, messageId, false, "💡 用法：/task delete <序号>（数字见 /task ls 的 #）"); return }
    if (idx > tasks.length) { await reportCommandResult(port, messageId, false, `😅 序号 ${idx} 对应的任务不存在哦（共 ${tasks.length} 条）`); return }
    const name = tasks[idx - 1].name
    tasks = tasks.filter((_, j) => j !== idx - 1)
    writeTasksToFile(tasks)
    await reportCommandResult(port, messageId, true, `🗑️ 已删除任务 #${idx} ${name}`)
    return
  }

  if (sub === "create") {
    const parsed = parseTaskCreateArgs(parts)
    if (!parsed.ok) { await reportCommandResult(port, messageId, false, parsed.error); return }
    const taskChannel = chatId ? resolveChannelForSession(chatId) : getEnabledChannels()[0]
    const newTask: ScheduledTask = { id: randomUUID(), name: parsed.name, cron: parsed.cron, content: parsed.content, enabled: true, channelId: taskChannel?.id }
    tasks = [...tasks, newTask]
    writeTasksToFile(tasks)
    const next = getNextCronFireLabel(parsed.cron)
    await reportCommandResult(port, messageId, true, `✅ 已创建并启动：${parsed.name}\n下次执行: ${next}`)
    return
  }

  if (sub === "update") {
    const pu = parseTaskUpdateArgs(parts)
    if (!pu.ok) { await reportCommandResult(port, messageId, false, pu.error); return }
    if (pu.oneBasedIndex > tasks.length) {
      await reportCommandResult(port, messageId, false, `😅 序号 ${pu.oneBasedIndex} 对应的任务不存在哦（共 ${tasks.length} 条）`)
      return
    }
    const t = tasks[pu.oneBasedIndex - 1]
    let nextName = t.name, nextCron = t.cron, nextContent = t.content
    if (pu.updates.name !== undefined) nextName = pu.updates.name
    if (pu.updates.cron !== undefined) nextCron = pu.updates.cron
    if (pu.updates.content !== undefined) nextContent = pu.updates.content
    if (pu.updates.cron !== undefined && !validateCron(nextCron)) {
      await reportCommandResult(port, messageId, false, "😅 新 Cron 表达式无效")
      return
    }
    const updated: ScheduledTask = { ...t, name: nextName, cron: nextCron, content: nextContent }
    tasks = tasks.map((x, j) => (j === pu.oneBasedIndex - 1 ? updated : x))
    writeTasksToFile(tasks)
    let scheduleSection = ""
    const prev = previewCronNextRuns(updated.cron)
    if (prev.ok) {
      const lines = prev.runs.map((r, i) => `   ${taskPreviewBullet(i)} ${r}`)
      scheduleSection = `⏱️ 最近计划触发（${prev.runs.length} 次预览）\n${lines.join("\n")}`
    }
    const body = [
      `✅ 已更新任务`, `📋 任务详情  #${pu.oneBasedIndex}`, "",
      `📝 名称 · ${updated.name}`,
      `💠 状态 · ${formatTaskStatusLine(updated.enabled)}`,
      `🔄 Cron · ${updated.cron}`,
      scheduleSection, "",
      "✉️ 任务内容", "────────────", updated.content,
    ].join("\n")
    await reportCommandResult(port, messageId, true, body)
    return
  }

  await reportCommandResult(port, messageId, false, `😅 未知子命令: ${parts[1]}\n\n${TASK_SUBCMD_HELP}`)
}

// ── MCP 命令 ──────────────────────────────────────────────
