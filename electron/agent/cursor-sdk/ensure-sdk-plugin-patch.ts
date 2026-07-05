/**
 * 启动时确保 @cursor/sdk createLocalExecutor 在 settingSources 含 plugins 时
 * 开启 importThirdPartyPlugins（SDK headless 默认 false，与 IDE 不一致）。
 */
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as path from "node:path"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const MARKER =
  'importThirdPartyPlugins:!(null==r.settingSources||!r.settingSources.some((s=>"plugins"===s||"all"===s)))'
const TARGET = "settingSources:r.settingSources,mcpServers:r.mcpServers"
const REPLACEMENT = `settingSources:r.settingSources,${MARKER},mcpServers:r.mcpServers`

let ensured = false

/** 解析 @cursor/sdk dist 目录（开发 / 打包 asar.unpacked） */
function resolveSdkDistDirs(): string[] {
  const dirs: string[] = []
  try {
    const req = createRequire(import.meta.url)
    const pkgDir = dirname(req.resolve("@cursor/sdk/package.json"))
    dirs.push(join(pkgDir, "dist"))
  } catch { /* ignore */ }

  const appDir = process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
  for (const base of [appDir, resolve("."), dirname(fileURLToPath(import.meta.url))]) {
    dirs.push(join(base, "node_modules", "@cursor/sdk", "dist"))
    dirs.push(join(base, "resources", "node_modules", "@cursor/sdk", "dist"))
  }
  return [...new Set(dirs.map((d) => (d.includes("app.asar") && !d.includes("app.asar.unpacked")
    ? d.replace("app.asar", "app.asar.unpacked")
    : d)))]
}

/** 对单个 357.js 打 patch（幂等） */
function patchSdkChunk(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false
  const src = fs.readFileSync(filePath, "utf-8")
  if (src.includes(MARKER)) return true
  if (!src.includes(TARGET)) return false
  fs.writeFileSync(filePath, src.replace(TARGET, REPLACEMENT), "utf-8")
  return true
}

/** 应用 SDK 第三方插件 patch */
export function ensureSdkThirdPartyPluginPatch(): boolean {
  if (ensured) return true
  ensured = true
  let ok = false
  for (const dist of resolveSdkDistDirs()) {
    if (patchSdkChunk(join(dist, "esm", "357.js"))) ok = true
    if (patchSdkChunk(join(dist, "cjs", "357.js"))) ok = true
  }
  return ok
}
