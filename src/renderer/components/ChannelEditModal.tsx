import { useState, useEffect, useRef } from "react"
import {
  X, Loader2, CheckCircle2, ShieldAlert, Eye, EyeOff, LogIn, MessageSquare, Bird, ExternalLink, ShieldCheck,
} from "lucide-react"
import ChannelModelSection from "./ChannelModelSection"
import FeishuQrFlow, { type FeishuQrFlowHandle } from "./FeishuQrFlow"
import { inputCls, isDefaultChannelName } from "./channel-panel-helpers"
import ChannelEditWechat from "./ChannelEditWechat"
import ChannelEditAccess from "./ChannelEditAccess"

/** 通道编辑弹窗：凭据 / 模型 / 主用户 / 其他人 / 高级 */
interface EditProps {
  channel: ChannelConfig
  isNew: boolean
  resources: AgentResource[]
  onClose: () => void
  onSave: (c: ChannelConfig) => Promise<void>
  /** 保存但不关闭（绑定主用户前需先落库） */
  onSaveDraft: (c: ChannelConfig) => Promise<void>
  showAlert: (title: string, message: string) => Promise<void>
  showConfirm: (title: string, message: string) => Promise<boolean>
}

/** 通道编辑弹窗：凭据 / 模型 / 主用户；其他人与高级见 ChannelEditAccess */
export function ChannelEditModal({ channel, isNew, resources, onClose, onSave, onSaveDraft, showAlert, showConfirm }: EditProps) {
  const [draft, setDraft] = useState<ChannelConfig>(channel)
  const [showSecret, setShowSecret] = useState(false)
  const [appInfoState, setAppInfoState] = useState<{ checking: boolean; error?: string }>({ checking: false })
  const [binding, setBinding] = useState(false)
  const [testing, setTesting] = useState(false)
  const [registerForm, setRegisterForm] = useState<{ name: string; desc: string } | null>(null)
  const [feishuQrBusy, setFeishuQrBusy] = useState(false)
  const feishuQrRef = useRef<FeishuQrFlowHandle>(null)

  const set = (p: Partial<ChannelConfig>) => setDraft((d) => ({ ...d, ...p }))

  // 凭据齐全时自动解析应用名（防抖），默认通道名自动替换为应用名
  const appId = draft.type === "feishu" ? (draft.larkAppId?.trim() ?? "") : ""
  const appSecret = draft.type === "feishu" ? (draft.larkAppSecret?.trim() ?? "") : ""
  useEffect(() => {
    if (!appId || !appSecret) { setAppInfoState({ checking: false }); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setAppInfoState({ checking: true })
      const r = await window.electronAPI.fetchFeishuAppInfo(appId, appSecret)
      if (cancelled) return
      if (r.ok && r.name) {
        setAppInfoState({ checking: false })
        setDraft((d) => ({
          ...d,
          larkBotName: r.name,
          name: isDefaultChannelName(d.name) ? r.name! : d.name,
        }))
      } else {
        setAppInfoState({ checking: false, error: r.error })
        setDraft((d) => ({ ...d, larkBotName: "" }))
      }
    }, 600)
    return () => { cancelled = true; clearTimeout(t) }
  }, [appId, appSecret])

  const openRegisterForm = () => {
    setRegisterForm({
      name: !isDefaultChannelName(draft.name) ? draft.name.trim() : "Cursor Claw",
      desc: "Cursor AI 协作助手",
    })
  }

  const startFeishuRegister = (preset: { name: string; desc: string }) => {
    setRegisterForm(null)
    void feishuQrRef.current?.startRegister(preset)
  }

  const startFeishuUpdatePermissions = () => {
    const id = draft.larkAppId?.trim()
    if (!id) return
    void feishuQrRef.current?.startUpdate(id)
  }


  // 主用户绑定
  const handleBind = async () => {
    const credOk = draft.type === "feishu" ? !!(draft.larkAppId?.trim() && draft.larkAppSecret?.trim()) : !!draft.wechatToken?.trim()
    if (!credOk) { void showAlert("提示", draft.type === "feishu" ? "请先填写飞书凭据" : "请先扫码获取微信 Token"); return }
    setBinding(true)
    try {
      // 先落库，保证主进程读到最新通道配置
      await onSaveDraft({ ...draft, mainUserEnabled: true })
      const r = await window.electronAPI.startChannelBind(draft.id)
      if (r.ok && r.chatId) {
        set({ mainUserEnabled: true, mainUserChatId: r.chatId })
        await onSaveDraft({ ...draft, mainUserEnabled: true, mainUserChatId: r.chatId })
      } else if (r.error && r.error !== "cancelled") {
        void showAlert("绑定失败", r.error)
      }
    } finally {
      setBinding(false)
    }
  }

  const cancelBind = async () => {
    await window.electronAPI.cancelChannelBind(draft.id)
    setBinding(false)
  }

  const handleUnbind = async () => {
    if (!await showConfirm("解绑确认", "确定解除该通道的主用户绑定吗？解绑后该通道私聊将按\"其他人\"模式处理。")) return
    set({ mainUserChatId: "" })
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      await onSaveDraft(draft)
      const r = await window.electronAPI.testBind(draft.id)
      if (r.ok) void showAlert("成功", "测试消息已发送")
      else void showAlert("错误", r.error || "测试失败")
    } finally {
      setTesting(false)
    }
  }



  const credOk = draft.type === "feishu" ? !!(draft.larkAppId?.trim() && draft.larkAppSecret?.trim()) : !!draft.wechatToken?.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl" style={{ maxHeight: "85vh" }}>
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
            {draft.type === "feishu" ? <Bird size={15} className="text-blue-400" /> : <MessageSquare size={15} className="text-green-400" />}
            {isNew ? "添加" : "编辑"}{draft.type === "feishu" ? "飞书" : "微信"}通道
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* 名称 */}
          <div>
            <label className="mb-1 block text-xs text-gray-500">通道名称</label>
            <input type="text" value={draft.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} placeholder={draft.type === "feishu" ? "飞书" : "微信"} />
          </div>

          {/* ── 凭据 ── */}
          {draft.type === "feishu" ? (
            <div className="space-y-3 rounded-lg border border-gray-800 p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-gray-400">飞书凭据</h4>
                <div className="flex items-center gap-2">
                  {draft.larkAppId?.trim() && (
                    <a href={`https://open.feishu.cn/app/${draft.larkAppId.trim()}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400">
                      <ExternalLink size={11} />开发者后台
                    </a>
                  )}
                  {draft.larkAppId?.trim() && (
                    <button
                      type="button"
                      onClick={startFeishuUpdatePermissions}
                      disabled={feishuQrBusy || registerForm !== null}
                      title={!draft.larkAppId?.trim() ? "请先填写 App ID" : "增量开通自定义菜单与进入私聊事件，不修改 App Secret"}
                      className="flex items-center gap-1 rounded-md border border-amber-600/50 bg-amber-600/10 px-2 py-1 text-xs text-amber-300 hover:bg-amber-600/20 disabled:opacity-50"
                    >
                      <ShieldCheck size={11} />扫码更新权限
                    </button>
                  )}
                  <button type="button" onClick={openRegisterForm} disabled={feishuQrBusy || registerForm !== null}
                    className="flex items-center gap-1 rounded-md border border-blue-600/50 bg-blue-600/10 px-2 py-1 text-xs text-blue-300 hover:bg-blue-600/20 disabled:opacity-50">
                    <LogIn size={11} />一键创建应用
                  </button>
                </div>
              </div>
              {registerForm && (
                <div className="space-y-2 rounded-lg border border-blue-800/40 bg-blue-950/20 p-3">
                  <p className="text-xs font-medium text-blue-200">新应用信息（创建页将预填，扫码后可修改）</p>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">应用名称（群内机器人显示名）</label>
                    <input type="text" value={registerForm.name} onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })} className={inputCls} placeholder="如：排课助手" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">应用描述</label>
                    <input type="text" value={registerForm.desc} onChange={(e) => setRegisterForm({ ...registerForm, desc: e.target.value })} className={inputCls} placeholder="如：排课领域知识问答助手" />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setRegisterForm(null)} className="rounded-md px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white">取消</button>
                    <button onClick={() => startFeishuRegister(registerForm)} disabled={!registerForm.name.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">开始扫码创建</button>
                  </div>
                </div>
              )}
              <FeishuQrFlow
                ref={feishuQrRef}
                mode="register"
                onStatusChange={(s) => setFeishuQrBusy(s === "loading" || s === "wait")}
                onSuccess={(result) => {
                  if (result?.appId && result.appSecret) {
                    set({ larkAppId: result.appId, larkAppSecret: result.appSecret, larkAppQuickCreated: true })
                  }
                }}
              />
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs text-gray-500">App ID</label><input type="text" value={draft.larkAppId ?? ""} onChange={(e) => set({ larkAppId: e.target.value })} className={inputCls} /></div>
                <div><label className="mb-1 block text-xs text-gray-500">App Secret</label>
                  <div className="relative">
                    <input type={showSecret ? "text" : "password"} value={draft.larkAppSecret ?? ""} onChange={(e) => set({ larkAppSecret: e.target.value })} className={inputCls + " pr-9"} />
                    <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">{showSecret ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                  </div>
                </div>
              </div>
              {appInfoState.checking && <p className="flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={11} className="animate-spin" />正在识别应用...</p>}
              {!appInfoState.checking && draft.larkBotName && <p className="flex items-center gap-1.5 text-xs text-green-400"><CheckCircle2 size={12} />已识别应用：{draft.larkBotName}</p>}
              {!appInfoState.checking && appInfoState.error && <p className="flex items-center gap-1.5 text-xs text-red-400"><ShieldAlert size={12} />{appInfoState.error}</p>}
            </div>
          ) : (
            <ChannelEditWechat draft={draft} set={set} />
          )}

          {/* ── Agent 资源与模型（按资源类型联动，见 ChannelModelSection） ── */}
          <ChannelModelSection channel={channel} draft={draft} set={set} resources={resources} showAlert={showAlert} />

          {/* ── 主用户绑定 ── */}
          <div className="space-y-3 rounded-lg border border-gray-800 p-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-medium text-gray-400">主用户绑定</h4>
                <p className="text-xs text-gray-600">绑定后该用户私聊使用主工作目录并延续会话；不绑定则所有会话按"其他人"模式运行</p>
              </div>
              <button onClick={() => set({ mainUserEnabled: !draft.mainUserEnabled })}
                className={`relative h-5 w-9 shrink-0 rounded-full transition ${draft.mainUserEnabled ? "bg-blue-600" : "bg-gray-600"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${draft.mainUserEnabled ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </div>
            {draft.mainUserEnabled && (
              <div className="flex items-center gap-3 rounded-lg border border-gray-700 px-3 py-2.5">
                {binding
                  ? <>
                      <Loader2 size={14} className="animate-spin text-blue-400" />
                      <span className="flex-1 text-xs text-blue-300">请在{draft.type === "feishu" ? "飞书" : "微信"}私聊中向机器人发送一条消息...</span>
                      <button type="button" onClick={() => void cancelBind()} className="text-xs text-gray-500 hover:text-red-400">取消</button>
                    </>
                  : draft.mainUserChatId
                    ? <>
                        <CheckCircle2 size={14} className="text-green-400" />
                        <span className="flex-1 truncate text-xs text-gray-300">已绑定 <span className="ml-1 font-mono text-gray-500">{draft.mainUserChatId}</span></span>
                        <button type="button" onClick={() => void handleBind()} className="text-xs text-gray-500 hover:text-blue-400">重新绑定</button>
                        <span className="text-gray-700">|</span>
                        <button type="button" onClick={() => void handleUnbind()} className="text-xs text-gray-500 hover:text-red-400">解绑</button>
                        <span className="text-gray-700">|</span>
                        <button type="button" onClick={() => void handleTest()} disabled={testing} className="text-xs text-gray-500 hover:text-green-400 disabled:opacity-50">{testing ? "发送中..." : "测试"}</button>
                      </>
                    : <>
                        <ShieldAlert size={14} className="text-yellow-500" />
                        <span className="flex-1 text-xs text-gray-500">未绑定</span>
                        <button type="button" onClick={() => void handleBind()} disabled={!credOk} className="rounded-md border border-gray-600 px-2.5 py-1 text-xs text-gray-300 transition hover:border-blue-500 hover:text-blue-400 disabled:opacity-50">绑定</button>
                      </>}
              </div>
            )}
            <p className="text-xs text-gray-600">
              创建临时会话：<span className="font-mono text-gray-500">/chat new &lt;任务描述&gt; [-dir &lt;路径&gt;]</span>；省略 <span className="font-mono text-gray-500">-dir</span> 时使用当前主会话目录（本通道工作目录留空则用全局默认）；无效目录不会创建临时会话。
            </p>
          </div>

          <ChannelEditAccess draft={draft} set={set} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md px-4 py-1.5 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-white">取消</button>
          <button onClick={() => void onSave(draft)} disabled={!draft.name.trim()} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40">保存</button>
        </div>
      </div>
    </div>
  )
}
