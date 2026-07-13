/**
 * SDK 平台二进制路径（ripgrep）与第三方插件 patch。
 * 从 agent-sdk 入口拆出，保持单文件 ≤300。
 */
import { resolve, join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { ensureSdkThirdPartyPluginPatch } from "./ensure-sdk-plugin-patch"
import { pushUiLog } from "../../app/ui-logger"

/** 解析 SDK 平台包内 ripgrep 路径，并确保第三方插件 patch 已应用 */
export function ensureSdkBinaryPaths(): void {
  ensureSdkThirdPartyPluginPatch()
  if (process.env.CURSOR_RIPGREP_PATH) return
  const platformPkg = `@cursor/sdk-${process.platform}-${process.arch}`
  const binaryName = process.platform === "win32" ? "rg.exe" : "rg"
  const candidates: string[] = []
  try {
    const req = createRequire(import.meta.url)
    const pkgDir = dirname(req.resolve(`${platformPkg}/package.json`))
    candidates.push(join(pkgDir, "bin", binaryName))
  } catch { /* package not resolvable */ }
  const appDir = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  for (const base of [appDir, resolve(".")]) {
    candidates.push(join(base, "node_modules", platformPkg, "bin", binaryName))
    candidates.push(join(base, "resources", "node_modules", platformPkg, "bin", binaryName))
  }
  for (const p of candidates) {
    const real = p.includes("app.asar") && !p.includes("app.asar.unpacked")
      ? p.replace("app.asar", "app.asar.unpacked")
      : p
    if (existsSync(real)) {
      process.env.CURSOR_RIPGREP_PATH = real
      pushUiLog("SDK", "INFO", `Ripgrep 路径: ${real}`)
      return
    }
  }
  pushUiLog("SDK", "WARN", `未找到 ${binaryName}，SDK 可能报错 (searched: ${candidates.join(", ")})`)
}
