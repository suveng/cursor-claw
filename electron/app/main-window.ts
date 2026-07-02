import { app, BrowserWindow, dialog, shell } from "electron"
import * as path from "node:path"
import * as fs from "node:fs"
import { getConfig } from "../config/config-store"

/** 与 renderer bg-gray-950 一致，加载前避免纯黑闪烁 */
const WINDOW_BACKGROUND = "#030712"

export let mainWindow: BrowserWindow | null = null
export let closeConfirmDialogOpen = false

export function setCloseConfirmDialogOpen(value: boolean): void {
  closeConfirmDialogOpen = value
}

/** createWindow 依赖的退出状态（由 main.ts 注入，避免循环 import） */
export interface CreateWindowOptions {
  profileName: string
  getIsQuitting: () => boolean
  setIsQuitting: (v: boolean) => void
}

function resolveIcon(): string {
  const dir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources")
  if (process.platform === "win32") {
    const ico = path.join(dir, "icon.ico")
    if (fs.existsSync(ico)) return ico
  }
  return path.join(dir, "icon.png")
}

/** 打包后 __dirname 为 out/main，renderer 与 main 同级在 out/ 下 */
function getRendererHtmlPath(): string {
  return path.join(__dirname, "../renderer/index.html")
}

/** 仅开发模式且存在 Vite URL 时走 dev server；打包版忽略残留环境变量 */
function shouldLoadDevUrl(): boolean {
  return !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
}

function installWindowCloseHandler(win: BrowserWindow, opts: CreateWindowOptions): void {
  win.on("close", (e) => {
    if (opts.getIsQuitting()) {
      return
    }

    const pref = getConfig().closeWindowAction

    if (pref === "minimize") {
      e.preventDefault()
      win.hide()
      return
    }

    if (pref === "quit") {
      opts.setIsQuitting(true)
      return
    }

    e.preventDefault()
    if (closeConfirmDialogOpen) {
      return
    }
    closeConfirmDialogOpen = true
    win.webContents.send("window:close-confirm")
  })
}

/** 加载 renderer：dev 用 ELECTRON_RENDERER_URL，打包始终 loadFile */
function loadRendererContent(win: BrowserWindow): boolean {
  const htmlPath = getRendererHtmlPath()

  if (shouldLoadDevUrl()) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!)
    return true
  }

  win.loadFile(htmlPath)
  return false
}

/** 开发 loadURL 失败时 fallback 到本地 index.html */
function installLoadFailureHandler(win: BrowserWindow, usedDevUrl: boolean): void {
  if (!usedDevUrl) {
    return
  }

  let fallbackAttempted = false
  const htmlPath = getRendererHtmlPath()

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[main-window] did-fail-load:", code, desc, url)

    if (fallbackAttempted || app.isPackaged) {
      return
    }

    fallbackAttempted = true
    console.error("[main-window] dev loadURL 失败，fallback 到 loadFile:", htmlPath)
    void win.loadFile(htmlPath)
    dialog.showErrorBox(
      "页面加载失败",
      "开发服务器连接失败，已尝试加载本地构建文件。请确认 Vite 是否正在运行。",
    )
  })
}

export function createWindow(opts: CreateWindowOptions): void {
  const iconPath = resolveIcon()

  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 780,
    minHeight: 560,
    title: opts.profileName ? `Cursor Claw [${opts.profileName}]` : "Cursor Claw",
    icon: iconPath,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: {
      // 打包后 __dirname 为 out/main，preload 与 main 同级在 out/ 下
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show()
  })

  installWindowCloseHandler(mainWindow, opts)

  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized-change", true))
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:maximized-change", false))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  const usedDevUrl = loadRendererContent(mainWindow)
  installLoadFailureHandler(mainWindow, usedDevUrl)
}
