/** plugin:inventory IPC 注册 */
import { ipcMain } from "electron"
import { buildPluginInventoryResult } from "./mcp/loaders/plugin-inventory"

/** 注册 plugin:* IPC handler */
export function registerPluginIpcHandlers(): void {
  ipcMain.handle("plugin:inventory", (_, workspaceDir: string) =>
    buildPluginInventoryResult(workspaceDir ?? ""),
  )
}
