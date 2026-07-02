# 修复打包版 Daemon 版本读取 - 验收记录

> **变更 ID**：`20260702143057-修复打包版Daemon版本读取`
> **阶段**：`/kb-test`（lite 记录型；**静态 bundle 冒烟** + **手工 dev/打包 E2E**）
> **设计来源**：`01-proposal.md`（无 `02-design` / `03-tasks`；追溯 `LITE-01` 与 `01` 验收 1–4）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态冒烟**（`build:mcp` + `bundle-daemon` + 产物 grep）+ **dev 路径手工** + **macOS 打包版 E2E**；不新增单元测试 / `auto_test/` |
| **目标** | 覆盖 `01-proposal` 验收 1–4、`LITE-01`（`inlinePackageJson` 覆盖 `_require("../../package.json")` 变体） |
| **通过口径** | 产物无运行时 `require` package.json；`PKG_VERSION` 内联且解析为与 `package.json` 一致的 semver 字符串；dev / 打包版 Daemon 可启动；`/api/status` 或 MCP 元数据 `version` 正确；无 `MODULE_NOT_FOUND` |
| **与 review 分工** | review 偏实现；本文负责验收追溯与执行证据 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·1 打包版点击「启动 Agent」** | 依赖完整 `npm run build` + electron-builder 安装包；耗时长且写入 `release/`、`out/` |
| **01·3 dev 全链路** | `npm run dev` 需 Electron 窗口与本地配置；本变更仅 bundle 脚本，dev 路径回归标记手工 |
| **MCP initialize 元数据** | 需 Cursor / Electron 侧连接 Daemon MCP；可与 S4 `/api/status` 二选一或互补 |
| **Win/Linux 打包路径** | 本机 macOS；`Contents/Resources/daemon/` 路径为 mac 形态 |
| **`auto_test/` 脚本** | lite hotfix 未新增；静态 grep + 手工清单足够 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **LITE-01** | `inlinePackageJson` 覆盖 `../../package.json` / `_require(...)` | 静态读 `scripts/bundle-daemon.cjs`；产物 grep | 代码 / 产物 | ✅ 静态 |
| **01·1** | 打包版 Daemon 启动；无 `Cannot find module '../../package.json'` | 打包版「启动 Agent」+ 控制台 | 手工 E2E | ⏳ 待手工 |
| **01·2** | 日志 / MCP / HTTP 中 `version` 与 `package.json` 一致 | S3 产物 + S4 `/api/status` 或 MCP | 静态 / HTTP | ✅ 静态；⏳ 运行时 |
| **01·3** | dev 路径 Daemon 正常；`PKG_VERSION` 可读 | `npm run dev` 启动 Agent | 手工 E2E | ⏳ 待手工 |
| **01·4** | `bundle-daemon` 构建通过；tsc 通过；调度不退化 | S1–S2 静态；S5 可选 smoke | 构建摘要 | ✅ 静态 |
| **根因回归** | 产物无 `package.json` 运行时 require | grep `dist-bundle/daemon-entry.mjs` | 产物 | ✅ 通过 |

## 4、场景摘要

### 4.1 静态 / 构建冒烟（已执行或可重复）

| 场景 ID | 前置 | 命令 / 操作摘要 | 期望 | 关联 |
|---------|------|-----------------|------|------|
| **S1 tsc** | 仓库根；依赖已 install | `npm run build:mcp` | exit 0 | 01·4 |
| **S2 bundle** | S1 完成 | `node scripts/bundle-daemon.cjs` | 输出 `✓ daemon-entry.mjs bundled`；exit 0 | LITE-01、01·4 |
| **S3 内联检查** | S2 完成 | `rg 'package\.json|_require\(' dist-bundle/daemon-entry.mjs`（或等价 grep） | **无匹配**；存在 `PKG_VERSION = {…}.version` 形态内联 | LITE-01、01·2 |
| **S4 版本常量** | S2 完成 | 读 `package.json` 的 `version`，对照产物中 `PKG_VERSION` 内联 JSON 的 `version` 字段 | 二者一致（如 `1.10.3`） | 01·2 |

### 4.2 dev 路径（手工）

