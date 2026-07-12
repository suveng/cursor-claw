---
type: ChangeSummary
title: Daemon EPIPE日志风暴加固
description: 统一 EPIPE 判定与 stderr 断管防御，消除 uncaughtException 递归日志风暴
timestamp: 2026-07-12T22:00:00+0800
related: []
depends_on: []
---

# Daemon EPIPE日志风暴加固 — 变更总结

> **hotfix-lite** · 变更 ID：`20260712215746-Daemon EPIPE日志风暴加固`
> **来源**：kb-lite（产品验收反馈，归因 code）
> **阶段**：`applied`（LITE-01 已完成；待 `/kb-archive` 归档）

---

## 1、根因（一句话）

Electron 父进程重启时 Daemon 子进程 **stderr 管道读者关闭**，异步 EPIPE 经 `stderr` 的 `error` 事件进入 `uncaughtException`，而异常处理器内 `log()` 再次写 stderr，触发 **EPIPE 递归日志风暴**（`daemon.log` 数千条 `write EPIPE`）。

## 2、实际变更

| 文件 | 关键改动 |
|------|----------|
| `src/shared/is-broken-pipe-error.ts` | **新增** `isBrokenPipeError`：统一判定 EPIPE / broken pipe（code、errno、message、syscall） |
| `src/daemon/daemon-logging.ts` | 注册 `process.stderr.on('error')`；维护 `stderrBroken` 标志，断管后跳过 stderr、仅写文件；导出 `markDaemonStderrBroken()` |
| `src/daemon/daemon.ts` | `uncaughtException` / `unhandledRejection` 改用 `isBrokenPipeError` 早退并 `markDaemonStderrBroken()`；日志写入加深度计数防重入 |
| `src/daemon-entry.ts` | 启动失败路径 `stderr.write` 包 `try/catch`，断管静默 |
| `src/daemon/daemon-session-routing-persist.ts` | 裸 `process.stderr.write` 改为 `safeStderrWrite`，EPIPE 静默 |
| `src/shared/AGENTS.md` | 补充 `is-broken-pipe-error.ts` 索引与引用约定 |
| `package.json` | version `1.14.5` → **`1.14.7`** |
| `changelog/1.14.7.json` | 用户可见变更摘要 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入（显式）**：`knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md`（kb-librarian 未改，见 §4）；proto / 跨端契约；Electron 主进程 daemon spawn 逻辑。

**统计**：5 源码文件 + 1 新增 shared helper + 1 AGENTS 约定 + 版本/changelog。

## 3、与设计的差异

无，与 `01-proposal.md` 拟定方案与验收标准一致。

## 4、知识库影响

**记录型 hotfix-lite**：Daemon 非功能细节见 `changelog/1.14.7.json` 与 `src/shared/AGENTS.md`；**工程平台可选补充**（`02-主进程与IPC.md` 中 Daemon stderr 断管约定，由 kb-librarian 视 archive 决定）。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/**` | 无需更新 | 无 IM/调度/通道等业务语义变更 |
| `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` | **可选更新** | 01 标注可能补充 Daemon stderr 断管约定；本轮 builder 未改 KB 正文 |
| `knowledge/知识索引.md` | 无需更新 | 无新领域/分区入口 |

- [x] 业务域 — 无用户可见业务行为变更
- [ ] 工程平台 — 可选补充 stderr 断管约定（非阻断 archive）
- [x] 知识索引 — 总入口未变化

## 5、用户操作建议

1. **升级至 1.14.7**（或含本修复的构建产物）。
2. **完全重启 App 与 Daemon**：退出 Cursor Claw 后重新打开，确保旧 Daemon 子进程被替换（前序修复已打包但旧进程未重启时仍会复现风暴）。
3. **验证**：Electron 重启或父进程退出后，`daemon.log` 不再出现 EPIPE 递归刷屏；断管后文件日志仍正常写入。

## 6、验收对照

| # | 标准（01） | 状态 |
|---|------------|------|
| 1 | 断管场景下 `daemon.log` 无 EPIPE 递归风暴 | ⏳ 待用户重启后验收 |
| 2 | EPIPE / broken pipe 静默处理，不再刷屏 `未捕获异常: write EPIPE` | ⏳ 待用户验收 |
| 3 | 断管后 stderr 不可用时仍正常写入文件日志 | ⏳ 待用户验收 |
| 4 | 稳态 Daemon 启动、通道、调度、session-routing 无回归 | ⏳ 待用户验收 |
| 5 | `npm run build` 通过；version bump + changelog | ✅ builder 已落地 |
