import { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from "react"
import { Loader2 } from "lucide-react"

/** 扫码流程模式：一键创建应用 / 增量更新权限 */
export type FeishuQrMode = "register" | "update-permissions"

export interface FeishuQrFlowHandle {
  /** 是否正在进行扫码（loading 或等待扫码） */
  isBusy: boolean
  /** 发起一键创建应用扫码 */
  startRegister: (preset: { name: string; desc: string }) => Promise<void>
  /** 发起增量权限更新扫码（不覆盖 App Secret） */
  startUpdate: (appId: string) => Promise<void>
  /** 取消当前扫码 */
  cancel: () => Promise<void>
}

/** 扫码 UI 状态 */
type QrStatus = "idle" | "loading" | "wait" | "error" | "success"

export interface FeishuQrFlowProps {
  mode: FeishuQrMode
  /** update-permissions 模式下的目标 App ID */
  appId?: string
  onSuccess?: (result?: { appId?: string; appSecret?: string }) => void
  onCancel?: () => void
  /** 状态变化时通知父组件（用于禁用并发按钮） */
  onStatusChange?: (status: QrStatus) => void
}

/** 飞书扫码流程 UI：订阅 QR 推送，区分创建应用与增量开权 */
const FeishuQrFlow = forwardRef<FeishuQrFlowHandle, FeishuQrFlowProps>(
  function FeishuQrFlow({ onSuccess, onCancel, onStatusChange }, ref) {
    const [status, setStatus] = useState<QrStatus>("idle")
    const [qrUrl, setQrUrl] = useState("")
    const [msg, setMsg] = useState("")
    const activeModeRef = useRef<FeishuQrMode | null>(null)
    const retryRef = useRef<(() => void) | null>(null)

    const setQrStatus = useCallback((next: QrStatus) => {
      setStatus(next)
      onStatusChange?.(next)
    }, [onStatusChange])

    // 复用主进程 feishu:setup-qrcode / feishu:setup-status 广播
    useEffect(() => {
      const unsub1 = window.electronAPI.onFeishuSetupQrCode((url) => {
        setQrUrl(url)
        setQrStatus("wait")
      })
      const unsub2 = window.electronAPI.onFeishuSetupStatus(() => {})
      return () => { unsub1(); unsub2() }
    }, [setQrStatus])

    const reset = useCallback(() => {
      setQrUrl("")
      setMsg("")
      activeModeRef.current = null
      retryRef.current = null
      setQrStatus("idle")
    }, [setQrStatus])

    const cancel = useCallback(async () => {
      const mode = activeModeRef.current
      if (mode === "register") {
        await window.electronAPI.feishuRegisterAppCancel()
      } else if (mode === "update-permissions") {
        await window.electronAPI.feishuUpdateAppPermissionsCancel()
      }
      reset()
      onCancel?.()
    }, [onCancel, reset])

    const startRegister = useCallback(async (preset: { name: string; desc: string }) => {
      activeModeRef.current = "register"
      setQrStatus("loading")
      setQrUrl("")
      setMsg("")
      const r = await window.electronAPI.feishuRegisterApp(preset)
      if (r.ok && r.appId && r.appSecret) {
        reset()
        onSuccess?.({ appId: r.appId, appSecret: r.appSecret })
      } else if (r.error === "cancelled") {
        reset()
        onCancel?.()
      } else {
        setQrStatus("error")
        setMsg(r.error ?? "创建失败")
        retryRef.current = () => { void startRegister(preset) }
      }
    }, [onSuccess, onCancel, reset, setQrStatus])

    const startUpdate = useCallback(async (appId: string) => {
      const trimmed = appId.trim()
      if (!trimmed) return
      activeModeRef.current = "update-permissions"
      setQrStatus("loading")
      setQrUrl("")
      setMsg("")
      const r = await window.electronAPI.feishuUpdateAppPermissions(trimmed)
      if (r.ok) {
        setQrStatus("success")
        setQrUrl("")
        activeModeRef.current = null
        onSuccess?.()
      } else if (r.error === "cancelled") {
        reset()
        onCancel?.()
      } else {
        setQrStatus("error")
        setMsg(r.error ?? "更新失败")
        retryRef.current = () => { void startUpdate(trimmed) }
      }
    }, [onSuccess, onCancel, reset, setQrStatus])

    useImperativeHandle(ref, () => ({
      isBusy: status === "loading" || status === "wait",
      startRegister,
      startUpdate,
      cancel,
    }), [status, startRegister, startUpdate, cancel])

    if (status === "idle") return null

    const waitHint = activeModeRef.current === "update-permissions"
      ? "请使用飞书扫码确认增量权限"
      : "请使用飞书扫码创建应用"

    return (
      <div className="flex flex-col items-center gap-2 py-3">
        {(status === "loading" || (status === "wait" && qrUrl)) && (
          <>
            {status === "loading"
              ? <Loader2 size={22} className="animate-spin text-blue-400" />
              : <img src={qrUrl} alt="Feishu QR" className="h-40 w-40 rounded bg-white p-1" />}
            <p className="text-xs text-gray-400">
              {status === "loading" ? "正在生成二维码..." : waitHint}
            </p>
            <button type="button" onClick={() => void cancel()} className="text-xs text-gray-500 hover:text-red-400">
              取消
            </button>
          </>
        )}
        {status === "success" && (
          <p className="text-xs text-emerald-400">
            权限已提交更新，请在飞书开发者后台确认并发布应用版本。
            <button type="button" onClick={reset} className="ml-1 text-blue-400 hover:underline">关闭</button>
          </p>
        )}
        {status === "error" && (
          <p className="text-xs text-red-400">
            {msg}{" "}
            <button type="button" onClick={() => retryRef.current?.()} className="text-blue-400 hover:underline">
              重试
            </button>
          </p>
        )}
      </div>
    )
  },
)

export default FeishuQrFlow
