# SDK 飞书 Tool 开始态与 Watchdog 误杀修复 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **范围**：Cursor SDK 路径；补强 Task 工具 tool_call 开始态呈现回归验收 + watchdog 竞态门控；**禁止**修改 `sdk-run-presentation.ts` Rev2 defer/release 链、`handleStreamText` final 语义、分级门控 SSOT。

## 1、执行计划

### 1.1 依赖图

```
T1 ─────────────────────┐
T2 → T3 → T4 ───────────┼──→ T5
```

- **T1**（Presentation 回归验收）：独立，可与 **T2** 并行。
- **T2**（`watchdogTimedOut` 字段）：无前置；为 T3/T4 数据前提。
- **T3**（activity 门控 + onTimeout 置闩）：依赖 T2；`sdk-session-registry.ts` 与 `sdk-run-watchdog.ts` 同轮串行。
- **T4**（status/stream/complete 去重 finalize）：依赖 T3。
- **T5**（AGENTS 同步）：依赖 T1、T4；不写 `knowledge/业务域`（留 archive 更新 `06-CursorSDK执行引擎.md`）。

### 1.2 分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1, T2 | 是 | 无文件冲突 |
| **第二轮** | T3 | — | 依赖 T2；registry + watchdog 须同任务串行 |
| **第三轮** | T4 | — | 依赖 T3；stream/lifecycle/finalize 须同任务串行 |
| **第四轮** | T5 | — | 文档；依赖 T1、T4 代码行为 |

**推荐串行顺序**：T1 ∥ T2 → T3 → T4 → T5

**同文件冲突表**

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `src/shared/tool-presentation.ts` | T1（验收/补缺） |
| `src/daemon/daemon.ts` | T1（验收/补缺） |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | T1（验收）→ T4（门控） |
| `electron/agent/cursor-sdk/sdk-session-types.ts` | T2 |
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | T2（reset）→ T3（markSessionActivity） |
| `electron/agent/cursor-sdk/sdk-run-watchdog.ts` | T3（onTimeout 置闩） |
| `electron/agent/cursor-sdk/finalize-sdk-run.ts` | T4 |
| `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` | T4 |
| `electron/agent/cursor-sdk/AGENTS.md` | T5 |
| `src/shared/AGENTS.md` | T5 |
| `src/daemon/AGENTS.md` | T5 |

## 2、任务清单

---

## T1: Presentation 路径回归验收（S2/S3）

### 背景

commit `6b7caf3` 已贯通 Task 工具 **tool_call** 路径：`extractTaskPresentationFields` → `postPresentationEvent` 透传 `tool_task_description` → daemon `formatToolMilestoneText` task 分支。本任务以**验收为主**：确认 shell/task 开始态、thinking 零出站与 01 验收 1–5、8–9 对齐；仅当静态/运行抽检发现缺口时做**最小补齐**（如日志 `stringifyToolPayload` 未解析 task description 等），不重做已归档 task **事件**映射。

### 上下文文件

