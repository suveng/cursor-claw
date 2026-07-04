/**
 * 飞书自定义菜单与进入私聊帮助所需的增量权限/事件 SSOT。
 * 供扫码增量开权（registerApp addons）、设置页对照表与菜单 event_key 映射引用。
 */

/** 菜单能力增量 scopes（含中文说明，供设置页展示） */
export const FEISHU_MENU_SCOPES: { scope: string; desc: string }[] = [
  { scope: "application:bot.menu:write", desc: "机器人自定义菜单写入" },
  { scope: "cardkit:card:write", desc: "CardKit 卡片写入（进入私聊帮助卡）" },
  { scope: "application:application.bot.operator_name:readonly", desc: "读取机器人操作者名称" },
];

/** 菜单能力增量事件（含中文说明，供设置页展示） */
export const FEISHU_MENU_EVENTS: { event: string; desc: string }[] = [
  { event: "application.bot.menu_v6", desc: "自定义菜单点击（推送事件类菜单）" },
  { event: "im.chat.access_event.bot_p2p_chat_entered_v1", desc: "用户进入机器人私聊" },
];

/** 扫码增量开权时传入 registerApp 的 addons（仅 tenant 身份叠加） */
export const FEISHU_MENU_ADDONS: {
  scopes: { tenant: string[]; user: string[] };
  events: { items: { tenant: string[]; user: string[] } };
} = {
  scopes: {
    tenant: FEISHU_MENU_SCOPES.map((p) => p.scope),
    user: [],
  },
  events: {
    items: {
      tenant: FEISHU_MENU_EVENTS.map((p) => p.event),
      user: [],
    },
  },
};

/** 飞书后台菜单 event_key → 斜杠指令映射（不含解析逻辑；指令权限不区分角色） */
export const FEISHU_MENU_EVENT_MAP: Record<
  string,
  { command: string; label: string }
> = {
  cmd_help: { command: "/help", label: "帮助" },
  cmd_status: { command: "/status", label: "查看状态" },
  cmd_reset: { command: "/reset", label: "重置会话" },
  cmd_stop: { command: "/stop", label: "停止任务" },
  cmd_workspace: { command: "/workspace", label: "工作区" },
  cmd_model: { command: "/model", label: "模型" },
  cmd_chat_new: { command: "/chat new", label: "新建会话" },
};
