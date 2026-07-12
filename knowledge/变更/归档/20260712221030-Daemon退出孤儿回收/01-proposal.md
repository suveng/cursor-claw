---
type: ChangeProposal
title: Daemon退出孤儿回收
description: 主应用完全退出时回收 Daemon 孤儿进程；Electron 侧统一杀进程 + Daemon 侧父进程监护
timestamp: 2026-07-12T22:10:30+0800
related: []
depends_on: []
---

# Daemon退出孤儿回收 — 轻量变更说明

> **变更 ID**：`20260712221030-Daemon退出孤儿回收`
> **来源**：kb-lite（产品验收反馈，归因 code）
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P1
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

用户确认：主应用退出后 **Daemon 子进程残留**（孤儿进程），`daemon.lock.json` 未清除，后续启动可能误判「已在运行」或端口占用。

### 根因（已确认）

1. **`cleanupDaemonManager` 路径不完整**：`app.on("will-quit")` 仅调用 `daemonProcess.kill()`，**不**发 HTTP `POST /shutdown`、**不**读 `lock.pid` 兜底杀进程（对比 `stopDaemon()` 已有 `/shutdown` + SIGTERM/SIGKILL 流程）。
2. **接管模式漏杀**：`autoStartDaemonOnLaunch` 检测到 Daemon 已在运行时仅 `startStatusPolling()`，`daemonProcess = null`；完全退出时 `cleanupDaemonManager` 因 `daemonProcess` 为空 **完全不杀** lock 中记录的进程。
3. **Daemon 侧无父进程死亡检测**：Electron 被强杀（SIGKILL / Force Quit）时无法执行 `will-quit`，Daemon 无 ppid/stdin 监护，继续常驻。

## 变更说明

### Electron 侧（主进程）

1. **新增** `electron/daemon/daemon-process-kill.ts`：统一 Daemon 终止逻辑（读 `daemon.lock.json` → `POST /shutdown` → 按 lock.pid / spawn 子进程 SIGTERM → 超时 SIGKILL → 清理 lock 缓存），供 `cleanupDaemonManager`、`stopDaemon` 等复用，避免两套实现漂移。
2. **改造** `cleanupDaemonManager`：完全退出（Cmd+Q / `will-quit`）时调用统一 kill，**无论** `daemonProcess` 是否为 null（接管模式须读 lock.pid）。
3. **保持** `stopDaemon` IPC、Dashboard 手动停止、斜杠 `/restart` 等既有入口行为不变（回归见验收第 4 条）。

### Daemon 侧（子进程）

4. **新增** 父进程监护（建议 `src/daemon/daemon-parent-watch.ts`，builder 可等价命名）：启动后监听 **stdin 关闭** 和/或 **ppid 变化/父进程不存在**（平台差异由 builder 选型）；检测到 Electron 父进程消失时，执行与 `/shutdown` 等价的清理（`stopDaemonScheduledTasks`、`removeLockFile`）后 `process.exit(0)`，目标 **N 秒内**（建议 ≤5s）自行退出。

### 产品语义（UI 不改）

| 场景 | 预期行为 |
|------|----------|
| **后台常驻**（关闭窗口 / 最小化到托盘，`isQuitting=false`） | Daemon **继续运行**，IM/调度不受影响 |
| **完全退出**（Cmd+Q、托盘「退出」、`isQuitting=true` → `will-quit`） | Daemon **必须终止**，lock 清除，无 `daemon-entry` 残留 |

> 本变更**不**改托盘/窗口 UI；仅加固「完全退出」与「Electron 强杀」两条路径的进程回收。

## 验收标准

1. **Cmd+Q / 托盘完全退出**：`daemon.lock.json` 被清除；`ps` / Activity Monitor **无残留** `daemon-entry`（或 bundle 内 Daemon 入口）进程。
2. **接管模式退出**：应用启动时 Daemon 已在运行（`autoStartDaemonOnLaunch` 仅轮询、`daemonProcess=null`），完全退出后 **lock.pid 对应进程被杀死**。
3. **Electron 强杀**：Force Quit / `kill -9` Electron 主进程后，Daemon 在 **N 秒内**（builder 实现时固定具体秒数，建议 ≤5s）自行退出，lock 清除。
4. **回归**：`stopDaemon` IPC、Dashboard 停止按钮、斜杠 `/restart`（经 `agent-command-http` → `stopDaemon`）行为与现网一致，不引入双杀竞态或误杀托盘常驻场景。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/daemon/daemon-process-kill.ts` | **新增**，统一杀进程 + lock 兜底 |
| `electron/daemon/daemon-manager.ts` | `cleanupDaemonManager` 改造；可选 `stopDaemon` 复用 kill 模块 |
| `src/daemon/daemon-parent-watch.ts`（或等价） | **新增**，父进程/stdin 监护 |
| `src/daemon/daemon.ts` 或 `daemon-bootstrap.ts` | 启动时注册 parent watch |
| `electron/daemon/AGENTS.md` | 补充退出/接管/kill 约定 |
| `knowledge/工程平台/Daemon守护进程/03-进程模型与部署.md` | kb-librarian：进程生命周期、孤儿回收 |
| `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` | kb-librarian：will-quit vs 托盘常驻 |
| 版本/changelog | **归档时** bump patch `1.14.7` → `1.14.8` + 新建 `changelog/1.14.8.json`（本阶段不 bump） |
| 不在范围 | proto / 跨端契约；EPIPE 日志风暴变更（`20260712215746`） |

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 根因、双端方案、4 条验收已明确 |
| 修改范围 | Electron daemon-manager + 新增 kill/watch 模块，强相关 |
| 接口契约 | 无 proto/跨端契约变更；复用既有 `/shutdown` |
| 数据/权限 | 不变 |
| 跨端联动 | Electron 主进程 + Daemon 子进程生命周期 |
| 知识库影响 | 记录型 lite；工程平台正文由 kb-librarian 视 archive 更新 |
| 风险 | 孤儿进程影响资源与重启判断，范围可控 → **hotfix-lite** |
| **总分** | **≤2**，可走 lite |

## integrations

`kb.project.json` 无 `integrations.registry` → **跳过**外部登记。
