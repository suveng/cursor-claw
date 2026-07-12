import { app, shell } from "electron"
import electronUpdater from "electron-updater"
import type { AppUpdater } from "electron-updater"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as fs from "node:fs"
import * as path from "node:path"
import semver from "semver"
import type { LatestRelease, UpdaterApplyResult, UpdaterCheckResult } from "./updater-types"
import { getUpdaterMainWindow, promptInstallDownloaded, showAppModal } from "./updater-modal"
import {
  GITHUB_OWNER, GITHUB_REPO, HOMEBREW_CASK, HOMEBREW_TAP,
  normalizeReleaseVersion, resolveReleaseNotes,
} from "./updater-release"

const execFileAsync = promisify(execFile)
export const autoUpdater: AppUpdater = (electronUpdater as { autoUpdater: AppUpdater }).autoUpdater

/** 跨入口共享的更新运行时状态 */
export let winDownloadRequested = false
export let lastKnownRemote: LatestRelease | null = null
export let downloadedUpdateVersion: string | null = null
let autoUpdaterWired = false

export function setWinDownloadRequested(v: boolean): void { winDownloadRequested = v }
export function setLastKnownRemote(v: LatestRelease | null): void { lastKnownRemote = v }
export function setDownloadedUpdateVersion(v: string | null): void { downloadedUpdateVersion = v }

export function getUpdaterCacheDir(): string {
  return path.join(app.getPath("userData"), "..", `${app.getName()}-updater`)
}

export function readCachedDownloadVersion(): string | null {
  try {
    const infoPath = path.join(getUpdaterCacheDir(), "pending", "update-info.json")
    if (!fs.existsSync(infoPath)) {
      return null
    }
    const json = JSON.parse(fs.readFileSync(infoPath, "utf-8")) as { version?: string }
    if (typeof json.version !== "string") {
      return null
    }
    const version = normalizeReleaseVersion(json.version)
    return semver.valid(version) ? version : null
  } catch {
    return null
  }
}

export async function invalidateStaleDownload(latest: LatestRelease): Promise<void> {
  const cached = readCachedDownloadVersion()
  downloadedUpdateVersion = cached
  if (!cached) {
    return
  }
  if (semver.eq(cached, latest.version)) {
    return
  }
  clearUpdaterCache()
  downloadedUpdateVersion = null
}

export async function buildAvailableOrReadyResult(
  currentVersion: string,
  rel: LatestRelease,
): Promise<Extract<UpdaterCheckResult, { status: "available" | "ready" }>> {
  await invalidateStaleDownload(rel)
  const notes = await resolveReleaseNotes(currentVersion, rel)
  const base = {
    currentVersion,
    latestVersion: rel.version,
    htmlUrl: rel.htmlUrl,
    applyHint: applyHintForPlatform(),
    releaseNotes: notes,
  }
  const cached = readCachedDownloadVersion()
  downloadedUpdateVersion = cached
  if (cached && semver.eq(cached, rel.version)) {
    return { status: "ready", ...base }
  }
  return { status: "available", ...base }
}
function getBrewExecutable(): string | null {
  const arm = "/opt/homebrew/bin/brew"
  const intel = "/usr/local/bin/brew"
  if (fs.existsSync(arm)) {
    return arm
  }
  if (fs.existsSync(intel)) {
    return intel
  }
  return null
}

const BREW_MANUAL_GUIDE = [
  "手动更新方法（在终端中执行）：",
  `  brew untap ${HOMEBREW_TAP}`,
  `  brew tap ${HOMEBREW_TAP}`,
  `  brew upgrade --cask ${HOMEBREW_CASK}`,
  "  xattr -cr /Applications/Cursor\\ Claw.app",
  "",
  `FAQ: https://github.com/${HOMEBREW_TAP}`,
].join("\n")

