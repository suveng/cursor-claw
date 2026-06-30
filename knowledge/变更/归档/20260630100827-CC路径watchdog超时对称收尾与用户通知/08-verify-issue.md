# 验收问题报告

> **变更 ID**：`20260630100827-CC路径watchdog超时对称收尾与用户通知`
> **manifest 阶段**：`acceptance_reopened`（第 1 轮验收打回）

## 第 1 轮

### 反馈问题

**现象**：Claude Agent（CC）路径下，hook 活动策略与 UI 日志已生效（F4-log 可观测），但 Run 仍在约 **5 分钟**被 watchdog **强杀**；日志示例：

```
2026-06-30 10:41:08.548 [CC] WARN [...] watchdog 超时，中止 Query
2026-06-30 10:41:08.551 [CC] INFO [...] watchdog 结束: timeout
```

**用户侧影响**：长任务 / 子 Agent 静默期场景下，即便 hook 持续刷新 `lastActivityAt`，Run 仍被 **绝对运行时长** 上限终止，与 Cursor SDK 路径「默认不因总时长取消」的体验 **不对称**；01 验收 **6、7**（hook 静默不误杀）及 **场景 D** 无法通过。

### 归因结论

| 问题 | 归因 | `reason` |
|------|------|----------|
| hook 活动下仍约 5min 被 watchdog 强杀 | **代码实现问题** | `code` |

**综合主归因**：`code` — CC 路径将 `watchRunGuard.timeoutMs` 设为与 idle 相同的 300_000ms，触发 `agent-run-guard` 绝对时长分支；未对齐 SDK 路径 `NEVER_CANCEL_ON_DURATION`（默认 true）语义。设计文档 C5-b 标「不改」导致该偏差在实现阶段被保留。

### 判定依据

#### 对照 01 验收 6 / 7、场景 D 与 F4-latch

| 验收项 | PRD 要求 | 代码现状 | 偏差 |
|--------|----------|----------|------|
| **01·6** 子 Agent 静默不误杀 | hook/工具活动下合理窗口内 **不** idle 误杀 | F4-hook/latch 已刷新 `lastActivityAt`（F4-log 生效） | idle 分支可能不触发，但 **绝对时长** 仍满 5min 强杀 |
| **01·7** hook 刷新活动 | 持续 hook 下 watchdog **不** 提前 idle 超时 | `armCcWatchdog.onTick` idle 判定依赖 `lastActivityAt`（`agent-cc-events.ts` L181–183） | idle 路径正确；**与 idle 解耦的 absolute 上限未关闭** |
| **场景 D / F4-latch** | 与 SDK 路径 **语义对齐** 的长静默边界 | SDK：`NEVER_CANCEL_ON_DURATION` 默认 true → 仅 idle 超时 | CC：absolute = idle = 300s → **双条件均 5min** |

#### 源码链路（已核实）

| 步骤 | 位置 | 说明 |
|------|------|------|
| 1 | `electron/agent-claude-sdk.ts` L43–44 | `WATCHDOG_IDLE_TIMEOUT_MS` 默认 300_000；**`WATCHDOG_ABSOLUTE_TIMEOUT_MS = WATCHDOG_IDLE_TIMEOUT_MS`**，absolute 与 idle 未解耦 |
| 2 | `electron/agent-cc-events.ts` L175–176 | `armCcWatchdog` 调用 `watchRunGuard({ timeoutMs: absoluteTimeoutMs, ... })`，将 300_000 传入 guard |
| 3 | `electron/agent-run-guard.ts` L73–75 | 每 tick 判定：`Date.now() - startedAt >= timeoutMs` → **无论 `lastActivityAt` 是否刷新**，满 5 分钟必 `onTimeout` |
| 4 | `electron/agent-sdk.ts` L137–139、L806–807 | SDK 对照：`NEVER_CANCEL_ON_DURATION` 默认 true → `timeoutMs: Number.MAX_SAFE_INTEGER`；绝对时长仅在显式关闭 never-cancel 时生效（L827–830） |
| 5 | `02-design.md` C5-b | 流程图与对照表将「绝对时长 `absoluteTimeoutMs`」标为 **不改** | 设计阶段遗漏 CC/SDK 对齐，实现按「不改」保留等式绑定 |

