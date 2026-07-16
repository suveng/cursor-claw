---
type: ChangeProposal
title: Daemon日志双写修复
description: 修复同一条 [Daemon] 日志被 Daemon 与 Electron 两侧重复写入 .cursor/daemon.log
timestamp: 2026-07-16T18:45:53+08:00
related: []
depends_on: []
---

# Daemon日志双写修复轻量变更说明

> **变更 ID**：`20260716184553-Daemon日志双写修复`
> **来源**：kb-lite
> **lite 类型**：hotfix-lite（记录型）
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 变更说明

同一条 `[Daemon]` 日志被写两次到 `.cursor/daemon.log`：

1. Daemon `log()`（`src/daemon/daemon-logging.ts`）同时写 stderr + `fs.appendFileSync(DAEMON_LOG_PATH)`
2. Electron `daemon-manager` 用 pipe 收 stderr → `pushDaemonStderrLine` → `pushLog` → `appendToLogFile`，路径同样是 `resolveActiveDaemonLogPath`

个别行不重复：`[TEMP_CONN]` / `[SDK]` 只走 Electron 一侧。

**推荐修复（优先）**：在 Electron `pushDaemonStderrLine` 命中统一 `[Daemon]` 前缀（`UNIFIED_DAEMON_PREFIX`）时，只推 UI/内存 buffer，不要再 `appendToLogFile`（Daemon 已自行落盘）。**不要改** Daemon 侧双写策略（`daemon-logging.ts` 文件头注释禁止改双写策略）。

## 验收标准

1. **无双写**：稳态下带 `[Daemon]` 前缀的同一条日志在 `.cursor/daemon.log` 中只出现一次（不再成对重复）。
2. **UI 可见**：Electron 侧 UI/内存 buffer 仍能收到并展示 `[Daemon]` stderr 行。
3. **非 Daemon 前缀不受影响**：`[TEMP_CONN]` / `[SDK]` 等仍按原路径落盘与展示，行为不回归。
4. **Daemon 策略不变**：不修改 `daemon-logging.ts` 的 stderr + 文件双写策略。

## 影响范围

| 范围 | 说明 |
|------|------|
| 主改文件（预期） | Electron `daemon-manager` 中 `pushDaemonStderrLine`（及同文件内与 `appendToLogFile` / `UNIFIED_DAEMON_PREFIX` 相关的少量逻辑） |
| 不改 | `src/daemon/daemon-logging.ts` 双写策略；proto / 跨端契约；数据库 / 权限 |
| 知识库 | 记录型 hotfix-lite；实现后于 `05-summary.md` 写明「知识库无需更新」原因（若文档无当前说明失真） |

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 根因、推荐修复与验收已明确 |
| 修改范围 | 单点 Electron stderr 落盘去重，强相关少量文件 |
| 接口契约 | 无 proto/跨端契约变更 |
| 数据与权限 | 不涉及 |
| 风险回滚 | 一次小补丁即可回滚 |
| 分流 | 记录型 hotfix-lite，可走 lite |