- 必读: `src/shared/tool-presentation.ts` — `extractTaskPresentationFields`、`parseTaskToolArgs`、`formatToolMilestoneText`（task/shell 分支）
- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` L138–166 — `case "tool_call"`、`extractTaskPresentationFields` 展开
- 必读: `src/daemon/daemon.ts` — `handleToolPresentationEvent`（L1458–1487）、`handleThinkingPresentationEvent`（L1593–1596 飞书零出站）
- 必读: `electron/agent/cursor-sdk/sdk-session-types.ts` — `PresentationEvent.tool_task_description`
- 参考: `src/shared/sdk-tool-presentation-tier.ts` — notify 白名单（task/shell）
- 参考: `01-proposal.md` — 验收 1–5、8–9；F1–F3、F5
- 参考: 归档变更 `20260704212706` — shell/task 事件与 tool_call 路径边界

### 实现范围

- **验收**（优先）:
  - `tool_call` 名 `task` + `args.description` → event 含 `tool_task_description` → 飞书里程碑 `正在执行：{描述}`，**禁止**裸 `task：已开始` / `子任务进行中…`
  - shell started 各呈现路径含命令摘要或 F2.3 降级句，**禁止**裸 `shell: started`
  - 飞书 thinking 抑制分支零 `sendMilestoneText`（`return { ok: true }`）
  - read/glob 等 silent 工具仍无 started 里程碑
- **补缺**（仅验收失败时）:
  - 修改: `src/shared/tool-presentation.ts` / `src/daemon/daemon.ts` / `electron/agent/cursor-sdk/sdk-run-stream.ts` 中与本路径直接相关的缺口
  - **禁止**修改: `sdk-run-presentation.ts`、`sdk-run-watchdog.ts`（归 T3/T4）、分级 SSOT

### 接口契约

- `extractTaskPresentationFields(toolName, status, args)` → `{ tool_task_description?: string } | undefined`
- `formatToolMilestoneText("task", "started", { tool_task_description })` → `正在执行：{truncateText(desc, TOOL_MILESTONE_TEXT_MAX)}`；无描述 → `子任务已开始（描述暂不可展示）`
- `postPresentationEvent` tool 载荷继续展开 `...extractTaskPresentationFields(...)`；daemon 继续读 `event.tool_task_description`
- 飞书 thinking：`isFeishuProcessPresentationSuppressed` 为 true 时 **无** `sendMilestoneText` 副作用

### 验收标准

- [ ] **01 验收 1**：≥2 个可区分 `description` 的 Task 工具 started，飞书开始态含对应描述摘要
- [ ] **01 验收 2**：task 事件与 Task 工具 tool_call 并存时，两路径描述均可读、无退化
- [ ] **01 验收 3–4**：≥3 条不同 shell started 均含命令摘要或明确降级句；文本里程碑路径信息等价
- [ ] **01 验收 5**：含 thinking 阶段 Run，飞书无独立思考通知；10s 内仍有处理中态/正文/子任务或工具 started 等反馈
- [ ] **01 验收 8**：read/glob 等 silent 工具仍无开始态通知
- [ ] **01 验收 9**：同次 shell/Task completed/failed 展示不退化
- [ ] **01 验收 10**：桌面 SDK 日志 `[thinking]` 仍有输出
- [ ] **02·八·（二）**：Task started 含 description；build:mcp 通过（本任务改动后须跑通）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: 无（可与 T2 并行）
- 后续任务: T5

---

## T2: watchdogTimedOut 会话字段与 reset（S5-4）

### 背景

看门狗 idle 取消与平台 `CANCELLED` 竞态时，须能区分「watchdog 已主动超时取消」与「平台短取消/用户 Stop」。对称 CC 路径（`agent-cc-events.ts` L228 在 `onTimeout` 置 `watchdogTimedOut=true`），本任务在 Cursor SDK session 模型增可选布尔字段，并在 Run 重置时清零，供 T3 置闩、T4 门控消费。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-session-types.ts` — `SdkSessionAgent` 全貌（当前无 `watchdogTimedOut`）
- 必读: `electron/agent/cursor-sdk/sdk-session-registry.ts` — `resetSdkRunPresentationState`（L28–53）
- 参考: `electron/agent/claude-code/agent-cc-types.ts` L84 — `watchdogTimedOut?: boolean` 注释口径
- 参考: `electron/agent/claude-code/agent-cc-events.ts` L224–231 — `onTimeout` 置闩时序
- 参考: `01-proposal.md` — F4、验收 6–7

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-session-types.ts` —
  - 在 `SdkSessionAgent` 增 `watchdogTimedOut?: boolean`
  - JSDoc：对称 CC；`armRunWatchdog.onTimeout` 在 `cancelRunAndWait` **前**置 `true`；`resetSdkRunPresentationState` 清零；用户主动 `stopSdkSession`（aborted）**不**置闩
- 修改: `electron/agent/cursor-sdk/sdk-session-registry.ts` —
  - `resetSdkRunPresentationState` 增加 `session.watchdogTimedOut = undefined`（或 `false`）
- **不改**: `markSessionActivity`、`onTimeout` 消费逻辑（留给 T3/T4）

### 接口契约

```ts
/** watchdog idle/absolute 超时触发取消时为 true；用户 Stop 不得置位 */
watchdogTimedOut?: boolean
```

- Run 级字段；`resetSdkRunPresentationState` / `startSdkRun` 路径须清零
- 可选字段，不破坏现有 session 构造

### 验收标准

- [ ] TypeScript 编译通过；`sdk-session-types.ts` ≤300 行
- [ ] 新 Run 开始时 `watchdogTimedOut` 为 `undefined`/`false`
- [ ] 字段注释明确与 CC 对称、Stop 不置闩
- [ ] 覆盖 T3/T4 数据前提（01 验收 6–7）
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: 无
- 后续任务: T3、T4

---

## T3: markSessionActivity 门控 + onTimeout 置闩（S5-5/6）

### 背景

**竞态根因**（2026-07-04 22:35 日志）：`streamRunEvents` L254 `markSessionActivity(stream:status)` → `handleSdkEvent` status L169 再次 `markSessionActivity(status)` → `watchdogState` 从 `cancelling` 被 `activity_resume` 恢复为 `running` → L176 `isRunTimeoutFailure`（duration≥7min）再次触发 `finalizeSdkRunOnTimeout` 与 `sdk_timeout` 归档。

方案：对称 CC 在 `onTimeout` 置 `watchdogTimedOut`；`markSessionActivity` 在 `watchdogState==='cancelling'` **或** `session.watchdogTimedOut` 时**仅**刷新 `lastActivityAt`，**不**调用 `setWatchdogState(..., 'running', activity_resume:*)`。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-session-registry.ts` L66–75 — 现网 `markSessionActivity`（无条件 resume）
- 必读: `electron/agent/cursor-sdk/sdk-run-watchdog.ts` L104–126 — `onTimeout`（当前未置 `watchdogTimedOut`）
- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` L250–256、L168–195 — 双次 activity 与 status 分支
- 参考: `electron/agent/claude-code/agent-cc-events.ts` L228 — 置闩参考
- 参考: `01-proposal.md` — F4.1、验收 6

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-session-registry.ts` — `markSessionActivity`:
  ```ts
  session.lastActivityAt = Date.now()
  if (session.watchdogState === 'cancelling' || session.watchdogTimedOut) {
    return // 不 activity_resume
  }
  if (session.watchdogState !== 'running') {
    setWatchdogState(session, 'running', `activity_resume:${source}`)
  }
  ```
