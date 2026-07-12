/** ChannelPanel 纯辅助：新建 id / 空通道模板 / 默认名判断 */

export const inputCls = "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none transition focus:border-blue-500"

export function newLocalChannelId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => b.toString(16).padStart(2, "0")).join("")
  return `ch_${hex}`
}

export function emptyChannel(type: "feishu" | "wechat", defaultName: string): ChannelConfig {
  const base: ChannelConfig = {
    id: newLocalChannelId(),
    name: defaultName,
    enabled: true,
    type,
    agentResourceId: "",
    model: "auto",
    modelParams: "",
    othersModel: "",
    othersModelParams: "",
    mainUserEnabled: false,
    mainUserChatId: "",
    mainUserNewSession: false,
    allowOthers: false,
    othersWorkspaceMode: "isolated",
    othersWorkspaceDir: "",
    digitalIdentity: "",
    workspaceDir: "",
  }
  // 微信通道默认群聊须 @ 入队
  if (type === "wechat") return { ...base, wechatGroupEnqueueMode: "mention_required" }
  return base
}

/** 通道名仍是默认占位（"飞书"/"飞书 2"…）时允许用解析出的应用名自动覆盖 */
export function isDefaultChannelName(name: string): boolean {
  return !name.trim() || /^飞书( \d+)?$/.test(name.trim()) || /^微信( \d+)?$/.test(name.trim())
}
