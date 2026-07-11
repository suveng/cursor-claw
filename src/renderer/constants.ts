/** 飞书基础 IM 权限（手动建应用 / 复制 JSON 用）。菜单增量权限见 `src/shared/feishu-addons.ts` 的 FEISHU_MENU_SCOPES */
export const REQUIRED_FEISHU_SCOPES: { scope: string; desc: string }[] = [
  { scope: "im:message", desc: "发送消息（create / reply）" },
  { scope: "im:message.p2p_msg:readonly", desc: "接收私聊消息" },
  { scope: "im:message.group_at_msg:readonly", desc: "接收群聊 @消息" },
  { scope: "im:message.group_at_msg.include_bot:readonly", desc: "接收其他机器人 @本机器人的群消息（AI 间协作）" },
  { scope: "im:resource", desc: "上传/下载图片与文件" },
  { scope: "im:chat:read", desc: "获取群聊名称" },
  // contact.user.get 的 name 字段须 contact:user.base:readonly（非 contact:contact.base:readonly）
  { scope: "contact:user.base:readonly", desc: "获取用户名称（私聊 group_name 注入）" },
]

export const FEISHU_SCOPES_JSON = JSON.stringify(
  { scopes: { tenant: REQUIRED_FEISHU_SCOPES.map((p) => p.scope), user: [] } },
  null,
  2,
)
