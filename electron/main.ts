import { app, BrowserWindow, ipcMain, dialog } from "electron"
import * as path from "node:path"
import * as fs from "node:fs"
import { getConfig, saveConfig, markCliMigrationNotified } from "./config/config-store"
import { registerSkillsIpcHandlers } from "./skills-ipc"
import { registerPluginIpcHandlers } from "./plugin-ipc"
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  getQueueMessages,
  deleteQueueMessage,
  clearMessageQueue,
  initDaemonManager,
  cleanupDaemonManager,
  saveAppConfigFromRenderer,
  checkSdkApiKey,
  listSdkModels,
  checkClaudeCodeApiKey,
  CLAUDE_CODE_MODEL_LIST,
  CODEX_MODEL_LIST,
} from "./daemon/daemon-manager"
import { closeAllEmbeddedOpencodeServers } from "./agent/opencode/agent-opencode-utils"
import {
  getMcpServerList,
  getMcpServerListForWorkspace,
  saveMcpServer,
  deleteMcpServer,
  loginMcpServer,
  toggleMcpServer,
  getMcpEnabledMap,
  getMcpServerTools,
  getMcpStatusMap,
} from "./mcp/mcp-manager"
import { getSessionMcpStatus } from "./session/session-mcp-status"
import { injectWorkspace } from "./agent/shared/workspace-injector"
import { initTray, destroyTray } from "./app/tray"
import { initAppUpdater } from "./config/updater"
import { broadcastLog } from "./app/ui-logger"
import { formatUnknownError } from "../src/shared/format-unknown-error"
import { createWindow, mainWindow, setCloseConfirmDialogOpen } from "./app/main-window"

const profileArg = process.argv.find((a) => a.startsWith("--profile="))
const profileName = profileArg?.split("=")[1] || ""
if (profileName) {
  const baseDir = path.dirname(app.getPath("userData"))
  app.setPath("userData", path.join(baseDir, `cursor-claw-${profileName}`))
}

