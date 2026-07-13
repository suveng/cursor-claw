/**
 * 飞书 /help 与帮助卡正文 SSOT。
 * bridge 与 Electron 均从此模块 import，避免文案漂移。
 */

/** 全量斜杠指令说明（私聊/群聊、文本/菜单路径一致） */
const ALL_COMMAND_LINES = [
  "🔹 /status 运行状态",
  "🔹 /stop 停止当前会话 Agent",
  "🔹 /reset 重置会话",
  "🔹 /help 指令列表",
  "🔹 /restart 重建当前会话 Agent（不影响其他会话）",
  "🔹 /restart daemon 全量重启 Daemon（停全部 Agent + 清队列）",
  "🔹 /list 消息队列",
  "🔹 /clean 清空队列",
  "🔹 /task 定时任务",
  "🔹 /workflow 工作流管理",
  "🔹 /model 模型设置",
  "🔹 /mcp MCP服务器管理",
  "🔹 /workspace 切换工作目录",
  "🔹 /chat 会话管理（new 可选 -dir <路径>，省略则用主会话目录，无效目录不创建）",
  "🔹 /merge 合并控制（send | split | edit <正文>）",
] as const

/** 自定义菜单位置引导 */
const MENU_GUIDE_LINE =
  "📋 点击输入框旁菜单可快捷执行常用操作；更多指令可手动输入斜杠文本"

/**
 * 生成与 /help 及帮助卡一致的纯文本帮助正文（全员同一套）。
 */
export function buildHelpText(): string {
  const title = "💡 可用指令："
  return [title, MENU_GUIDE_LINE, ...ALL_COMMAND_LINES].join("\n")
}
