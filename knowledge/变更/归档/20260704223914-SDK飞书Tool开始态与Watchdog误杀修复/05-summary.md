# SDK 飞书 Tool 开始态与 Watchdog 误杀修复 - 变更总结

> **变更 ID**：`20260704223914-SDK飞书Tool开始态与Watchdog误杀修复`
> **来源**：kb-propose · standard flow（Bug P1）
> **阶段**：`tested`（04-review 通过；06 静态+编译通过；E2E 待手工）
> **范围**：T1–T5 done

---

## 1、实际变更

### 代码（与 manifest.files code 一致）

| 文件 | 关键改动 |
|------|----------|
| `src/shared/tool-presentation.ts` | `stringifyToolPayload` 对 task 工具日志展示 `description` 摘要 |
| `electron/agent/cursor-sdk/sdk-session-types.ts` | `SdkSessionAgent` 增可选 `watchdogTimedOut?: boolean` |
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | `resetSdkRunPresentationState` 清零 `watchdogTimedOut`；`markSessionActivity` 在 `cancelling \|\| watchdogTimedOut` 时仅刷新 `lastActivityAt`、不 `activity_resume` |
| `electron/agent/cursor-sdk/sdk-run-watchdog.ts` | `onTimeout` 在 `cancelRunAndWait` **前**置 `watchdogTimedOut = true`（对称 CC L228） |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | status/stream 分支：`watchdogTimedOut \|\| runFinalizing` 时跳过 `isRunTimeoutFailure` / 重复 `finalize` |
| `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` | `completeSdkRun` 增 `!watchdogTimedOut` 门控，避免超时闩后二次收尾 |
| `electron/agent/cursor-sdk/finalize-sdk-run.ts` | `isRunTimeoutFailure` 副门控：`watchdogTimedOut === true` 时早退 `false` |
| `electron/agent/cursor-sdk/AGENTS.md` | watchdog 闩、activity 门控、收尾去重约定 |
| `src/shared/AGENTS.md` | `stringifyToolPayload` / task 描述展示索引 |
| `src/daemon/AGENTS.md` | 飞书 tool/thinking handler 行为（本 diff 无 `daemon.ts` 改动） |

**T1 说明**：Presentation / daemon 路径已在 commit `6b7caf3`（归档变更 `20260704212706`）落地；本变更对 `src/daemon/daemon.ts` **无额外 diff**，T1 以静态回归验收为主。

**用户可见行为**：

- Task 工具开始态过程通知继续携带 `description` 摘要（继承 v1.13.5；本变更补强 tool_call 日志侧 `stringifyToolPayload`）。
- 看门狗因长 idle 主动取消后，平台 `CANCELLED` 状态**不再**错误 `activity_resume`，**不再**重复触发超时失败通知与 `sdk_timeout` 归档。
- 非竞态 hung run 的真实超时保护路径保留。

**不变**：`sdk-run-presentation.ts` Rev2 end-only 链；飞书 thinking 零出站；silent 工具分级；`daemon.ts` 抑制分支。

### 变更文档

- `00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`、`05-summary.md`（本文件）

### 版本与 changelog

- `package.json`：`1.13.7` → **`1.13.8`**（patch；由 `/kb-archive` release 工序写入）
- `changelog/1.13.8.json`（新建；由 release 工序写入，预期要点：Task 工具开始态描述补强、watchdog 竞态误杀修复）

---

## 2、与设计的差异

与 `02-design` / `03-tasks` 核心契约**一致**；无阻断性设计偏差。

| 项 | 设计预期 | 实际 | 评估 |
|----|----------|------|------|
| T2 `watchdogTimedOut` + reset | 字段与 reset 清零 | 已落地 | ✅ |
| T3 `onTimeout` 前置置闩 + activity 门控 | cancel 前闩；cancelling/闩不 resume | 已落地 | ✅ |
| T4 status/stream/complete + 副门控去重 | 三路径 caller 门控 + `isRunTimeoutFailure` 早退 | 已落地 | ✅ |
| T1 6b7caf3 路径回归 | 本 diff 无 presentation/daemon 改动 | 静态验收通过 | ✅ |
| T5 三份 `AGENTS.md` | 已同步；不写 `06-CursorSDK` | 已落地 | ✅ |

**可选债务（04-review，不阻断）**：

| ID | 说明 |
|----|------|
| **R1** | `onTimeout` 在 `runFinalizing` 早退时不置 `watchdogTimedOut`；可选闩前移一行对齐 CC |
| **R2** | caller 门控可额外判断 `watchdogState === 'cancelling'`（现网 `watchdogTimedOut` 已覆盖主路径） |

---

## 3、影响范围

- **Cursor SDK + 飞书**：Task 工具开始态可读性维持/日志侧补强；watchdog 与平台 `CANCELLED` 竞态不再误杀。
- **收尾语义**：`watchdogTimedOut` 闩后，status/stream/complete 三路径与 `isRunTimeoutFailure` 协同去重，用户仅见**单次**超时类收尾（竞态场景）。
- **用户主动 Stop**：`stopSdkSession` 不置 `watchdogTimedOut`，行为与现网一致。
- **非目标**：Claude/Codex/OpenCode 引擎；`sdk-run-presentation.ts` Rev2；Electron 设置 UI；proto/DB 未改。
- **测试残留**：01 验收 1–10 飞书 E2E 待维护者手工（06 §4.2）；不阻断 archive。

### 3.1 Ponytail 技术债

无（本 diff 无 `ponytail:` 注释；04-review 口径 **Lean already. Ship.**）。

---

## 4、知识库影响清单

> 来源：`02-design` §九、§十；`06-CursorSDK` 正文由 **kb-librarian** 在 `/kb-archive` 消费本清单落盘。

| 文件 | 状态 |
|------|------|
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` §二/§八/§十 | ✅ 已更新（watchdog 闩、activity 门控、收尾去重、Task tool_call 开始态） |
| `electron/agent/cursor-sdk/AGENTS.md` | ✅ 已更新（T5） |
| `src/shared/AGENTS.md` | ✅ 已更新（T5） |
| `src/daemon/AGENTS.md` | ✅ 已更新（T5） |
| `knowledge/知识索引.md` | 不需要更新 |