**时序推断（与日志一致）**：

1. Query 启动 → `watchRunGuard` 记录 `startedAt`。
2. 子 Agent / tool hook 持续 → `markSessionActivity` 刷新 `lastActivityAt` → idle 分支不进入 draining。
3. 约 300s 后 guard L73–75 绝对时长命中 → `onTimeout` → WARN「watchdog 超时」→ `watchdog 结束: timeout`。
4. 与 SDK 同场景（默认 never-cancel）下 Run **不应**因总时长终止 → **双路径不对称**。

#### PRD 侧说明

01 **场景 D**、**F4-latch** 与 **验收 6、7** 要求 CC 与 SDK **语义对齐** 的长静默边界；01 **F3** 要求两种超时触发时 **收尾行为一致**（已实现 F1/F2），但 **未** 要求 CC 保留与 idle 相同的 5min 绝对硬杀。问题属 **实现未对齐 SDK 默认策略**，非 PRD 口径错误或范围遗漏。

### 影响范围

| 模块 | 影响 |
|------|------|
| `electron/agent-claude-sdk.ts` | `WATCHDOG_ABSOLUTE_TIMEOUT_MS` 常量与 `makeWatchdogOpts` 传参 |
| `electron/agent-cc-events.ts` | `armCcWatchdog` → `watchRunGuard.timeoutMs` |
| `electron/agent-run-guard.ts` | 行为符合契约；**调用方**传参需调整 |
| `02-design.md` C5-b | 须修订为「对齐 SDK never-cancel」或可选 `CC_ABSOLUTE_TIMEOUT_MS` |
| 01 验收 **6、7**、**场景 D**、**K6** 台架 | **不通过**（hook 活动下仍 5min 强杀） |
| 01 验收 **1–5**（超时收尾/IM/续聊） | 若仅验证 **绝对时长** 触发路径则可能 **通过**；与本轮主问题正交 |
| Cursor SDK 路径 | **无回归**（对照基准） |

### 后续处理路径

| 问题 | 建议路径 |
|------|----------|
| CC absolute/idle 未解耦、未对齐 SDK never-cancel | **`/kb-apply` 或 `/kb-revise-apply`**：新增修复任务 — 引入 `NEVER_CANCEL_ON_DURATION`（或 CC 等价 env）；never-cancel 为 true 时 `watchRunGuard.timeoutMs = Number.MAX_SAFE_INTEGER`；idle 仍用 `CC_IDLE_TIMEOUT_MS` / `WATCHDOG_IDLE_TIMEOUT_MS`；可选独立 `CC_ABSOLUTE_TIMEOUT_MS` 供显式关闭 never-cancel 时使用 |
| 设计文档 C5-b | 同步 **`/kb-revise-apply`** 或 design 补丁：C5-b 由「不改」改为「对齐 SDK」 |
| 台架回归 | 修复后重跑 **K6**（hook 静默不误杀）及 **K2**（显式 absolute 场景，若保留可配置上限） |

### 关联验收标准

| 编号 | 摘要 | 本轮结果 |
|------|------|----------|
| **6** | hook/工具活动下合理窗口内不误杀 idle | **不通过**（absolute 5min 强杀） |
| **7** | hook 触发期间 `lastActivityAt` 刷新；持续活动下不提前 idle 超时 | **部分通过**（刷新 ✅；仍被 absolute 杀 ❌） |
| **场景 D / F4-latch** | 与 SDK 路径语义对齐的长静默边界 | **不通过** |
| **8** | Hook UI 日志；无 IM hook 原文 | **通过**（F4-log 已验证） |
| **1–5** | 超时收尾、IM 通知、续聊、双路径对称（收尾层） | **待修复后复测** / 部分场景已通过 |
| **9–10** | Stop / 非超时 error 回归 | **未在本轮复测** |
