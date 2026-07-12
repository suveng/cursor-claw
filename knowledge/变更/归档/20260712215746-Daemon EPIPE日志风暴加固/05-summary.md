---
type: ChangeSummary
title: Daemon EPIPE日志风暴加固
description: 统一 EPIPE 判定与 stderr 断管防御，消除 uncaughtException 递归日志风暴
timestamp: 2026-07-12T22:12:00+0800
related: []
depends_on: []
---

# Daemon EPIPE日志风暴加固 — 变更总结

> **hotfix-lite** · 变更 ID：`20260712215746-Daemon EPIPE日志风暴加固`
> **来源**：kb-lite（产品验收反馈，归因 code）
> **阶段**：`reviewed`（05 已补全；知识正文已落盘；**待 archive**，目录迁移交 kb-release）

---

## 1、根因（一句话）

Electron 父进程重启时 Daemon 子进程 **stderr 管道读者关闭**，异步 EPIPE 经 `stderr` 的 `error` 事件进入 `uncaughtException`，而异常处理器内 `log()` 再次写 stderr，触发 **EPIPE 递归日志风暴**（`daemon.log` 数千条 `write EPIPE`）。

## 2、实际变更

**业务代码**：已在 commit `5bb9f631` 落地；archive commit 预期仅含目录迁移 + `00-manifest.json` + `05-summary.md` 补全。

### 2.1 代码与配置

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

### 2.2 变更文档

- `01-proposal.md`、`04-review.md`、`08-verify-issue.md`
- `00-manifest.json`、`05-summary.md`（本文件）

### 2.3 知识正文（librarian 已在 `5bb9f631` 落盘）

- `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — spawn `stdio` stdin pipe 与 Daemon 退出语义；stderr 断管/EPIPE 约定与 `03-进程模型与部署.md` §三交叉引用

**未纳入（显式）**：proto / 跨端契约；Electron 主进程 daemon spawn 逻辑（孤儿回收见并行变更 `20260712221030`）。

**统计**：5 源码文件 + 1 新增 shared helper + 1 AGENTS 约定 + 版本/changelog + 1 知识正文。

## 3、与设计的差异

无，与 `01-proposal.md` 拟定方案与验收标准一致。

## 4、影响范围

- **模块**：Daemon 日志（`daemon-logging`）、全局异常处理（`daemon.ts`）、启动入口与会话路由持久化 stderr 写入。
- **接口**：无对外 HTTP/MCP/proto 变更。
- **用户可见**：Electron 重启或父进程退出后 `daemon.log` 不再 EPIPE 递归刷屏；断管后文件日志仍正常写入。
- **可靠性**：`isBrokenPipeError` 为跨模块 SSOT；`stderrBroken` 标志防止断管后重复写 stderr。

### 4.1 Ponytail 技术债

本变更相关 diff（commit `5bb9f631`）中检索 `ponytail:`：**无**。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| — | 无 | — |

**非 Ponytail 可选跟进**（`04-review` §3，`reviews[]` R1 已标 `false_positive`）：`server-workflow.ts` / `daemon-http-workflow-signal.ts` 仍裸 `process.stderr.write`；风暴路径已缓解，非阻断 archive。

## 5、知识库影响清单

> 与 `manifest.files` 知识项一致；正文已在 `5bb9f631` 由 kb-librarian 落盘。

### （一）必须更新

- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — Daemon spawn `stdio`、退出语义；stderr 断管/EPIPE 与 Daemon 侧加固约定（同 commit 合并更新）

### （二）可能更新（视实现结果）

- [x] `src/shared/AGENTS.md` — apply 已同步 `is-broken-pipe-error.ts` 索引

### （三）不需要更新

- [x] `knowledge/业务域/**` — 无 IM/调度/通道等业务语义变更
- [x] `knowledge/知识索引.md` — 总入口未变化

## 6、用户操作建议

1. **升级至 1.14.7**（或含本修复的构建产物）。
2. **完全重启 App 与 Daemon**：退出 Cursor Claw 后重新打开，确保旧 Daemon 子进程被替换（前序修复已打包但旧进程未重启时仍会复现风暴）。
3. **验证**：Electron 重启或父进程退出后，`daemon.log` 不再出现 EPIPE 递归刷屏；断管后文件日志仍正常写入。

## 7、验收对照

| # | 标准（01） | 状态 |
|---|------------|------|
| 1 | 断管场景下 `daemon.log` 无 EPIPE 递归风暴 | ⏳ 待用户重启后验收 |
| 2 | EPIPE / broken pipe 静默处理，不再刷屏 `未捕获异常: write EPIPE` | ⏳ 待用户验收 |
| 3 | 断管后 stderr 不可用时仍正常写入文件日志 | ⏳ 待用户验收 |
| 4 | 稳态 Daemon 启动、通道、调度、session-routing 无回归 | ⏳ 待用户验收 |
| 5 | `npm run build` 通过；version bump + changelog | ✅ builder 已落地（`5bb9f631`） |

## 8、阶段说明

- `04-review` **通过**；R1 标 `false_positive`；**无** open 阻断项。
- 本轮 scribe 补全 `05-summary.md` 并回写 `manifest.files`；**保持 `stage=reviewed`**。
- 目录 `mv` → `archived`、白名单 commit/push 交 **kb-release**。
