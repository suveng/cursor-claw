/**
 * 飞书 /help 与帮助卡正文 SSOT。
 * bridge 与 Electron 均从此模块 import，避免文案漂移。
 */

/** 全员可用斜杠指令说明 */
const COMMON_COMMAND_LINES = [
  "🔹 /status 运行状态",
  "🔹 /stop 停止Agent",
  "🔹 /reset 重置会话",
  "🔹 /help 指令列表",
] as const

/** 管理员额外斜杠指令说明（与首期菜单 workspace/model/chat new 等语义对齐） */
const ADMIN_COMMAND_LINES = [
  "🔹 /restart 重启应用",
  "🔹 /list 消息队列",
  "🔹 /clean 清空队列",
  "🔹 /task 定时任务",
  "🔹 /workflow 工作流管理",
  "🔹 /model 模型设置",
  "🔹 /mcp MCP服务器管理",
  "🔹 /workspace 切换工作目录",
  "🔹 /chat 会话管理（new 可选 -dir <路径>，省略则用主会话目录，无效目录不创建）",
] as const

/** 自定义菜单位置引导（与 01 F2.2 一致） */
const MENU_GUIDE_LINE =
  "📋 点击输入框旁菜单可快捷执行常用操作；更多指令可手动输入斜杠文本"

/**
 * 生成与 /help 及帮助卡一致的纯文本帮助正文。
 * @param isAdmin 是否主用户/管理员（与 daemon-manager isAdmin 判定一致）
 */
export function buildHelpText(isAdmin: boolean): string {
  const title = isAdmin ? "💡 可用指令（管理员）：" : "💡 可用指令："
  const lines = isAdmin
    ? [title, MENU_GUIDE_LINE, ...COMMON_COMMAND_LINES, ...ADMIN_COMMAND_LINES]
    : [title, MENU_GUIDE_LINE, ...COMMON_COMMAND_LINES]
  return lines.join("\n")
}
