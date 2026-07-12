import { useState, useEffect, useRef } from "react"
import { CheckCircle2, Loader2, LogIn } from "lucide-react"
import { inputCls } from "./channel-panel-helpers"

interface Props {
  draft: ChannelConfig
  set: (p: Partial<ChannelConfig>) => void
}

/** 通道编辑弹窗 — 微信凭据与扫码绑定 */
export default function ChannelEditWechat({ draft, set }: Props) {
  const [wechatQrUrl, setWechatQrUrl] = useState("")
  const [wechatQrStatus, setWechatQrStatus] = useState<"idle" | "loading" | "wait" | "scaned" | "error">("idle")
  const [wechatQrMsg, setWechatQrMsg] = useState("")
  const wechatQrBusy = useRef(false)

  useEffect(() => {
    const unsub1 = window.electronAPI.onWechatSetupQrCode((url) => { setWechatQrUrl(url); setWechatQrStatus("wait") })
    const unsub2 = window.electronAPI.onWechatSetupStatus((status) => { if (status === "scaned") setWechatQrStatus("scaned") })
    return () => { unsub1(); unsub2() }
  }, [])

  const startWechatQrLogin = async () => {
    if (wechatQrBusy.current) return
    wechatQrBusy.current = true
    setWechatQrStatus("loading"); setWechatQrUrl(""); setWechatQrMsg("")
    try {
      const r = await window.electronAPI.wechatQrLogin()
      wechatQrBusy.current = false
      if (r.ok && r.botToken) {
        set({ wechatToken: r.botToken, wechatAccountId: r.accountId ?? "" })
        setWechatQrStatus("idle"); setWechatQrUrl("")
      } else if (r.error === "cancelled") {
        setWechatQrStatus("idle"); setWechatQrUrl("")
      } else {
        setWechatQrStatus("error"); setWechatQrMsg(r.error ?? "登录失败")
      }
    } catch (e: unknown) {
      wechatQrBusy.current = false
      setWechatQrStatus("error"); setWechatQrMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 p-3">
      <h4 className="text-xs font-medium text-gray-400">微信账号</h4>
      {draft.wechatToken && wechatQrStatus === "idle" ? (
        <div className="flex items-center gap-3 rounded-lg border border-gray-700 px-3 py-2">
          <CheckCircle2 size={14} className="text-green-400" />
          <span className="flex-1 text-xs text-gray-300">已获取 Token{draft.wechatAccountId && <span className="ml-1 font-mono text-gray-500">{draft.wechatAccountId}</span>}</span>
          <button type="button" onClick={() => void startWechatQrLogin()} className="text-xs text-gray-500 hover:text-blue-400">重新扫码</button>
        </div>
      ) : (
        <div className="space-y-2">
          {wechatQrStatus === "loading" && (
            <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
              <Loader2 size={13} className="animate-spin" />正在获取二维码...
              <button onClick={async () => { await window.electronAPI.wechatQrLoginCancel(); wechatQrBusy.current = false; setWechatQrStatus("idle") }} className="text-gray-500 hover:text-red-400">取消</button>
            </div>
          )}
          {(wechatQrStatus === "wait" || wechatQrStatus === "scaned") && wechatQrUrl && (
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="rounded-lg bg-white p-2"><img src={wechatQrUrl} alt="WeChat QR" className="h-40 w-40" /></div>
              <p className="text-xs text-gray-400">{wechatQrStatus === "scaned" ? "✅ 已扫描，请在手机上确认" : "请使用手机微信扫码"}</p>
              <button onClick={async () => { await window.electronAPI.wechatQrLoginCancel(); wechatQrBusy.current = false; setWechatQrStatus("idle") }} className="text-xs text-gray-500 hover:text-red-400">取消</button>
            </div>
          )}
          {wechatQrStatus === "error" && <p className="text-xs text-red-400">{wechatQrMsg} <button onClick={() => void startWechatQrLogin()} className="text-blue-400 hover:underline">重试</button></p>}
          {wechatQrStatus === "idle" && (
            <button onClick={() => void startWechatQrLogin()} className="flex items-center gap-2 rounded-md border border-gray-600 px-3 py-2 text-xs text-gray-300 transition hover:border-blue-500 hover:text-blue-400">
              <LogIn size={13} />扫码绑定ClawBot
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">群聊入队策略</label>
          <select
            value={draft.wechatGroupEnqueueMode ?? "mention_required"}
            onChange={(e) => set({ wechatGroupEnqueueMode: e.target.value as "mention_required" | "all" })}
            className={inputCls}
          >
            <option value="mention_required">群聊须 @ 机器人</option>
            <option value="all">群聊全量入队</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">机器人显示名（@ 匹配，可选）</label>
          <input
            type="text"
            value={draft.wechatBotDisplayName ?? ""}
            onChange={(e) => set({ wechatBotDisplayName: e.target.value })}
            placeholder={draft.name || "默认用通道名称"}
            className={inputCls}
          />
        </div>
      </div>
    </div>
  )
}
