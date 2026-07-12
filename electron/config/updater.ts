/**
 * 应用更新入口：组装启动检查 / IPC / 初始化；实现见 updater-*.ts
 */
import { app, ipcMain, shell } from "electron"
import type { BrowserWindow } from "electron"
import type { LatestRelease, UpdaterApplyResult, UpdaterCheckResult } from "./updater-types"
import { resolveAppModalResult, setUpdaterMainWindowGetter, showAppModal } from "./updater-modal"
import {
  DEV_FAKE_LATEST_VERSION,
  STARTUP_CHECK_DELAY_MS,
  buildReleaseNotes,
  devSimulateDetailSuffix,
  fakeLatestReleaseForDev,
  fetchLatestRelease,
  isDevSimulateUpdate,
  resolveReleaseNotes,
} from "./updater-release"
import {
  applyHintForPlatform,
  autoUpdater,
  buildAvailableOrReadyResult,
  clearUpdaterCache,
  invalidateStaleDownload,
  lastKnownRemote,
  manualUpdateUrl,
  readCachedDownloadVersion,
  runBrewUpgrade,
  setLastKnownRemote,
  setWinDownloadRequested,
  showWinDownloadFallback,
  wireAutoUpdater,
} from "./updater-apply"
import semver from "semver"

export type { LatestRelease, UpdaterCheckResult, UpdaterApplyResult } from "./updater-types"
export { fetchLatestRelease } from "./updater-release"

let updaterIpcRegistered = false

/** 启动后延迟检查远程版本并弹窗引导更新 */
async function runStartupUpdateCheck(): Promise<void> {
  if (!app.isPackaged && !isDevSimulateUpdate()) {
    return
  }

  const simulate = isDevSimulateUpdate()
  let rel: LatestRelease | null

  if (simulate) {
    rel = fakeLatestReleaseForDev()
    setLastKnownRemote(rel)
  } else {
    rel = await fetchLatestRelease()
    setLastKnownRemote(rel)
    if (!rel) {
      return
    }
    const cur0 = app.getVersion()
    if (!semver.gt(rel.version, cur0)) {
      return
    }
  }

  const cur = app.getVersion()
  const simSuffix = simulate ? devSimulateDetailSuffix() : ""

  const notes = simulate
    ? buildReleaseNotes(
        [{ version: DEV_FAKE_LATEST_VERSION, date: "", changes: ["模拟更新内容", "用于开发测试"] }],
        cur,
      )
    : await resolveReleaseNotes(cur, rel)
  const notesDetail = notes ? `\n\n更新内容：\n${notes}` : ""

  if (process.platform === "darwin") {
    const r = await showAppModal({
      variant: "info",
      title: "发现新版本",
      message: `新版本 v${rel.version}，当前 v${cur}。`,
      detail: "是否现在更新？" + notesDetail + simSuffix,
      buttons: ["稍后", "立即更新"],
      defaultId: 1,
      cancelId: 0,
    })
    if (r !== 1) return
    if (simulate) {
      await showAppModal({
        variant: "info",
        title: "提示",
        message: "开发测试：未执行真实更新。",
        buttons: ["确定"],
        defaultId: 0,
      })
      return
    }
    const result = await runBrewUpgrade()
    await showAppModal({
      variant: result.ok ? "info" : "error",
      title: result.ok ? "完成" : "更新失败",
      message: result.ok ? (result.message ?? "请重启应用。") : (result.error ?? "未知错误"),
      buttons: ["确定"],
      defaultId: 0,
    })
    return
  }

  if (process.platform === "win32") {
    const r = await showAppModal({
      variant: "info",
      title: "发现新版本",
      message: `新版本 v${rel.version}，当前 v${cur}。`,
      detail: "是否下载并安装？" + notesDetail + simSuffix,
      buttons: ["稍后", "下载并安装"],
      defaultId: 1,
      cancelId: 0,
    })
    if (r !== 1) return
    if (simulate) {
      await showAppModal({
        variant: "info",
        title: "提示",
        message: "开发测试：未执行真实更新。",
        buttons: ["确定"],
        defaultId: 0,
      })
      return
    }
    setWinDownloadRequested(true)
    clearUpdaterCache()
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      setWinDownloadRequested(false)
      await showWinDownloadFallback(e)
    }
    return
  }

  const r = await showAppModal({
    variant: "info",
    title: "发现新版本",
    message: `新版本 v${rel.version}，当前 v${cur}。`,
    detail: "是否在浏览器中打开下载页？" + notesDetail + simSuffix,
    buttons: ["稍后", "打开下载页"],
    defaultId: 1,
    cancelId: 0,
  })
  if (r === 1) {
    await shell.openExternal(rel.htmlUrl)
  }
}

