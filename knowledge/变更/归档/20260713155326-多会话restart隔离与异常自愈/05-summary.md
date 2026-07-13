---
type: ChangeSummary
title: 多会话restart隔离与异常自愈
description: /restart 仅重建当前会话；Run 异常终态 error-auto-restart 自愈当前会话；保留 /restart daemon 全量重启
timestamp: 2026-07-13T16:12:00+0800
related: []
depends_on:
  - 20260712213309-restart重启成功群消息反馈
  - 20260712210942-修复restart失败failedCooldowns未定义
---

# 多会话restart隔离与异常自愈 — 变更总结

> **hotfix-lite** · 变更 ID：`20260713155326-多会话restart隔离与异常自愈` · 版本 **1.14.9**
> **来源**：kb-lite（现网多会话误杀 / 异常后不可用）
> **阶段**：`archived`

---

## 1、实际变更

### 1.1 代码与配置

| 文件 | 关键改动 |
|------|----------|
| `electron/scheduling/command-executor.ts` | `/restart` 分流：默认仅 `restartCurrentSessionAgent`；`/restart daemon` 保留停全部 + 清队列 + `restartDaemon` |
| `electron/session/session-dispatcher-runtime.ts` | 新增 `restartCurrentSessionAgent`（按 sessionKey 原地重建 SDK / 停非 SDK 会话） |
| `electron/session/session-dispatcher.ts` | 导出/挂接当前会话重启能力 |
| `electron/agent/cursor-sdk/sdk-resident-refresh.ts` | `recreateSessionAgent` 供 slash-restart / error-auto-restart 复用 |
| `electron/agent/cursor-sdk/sdk-run-port-lifecycle.ts` | 非超时 ERROR 终态后 `error-auto-restart`：仅重建当前会话并清本 session 冷却 / `opaqueRetryDone` |
| `electron/agent/cursor-sdk/agent-command-http.ts` | HTTP 斜杠执行路径与分流语义对齐 |
| `src/shared/feishu-help-text.ts` | help：`/restart` vs `/restart daemon` 文案 |
| `src/daemon/daemon-slash-command-router.ts` | Daemon 侧斜杠路由说明对齐 |
| `electron/scheduling/AGENTS.md` | 调度约定：当前会话 vs 全量 daemon |
| `electron/agent/cursor-sdk/AGENTS.md` | error-auto-restart / 当前会话自愈约定 |
| `electron/session/AGENTS.md` | `restartCurrentSessionAgent` 边界 |
| `knowledge/业务域/Agent调度/04-远程指令.md` | `/restart` 仅当前会话；`/restart daemon` 全量 |
| `package.json` | version `1.14.8` → **`1.14.9`** |
| `changelog/1.14.9.json` | 用户可见变更摘要 |

### 1.2 变更文档

- `01-proposal.md`
- `00-manifest.json`、`05-summary.md`（本文件）

**未纳入**：proto / 跨端契约；无关引擎端口抽象重构。

## 2、行为变更

1. **`/restart`（无参数）**：只重建**当前**会话 Agent；不清全局队列；不重启 Daemon；其他会话长驻不受影响。
2. **`/restart daemon`**：保留运维全量行为（停全部 Agent + 清队列 + Daemon 重启 + 终态群消息）。
3. **异常自愈**：长驻会话非超时 ERROR（含 opaque_retry 耗尽后）经 `recreateSessionAgent(..., "error-auto-restart")` 重建**当前**会话，并清除本 session `failedCooldowns` / `opaqueRetryDone`，便于立即重试。

## 3、与设计的差异

无，与 `01-proposal.md` 分流语义与 4 条验收标准一致。

### 3.1 Ponytail 技术债

无。

## 4、影响范围

- **模块**：scheduling 斜杠执行、session-dispatcher 当前会话冷启、Cursor SDK Run 终态自愈、help 文案。
- **接口**：无 proto/跨端契约变更；IM 斜杠语义变更（用户可见）。
- **用户可见**：多会话下 `/restart` 不再误杀其他会话；异常后可立即再发。

## 5、知识库更新结论

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/04-远程指令.md` — `/restart` 仅当前会话；`/restart daemon` 全量（已落盘）

### （二）可能更新

- [x] 相关 `AGENTS.md`（scheduling / cursor-sdk / session）— apply 已同步

### （三）不需要更新

- [x] 其他业务域 / 工程平台正文 — 无额外语义扩散
- [x] `knowledge/知识地图.md` / 总 index — 无新领域入口

## 6、验收对照

| # | 标准（01） | 状态 |
|---|------------|------|
| 1 | 两会话 A/B 并存时，A 群 `/restart` 后 B 仍长驻可 dispatch | ⏳ 待用户验证 |
| 2 | A `/restart` 后 A 用新 `agentId`；Daemon 不重启 | ⏳ 待用户验证 |
| 3 | `/restart daemon` 仍全量停 Agent + 清队列 + Daemon 重启，有终态群消息 | ⏳ 待用户验证 |
| 4 | 静默 ERROR（opaque 后仍失败）后当前会话重建；他会话不受影响；可立即再发 | ⏳ 待用户验证 |
| — | version `1.14.9` + `changelog/1.14.9.json` | ✅ 本轮归档已落盘 |

## 7、Changelog 要点（1.14.9）

- `/restart` 仅重建当前会话，不影响其他会话；全量请用 `/restart daemon`
- Agent 异常后自动重建当前会话，便于立即重试

## 8、阶段说明

- hotfix-lite；无 `04-review.md`；LITE-01 `done`。
- 本轮 scribe：补全 `05-summary`、bump patch、写 changelog、`stage=archived`、目录迁入 `knowledge/变更/归档/`。
- **未** git commit / push（用户未要求）。
