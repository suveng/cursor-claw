---
type: ChangeSummary
title: Daemon退出孤儿回收
description: 主应用完全退出时统一回收 Daemon 孤儿进程；Electron 侧 lock.pid + /shutdown 统一杀进程，Daemon 侧父进程/stdin 监护自退出
timestamp: 2026-07-12T22:12:00+0800
related: []
depends_on: []
---

# Daemon退出孤儿回收 — 变更总结

> **hotfix-lite** · 变更 ID：`20260712221030-Daemon退出孤儿回收`
> **来源**：kb-lite（产品验收反馈，归因 code）
> **阶段**：`applied`（05 已补全；知识正文已落盘；**待 archive**，目录迁移交 kb-release）

---

## 1、根因（一句话）

主应用完全退出时 `cleanupDaemonManager` 仅 `daemonProcess.kill()`、接管模式 `daemonProcess=null` 不杀 lock.pid，且 Daemon 无父进程死亡检测，导致 **Daemon 孤儿进程残留**、`daemon.lock.json` 未清除。

## 2、实际变更

**业务代码**：已在 commit `5bb9f631` 落地；archive commit 预期仅含目录迁移 + `00-manifest.json` + `05-summary.md` 补全。

### 2.1 代码与配置

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

### 2.2 变更文档

- `01-proposal.md`
- `00-manifest.json`、`05-summary.md`（本文件）

### 2.3 知识正文（librarian 已在 `5bb9f631` 落盘）

- `knowledge/工程平台/Daemon守护进程/03-进程模型与部署.md` — 双路径回收、parent watch、退出场景表、stdin EPIPE 与 stderr 加固兼容
- `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — will-quit vs 托盘常驻、`daemon-process-kill` SSOT、`cleanupDaemonManager` 覆盖接管模式

**未纳入（显式）**：proto / 跨端契约；EPIPE 日志风暴变更（`20260712215746`，独立并行）；业务域知识。

**统计**：2 新增源码 + 3 改造源码 + 1 AGENTS 约定 + 版本/changelog + 2 知识正文。

## 3、与设计的差异

无，与 `01-proposal.md` 拟定方案与 4 条验收标准一致。

## 4、影响范围

- **模块**：Electron `daemon-manager` / `daemon-process-kill`；Daemon `daemon-parent-watch`；lock 文件生命周期。
- **接口**：无对外 HTTP/MCP/proto 变更；主进程内部 kill 路径统一。
- **用户可见**：Cmd+Q / 托盘完全退出后无 `daemon-entry` 残留；托盘常驻不误杀 Daemon。
- **可靠性**：Electron 强杀场景 Daemon ≤5s 自退出清 lock；`stopDaemon` IPC/Dashboard/`/restart` 行为与现网一致。

### 4.1 Ponytail 技术债

本变更相关 diff（commit `5bb9f631`）中检索 `ponytail:`：**无**。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| — | 无 | — |

## 5、知识库影响清单

> 与 `manifest.files` 知识项一致；正文已在 `5bb9f631` 由 kb-librarian 落盘。

### （一）必须更新

- [x] `knowledge/工程平台/Daemon守护进程/03-进程模型与部署.md` — 孤儿回收双路径、parent watch、退出场景表、spawn stdin pipe
- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — will-quit vs 托盘常驻、kill SSOT、`cleanupDaemonManager` 语义

### （二）可能更新（视实现结果）

- [x] `electron/daemon/AGENTS.md` — apply 已同步 kill SSOT 与 spawn 约定

### （三）不需要更新

- [x] `knowledge/业务域/**` — 无 IM/调度/通道业务语义变更
- [x] `knowledge/知识索引.md` — 无新领域/分区入口

## 6、与 EPIPE 变更的关系

| 变更 ID | 关注点 | 关系 |
|---------|--------|------|
| `20260712215746-Daemon EPIPE日志风暴加固` | stderr 断管 EPIPE 日志风暴 | **独立**：无代码文件重叠（除 `daemon.ts` 各自改不同段落）；可 **并行归档** |
| `20260712221030-Daemon退出孤儿回收`（本变更） | 完全退出 / 强杀后孤儿进程回收 | 同上 |

## 7、用户操作建议

1. **升级至 1.14.8**（或含本修复的构建产物）。
2. **验证完全退出**：Cmd+Q 或托盘「退出」后，确认 `daemon.lock.json` 已清除、`ps` 无 `daemon-entry` 残留。
3. **验证托盘常驻**：仅关窗/最小化到托盘时 Daemon **仍运行**，IM/调度不受影响。
4. **强杀场景**（可选）：Force Quit / `kill -9` Electron 主进程后，Daemon 应在 **≤5s** 内自行退出并清 lock。

## 8、验收对照

| # | 标准（01） | 状态 |
|---|------------|------|
| 1 | Cmd+Q / 托盘完全退出：`daemon.lock.json` 清除；无 `daemon-entry` 残留 | ⏳ 待用户手动验证 |
| 2 | 接管模式（启动时 Daemon 已在运行）完全退出后 lock.pid 对应进程被杀死 | ⏳ 待用户手动验证 |
| 3 | Electron 强杀（Force Quit / `kill -9`）后 Daemon ≤5s 内自退出并清 lock | ⏳ 待用户手动验证 |
| 4 | `stopDaemon` IPC、Dashboard 停止、`/restart` 回归一致；托盘常驻不误杀 | ⏳ 待用户手动验证 |
| — | `npm run build` 通过；version `1.14.8` + `changelog/1.14.8.json` | ✅ builder 已落地（`5bb9f631`） |

## 9、Changelog 要点（1.14.8）

- 修复主应用完全退出后 Daemon 子进程残留（孤儿进程）问题
- 完全退出时统一回收 Daemon 并清除 lock 文件，接管模式下也能正确终止外部 Daemon
- Electron 被强杀时 Daemon 会在数秒内自行退出并清理 lock

## 10、阶段说明

- 记录型 lite hotfix；**无** `04-review.md`；LITE-01 `completed`。
- 本轮 scribe 补全 `05-summary.md` 并回写 `manifest.files`；**保持 `stage=applied`**。
- 目录 `mv` → `archived`、白名单 commit/push 交 **kb-release**。
