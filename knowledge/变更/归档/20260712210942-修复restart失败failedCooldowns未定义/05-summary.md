---
type: ChangeSummary
title: 修复restart失败failedCooldowns未定义
description: stopAllSdkSessions 经 clearSdkDispatchState 修复 bundle 裸引用 failedCooldowns
timestamp: 2026-07-12T21:09:42+0800
related: []
depends_on: []
---

# 修复restart失败failedCooldowns未定义 — 变更总结

> **hotfix-lite** · 变更 ID：`20260712210942-修复restart失败failedCooldowns未定义`
> **来源**：kb-lite
> **阶段**：`archived`（已归档）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | 新增 `clearSdkDispatchState()`：清理 `failedCooldowns` 与 `pendingLaunches` |
| `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` | `stopAllSdkSessions` 改调 `clearSdkDispatchState()`，移除内联 `failedCooldowns.clear()` / `pendingLaunches.clear()` |
| `electron/agent/cursor-sdk/AGENTS.md` | 会话注册表段补充 `clearSdkDispatchState` 为 dispatch 冷却/pending 清理 SSOT |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入（显式）**：proto/数据库、业务域知识、`package.json` version、`changelog/`。

**不 bump version/changelog 理由**：本修复为 Rollup bundle 作用域内符号绑定问题，恢复既有 `/restart` 预期行为，无新增用户可见功能或文案变更；属内部实现修正，按 hotfix-lite 记录型归档，跳过版本号与 changelog。

**统计**：2 源码文件 + 1 AGENTS 约定；局部 SDK lifecycle 修正。

## 2、与设计的差异

无，与 `01-proposal.md` 验收标准一致。

## 3、影响范围

- **涉及模块**：Cursor SDK Run 生命周期（`sdk-run-lifecycle` / `sdk-session-registry`）。
- **行为变更**：`/restart` 路径不再因 `failedCooldowns is not defined` 抛错；dispatch 冷却与 pending launch 清理逻辑不变，仅调用入口收敛。
- **接口/proto/数据**：无对外契约变更；无持久化模型变更。
- **用户可见性**：修复后用户可正常执行 `/restart`（恢复 crash 后重启能力）；无新 UI 或文案。

### 3.1 Ponytail 技术债

无（本次 diff 未新增 `ponytail:` 注释）。

## 4、知识库影响清单

hotfix-lite 记录型：**知识库无需更新**。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/**` | 无需更新 | 无 IM/调度/通道等业务语义变更 |
| `knowledge/工程平台/**` | 无需更新 | 局部 bundle 作用域修复；约定已写入 `electron/agent/cursor-sdk/AGENTS.md` |
| `knowledge/知识索引.md` | 无需更新 | 无新领域/分区入口 |

- [x] 业务域 — 无用户可见业务行为变更
- [x] 工程平台 — 内部 SDK 实现修正，记录型不扩 KB
- [x] 知识索引 — 总入口未变化

## 5、验收步骤

| # | 项 | 操作 | 状态 |
|---|-----|------|------|
| 1 | 重新构建 | 执行 `npm run build`，确认主进程 bundle 成功产出 | ✅ 修复轮 build 已通过 |
| 2 | bundle 符号检查 | `grep -n 'failedCooldowns' out/main/index.js`：`stopAllSdkSessions` 路径应经 `clearSdkDispatchState`，**不应**出现裸 `failedCooldowns.clear()`（修复前产物在 ~36292 行可见该裸引用） | ✅ 已确认：`stopAllSdkSessions` 调用 `clearSdkDispatchState`（`out/main/index.js` ~36294–36296） |
| 3 | `/restart` 冒烟 | 应用运行中执行 `/restart`，确认不再报 `failedCooldowns is not defined`，Daemon/SDK 可正常重启 | ✅ v1.14.4 实机飞书 `/restart` ×2；shutdown→~2s 新 Daemon；无 ReferenceError |

## 6、归档说明

- [x] **文档阶段**：`05-summary` 已标 `archived`；`00-manifest.json` 的 `stage` 与目录 `mv` 由 kb-release 同轮完成
- [x] **版本/changelog**：**跳过 bump**（内部 bundle 作用域修复，用户不可见行为变更；见 §1）
