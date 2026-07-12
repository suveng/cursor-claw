---
type: ChangeSummary
title: Daemon退出孤儿回收
description: 主应用完全退出时统一回收 Daemon 孤儿进程；Electron 侧 lock.pid + /shutdown 统一杀进程，Daemon 侧父进程/stdin 监护自退出
timestamp: 2026-07-12T22:06:00+0800
related: []
depends_on: []
---

# Daemon退出孤儿回收 — 变更总结

> **hotfix-lite** · 变更 ID：`20260712221030-Daemon退出孤儿回收`
> **来源**：kb-lite（产品验收反馈，归因 code）
> **阶段**：`applied`（LITE-01 已完成；待 `/kb-archive` 归档）

---

## 1、根因（一句话）

主应用完全退出时 `cleanupDaemonManager` 仅 `daemonProcess.kill()`、接管模式 `daemonProcess=null` 不杀 lock.pid，且 Daemon 无父进程死亡检测，导致 **Daemon 孤儿进程残留**、`daemon.lock.json` 未清除。

## 2、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/daemon/daemon-process-kill.ts` | **新增** 统一终止 SSOT：`POST /shutdown` → SIGTERM → SIGKILL → `removeLockFile`；导出 `killDaemonByLockOrProcess`（async）与 `killDaemonByLockOrProcessSync`（will-quit 同步） |
| `electron/daemon/daemon-manager.ts` | `cleanupDaemonManager` 改调 `killDaemonByLockOrProcessSync`（含接管模式 `managedExternalDaemonPid`）；`stopDaemon` 复用 async kill；`startDaemon` spawn `stdio: ["pipe", "pipe", "pipe"]` 供 stdin 监护 |
| `electron/daemon/daemon-client.ts` | **新增** 导出 `removeLockFile()`（幂等删除 `daemon.lock.json`），供 kill 模块与 manager 复用 |
| `src/daemon/daemon-parent-watch.ts` | **新增** 父进程监护：stdin 断管 / ppid 消失 / reparent 检测，≤5s 延迟后 `stopScheduledTasks` + `removeLockFile` + `process.exit(0)` |
| `src/daemon/daemon.ts` | 冷启动后注册 `startDaemonParentWatch` |
| `electron/daemon/AGENTS.md` | 补充完全退出 vs 托盘常驻、kill SSOT、spawn stdin pipe 约定 |
| `package.json` | version `1.14.7` → **`1.14.8`** |
| `changelog/1.14.8.json` | 用户可见变更摘要 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入（显式）**：proto / 跨端契约；EPIPE 日志风暴变更（`20260712215746`，独立并行）；业务域知识。

**统计**：2 新增源码 + 3 改造源码 + 1 AGENTS 约定 + 版本/changelog。

## 3、与设计的差异

无，与 `01-proposal.md` 拟定方案与 4 条验收标准一致。

## 4、知识库影响

**记录型 hotfix-lite**：进程生命周期细节见 changelog 与 `electron/daemon/AGENTS.md`；**工程平台正文由 kb-librarian 在 archive 阶段更新**。

| 文件/分区 | 结论 | 负责 |
|-----------|------|------|
| `knowledge/工程平台/Daemon守护进程/03-进程模型与部署.md` | **待 archive 更新** | kb-librarian：孤儿回收、parent watch、lock 清理 |
| `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` | **待 archive 更新** | kb-librarian：will-quit vs 托盘常驻、接管模式 kill |
| `knowledge/业务域/**` | 无需更新 | 无 IM/调度/通道业务语义变更 |
| `knowledge/知识索引.md` | 无需更新 | 无新领域/分区入口 |

- [x] 业务域 — 无用户可见业务行为变更
- [ ] 工程平台 — 两篇文档待 kb-librarian archive 时同步（非阻断 builder applied）
- [x] 知识索引 — 总入口未变化

## 5、与 EPIPE 变更的关系

| 变更 ID | 关注点 | 关系 |
|---------|--------|------|
| `20260712215746-Daemon EPIPE日志风暴加固` | stderr 断管 EPIPE 日志风暴 | **独立**：无代码文件重叠（除 `daemon.ts` 各自改不同段落）；可 **并行归档** |
| `20260712221030-Daemon退出孤儿回收`（本变更） | 完全退出 / 强杀后孤儿进程回收 | 同上 |

## 6、用户操作建议

1. **升级至 1.14.8**（或含本修复的构建产物）。
2. **验证完全退出**：Cmd+Q 或托盘「退出」后，确认 `daemon.lock.json` 已清除、`ps` 无 `daemon-entry` 残留。
3. **验证托盘常驻**：仅关窗/最小化到托盘时 Daemon **仍运行**，IM/调度不受影响。
4. **强杀场景**（可选）：Force Quit / `kill -9` Electron 主进程后，Daemon 应在 **≤5s** 内自行退出并清 lock。

## 7、验收对照

| # | 标准（01） | 状态 |
|---|------------|------|
| 1 | Cmd+Q / 托盘完全退出：`daemon.lock.json` 清除；无 `daemon-entry` 残留 | ⏳ 待用户手动验证 |
| 2 | 接管模式（启动时 Daemon 已在运行）完全退出后 lock.pid 对应进程被杀死 | ⏳ 待用户手动验证 |
| 3 | Electron 强杀（Force Quit / `kill -9`）后 Daemon ≤5s 内自退出并清 lock | ⏳ 待用户手动验证 |
| 4 | `stopDaemon` IPC、Dashboard 停止、`/restart` 回归一致；托盘常驻不误杀 | ⏳ 待用户手动验证 |
| — | `npm run build` 通过；version `1.14.8` + `changelog/1.14.8.json` | ✅ builder 已落地 |

## 8、Changelog 要点（1.14.8）

- 修复主应用完全退出后 Daemon 子进程残留（孤儿进程）问题
- 完全退出时统一回收 Daemon 并清除 lock 文件，接管模式下也能正确终止外部 Daemon
- Electron 被强杀时 Daemon 会在数秒内自行退出并清理 lock
