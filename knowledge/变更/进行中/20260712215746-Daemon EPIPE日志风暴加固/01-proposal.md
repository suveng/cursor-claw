---
type: ChangeProposal
title: Daemon EPIPE日志风暴加固
description: 加固 Daemon stderr 断管场景下的 EPIPE 防御，消除 uncaughtException 递归日志风暴
timestamp: 2026-07-12T21:57:46+0800
related: []
depends_on: []
---

# Daemon EPIPE日志风暴加固 — 轻量变更说明

> **变更 ID**：`20260712215746-Daemon EPIPE日志风暴加固`
> **来源**：kb-lite（产品验收反馈，归因 code）
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P1
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

用户报告 `daemon.log` 在 **21:55:31** 出现约 **3600 条** `write EPIPE` 未捕获异常风暴。

前序修复 commit `8a3055e`（20:29）已在 `daemon-logging.ts` 对 `process.stderr.write` 加 `try/catch`，并在 `daemon.ts` 的 `uncaughtException` / `unhandledRejection` 中对 `code === "EPIPE"` 早退。但 **21:45 重建的 App bundle 已含该修复代码**，用户仍见风暴，疑为：

1. **未重启的旧 Daemon 子进程**仍在运行旧逻辑；
2. 现有防御**不完整**：异步 EPIPE、无 `stderr.on('error')`、断管后仍尝试写 stderr、部分裸 `stderr.write` 绕过日志器。

## 根因（拟定）

Electron 父进程重启或退出时，Daemon 子进程的 **stderr 管道读者关闭**。此后：

1. `process.stderr.write` 的 **EPIPE 可能异步抛出**（经 `stderr` 的 `error` 事件），`try/catch` 无法捕获；
2. 未注册 `process.stderr.on('error')`，异步 EPIPE 进入 `uncaughtException`；
3. `uncaughtException` 处理器内调用 `log("ERROR", …)` **再次写 stderr**，触发新一轮 EPIPE → **递归风暴**；
4. `daemon-entry.ts` 启动失败路径、`daemon-session-routing-persist.ts` 等处的**裸 `process.stderr.write`** 同样可触发未处理 EPIPE。

## 变更说明

1. **新增** `src/shared/is-broken-pipe-error.ts`：统一判定 EPIPE / broken pipe（`err.code`、`errno`、`message` 等），供 daemon 与 shared 复用。
2. **`createDaemonLogger`（`daemon-logging.ts`）**：
   - 启动时注册 `process.stderr.on('error')`，对 broken pipe **静默吞掉**；
   - 维护 `stderrBroken` 标志：一旦断管，**永久跳过 stderr**，仅写文件日志；
   - 导出 `markStderrBroken()` 供 `daemon.ts` 异常处理器调用。
3. **`daemon.ts`**：`uncaughtException` / `unhandledRejection` 改用 `isBrokenPipeError` 早退，并调用 `markStderrBroken()`，避免处理器内再写已断 stderr。
4. **`daemon-entry.ts`**：启动失败路径改用安全写（shared helper 或 logger 兜底），防止进程退出前再抛 EPIPE。
5. **（可选）`daemon-session-routing-persist.ts`**：裸 `process.stderr.write` 改为安全写或复用 shared helper，与日志器策略一致。

## 验收标准

1. **断管场景**：模拟 Electron 父进程退出 / 重启（或关闭 stderr 读者）后，Daemon 继续运行或优雅退出时，`daemon.log` **不再**出现 EPIPE 递归风暴（条数不暴涨至数千级）。
2. **静默处理**：EPIPE / broken pipe 被静默吞掉，**不**再触发 `未捕获异常: write EPIPE` 类刷屏。
3. **文件日志**：断管后 stderr 不可用时，**仍正常写入** `daemon.log`（或 `DAEMON_LOG_PATH` 指定路径）。
4. **回归**：正常稳态下 Daemon 启动、通道、调度、session-routing 写盘 WARN/INFO 行为无意外回归。
5. **构建**：`npm run build` 通过；归档时 bump patch `1.14.6` → `1.14.7` 并新建 `changelog/1.14.7.json`。

## 影响范围

| 范围 | 说明 |
|------|------|
| `src/shared/is-broken-pipe-error.ts` | 新增，EPIPE 统一判定 |
| `src/daemon/daemon-logging.ts` | stderr error 监听、断管标志、安全写策略 |
| `src/daemon/daemon.ts` | uncaught/unhandled 早退 + mark stderr broken |
| `src/daemon-entry.ts` | 启动失败路径防 EPIPE |
| `src/daemon/daemon-session-routing-persist.ts` | （可选）裸 stderr.write 加固 |
| `src/shared/AGENTS.md` | 若新增 shared 文件，补充索引 |
| `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` | kb-librarian 视实现补充 Daemon stderr 断管约定（可能更新） |
| 不在范围 | proto / 跨端契约；Electron 主进程 daemon spawn 逻辑（本变更聚焦 Daemon 子进程侧防御） |
| 版本/changelog | **归档时 bump patch**：`1.14.6` → `1.14.7` + 新建 `changelog/1.14.7.json` |

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、前序修复缺口、拟定方案与验收已明确 |
| 修改范围 | daemon 日志与异常处理 + 少量 shared helper，强相关 |
| 接口契约 | 无 proto/跨端契约变更 |
| 数据/权限 | 不变 |
| 跨端联动 | 仅 Daemon 子进程 stderr/日志路径 |
| 知识库影响 | 记录型 lite；工程平台正文由 kb-librarian 视 archive 结果更新 |
| 风险 | 日志风暴影响磁盘与可观测性，范围可控 → **hotfix-lite** |
| **总分** | **≤2**，可走 lite |

## integrations

`kb.project.json` 无 `integrations.registry` → **跳过**外部登记。
