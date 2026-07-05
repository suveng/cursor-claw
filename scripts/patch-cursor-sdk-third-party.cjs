#!/usr/bin/env node
/**
 * @cursor/sdk headless 路径在 createLocalExecutor→Oh 未传 importThirdPartyPlugins，
 * 导致 settingSources:plugins 无法加载 Claude Code 第三方插件（skills/commands/agents/hooks/MCP）。
 * 本脚本在 Oh 调用处按 settingSources 自动开启，与 Cursor IDE 行为对齐。
 */
const fs = require("node:fs")
const path = require("node:path")

const MARKER = "importThirdPartyPlugins:!(null==r.settingSources||!r.settingSources.some((s=>\"plugins\"===s||\"all\"===s)))"
const TARGET = "settingSources:r.settingSources,mcpServers:r.mcpServers"
const REPLACEMENT = `settingSources:r.settingSources,${MARKER},mcpServers:r.mcpServers`

const sdkRoot = path.join(__dirname, "..", "node_modules", "@cursor", "sdk", "dist")
const files = ["esm/357.js", "cjs/357.js"].map((f) => path.join(sdkRoot, f))

let patched = 0
for (const file of files) {
  if (!fs.existsSync(file)) continue
  const src = fs.readFileSync(file, "utf-8")
  if (src.includes(MARKER)) {
    patched += 1
    continue
  }
  if (!src.includes(TARGET)) {
    console.warn(`[patch-cursor-sdk] 跳过 ${file}：未找到预期锚点，可能 SDK 版本已变更`)
    continue
  }
  fs.writeFileSync(file, src.replace(TARGET, REPLACEMENT), "utf-8")
  patched += 1
  console.log(`[patch-cursor-sdk] 已 patch: ${file}`)
}

if (patched === 0) process.exit(1)
