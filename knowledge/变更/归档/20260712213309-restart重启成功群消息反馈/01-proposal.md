---
type: ChangeProposal
title: restart重启成功群消息反馈
description: 飞书群 /restart 流程跑通后补充成功/失败群消息反馈，并修复重启后 poll 路径旧 port 问题
timestamp: 2026-07-12T21:33:09+0800
related: []
depends_on:
  - 20260712210942-修复restart失败failedCooldowns未定义
---

# restart重启成功群消息反馈 — 轻量变更说明

> **变更 ID**：`20260712213309-restart重启成功群消息反馈`
> **来源**：kb-lite（前序 hotfix 跟进）
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

飞书群执行 `/restart` 后，restart 流程已能跑通（前序 hotfix `20260712210942-修复restart失败failedCooldowns未定义` 修复了 `failedCooldowns is not defined`），但**重启完成后没有在群里发送成功/失败反馈**，用户无法确认重启结果。

## 根因（拟定）

1. `restartDaemon` 当前无结构化返回，`command-executor.ts` `/restart` 分支无法在重启完成后统一 `reply` 终态文案。
2. Poll 路径在 daemon 重启后仍可能用旧 `lock.port` 上报 `/cmd/result`，导致结果消息发送失败。
3. HTTP 稳态 daemon 模式下 sink 可能产生多条 reply，需合并为单条最终消息。

## 变更说明

1. `CommandExecutorContext.restartDaemon` 改为 `() => Promise<{ ok: boolean; error?: string }>`。
2. `command-executor.ts` `/restart` 分支：停止 Agent + 清空队列后执行 `restartDaemon()`，**仅在重启完成后** `reply` 一条合并文案（成功/失败）。
3. `daemon-manager.ts` 与 `agent-command-http.ts` 的 `restartDaemon` 实现返回 `{ ok, error? }`。
4. **Poll 路径**：`daemon-manager.ts` poll 执行时 `reply` 回调改用 `readLockFile()?.port ?? lock.port`，避免重启后旧 port 发 `/cmd/result` 失败。
5. **HTTP 路径（稳态 daemon 模式）**：sink 只保留最后一次 reply → 合并为单条最终消息即可。

## 验收标准

1. **成功路径**：飞书群执行 `/restart`，daemon 正常重启后，群里收到**一条**明确的成功反馈（含可理解文案，非静默）。
2. **失败路径**：`restartDaemon` 返回 `{ ok: false, error }` 时，群里收到**一条**失败反馈，文案包含错误原因摘要。
3. **时序**：成功/失败 `reply` 仅在 `restartDaemon()` **完成后**发送，不在停止 Agent/清队列中间阶段提前发送终态消息。
4. **Poll port**：daemon 重启后 poll 路径上报 `/cmd/result` 使用 `readLockFile()?.port ?? lock.port`，不因旧 port 静默丢消息。
5. **HTTP 稳态**：稳态 daemon 模式下 `/restart` 相关 sink 最终只向群发送**一条**合并终态消息。
6. **回归**：`/restart` 不再因前序 `failedCooldowns` 类错误中断；其他斜杠命令行为无意外回归。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/scheduling/command-executor.ts` | `/restart` 分支终态 reply 与 `restartDaemon` 契约 |
| `electron/daemon/daemon-manager.ts` | `restartDaemon` 返回结果；poll reply port 对齐 |
| `electron/agent/cursor-sdk/agent-command-http.ts` | `restartDaemon` 返回结果 |
| 可选 `electron/scheduling/AGENTS.md` | 若需沉淀 `/restart` reply 与 port 约定 |
| 不在范围 | proto / 跨端契约；knowledge 业务域/工程平台正文 |
| 版本/changelog | **归档时 bump patch**：`1.14.4` → `1.14.5` + 新建 `changelog/1.14.5.json`（由 builder/release 执行） |

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、拟定方案与验收已明确 |
| 修改范围 | scheduling + daemon + agent-command-http，强相关 |
| 接口契约 | 仅主进程内部 `restartDaemon` 返回类型，无 proto/跨端变更 |
| 数据/权限 | 不变 |
| 跨端联动 | 仅 Electron 主进程 + 飞书 IM 展示 |
| 知识库影响 | 记录型 lite，**无需更新** knowledge 业务域/工程平台（05 写明原因） |
| 风险 | 用户可见 `/restart` 反馈缺失，范围可控 → **hotfix-lite** |
| **总分** | **≤2**，可走 lite |

## integrations

`kb.project.json` 无 `integrations.registry` → **跳过**外部登记。
