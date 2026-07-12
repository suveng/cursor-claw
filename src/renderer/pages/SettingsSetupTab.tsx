import { ExternalLink, Copy } from "lucide-react"
import { REQUIRED_FEISHU_SCOPES, FEISHU_SCOPES_JSON } from "../constants"
import {
  FEISHU_MENU_SCOPES,
  FEISHU_MENU_EVENTS,
  FEISHU_MENU_EVENT_MAP,
} from "../../shared/feishu-addons"

interface Props {
  firstFeishuAppId: string
  onNavigateTab: (tab: string) => void
}

/** Settings 帮助引导 Tab：配置顺序与飞书权限/事件参考 */
export default function SettingsSetupTab({ firstFeishuAppId, onNavigateTab }: Props) {
  const setTab = onNavigateTab
  return (
    <>
              <section className="space-y-4">
                <h3 className="text-sm font-medium text-gray-300">配置指引</h3>
                <div className="rounded-lg border border-gray-700 p-4 space-y-2">
                  <p className="text-sm text-gray-400">按以下顺序完成配置：</p>
                  <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-500">
                    <li><button onClick={() => setTab("general")} className="text-blue-400 hover:underline">通用</button> — 选择主工作目录</li>
                    <li><button onClick={() => setTab("agent")} className="text-blue-400 hover:underline">Agent</button> — 配置 Agent 资源（Cursor SDK / Claude Code / Codex / OpenCode）</li>
                    <li><button onClick={() => setTab("channel")} className="text-blue-400 hover:underline">消息通道</button> — 接入飞书 / 微信，绑定 Agent 资源与模型</li>
                  </ol>
                  <p className="text-xs text-gray-600">完成后回到主页启动 Daemon 即可使用。以下为飞书手动建应用时需要的权限与事件配置参考。</p>
                </div>
              </section>

              {/* 主/次通道能力对照：口径对齐知识库概览 §九，静态文案不持久化 */}
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-gray-300">主/次通道能力</h3>
                <p className="text-xs text-gray-600">
                  飞书为主通道、微信为次通道：形态可不同，边界须透明。微信一期无合并卡与自定义菜单，也不假装 CardKit。
                </p>
                <div className="rounded-lg border border-gray-800 overflow-hidden">
                  <div className="grid grid-cols-3 gap-2 bg-gray-800/50 px-3 py-2 text-xs font-medium text-gray-400">
                    <span>能力</span>
                    <span>飞书（主）</span>
                    <span>微信（次）</span>
                  </div>
                  <div className="divide-y divide-gray-800 text-xs">
                    <div className="grid grid-cols-3 gap-2 px-3 py-2">
                      <span className="text-gray-400">群聊过滤</span>
                      <span className="text-gray-300">协议 @</span>
                      <span className="text-gray-300">正文 @ 启发式；可配置全量入队</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 px-3 py-2">
                      <span className="text-gray-400">进行中</span>
                      <span className="text-gray-300">Get 表情 + CardKit</span>
                      <span className="text-gray-300">typing（约 4s 续期）</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 px-3 py-2">
                      <span className="text-gray-400">出站 track</span>
                      <span className="text-gray-300">open_message_id</span>
                      <span className="text-gray-300 font-mono">wxc_&lt;clientId&gt;</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 px-3 py-2">
                      <span className="text-gray-400">合并 / 菜单</span>
                      <span className="text-gray-300">有</span>
                      <span className="text-amber-400/90">微信一期无</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300">基础权限</h3>
                  <div className="flex items-center gap-2">
                    {firstFeishuAppId.trim() && (
                      <a href={`https://open.feishu.cn/app/${firstFeishuAppId.trim()}/auth`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-blue-400">
                        <ExternalLink size={12} />前往设置权限
                      </a>
                    )}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(FEISHU_SCOPES_JSON)
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white"
                    >
                      <Copy size={12} />复制基础权限 JSON
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-600">IM 收发消息等基础能力。自定义菜单增量权限见下方「菜单增量权限」。</p>
                <div className="rounded-lg border border-gray-800 divide-y divide-gray-800">
                  {REQUIRED_FEISHU_SCOPES.map((p) => (
                    <div key={p.scope} className="flex items-center justify-between px-3 py-2">
                      <code className="text-xs text-blue-400">{p.scope}</code>
                      <span className="text-xs text-gray-500">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium text-gray-300">菜单增量权限</h3>
                <p className="text-xs text-gray-600">
                  自定义菜单与进入私聊帮助卡所需。存量应用可在
                  <button type="button" onClick={() => setTab("channel")} className="mx-0.5 text-blue-400 hover:underline">消息通道</button>
                  编辑页使用「扫码更新权限」增量开通，无需修改 App Secret。
                </p>
                <div className="rounded-lg border border-amber-900/40 divide-y divide-gray-800">
                  {FEISHU_MENU_SCOPES.map((p) => (
                    <div key={p.scope} className="flex items-center justify-between px-3 py-2">
                      <code className="text-xs text-amber-400">{p.scope}</code>
                      <span className="text-xs text-gray-500">{p.desc}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-amber-900/40 divide-y divide-gray-800">
                  {FEISHU_MENU_EVENTS.map((p) => (
                    <div key={p.event} className="flex items-center justify-between px-3 py-2">
                      <code className="text-xs text-amber-400">{p.event}</code>
                      <span className="text-xs text-gray-500">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300">事件订阅</h3>
                  {firstFeishuAppId.trim() && (
                    <a href={`https://open.feishu.cn/app/${firstFeishuAppId.trim()}/event`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-blue-400">
                      <ExternalLink size={12} />前往设置事件订阅
                    </a>
                  )}
                </div>
                <div className="rounded-lg border border-gray-800 divide-y divide-gray-800">
                  <div className="px-3 py-2 flex items-center justify-between">
                    <code className="text-xs text-blue-400">im.message.receive_v1</code>
                    <span className="text-xs text-gray-500">接收消息 v2.0</span>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300">读取用户发给机器人的单聊消息</span>
                    <span className="text-xs text-emerald-400">需开通</span>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-gray-300">获取群组中用户@机器人消息</span>
                    <span className="text-xs text-emerald-400">需开通</span>
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-500 space-y-1">
                    <div>订阅方式：<span className="text-gray-300">应用身份</span></div>
                    <div>回调类型：<span className="text-gray-300">长连接（WebSocket）</span></div>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium text-gray-300">自定义菜单 event_key 对照表</h3>
                <p className="text-xs text-gray-600">
                  在飞书开发者后台 → 机器人 → 自定义菜单中配置菜单项时，推送事件类菜单须填写下方 event_key（区分大小写）。
                  菜单类型选「推送事件」，保存后发布应用版本生效。已授权用户均可使用下列指令。
                </p>
                <div className="rounded-lg border border-gray-800 overflow-hidden">
                  <div className="grid grid-cols-4 gap-2 bg-gray-800/50 px-3 py-2 text-xs font-medium text-gray-400">
                    <span>event_key</span>
                    <span>菜单名称</span>
                    <span>等价斜杠</span>
                    <span className="text-right">权限</span>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {Object.entries(FEISHU_MENU_EVENT_MAP).map(([key, item]) => (
                      <div key={key} className="grid grid-cols-4 gap-2 px-3 py-2 text-xs">
                        <code className="text-blue-400">{key}</code>
                        <span className="text-gray-300">{item.label}</span>
                        <code className="text-gray-400">{item.command}</code>
                        <span className="text-right text-emerald-400">全员</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">参考文档</h3>
                <div className="flex flex-wrap gap-2">
                  <a href="https://github.com/lk-eternal/cursor-claw" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-blue-400">
                    <ExternalLink size={12} />项目 GitHub
                  </a>
                </div>
              </section>
    </>
  )
}