/** 同步开机自启系统设置到配置值（开发模式跳过，避免把 electron.exe 注册为自启） */
function applyLoginItemSetting(enabled: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: profileName ? [`--profile=${profileName}`] : [],
    })
  } catch (e) {
    console.error("[main] 设置开机自启失败:", e)
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("window:minimize", () => mainWindow?.minimize())
  ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle("window:close", () => mainWindow?.close())
  ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle("config:get", () => getConfig())
  ipcMain.handle("config:save", (_, config) => saveAppConfigFromRenderer(config))
  ipcMain.handle("config:mark-cli-migration-notified", () => {
    markCliMigrationNotified()
    return { ok: true }
  })
  ipcMain.handle("app:set-auto-start", (_, enabled: boolean) => {
    saveConfig({ autoStart: enabled })
    applyLoginItemSetting(enabled)
    return { ok: true }
  })

  ipcMain.handle(
    "window:close-confirm-result",
    (_, payload: { action: "minimize" | "quit" | "cancel"; remember: boolean }) => {
      const win = mainWindow
      setCloseConfirmDialogOpen(false)
      if (!win || win.isDestroyed()) {
        return
      }
      if (payload.action === "cancel") {
        return
      }
      if (payload.remember) {
        saveConfig({
          closeWindowAction: payload.action === "minimize" ? "minimize" : "quit",
        })
      }
      if (payload.action === "minimize") {
        win.hide()
        return
      }
      isQuitting = true
      win.close()
    },
  )

  ipcMain.handle("dialog:selectDirectory", async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "选择工作目录",
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle("workspace:inject", () => injectWorkspace())
  ipcMain.handle("daemon:start", () => startDaemon())
  ipcMain.handle("daemon:stop", () => stopDaemon())
  ipcMain.handle("daemon:status", () => getDaemonStatus())
  ipcMain.handle("daemon:queue", () => getQueueMessages())
  ipcMain.handle("daemon:queue-delete", (_e, fileId: string) => deleteQueueMessage(fileId))
  ipcMain.handle("daemon:queue-clear", () => clearMessageQueue())
  ipcMain.handle("mcp:list-all", () => getMcpServerList())
  ipcMain.handle("mcp:list-for-workspace", (_, workspaceDir: string) => getMcpServerListForWorkspace(workspaceDir))
  ipcMain.handle("mcp:save", (_, name: string, entry: Record<string, unknown>, source: "global" | "project") => {
    saveMcpServer(name, entry, source)
    return { ok: true }
  })
  ipcMain.handle("mcp:delete", (_, name: string) => {
    const server = getMcpServerList().find((s) => s.name === name)
    if (!server) return { ok: false, error: "MCP 服务器不存在" }
    return deleteMcpServer(name, server.source)
  })
  ipcMain.handle("mcp:login", (_, name: string, workspaceDir?: string) => loginMcpServer(name, workspaceDir))
  ipcMain.handle("mcp:toggle", (_, name: string, enabled: boolean) => toggleMcpServer(name, enabled))
  ipcMain.handle("mcp:enabled-map", (_, force?: boolean) => getMcpEnabledMap(force ?? false))
  ipcMain.handle("mcp:status-map", (_, force?: boolean, workspaceDir?: string) => getMcpStatusMap(force ?? false, workspaceDir))
  ipcMain.handle("mcp:tools", (_, name: string, workspaceDir?: string) => getMcpServerTools(name, workspaceDir))
  // 按 sessionKey 取运行时 MCP 状态（CC runtime/snapshot/disk、SDK 注入快照）；供 SessionMcpPanel 展示
  ipcMain.handle(
    "agent:mcp-status",
    (_e, sessionKey: string, force?: boolean, engineType?: string, workspaceDir?: string) =>
      getSessionMcpStatus(sessionKey, force, engineType, workspaceDir),
  )

  ipcMain.handle("rules:list", () => {
    const config = getConfig()
    if (!config.workspaceDir) return []
    const rulesDir = path.join(config.workspaceDir, ".cursor", "rules")
    if (!fs.existsSync(rulesDir)) return []
    return fs.readdirSync(rulesDir)
      .filter((f) => f.endsWith(".mdc") || f.endsWith(".md"))
      .map((f) => ({
        name: f,
        content: fs.readFileSync(path.join(rulesDir, f), "utf-8"),
      }))
  })

  ipcMain.handle("rules:save", (_, name: string, content: string) => {
    const config = getConfig()
    if (!config.workspaceDir) {
      return { ok: false, error: "未配置主工作区，无法保存规则。请先在「通用」中设置主工作区。" }
    }
    const rulesDir = path.join(config.workspaceDir, ".cursor", "rules")
    if (!fs.existsSync(rulesDir)) fs.mkdirSync(rulesDir, { recursive: true })
    fs.writeFileSync(path.join(rulesDir, name), content, "utf-8")
    return { ok: true, workspaceDir: config.workspaceDir }
  })

  ipcMain.handle("rules:delete", (_, name: string) => {
    const config = getConfig()
    if (!config.workspaceDir) {
      return { ok: false, error: "未配置主工作区，无法删除规则。请先在「通用」中设置主工作区。" }
    }
    const filePath = path.join(config.workspaceDir, ".cursor", "rules", name)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return { ok: true, workspaceDir: config.workspaceDir }
  })

  registerSkillsIpcHandlers()
  registerPluginIpcHandlers()

  ipcMain.handle("sdk:check-api-key", (_, apiKey: string) => checkSdkApiKey(apiKey))
  ipcMain.handle("sdk:list-models", (_, apiKey: string, currentModel?: string, currentParams?: string) => listSdkModels(apiKey, currentModel, currentParams))
  ipcMain.handle("cc:check-api-key", (_, apiKey: string, baseUrl?: string) => checkClaudeCodeApiKey(apiKey, baseUrl))
  ipcMain.handle("cc:list-models", () => CLAUDE_CODE_MODEL_LIST)
  ipcMain.handle("codex:list-models", () => CODEX_MODEL_LIST)
}

let isQuitting = false

// 第三方 SDK（如 @cursor/sdk）深处的异步 socket 错误无法在调用点捕获，
// 全局兜底记日志，避免 Electron 默认弹出 "JavaScript error in main process" 并中断运行
process.on("uncaughtException", (err) => {
  try {
    broadcastLog(
      `[Main] 未捕获异常: ${formatUnknownError(err, { includeRegistrationHint: true })}`,
      "ERROR",
    )
  } catch { console.error("[Main] uncaughtException:", err) }
})
process.on("unhandledRejection", (reason, promise) => {
  try {
    const detail = formatUnknownError(reason, { includeRegistrationHint: true })
    const promiseCtx = promise ? ` | promise=${Object.prototype.toString.call(promise)}` : ""
    broadcastLog(`[Main] 未处理的 Promise 拒绝: ${detail}${promiseCtx}`, "ERROR")
  } catch { console.error("[Main] unhandledRejection:", reason) }
})

app.on("before-quit", () => {
  isQuitting = true
  // best-effort 关闭内嵌 OpenCode server，避免 resident 缓存进程残留
  closeAllEmbeddedOpencodeServers()
})

app.whenReady().then(() => {
  registerIpcHandlers()
  applyLoginItemSetting(getConfig().autoStart)
  createWindow({
    profileName,
    getIsQuitting: () => isQuitting,
    setIsQuitting: (v) => {
      isQuitting = v
    },
  })
  initAppUpdater(() => mainWindow)
  initTray()
  initDaemonManager()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow({
      profileName,
      getIsQuitting: () => isQuitting,
      setIsQuitting: (v) => {
        isQuitting = v
      },
    })
  } else {
    mainWindow?.show()
  }
})

app.on("will-quit", () => {
  cleanupDaemonManager()
  destroyTray()
})