export async function runBrewUpgrade(): Promise<UpdaterApplyResult> {
  const brew = getBrewExecutable()
  if (!brew) {
    return { ok: false, error: `未找到 Homebrew（/opt/homebrew 或 /usr/local）\n\n${BREW_MANUAL_GUIDE}` }
  }
  const brewEnv = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`,
  }
  try {
    await execFileAsync(brew, ["tap", HOMEBREW_TAP], { timeout: 120_000, env: brewEnv })
    await execFileAsync(brew, ["update"], { timeout: 300_000, env: brewEnv })
    await execFileAsync(brew, ["upgrade", "--cask", HOMEBREW_CASK], { timeout: 600_000, env: brewEnv })
    return {
      ok: true,
      message: "更新已完成，请重启应用。",
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `brew 执行失败：${msg}\n\n${BREW_MANUAL_GUIDE}` }
  }
}

export function manualUpdateUrl(version: string): string {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/cursor-claw-setup-${version}.exe`
}

export async function showWinDownloadFallback(reason: unknown): Promise<void> {
  const ver = lastKnownRemote?.version ?? ""
  const errMsg =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : String(reason)
  const downloadUrl = ver ? manualUpdateUrl(ver) : (lastKnownRemote?.htmlUrl ?? "")
  const detail = [
    `错误: ${errMsg}`,
    "",
    "可能原因: 安装包托管在 GitHub，直接访问可能被墙。",
    "",
    downloadUrl ? "点击「手动下载」可在浏览器中打开安装包下载链接。" : "",
  ].filter(Boolean).join("\n")

  const buttons = downloadUrl ? ["关闭", "手动下载"] : ["关闭"]
  const r = await showAppModal({
    variant: "warning",
    title: "自动更新失败",
    message: "无法自动下载更新，请尝试手动更新。",
    detail,
    buttons,
    defaultId: downloadUrl ? 1 : 0,
    cancelId: 0,
  })
  if (r === 1 && downloadUrl) {
    await shell.openExternal(downloadUrl)
  }
}

export function clearUpdaterCache(): void {
  try {
    const cacheDir = getUpdaterCacheDir()
    if (!fs.existsSync(cacheDir)) return
    for (const entry of fs.readdirSync(cacheDir)) {
      fs.rmSync(path.join(cacheDir, entry), { recursive: true, force: true })
    }
    downloadedUpdateVersion = null
  } catch { /* best-effort */ }
}

export function wireAutoUpdater(): void {
  if (autoUpdaterWired || !app.isPackaged) {
    return
  }
  autoUpdaterWired = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on("update-available", () => {
    getUpdaterMainWindow()?.webContents.send("updater:status", { kind: "available" as const })
    if (winDownloadRequested && process.platform === "win32") {
      winDownloadRequested = false
      getUpdaterMainWindow()?.webContents.send("updater:status", { kind: "downloading" as const })
      void autoUpdater.downloadUpdate().catch((err: unknown) => {
        void showWinDownloadFallback(err)
      })
    }
  })

  autoUpdater.on("update-not-available", () => {
    if (winDownloadRequested && process.platform === "win32") {
      winDownloadRequested = false
      void showWinDownloadFallback(new Error("未找到可用更新"))
    }
  })

  autoUpdater.on("download-progress", (p) => {
    getUpdaterMainWindow()?.webContents.send("updater:progress", p.percent)
  })

  autoUpdater.on("update-downloaded", (info) => {
    const version = normalizeReleaseVersion(info.version)
    downloadedUpdateVersion = semver.valid(version) ? version : null
    getUpdaterMainWindow()?.webContents.send("updater:status", {
      kind: "downloaded" as const,
      version: downloadedUpdateVersion ?? version,
    })
    promptInstallDownloaded(downloadedUpdateVersion ?? version, () => {
      autoUpdater.quitAndInstall(false, true)
    })
  })

  autoUpdater.on("error", (err) => {
    if (winDownloadRequested && process.platform === "win32") {
      winDownloadRequested = false
      void showWinDownloadFallback(err)
    }
    getUpdaterMainWindow()?.webContents.send("updater:error", err.message)
  })
}

export function applyHintForPlatform(): string {
  if (process.platform === "darwin") {
    return "可在下一步确认后开始更新。"
  }
  if (process.platform === "win32") {
    return "将下载并安装，完成后按提示重启。"
  }
  return "将打开下载页面。"
}
