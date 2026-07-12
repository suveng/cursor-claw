import { useState, useEffect, useRef } from "react"
import { Loader2, Download, Github, ExternalLink } from "lucide-react"

/** Settings 关于 Tab：版本检查 / 安装更新 / GitHub 入口（状态自包含） */
export default function SettingsAboutTab() {
  const [appVersion, setAppVersion] = useState("")
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateCheck, setUpdateCheck] = useState<Awaited<ReturnType<typeof window.electronAPI.checkAppUpdate>> | null>(null)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [updateDownloadPct, setUpdateDownloadPct] = useState<number | null>(null)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const updateDownloadingRef = useRef(false)

  useEffect(() => {
    void window.electronAPI.getAppVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    updateDownloadingRef.current = updateDownloading
  }, [updateDownloading])

  useEffect(() => {
    const offS = window.electronAPI.onUpdaterStatus((s) => {
      if (s.kind === "downloading") {
        setUpdateDownloading(true)
        setUpdateDownloadPct(null)
        setUpdateMsg("正在下载更新…")
      }
      if (s.kind === "downloaded") {
        setUpdateDownloading(false)
        setUpdateDownloadPct(null)
        setUpdateMsg(`新版本 v${s.version} 已下载，可立即安装。`)
        void window.electronAPI.checkAppUpdate().then((r) => {
          if (r.status === "ready" || r.status === "available") setUpdateCheck(r)
        })
      }
    })
    const offP = window.electronAPI.onUpdaterProgress((pct) => {
      if (!updateDownloadingRef.current) return
      const p = Math.round(pct)
      setUpdateDownloadPct(p)
      setUpdateMsg(`正在下载更新… ${p}%`)
    })
    const offE = window.electronAPI.onUpdaterError((m) => {
      setUpdateDownloading(false)
      setUpdateDownloadPct(null)
      setUpdateMsg((prev) => (prev ? `${prev}\n${m}` : m))
    })
    return () => { offS(); offP(); offE() }
  }, [])

  useEffect(() => {
    void window.electronAPI.checkAppUpdate().then((r) => {
      if (r.status === "ready") {
        setUpdateCheck(r)
        setUpdateDownloading(false)
        setUpdateDownloadPct(null)
        setUpdateMsg(`新版本 v${r.latestVersion} 已下载，可立即安装。`)
      } else if (r.status === "available") {
        setUpdateCheck(r)
        if (!updateDownloading) {
          setUpdateMsg(`发现新版本 v${r.latestVersion}，当前 v${r.currentVersion}。`)
        }
      } else if (r.status === "latest") {
        setUpdateCheck(r)
        setUpdateDownloading(false)
        setUpdateDownloadPct(null)
      }
    })
  }, [])

  const handleCheckUpdate = async () => {
    setUpdateBusy(true)
    setUpdateMsg(null)
    setUpdateCheck(null)
    setUpdateDownloadPct(null)
    setUpdateDownloading(false)
    try {
      const r = await window.electronAPI.checkAppUpdate()
      setUpdateCheck(r)
      if (r.status === "latest") setUpdateMsg(`已是最新 v${r.latestVersion}。`)
      else if (r.status === "dev" || r.status === "error") setUpdateMsg(r.message)
      else if (r.status === "available") setUpdateMsg(`发现新版本 v${r.latestVersion}，当前 v${r.currentVersion}。`)
      else if (r.status === "ready") setUpdateMsg(`新版本 v${r.latestVersion} 已下载，可立即安装。`)
    } finally {
      setUpdateBusy(false)
    }
  }

  const handleApplyUpdate = async () => {
    setUpdateBusy(true)
    setUpdateMsg("正在连接更新服务器…")
    try {
      const res = await window.electronAPI.applyAppUpdate()
      if (res.ok) {
        setUpdateMsg(res.message ?? "已触发更新流程。")
        setUpdateCheck(null)
      } else {
        setUpdateDownloading(false)
        setUpdateDownloadPct(null)
        setUpdateMsg(res.error ?? "更新失败")
      }
    } finally {
      setUpdateBusy(false)
    }
  }

  return (
    <>
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-300">应用更新</h3>
        <p className="text-xs text-gray-600">
          当前 <span className="font-mono text-gray-400">v{appVersion || "…"}</span>
          ，可检查是否有新版本。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={updateBusy || updateDownloading}
            onClick={() => void handleCheckUpdate()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-2 text-sm transition hover:border-blue-500 hover:bg-gray-800 disabled:opacity-50"
          >
            {updateBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            检查更新
          </button>
          {updateCheck?.status === "available" && (
            <button type="button" disabled={updateBusy || updateDownloading} onClick={() => void handleApplyUpdate()}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-500 bg-blue-500/15 px-4 py-2 text-sm text-blue-200 transition hover:bg-blue-500/25 disabled:opacity-50">立即更新</button>
          )}
          {updateCheck?.status === "ready" && (
            <button type="button" disabled={updateBusy} onClick={() => void handleApplyUpdate()}
              className="inline-flex items-center gap-2 rounded-lg border border-green-500 bg-green-500/15 px-4 py-2 text-sm text-green-200 transition hover:bg-green-500/25 disabled:opacity-50">立即安装</button>
          )}
        </div>
        {(updateCheck?.status === "available" || updateCheck?.status === "ready") && updateCheck.releaseNotes && (
          <div className="rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2">
            <p className="mb-1.5 text-xs font-medium text-gray-300">更新内容</p>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-400">{updateCheck.releaseNotes}</p>
          </div>
        )}
        {updateMsg && (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2 text-xs text-gray-400">{updateMsg}</p>
            {updateDownloading && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                <div className="h-full rounded-full bg-blue-500 transition-[width] duration-300 ease-out"
                  style={{ width: updateDownloadPct === null ? "0%" : `${updateDownloadPct}%` }} />
              </div>
            )}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-300">项目信息</h3>
        <a href="https://github.com/lk-eternal/cursor-claw" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-2 text-sm text-gray-300 transition hover:border-blue-500 hover:bg-gray-800 hover:text-blue-400">
          <Github size={16} />GitHub 仓库<ExternalLink size={12} className="text-gray-500" />
        </a>
      </section>
    </>
  )
}