- 修改: `electron/agent/cursor-sdk/sdk-run-watchdog.ts` — `onTimeout` 内，在 `setWatchdogState(..., 'cancelling', ...)` 之后、`cancelRunAndWait(run)` **之前**：
  ```ts
  session.watchdogTimedOut = true
  ```
- **不改**: `finalizeSdkRunOnTimeout` 调用时机（T4 去重）；`stopSdkSession` 不得置闩

### 接口契约

- `markSessionActivity(session, source)`：`cancelling || watchdogTimedOut` → 只更新 `lastActivityAt`；`draining` 且无闩时仍允许 resume（现网语义）
- `armRunWatchdog.onTimeout`：进入取消前 `session.watchdogTimedOut = true`（与 CC L228 对称）
- UI 日志：cancelling 态收到 status 事件时**不应**出现 `activity_resume:stream:status` 或 `activity_resume:status`

### 验收标准

- [ ] **01 验收 6**（门控前半）：模拟长 idle → watchdog `cancelling` → 收到 `CANCELLED` status，日志**无** `activity_resume:stream:status` / `activity_resume:status`
- [ ] `watchdogTimedOut` 在 `onTimeout` 触发取消前已置 `true`
- [ ] 正常 Run 中非 cancelling 事件的 `markSessionActivity` 仍可 resume `draining`（非竞态 hung run 保护不退化）
- [ ] 用户主动 Stop（`abortController.aborted`）不置 `watchdogTimedOut`
- [ ] **02·八·（二）**：cancelling + CANCELLED 无 resume
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T2
- 后续任务: T4

---

## T4: status/stream/complete 超时收尾去重（S4/S6）

### 背景

T3 阻止 watchdog 被 CANCELLED「复活」，但 `isRunTimeoutFailure`（platform ≥7min + CANCELLED/ERROR）仍可能在 status 分支（L176）、`streamRunEvents` 尾部（L265–271）、`completeSdkRun` cancelled 分支（L82–88）**重复**调用 `finalizeSdkRunOnTimeout` / `notifySdkFailure(cancelled)`，产生二次 IM 通知与 `sdk_timeout` 归档。本任务在三条收尾路径加统一门控。

**契约（二选一，本变更采用组合）**：
1. **主门控（caller）**：`sdk-run-stream.ts` status 分支、`streamRunEvents` 尾部、`sdk-run-lifecycle.ts` `completeSdkRun` — 当 `session.watchdogTimedOut || session.runFinalizing` 时跳过 `isRunTimeoutFailure` 判定链与 `finalizeSdkRunOnTimeout` / `notifySdkFailure(cancelled)`
2. **副门控（finalizer）**：`finalize-sdk-run.ts` `isRunTimeoutFailure` 开头若 `session.watchdogTimedOut === true` 则早退 `false`（兜底防遗漏）

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` L168–195（status）、L265–271（stream 尾部）
- 必读: `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` L82–88 — `completeSdkRun` cancelled + timeout 分支
- 必读: `electron/agent/cursor-sdk/finalize-sdk-run.ts` L57–79 — `isRunTimeoutFailure`
- 必读: `electron/agent/cursor-sdk/sdk-run-finalize.ts` — `finalizeSdkRunOnTimeout` 导出（只读）
- 参考: `electron/agent/claude-code/agent-cc-stream.ts` L266 — `watchdogTimedOut` 消费模式
- 参考: `01-proposal.md` — F4.2–F4.4、验收 6–7

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-run-stream.ts` —
  - `case "status"`：`isErr || CANCELLED` 分支内，若 `session.watchdogTimedOut || session.runFinalizing` → **跳过** `isRunTimeoutFailure` / `finalizeSdkRunOnTimeout` / `notifySdkFailure(cancelled)`
  - `streamRunEvents` 尾部 finalize 块：同样门控后再判 `isRunTimeoutFailure`
