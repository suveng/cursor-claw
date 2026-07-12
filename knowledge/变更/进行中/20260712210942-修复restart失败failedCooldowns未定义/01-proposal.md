---
type: ChangeProposal
title: 修复restart失败failedCooldowns未定义
description: 修复 Rollup bundle 后 stopAllSdkSessions 裸引用 failedCooldowns 导致 /restart 失败
timestamp: 2026-07-12T21:09:42+0800
related: []
depends_on: []
---

# 修复restart失败failedCooldowns未定义 — 轻量变更说明

> **变更 ID**：`20260712210942-修复restart失败failedCooldowns未定义`
> **来源**：kb-lite（crash_log 跟进）
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P1
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

crash_log `20260712205747` 后用户执行 `/restart` 失败，报错：

> `failedCooldowns is not defined`

日志表明 `stopAllSdkSessions` 在清理 dispatch 冷却态时抛错，导致重启流程中断。

## 根因

Rollup 打包将 `sdk-session-registry.ts` 导出的 `failedCooldowns` 重命名为 `failedCooldowns$1`，但 `stopAllSdkSessions` 内联代码仍直接引用裸标识符 `failedCooldowns`。源码层 import 看似正确，bundle 产物 `out/main/index.js` 中该调用点未绑定到重命名后的符号，运行期 `ReferenceError`。

## 变更说明

1. 在 `sdk-session-registry.ts` 新增 `clearSdkDispatchState()`，统一清理 `failedCooldowns` 与 `pendingLaunches`。
2. `sdk-run-lifecycle.ts` 的 `stopAllSdkSessions` 改调 `clearSdkDispatchState()`，避免在 lifecycle 模块内直触 Map/Set 导出，消除 bundle 作用域裸引用风险。
3. 更新 `electron/agent/cursor-sdk/AGENTS.md` 记录 dispatch 状态清理入口约定。

## 验收标准

1. **源码**：`stopAllSdkSessions` 仅调用 `clearSdkDispatchState()`，不再内联 `failedCooldowns.clear()` / `pendingLaunches.clear()`。
2. **构建产物**：执行 `npm run build` 后，`out/main/index.js` 中 `stopAllSdkSessions` 路径**不出现**裸 `failedCooldowns.clear()`（应经 `clearSdkDispatchState` 或 `failedCooldowns$1` 等合法绑定）。
3. **功能**：应用运行中执行 `/restart` 不再因 `failedCooldowns is not defined` 失败；SDK 会话可正常停止并重启。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | 新增 `clearSdkDispatchState` |
| `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` | `stopAllSdkSessions` 改调清理函数 |
| `electron/agent/cursor-sdk/AGENTS.md` | 代码侧 SSOT 补充 |
| 不在范围 | proto / 跨端契约；用户可见功能行为（修复后恢复预期 `/restart`） |
| 版本/changelog | **不 bump**：内部 bundle 作用域修复，无新增用户可感知特性 |

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、crash_log、bundle 根因与验收已明确 |
| 修改范围 | cursor-sdk 两处源码 + AGENTS，强相关 |
| 接口契约 | 无 proto/跨端契约变更 |
| 数据/权限 | 不变 |
| 跨端联动 | 仅 Electron 主进程 SDK 路径 |
| 风险 | 线上 `/restart` 阻断、范围可控 → **hotfix-lite** |
| **总分** | **≤2**，可走 lite |