/** 注册 updater / modal 相关 IPC（幂等） */
export function registerUpdaterIpc(): void {
  if (updaterIpcRegistered) {
    return
  }
  updaterIpcRegistered = true

  ipcMain.handle("app:modal-result", (_, payload: { requestId: string; response: number }) => {
    resolveAppModalResult(payload.requestId, payload.response)
  })

  ipcMain.handle("updater:current-version", () => app.getVersion())

  ipcMain.handle("updater:check", async (): Promise<UpdaterCheckResult> => {
    const currentVersion = app.getVersion()
    if (!app.isPackaged) {
      if (isDevSimulateUpdate()) {
        setLastKnownRemote(fakeLatestReleaseForDev())
        const fakeNotes = buildReleaseNotes(
          [{ version: DEV_FAKE_LATEST_VERSION, date: "", changes: ["模拟更新内容", "用于开发测试"] }],
          currentVersion,
        )
        return {
          status: "available",
          currentVersion,
          latestVersion: DEV_FAKE_LATEST_VERSION,
          htmlUrl: lastKnownRemote!.htmlUrl,
          applyHint: applyHintForPlatform(),
          releaseNotes: fakeNotes,
        }
      }
      return {
        status: "dev",
        currentVersion,
        message: "开发版本不检查更新。",
      }
    }
    const rel = await fetchLatestRelease()
    if (!rel) {
      return {
        status: "error",
        currentVersion,
        message: "检查失败（可能原因: GitHub 访问受限），请检查网络后重试。",
      }
    }
    setLastKnownRemote(rel)
    if (semver.gt(rel.version, currentVersion)) {
      return buildAvailableOrReadyResult(currentVersion, rel)
    }
    return {
      status: "latest",
      currentVersion,
      latestVersion: rel.version,
    }
  })

  ipcMain.handle("updater:apply", async (): Promise<UpdaterApplyResult> => {
    if (!app.isPackaged) {
      if (isDevSimulateUpdate()) {
        return { ok: true, message: "开发测试：未执行真实更新。" }
      }
      return { ok: false, error: "开发版本无法更新。" }
    }
    const currentVersion = app.getVersion()
    const rel = lastKnownRemote ?? (await fetchLatestRelease())
    if (rel) setLastKnownRemote(rel)
    if (!rel) {
      return {
        ok: false,
        error: "无法获取远程版本信息（可能原因: GitHub 访问受限）。\n请检查网络后重试。",
      }
    }
    if (!semver.gt(rel.version, currentVersion)) {
      return { ok: false, error: "当前已是最新版本" }
    }

    if (process.platform === "darwin") {
      return runBrewUpgrade()
    }

    if (process.platform === "win32") {
      await invalidateStaleDownload(rel)
      const cached = readCachedDownloadVersion()
      if (cached && semver.eq(cached, rel.version)) {
        autoUpdater.quitAndInstall(false, true)
        return { ok: true, message: "正在安装并重启…" }
      }
      setWinDownloadRequested(true)
      clearUpdaterCache()
      try {
        await autoUpdater.checkForUpdates()
        return { ok: true, message: "正在下载…" }
      } catch (e) {
        setWinDownloadRequested(false)
        const msg = e instanceof Error ? e.message : String(e)
        const dlUrl = manualUpdateUrl(rel.version)
        return {
          ok: false,
          error: [
            msg,
            "",
            "可能原因: 安装包托管在 GitHub，直接访问可能被墙。",
            `手动下载: ${dlUrl}`,
          ].join("\n"),
        }
      }
    }

    await shell.openExternal(rel.htmlUrl)
    return { ok: true, message: "已打开下载页。" }
  })
}

/** 主进程启动时初始化更新器 */
export function initAppUpdater(getMainWindow: () => BrowserWindow | null): void {
  setUpdaterMainWindowGetter(getMainWindow)
  registerUpdaterIpc()
  wireAutoUpdater()
  if (app.isPackaged || isDevSimulateUpdate()) {
    setTimeout(() => {
      void runStartupUpdateCheck()
    }, STARTUP_CHECK_DELAY_MS)
  }
}