- 修改: `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` —
  - `run.status === "cancelled" && isRunTimeoutFailure` 分支：增加 `!session.watchdogTimedOut` 门控（或统一 helper）
- 修改: `electron/agent/cursor-sdk/finalize-sdk-run.ts` —
  - `isRunTimeoutFailure`：若 `(session as SdkSessionForFinalizer).watchdogTimedOut === true` 则 `return false`（须在 `SdkSessionForFinalizer` 类型扩展该字段）
- **保留**: 非竞态 hung run（无 `watchdogTimedOut`、无平台 CANCELLED 干扰）仍走既有 timeout finalize

### 接口契约

```ts
// caller 门控（伪代码）
if (session.watchdogTimedOut || session.runFinalizing) {
  // 仅记日志/lastStatus，不 finalize / 不 notifySdkFailure(cancelled)
} else if (isRunTimeoutFailure(...)) {
  await finalizeSdkRunOnTimeout(...)
}

// isRunTimeoutFailure 副门控
if (session.watchdogTimedOut === true) return false
```

- `finalizeSdkRunOnTimeout` trigger（`status`/`stream`/`complete`/`watchdog`）语义不变；竞态场景仅触发一次（通常 `watchdog` trigger）
- `failureArchiveDone` 幂等仍有效；本任务防止进入第二次 finalize 路径

### 验收标准

- [ ] **01 验收 6**：复现「长 idle watchdog 取消 + stream CANCELLED」，**无**二次超时失败通知、**无**重复 `sdk_timeout` 崩溃归档（单次 archive）
- [ ] **01 验收 7**：非竞态 hung run（无 CANCELLED 干扰、未置 `watchdogTimedOut`）仍由 watchdog 合理收尾并通知用户
- [ ] status/stream/complete 三路径在 `watchdogTimedOut` 已置时均不调用 `notifySdkFailure(..., "sdk_cancelled")` 与 `finalizeSdkRunOnTimeout(..., "status"|"stream"|"complete")`
- [ ] **02·八·（二）**：≥7min 竞态场景单次 `sdk_timeout`；真实 hung run 仍 timeout
- [ ] TypeScript 编译通过；改动文件均 ≤300 行
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T3
- 后续任务: T5

---

## T5: AGENTS 编码约定同步

### 背景

T1 呈现路径与 T4 watchdog 门控落地后，须同步三份代码侧 `AGENTS.md`，使开发指引与运行行为一致。**不写** `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md`（标注由 `/kb-archive` 知识库任务更新 §二/§八）。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/AGENTS.md` — Presentation、watchdog、错误 notify 段落
- 必读: `src/shared/AGENTS.md` — `tool-presentation`、task 工具里程碑段落
- 必读: `src/daemon/AGENTS.md` — 飞书 Presentation 门控、thinking 零出站
- 参考: T1–T4 已落地代码实际行为
- 参考: `02-design.md` §十·（一）— archive 阶段须更 `06-CursorSDK执行引擎.md`

### 实现范围

- 修改: `electron/agent/cursor-sdk/AGENTS.md` —
  - 补充 `watchdogTimedOut` 字段、`markSessionActivity` cancelling/闩门控、`onTimeout` 置闩时序
  - 补充 status/stream/complete 竞态去重门控与 `isRunTimeoutFailure` 副门控
  - 确认 Task 工具 tool_call `tool_task_description` / `formatToolMilestoneText` 描述已文档化
- 修改: `src/shared/AGENTS.md` —
  - 确认 `extractTaskPresentationFields` / `formatToolMilestoneText` task 分支 SSOT 描述与代码一致
- 修改: `src/daemon/AGENTS.md` —
  - 确认 `handleToolPresentationEvent` 透传 `tool_task_description`；thinking 飞书零出站
- **不写**: `knowledge/业务域/**`（archive T5 或单独知识库任务）
- 运行: `npm run build:mcp` 通过

### 接口契约

- 文档描述须与 T1–T4 代码一致；不得承诺未实现行为
- 明确 **未修改** `sdk-run-presentation.ts` Rev2 链
- 注明 `06-CursorSDK执行引擎.md` 留 archive 更新

### 验收标准

- [ ] 三份 `AGENTS.md` 均提及：Task tool_call 开始态描述、shell 命令摘要、飞书 thinking 零出站
- [ ] `electron/agent/cursor-sdk/AGENTS.md` 记载 `watchdogTimedOut` + activity 门控 + 收尾去重
- [ ] 文档无与 01 验收 1–10 相矛盾陈述
- [ ] `npm run build:mcp` 通过
- [ ] 各文件 ≤3000 字符（超限最小 diff 拆分）
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T1、T4
- 后续任务: 无（完成后 `/kb-apply` → `/kb-test` → `/kb-archive`）