| 场景 ID | 前置 | 步骤摘要 | 期望 | 关联 |
|---------|------|----------|------|------|
| **D1 dev 启动** | 本地 Cursor / API 配置就绪 | 仓库根 `npm run dev`（或等价 dev 链路） | Electron 正常；Daemon 进程拉起 | 01·3 |
| **D2 启动 Agent** | D1 完成 | 应用内点击「启动 Agent」 | Daemon 无崩溃；控制台无 `MODULE_NOT_FOUND` / `package.json` | 01·1、01·3 |
| **D3 版本可读** | D2 Daemon 运行中 | 查 Daemon 启动日志 `Daemon v{x.y.z} 启动`；或 `curl http://127.0.0.1:<port>/api/status` 看 `daemon.version` | `version` = 当前 `package.json` version | 01·2 |

> Daemon 端口：应用设置或 Electron 主进程日志；`/api/status` 返回 `daemon.version`（见 `src/daemon/daemon.ts`）。

### 4.3 打包版 E2E（手工，macOS）

| 场景 ID | 前置 | 步骤摘要 | 期望 | 关联 |
|---------|------|----------|------|------|
| **P1 完整构建** | Node≥18；`npm install` 完成 | `npm run pack:mac`（dir 快）或 `npm run dist:mac`（dmg） | build 链含 `build:bundle` 无报错 | 01·4 |
| **P2 安装启动** | P1 产出 | 打开 `release/` 下 `.app` | 应用窗口正常 | 01·1 |
| **P3 启动 Agent** | P2 完成 | 点击「启动 Agent」 | **无** `Cannot find module '../../package.json'`；**无** `MODULE_NOT_FOUND` | 01·1 |
| **P4 版本字段** | P3 Daemon 运行 | `/api/status` 或 MCP Server `initialize` 结果中的 `version` | 与打包时 `package.json` version 一致，非空/占位 | 01·2 |
| **P5 产物路径（可选）** | P1 完成 | 检查 `.app/Contents/Resources/daemon/daemon-entry.mjs` | 存在；内容同 S3（已内联） | LITE-01 |

打包入口：`scripts/deploy/mac.cjs`（`dist:mac` / `pack:mac`）；Daemon 复制落点见 `scripts/after-pack.cjs`（`Resources/daemon/`）。

### 4.4 可选 MCP 元数据抽查

| 场景 ID | 步骤摘要 | 期望 |
|---------|----------|------|
| **M1 admin MCP** | 连接 `cursor-claw-admin` MCP，`initialize` | `serverInfo.version` = 应用版本 |
| **M2 主 MCP** | 连接 `cursor-claw` MCP | 同上 |

与 D3 / P4 任通过即可满足 01·2。

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **bundle 入口** | `scripts/bundle-daemon.cjs`（`inlinePackageJson` 插件） |
| **npm 封装** | `package.json` → `build:bundle`（`build` 链一环） |
| **产物** | `dist-bundle/daemon-entry.mjs` → 打包后 `Contents/Resources/daemon/` |
| **版本 SSOT** | 根目录 `package.json` `version` |
| **HTTP 探针** | `GET /api/status` → `daemon.version` |
| **脚本目录** | 本期无 `auto_test/` 新增 |
| **环境变量** | 无新增；打包可选 `CSC_*` / `APPLE_*`（仅名称，不写值） |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 失败时区分：**bundle 脚本/内联问题** vs **electron-builder / 安装路径问题** vs **dev 环境配置问题**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-02 | macOS；pkg 1.10.3 | S1 `npm run build:mcp` | 通过 | tsc exit 0 |
| 2026-07-02 | 同上 | S2 `node scripts/bundle-daemon.cjs` | 通过 | 产物已生成 |
| 2026-07-02 | 同上 | S3 产物 grep（无 package.json require） | 通过 | 内联 `.version` |
| 2026-07-02 | 同上 | S4 版本对照 | 通过 | 1.10.3 一致 |
| 2026-07-02 | — | D1–D3 dev 路径 | 待执行 | 用户手工 |
| 2026-07-02 | — | P1–P5 打包版 E2E | 待执行 | 用户手工 |
| 2026-07-02 | — | M1–M2 MCP 元数据 | 待执行 | 可选 |
