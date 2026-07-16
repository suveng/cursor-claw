---
type: ChangeSummary
title: Daemon日志双写修复
description: Electron 侧对 UNIFIED_DAEMON_PREFIX 行跳过 appendToLogFile，消除与 Daemon 落盘的双写
timestamp: 2026-07-16T18:50:29+08:00
related: []
depends_on: []
---

# Daemon日志双写修复 — 变更总结

> **hotfix-lite** · 变更 ID：`20260716184553-Daemon日志双写修复`
> **来源**：kb-lite（记录型 hotfix-lite）
> **阶段**：`archived`（已 shell `mv` 至 `knowledge/变更/归档/`；本轮不 commit/push）

---

## 1、变更说明

同一条带 `[Daemon]` 统一前缀的日志原先被写两次到 `.cursor/daemon.log`：Daemon `log()` 已 stderr + 文件双写，Electron `pushDaemonStderrLine` → `pushLog` 又经 `appendToLogFile` 再写同一路径。

**落地修复**：`pushLog` 增加可选 `{ skipFile?: true }`；`pushDaemonStderrLine` 命中 `UNIFIED_DAEMON_PREFIX` 时 `pushLog(..., { skipFile: true })`，仍写内存 buffer 并广播 UI，跳过文件追加。未改 `src/daemon/daemon-logging.ts` 双写策略。

## 2、实际变更

### 2.1 代码与约定

| 文件 | 关键改动 |
|------|----------|
| `electron/app/ui-logger.ts` | `pushLog` 增加可选 `{ skipFile?: true }`；为 true 时跳过 `appendToLogFile`，仍写 buffer + 广播 UI |
| `electron/daemon/daemon-manager.ts` | 命中 `UNIFIED_DAEMON_PREFIX` 时 `pushLog(..., { skipFile: true })`；非统一前缀仍走原 `pushUiLog` 落盘路径 |
| `electron/daemon/AGENTS.md` | 沉淀：统一 `[Daemon]` 前缀行勿在 Electron 侧再 `appendToLogFile` |
| `electron/app/AGENTS.md` | 沉淀：`pushLog` 的 `skipFile` 用途与调用约定 |

**未改（显式）**：`src/daemon/daemon-logging.ts`；proto / 跨端契约；数据库 / 权限。

### 2.2 变更目录文档

- `knowledge/变更/归档/20260716184553-Daemon日志双写修复/00-manifest.json`
- `knowledge/变更/归档/20260716184553-Daemon日志双写修复/01-proposal.md`
- `knowledge/变更/归档/20260716184553-Daemon日志双写修复/05-summary.md`（本文件）

**统计**：2 源码 + 2 AGENTS 约定 + 变更文档；无知识正文改动。

## 3、与设计的差异

无，与 `01-proposal.md` 推荐修复与 4 条验收标准一致。

## 4、影响范围

| 范围 | 说明 |
|------|------|
| 模块 | Electron `ui-logger` / `daemon-manager` stderr 落盘路径 |
| 接口 | 无对外 HTTP/MCP/proto 变更；`pushLog` 仅增可选内部参数 |
| 用户可见 | `.cursor/daemon.log` 中 `[Daemon]` 行不再成对重复；UI 日志面板仍可见 |
| 不回归 | `[TEMP_CONN]` / `[SDK]` 等非统一前缀仍按原路径落盘与展示 |

## 5、知识库无需更新的原因

本变更为 **内部落盘去重**：仅调整 Electron 对已由 Daemon 落盘的统一前缀行是否再次 `appendToLogFile`，不改变对外行为语义、接口契约、进程模型或工程平台文档中已描述的 Daemon stderr+文件双写策略。`daemon-logging.ts` 文件头「禁止改双写策略」仍成立；工程平台/业务域正文无当前说明失真，故 **无需知识库更新**（无需 `/kb-index`）。

## 6、验收要点

| # | 标准（01） | 状态 |
|---|------------|------|
| 1 | 稳态下带 `[Daemon]` 前缀的同一条日志在 `.cursor/daemon.log` 中只出现一次 | ⏳ 待运行验收 |
| 2 | Electron UI/内存 buffer 仍能收到并展示 `[Daemon]` stderr 行 | ⏳ 待运行验收 |
| 3 | `[TEMP_CONN]` / `[SDK]` 等仍按原路径落盘与展示 | ⏳ 待运行验收 |
| 4 | 未修改 `daemon-logging.ts` 的 stderr + 文件双写策略 | ✅ 磁盘已核对无 diff |

## 7、阶段说明

- LITE-01 `status=done`；builder 代码与 AGENTS 已落盘。
- scribe 已写入 `05-summary.md`；随后 **kb-release** 已将目录 shell `mv` 至归档，**`stage=archived`**。
- 按用户硬要求：本轮 **不** git commit / push，**不** 外部 sync。
