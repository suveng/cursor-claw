import type { BrowserWindow } from "electron"

/** GitHub latest release 摘要 */
export interface LatestRelease {
  version: string
  htmlUrl: string
  releaseBody?: string
}

/** CHANGELOG 单条版本记录 */
export interface ChangelogEntry {
  version: string
  date: string
  changes: string[]
}

/** 检查更新 IPC 返回值 */
export type UpdaterCheckResult =
  | { status: "dev"; currentVersion: string; message: string }
  | { status: "error"; currentVersion: string; message: string }
  | { status: "latest"; currentVersion: string; latestVersion: string }
  | {
      status: "available"
      currentVersion: string
      latestVersion: string
      htmlUrl: string
      applyHint: string
      releaseNotes: string
    }
  | {
      status: "ready"
      currentVersion: string
      latestVersion: string
      htmlUrl: string
      applyHint: string
      releaseNotes: string
    }

/** 应用更新 IPC 返回值 */
export interface UpdaterApplyResult {
  ok: boolean
  error?: string
  message?: string
}

/** 应用内模态框请求参数 */
export interface AppModalOptions {
  variant?: "info" | "error" | "warning"
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
}

export type MainWindowGetter = () => BrowserWindow | null
