# Cursor SDK 依赖升级 1.0.23

## 背景

项目当前锁定 `@cursor/sdk ^1.0.22`（lock 解析 1.0.22）。npm 最新稳定版为 **1.0.23**（2026-07-03 发布）。

社区反馈与官方建议表明 1.0.23 为维护性更新，主要改善：

1. **长驻 Agent 空闲后静默失败**：1.0.22 存在空闲后 `status: ERROR`、host 进程 `unhandledRejection` 崩溃等问题，官方建议升级至 1.0.23。
2. **error 终态可观测性**：`status: "error"` 的 Run 返回更完整错误详情。
3. **依赖清理**：修复 ConnectRPC transport 解析；移除 `sqlite3` / `node-gyp` 等旧依赖链。

与本项目近期 hotfix「长驻 Agent 空闲后静默失败修复」（archive 20260711113147）方向一致，应用层 workaround 保留，底层 SDK 同步升级以降低复发概率。

## 目标

1. `package.json` / `package-lock.json` 将 `@cursor/sdk` 升至 `^1.0.23`，lock 解析 1.0.23。
2. `postinstall` 脚本 `patch-cursor-sdk-third-party.cjs` 在新版本上仍可成功 patch（`importThirdPartyPlugins` 对齐）。
3. 无 Claw 业务代码改动；仅依赖与变更归档。

## 验收

- [x] `npm ls @cursor/sdk` 显示 1.0.23
- [x] `node scripts/patch-cursor-sdk-third-party.cjs` 成功（esm/357.js 锚点仍有效）
- [x] `changelog/1.14.4.json` 与 `package.json` version 已登记
- [ ] 可选：staging 长驻 Agent 空闲 ≥15min 后 dispatch 回归（依赖人工 E2E）
