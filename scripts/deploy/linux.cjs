/**
 * Linux 本地打包统一入口。
 *
 * 用法:
 *   node scripts/deploy/linux.cjs [--mode=dist|pack] [--version=<semver>] [--no-install] [--help]
 *   npm run dist:linux
 *   npm run pack:linux
 */

const { spawn, execFileSync } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { ROOT, runChecks, resolveVersion, run, findReleaseFile } = require("./pipeline.cjs")

const APP_NAME = "cursor-claw"
const PRODUCT_NAME = "Cursor Claw"
const DEFAULT_PROFILE = "swg"
const INSTALL_OPT_DIR = path.join(os.homedir(), ".local", "opt", "cursor-claw")
const INSTALL_APP_IMAGE = path.join(os.homedir(), ".local", "bin", `${APP_NAME}.AppImage`)

function parseArgs(argv) {
  const args = argv.slice(2)
  let mode = "dist", version, help = false, install = true, profile = DEFAULT_PROFILE, artifact = "appimage"

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") help = true
    else if (arg === "--no-install") install = false
    else if (arg === "--no-profile") profile = ""
    else if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length)
      if (!profile) { console.error("错误: --profile 不能为空"); process.exit(1) }
    } else if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length)
      if (value !== "dist" && value !== "pack") { console.error(`错误: 无效 --mode "${value}"`); process.exit(1) }
      mode = value
    } else if (arg.startsWith("--artifact=")) {
      const value = arg.slice("--artifact=".length)
      if (!["appimage", "deb", "all"].includes(value)) { console.error(`错误: 无效 --artifact "${value}"`); process.exit(1) }
      artifact = value
    } else if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length)
      if (!version) { console.error("错误: --version 不能为空"); process.exit(1) }
    } else {
      console.error(`错误: 未知参数 "${arg}"，使用 --help 查看用法`)
      process.exit(1)
    }
  }
  return { mode, version, help, install, profile, artifact }
}

function printHelp() {
  console.log(`
Linux 本地打包脚本

用法: node scripts/deploy/linux.cjs [选项]

选项:
  --mode=dist|pack        dist=安装包（默认 AppImage）；pack=目录包
  --artifact=appimage|deb|all   dist 产物（默认 appimage；deb 需 fakeroot/dpkg）
  --version=<semver>      覆盖版本（不写回 package.json）
  --no-install            仅打包
  --profile=<name>        启动 profile（默认 swg）
  --no-profile            使用默认 userData
  --help, -h

默认: dist → ~/.local/bin/cursor-claw.AppImage；pack → ~/.local/opt/cursor-claw

示例:
  npm run dist:linux
  node scripts/deploy/linux.cjs --profile=dev --no-install
  node scripts/deploy/linux.cjs --artifact=deb
`.trim())
}

async function runPipeline(mode, resolvedVersion, artifact) {
  await run("npm", ["run", "build"])
  const ebArgs = ["electron-builder", "--linux", "--publish", "never", `--config.extraMetadata.version=${resolvedVersion}`]
  if (mode === "pack") ebArgs.push("--dir")
  else if (artifact === "appimage") ebArgs.push("--config.linux.target=AppImage")
  else if (artifact === "deb") ebArgs.push("--config.linux.target=deb")
  console.log(`→ npx ${ebArgs.join(" ")}`)
  await run("npx", ebArgs)
}

function requireRelease(candidates, label) {
  const found = findReleaseFile(candidates)
  if (!found) {
    console.error(`错误: 未找到 ${label}，已尝试: ${candidates.join(", ")}`)
    process.exit(1)
  }
  return found
}

function launchExecutable(execPath, profile) {
  const args = profile ? [`--profile=${profile}`] : []
  console.log(profile ? `→ 启动（--profile=${profile}）` : "→ 启动（无 profile）")
  const child = spawn(execPath, args, { detached: true, stdio: "ignore", env: process.env })
  child.unref()
}

function installUnpackedDir(srcDir, profile) {
  console.log(`→ 安装到 ${INSTALL_OPT_DIR}`)
  if (fs.existsSync(INSTALL_OPT_DIR)) fs.rmSync(INSTALL_OPT_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(INSTALL_OPT_DIR), { recursive: true })
  execFileSync("cp", ["-a", `${srcDir}/.`, INSTALL_OPT_DIR], { stdio: "inherit" })
  const execPath = path.join(INSTALL_OPT_DIR, APP_NAME)
  if (!fs.existsSync(execPath)) { console.error(`错误: 未找到 ${execPath}`); process.exit(1) }
  fs.chmodSync(execPath, 0o755)
  launchExecutable(execPath, profile)
}

function installAppImage(src, profile) {
  fs.mkdirSync(path.dirname(INSTALL_APP_IMAGE), { recursive: true })
  fs.copyFileSync(src, INSTALL_APP_IMAGE)
  fs.chmodSync(INSTALL_APP_IMAGE, 0o755)
  console.log(`✓ AppImage → ${INSTALL_APP_IMAGE}`)
  launchExecutable(INSTALL_APP_IMAGE, profile)
}

function installDeb(debPath, profile) {
  execFileSync("sudo", ["dpkg", "-i", debPath], { stdio: "inherit" })
  const candidates = ["/opt/Cursor Claw/cursor-claw", "/usr/bin/cursor-claw"]
  const execPath = candidates.find((p) => fs.existsSync(p))
  if (!execPath) { console.error("错误: deb 安装后未找到可执行文件"); process.exit(1) }
  launchExecutable(execPath, profile)
}

function runInstall(mode, resolvedVersion, profile, artifact) {
  if (mode === "pack") {
    const dir = path.join(ROOT, "release", "linux-unpacked")
    if (!fs.existsSync(dir)) { console.error(`错误: 未找到 ${dir}`); process.exit(1) }
    installUnpackedDir(dir, profile)
    return
  }
  if (artifact === "deb") {
    installDeb(requireRelease([`${APP_NAME}_${resolvedVersion}_amd64.deb`, `${APP_NAME}_${resolvedVersion}_x86_64.deb`], "deb"), profile)
    return
  }
  installAppImage(requireRelease([
    `${PRODUCT_NAME}-${resolvedVersion}.AppImage`,
    `${APP_NAME}-${resolvedVersion}.AppImage`,
    `${PRODUCT_NAME}-${resolvedVersion}-x86_64.AppImage`,
  ], "AppImage"), profile)
  if (artifact === "all") {
    const deb = findReleaseFile([`${APP_NAME}_${resolvedVersion}_amd64.deb`])
    if (deb) console.log(`提示: deb 已生成 ${deb}，可 sudo dpkg -i 安装`)
  }
}

async function main() {
  if (process.platform !== "linux") { console.error("错误: 此脚本仅支持 Linux"); process.exit(1) }
  const opts = parseArgs(process.argv)
  if (opts.help) { printHelp(); return }

  runChecks()
  const resolvedVersion = resolveVersion(opts.version)
  console.log(`使用版本: ${resolvedVersion}`)
  await runPipeline(opts.mode, resolvedVersion, opts.artifact)
  if (opts.install) runInstall(opts.mode, resolvedVersion, opts.profile, opts.artifact)
  else console.log("已跳过安装（--no-install）")
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
