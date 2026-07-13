---
type: ChangeProposal
title: 多会话restart隔离与异常自愈
description: /restart 仅重建当前会话 Agent；Run 异常终态仅自愈当前会话；保留 /restart daemon 全量重启
timestamp: 2026-07-13T15:53:26+08:00
related: []
depends_on:
  - 20260712213309-restart重启成功群消息反馈
  - 20260712210942-修复restart失败failedCooldowns未定义
---

# 多会话restart隔离与异常自愈 — 轻量变更说明

> **变更 ID**：`20260713155326-多会话restart隔离与异常自愈`
> **来源**：kb-lite（现网 crash_log / 多会话误杀反馈）
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P1
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

现网 `/restart` 调用 `stopAllSessionAgents` + 清空全局队列 + `restartDaemon`，多会话并存时会误杀其他会话的长驻 Agent，破坏并发调度隔离。

SDK 静默 ERROR 路径已有 `opaque_retry`（仅当前会话），但失败后长驻仍保留坏实例，并写入 `failedCooldowns` 约 30s，用户体验差；用户要求异常后自主重启**当前**会话 Agent，且不影响其他会话。

## 根因（拟定）

1. `/restart` 语义按「全进程级」实现：停全部会话 Agent、清全局队列、重启 Daemon，未区分「当前会话冷启」与「运维级全量重启」。
2. Run 异常终态（含 opaque_retry 耗尽）未触发当前 session 的 `recreateSessionAgent`（或等价冷启），坏实例与本 session 冷却残留，阻塞立即再发。

## 变更说明

1. `/restart`（无参数）：只重建**当前**会话 Agent（若有进行中 Run 则先停当前 Run + recreate / 等价冷启），**不影响**其他会话；不清全局队列；不重启 Daemon。
2. `/restart daemon`：保留旧行为（停全部 Agent + 清队列 + `restartDaemon`），供运维全量重启，并保留终态群消息反馈。
3. Run 异常终态（含 opaque_retry 耗尽后）：在**当前** session 上自主 `recreateSessionAgent`（或等价），清理本 session 冷却 / `opaqueRetryDone`，不影响其他会话。
4. 更新 help 文案与相关 AGENTS / 知识说明（远程指令；实现后由 librarian/builder 同步）。

## 验收标准

1. 两会话 A/B 并存时，A 群执行 `/restart` 后，B 仍保持长驻并可正常 dispatch。
2. A 执行 `/restart` 后，A 对新消息使用新 `agentId`；Daemon **不**重启。
3. `/restart daemon` 仍全量停 Agent + 清队列 + Daemon 重启，并有终态群消息。
4. 当前会话静默 ERROR（opaque 后仍失败）后，该会话 Agent 被重建；其他会话不受影响；用户可立即再发（不被 30s 冷却误伤，或冷却仅本 session 且重建后清除）。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/scheduling/command-executor.ts` | `/restart` 与 `/restart daemon` 语义分流 |
| `electron/agent/cursor-sdk/agent-command-http.ts` | 重启/重建 HTTP 路径对齐 |
| `electron/agent/cursor-sdk`（opaque / complete 路径） | 异常终态后当前 session 自愈重建 |
| `session-dispatcher-runtime`（可选） | 若冷却/重建落点在此则一并调整 |
| help 文案 | `/restart` vs `/restart daemon` 说明 |
| 相关 `AGENTS.md` | 调度/远程指令约定沉淀 |
| `knowledge/业务域/Agent调度/04-远程指令.md` | 知识同步型：实现后由 librarian/builder 更新 |
| 不在范围 | proto / 跨端契约；无关引擎端口抽象重构 |
| 版本/changelog | 用户可见修复；归档时按规则 bump patch + 写 changelog |

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 背景、分流语义、异常自愈与验收已明确 |
| 修改范围 | scheduling + cursor-sdk 强相关少量文件 |
| 接口契约 | 无 proto/跨端契约变更 |
| 数据与权限 | 不改库表/权限/资金/事务 |
| 客户端协作 | 单端（Electron/Daemon 侧） |
| 知识库影响 | 同步一处远程指令说明（知识同步型） |
| 风险回滚 | 可一次小补丁回滚 `/restart` 语义与自愈钩子 |
| lite 类型 | **hotfix-lite**（多会话误杀 + 异常后不可用，线上阻断可控修复） |

integrations 未启用，external 登记与通知跳过。
