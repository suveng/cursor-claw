/**
 * deploy 脚本共用：环境检查、版本解析、子进程编排。
 */

const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const semver = require("semver")

const ROOT = path.join(__dirname, "..", "..")

/** 必检：Node 版本、node_modules、electron-builder */
function runChecks() {
  const pkgPath = path.join(ROOT, "package.json")
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
  const requiredNode = pkg.engines?.node || ">=18.0.0"

  if (!semver.satisfies(process.version, requiredNode)) {
    console.error(`错误: Node 版本不满足要求（当前 ${process.version}，需要 ${requiredNode}）`)
    process.exit(1)
  }
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    console.error("错误: 未找到 node_modules，请运行 npm install")
    process.exit(1)
  }
  if (!fs.existsSync(path.join(ROOT, "node_modules", ".bin", "electron-builder"))) {
    console.error("错误: 未找到 electron-builder，请运行 npm install")
    process.exit(1)
  }
}

/** 确定版本：显式 --version 或 package.json */
function resolveVersion(explicitVersion) {
  if (explicitVersion) {
    const valid = semver.valid(explicitVersion)
    if (!valid) {
      console.error(`错误: 无效的 semver 版本 "${explicitVersion}"`)
      process.exit(1)
    }
    return valid
  }
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env })
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))))
  })
}

/** 在 release/ 下按候选文件名查找产物 */
function findReleaseFile(candidates) {
  const releaseDir = path.join(ROOT, "release")
  for (const name of candidates) {
    const p = path.join(releaseDir, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

module.exports = { ROOT, runChecks, resolveVersion, run, findReleaseFile }
