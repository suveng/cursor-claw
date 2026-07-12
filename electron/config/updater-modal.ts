import { BrowserWindow, dialog } from "electron"
import { randomUUID } from "node:crypto"
import type { AppModalOptions, MainWindowGetter } from "./updater-types"

interface ModalQueueItem {
  options: AppModalOptions
  resolve: (index: number) => void
}

const pendingModalResolvers = new Map<string, (index: number) => void>()
const modalWaitQueue: ModalQueueItem[] = []
let modalProcessor: Promise<void> | null = null
let mainWindowGetter: MainWindowGetter | null = null

/** 由 initAppUpdater 注入主窗口 getter */
export function setUpdaterMainWindowGetter(getter: MainWindowGetter): void {
  mainWindowGetter = getter
}

function getMainWindow(): BrowserWindow | null {
  return mainWindowGetter?.() ?? null
}

/** IPC app:modal-result 回调：解析对应 requestId */
export function resolveAppModalResult(requestId: string, response: number): void {
  const fn = pendingModalResolvers.get(requestId)
  if (fn) {
    pendingModalResolvers.delete(requestId)
    fn(response)
  }
}

async function showAppModalOnce(options: AppModalOptions): Promise<number> {
  const w = getMainWindow()
  if (!w || w.isDestroyed()) {
    const type =
      options.variant === "error" ? "error" : options.variant === "warning" ? "warning" : "info"
    const detailPart = options.detail ? `\n\n${options.detail}` : ""
    const r = await dialog.showMessageBox({
      type,
      title: options.title,
      message: options.message + detailPart,
      buttons: options.buttons,
      defaultId: options.defaultId ?? 0,
      cancelId: options.cancelId ?? 0,
    })
    return r.response
  }
  const requestId = randomUUID()
  return new Promise((resolve) => {
    pendingModalResolvers.set(requestId, resolve)
    w.webContents.send("app:modal-request", {
      requestId,
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: options.buttons,
      defaultId: options.defaultId,
      cancelId: options.cancelId,
      variant: options.variant,
    })
  })
}

function ensureModalProcessor(): void {
  if (modalProcessor) {
    return
  }
  modalProcessor = (async () => {
    while (modalWaitQueue.length > 0) {
      const item = modalWaitQueue.shift()
      if (!item) {
        break
      }
      const idx = await showAppModalOnce(item.options)
      item.resolve(idx)
    }
  })().finally(() => {
    modalProcessor = null
    if (modalWaitQueue.length > 0) {
      ensureModalProcessor()
    }
  })
}

/** 排队展示应用内模态（避免多弹窗并发） */
export function showAppModal(options: AppModalOptions): Promise<number> {
  return new Promise((resolve) => {
    modalWaitQueue.push({ options, resolve })
    ensureModalProcessor()
  })
}

/** 下载完成后询问是否立即安装；install 由 apply 层注入以避免循环依赖 */
export function promptInstallDownloaded(version: string, install: () => void): void {
  void showAppModal({
    variant: "info",
    title: "更新已就绪",
    message: `新版本 v${version} 已下载，是否立即安装并重启？`,
    buttons: ["稍后", "立即安装"],
    defaultId: 1,
    cancelId: 0,
  }).then((resp) => {
    if (resp === 1) {
      setImmediate(() => {
        install()
      })
    }
  })
}

export function getUpdaterMainWindow(): BrowserWindow | null {
  return getMainWindow()
}
