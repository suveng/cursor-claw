# CC 路径 watchdog 超时对称收尾与用户通知 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### （一）依赖图

```
T1 ──┐
T2 ──┼──→ T3
     ├──→ T4 ──→ T5
     └──→ T5（经 T4 置位 watchdogTimedOut）
```

- **T1**（`agent-cc-types.ts`）与 **T2**（`cc-sdk-hooks.ts`）无文件冲突，可并行。
- **T3**（`agent-claude-sdk.ts`）仅依赖 **T2** 的 `buildCcSdkHooks` 导出。
- **T4**（`agent-cc-events.ts`）依赖 **T1**（`watchdogTimedOut` 字段）与 **T2**（`formatCcHookUiLog`）；同文件内 hook 流与 watchdog 改动须**同一任务串行**完成。
- **T5**（`agent-cc-stream.ts`）依赖 **T1** + **T4**（`onTimeout` 已置位 `watchdogTimedOut` 并 close Query）。

### （二）分组调度

- **第一轮（并行）**: T1, T2
- **第二轮（并行）**: T3, T4（均依赖 T2；T4 另依赖 T1）
- **第三轮**: T5

---

## 2、任务清单

<!-- 以下每条任务自包含；子 agent 执行时只读单条 T{n} + 上下文文件 -->

---

## T1: 扩展 CcSessionAgent 超时标记字段

### 背景

watchdog 超时与 `completeCcRun` 正常 error 分支须可区分：前者走 IM 超时友好文案且跳过 `failedCooldowns`，后者沿用既有失败 notify。本任务在 session 内存模型增可选布尔字段，供 T4 置位、T5 判定，对应设计 C6/C9 与 01 F5。

### 上下文文件

- CodeGraph: `CcSessionAgent` — 定位 session 字段定义与引用方（未初始化时以源码为准）
- CodeGraph: `watchdogTimedOut` — impact 分析（预期无既有引用）
- 必读: `electron/agent-cc-types.ts` — `CcSessionAgent` 接口全貌（当前 L34–84）
- 参考: `electron/agent-cc-stream.ts` L253–294 — `completeCcRun` 现有 error 分支（T5 将增超时分支）

### 实现范围

- 修改: `electron/agent-cc-types.ts` — 在 `CcSessionAgent` 增 `watchdogTimedOut?: boolean`（JSDoc 注明：`armCcWatchdog.onTimeout` 置 true，`completeCcRun` 消费后可选清零）
- 不改: 任何消费方逻辑（留给 T4/T5）

### 接口契约

- `CcSessionAgent.watchdogTimedOut?: boolean` — watchdog 空闲/绝对超时触发时为 `true`；主动 Stop、非超时 error 不得置位

### 验收标准

- [ ] TypeScript 编译通过；`agent-cc-types.ts` 仍 ≤300 行
- [ ] 字段为可选，不破坏现有 session 构造/初始化
- [ ] 覆盖 01 验收 4、9 的数据前提（超时与主动取消可区分）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T4, T5

---

## T2: 新建 cc-sdk-hooks.ts（hooks 工厂与 UI 日志）

### 背景

子 Agent / 工具长跑静默期须通过 Electron 内注册的 Claude Agent SDK `options.hooks` 刷新活动时钟，并在 UI 日志可观测（F4-hook/latch/log）。本任务新建独立模块，避免 `agent-claude-sdk.ts`（现 271 行）超限；对应设计 C3-a、C5、C10。

### 上下文文件

- CodeGraph: `markSessionActivity` — 活动刷新调用链
- CodeGraph: `buildQueryOptions` — query options 组装入口（T3 将注入本模块产出）
- 必读: `electron/agent-cc-utils.ts` L155–160 — `markSessionActivity(session, source)` 签名与副作用
- 必读: `electron/ui-logger.ts` — `pushUiLog(channel, level, message)` 用法
- 必读: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — **以实际类型为准**：
  - L756 `HOOK_EVENTS`、L761–773 `HookCallback` / `HookCallbackMatcher`
  - L1446 `Options.hooks`、L1551 `includeHookEvents`
  - L6364+ `SubagentStartHookInput`（含 `agent_type`）；L2164+ `PreToolUseHookInput`（含 `tool_name`）
  - L3627–3635 `SDKHookStartedMessage` 等流事件字段（`hook_event`、`hook_name`）
- 参考: `electron/finalize-sdk-run.ts` — SDK 路径超时对称参考（本任务不涉及 IM notify）

### 实现范围

- 新建: `electron/cc-sdk-hooks.ts`（≤300 行，须写中文注释）
  - `formatCcHookUiLog(sessionKey, fields)` — 格式化 CC 前缀 UI 日志，字段至少含 `hook_event`；从 `HookInput` 或流消息提取 `agent_type` / `tool_name`（按 SDK 类型可用字段，禁止臆造）
  - `buildCcSdkHooks(deps)` — 返回 `Partial<Record<HookEvent, HookCallbackMatcher[]>>`；至少注册 **SubagentStart**、**PreToolUse**、**PostToolUse**（可选 **SubagentStop**，若行数允许且对 F4-latch 有增益）
  - 每个 hook 回调：`markSessionActivity(session, 'hook:${hook_event_name}')` + `pushUiLog("CC", "INFO", formatCcHookUiLog(...))`；回调须 `return { continue: true }` 或 SDK 要求的等价 JSON（不阻断工具）
  - **禁止** `notifySessionChat` / IM 推送 hook 原文
- deps 接口：`{ session: CcSessionAgent; markActivity: typeof markSessionActivity; pushUiLog: ... }`，避免 import `agent-claude-sdk` 循环依赖
- 不改: `agent-claude-sdk.ts`、`agent-cc-events.ts`（留给 T3/T4）

### 接口契约

- `export function formatCcHookUiLog(sessionKey: string, info: { hook_event: string; agent_type?: string; tool_name?: string; hook_name?: string }): string`
- `export function buildCcSdkHooks(deps: CcSdkHooksDeps): Partial<Record<HookEvent, HookCallbackMatcher[]>>`
- `export type CcSdkHooksDeps = { session: CcSessionAgent; markActivity: (s: CcSessionAgent, source: string) => void }`
- hook 事件名与回调签名 **必须** 与 `@anthropic-ai/claude-agent-sdk` ^0.3.195 导出类型一致

### 验收标准

- [ ] TypeScript 编译通过；文件 ≤300 行
- [ ] `buildCcSdkHooks` 返回非空 hooks 表，含 SubagentStart / PreToolUse / PostToolUse 至少三项
- [ ] 回调内调用 `markActivity`，source 形如 `hook:SubagentStart`（可辨识）
- [ ] UI 日志字符串含 `hook_event=` 及 `agent_type=` 或 `tool_name=` 至少一类（覆盖 01 验收 8、F4-log）
- [ ] 无 IM notify、无新建通用 Agent 抽象层
- [ ] 覆盖 02 §八·（二）第 1 条前提（Electron 内 hooks 可注册，非 settings.json 主路径）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T3, T4

---

## T3: buildQueryOptions 注入 SDK hooks

### 背景

F4-hook 要求 Claude Agent SDK `query()` 在 Electron 主进程内携带 `hooks` 与 `includeHookEvents: true`，使 hook 回调与流事件进入 CC 执行链路。本任务仅改 `buildQueryOptions` 组装逻辑，对应设计 C3-a 步骤 2。

### 上下文文件

- CodeGraph: `buildQueryOptions` — callers（预期 `startCcQuery`）
- CodeGraph: `startCcQuery` — callees（query + armCcWatchdog + stream）
- 必读: `electron/agent-claude-sdk.ts` L61–82 — `buildQueryOptions`、`startCcQuery` 现网实现
- 必读: `electron/cc-mcp-loader.ts` — `appendInlineMcpToCcOptions` 合并模式（hooks 须在 MCP merge 之后或之前保持 options 对象一致）
- 必读: `electron/cc-sdk-hooks.ts` — T2 产出的 `buildCcSdkHooks`（本任务 import）
- 必读: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` L1446、L1551 — `hooks`、`includeHookEvents` 选项
- 参考: `electron/agent-claude-sdk.ts` L251–268 — `makeWatchdogOpts` / `makeStreamOpts`（本任务不改）

### 实现范围

- 修改: `electron/agent-claude-sdk.ts` `buildQueryOptions(session)` —
  - 在 `appendInlineMcpToCcOptions` 返回的 options 上合并：
    - `hooks: buildCcSdkHooks({ session, markActivity: markSessionActivity })`
    - `includeHookEvents: true`
  - 可选：`settingSources: ["project", "user"]` — **仅**当与 MCP inline 无冲突且行数允许时添加；YAGNI，非必须
- 约束: 文件改后仍 **≤300 行**（现 271 行）；若逼近上限，禁止在本文件内 inline hooks 逻辑
- 不改: `armCcWatchdog`、`completeCcRun`、`agent-cc-events.ts`

### 接口契约

- `buildQueryOptions(session)` 返回值含 `hooks` 与 `includeHookEvents: true`（TypeScript 与 SDK `Options` 类型兼容）
- `startCcQuery` 行为不变：仍 `query({ prompt, options: buildQueryOptions(session) })`

### 验收标准

- [ ] TypeScript 编译通过；`agent-claude-sdk.ts` ≤300 行
- [ ] `buildQueryOptions` 输出含 `hooks` 与 `includeHookEvents: true`（02 §八·（二）第 1 条）
- [ ] hooks 来自 `buildCcSdkHooks`，非空对象
- [ ] Cursor SDK 路径、`agent-cc-http.ts`、daemon 无改动
- [ ] 覆盖 01 F4-hook、验收 7 的配置前提
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T2
- 后续任务: 无（T5 不直接依赖 T3，但集成验证需 T3+T4 均完成）

---

## T4: hook 流事件处理与 watchdog 超时标记

### 背景

活动刷新须覆盖两条路径：hook 回调（T2）与 SDK 消息流 `hook_started` / `hook_progress` / `hook_response`（F4-latch）；watchdog 超时时须置 `watchdogTimedOut` 并 close Query，供 T5 对称收尾。本任务集中修改 `agent-cc-events.ts`，对应设计 C5、C5-a、C6、C10。

### 上下文文件

- CodeGraph: `handleSdkMessage` — 消息分派与现有 `markActivity` 调用点
- CodeGraph: `armCcWatchdog` — callers / `onTimeout` 行为
- 必读: `electron/agent-cc-events.ts` L88–148 — `handleSdkMessage` 现网分支
- 必读: `electron/agent-cc-events.ts` L160–187 — `armCcWatchdog` 现网 `onTimeout`（仅 close + WARN 日志）
- 必读: `electron/cc-sdk-hooks.ts` — `formatCcHookUiLog`（流事件路径日志格式与回调一致）
- 必读: `electron/agent-cc-types.ts` — `watchdogTimedOut`（T1）
- 必读: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` L3599–3635 — `SDKHookStartedMessage` / `SDKHookProgressMessage` / `SDKHookResponseMessage`（字段 `hook_event`、`hook_name` 等）
- 参考: `electron/agent-run-guard.ts` L60–79 — `watchRunGuard` 契约（不改）
- 参考: `electron/finalize-sdk-run.ts` L110+ — SDK 路径超时先标记再 notify 的时序参考

### 实现范围

- 修改: `electron/agent-cc-events.ts` `handleSdkMessage` —
  - 在 `msg.type === "system"` 分支处理 `subtype === "hook_started" | "hook_progress" | "hook_response"`（以 SDK 联合类型为准）
  - 每条：`markActivity(session, 'hook:${subtype}')` 或含 `hook_event` 的可辨识 source
  - `pushUiLog("CC", "INFO", formatCcHookUiLog(...))`，从消息体提取 `hook_event`、`hook_name`；工具类事件尽量带 `tool_name`（若消息无则省略，不臆造）
  - **禁止** IM notify
- 修改: `electron/agent-cc-events.ts` `armCcWatchdog` `onTimeout` —
  - 在 `activeQuery.close()` **之前**：`s.watchdogTimedOut = true`（或等价语义，与 T1 字段一致）
  - 保留现有 UI WARN 日志与 best-effort close
  - 不调用 `completeCcRun`（仍由 `streamCcSdkMessages` finally 路径触发）
- 不改: `handleContentBlocks` tool 闩锁、`watchRunGuard` 阈值、`agent-run-guard.ts`

### 接口契约

- `handleSdkMessage` 识别 SDK `system` 消息 subtype `hook_started` / `hook_progress` / `hook_response`
- `armCcWatchdog.onTimeout` 置 `session.watchdogTimedOut = true` 后 close Query
- hook 流与回调路径均刷新 `lastActivityAt`（经 `markActivity`）

### 验收标准

- [ ] TypeScript 编译通过；`agent-cc-events.ts` ≤300 行（现 231 行）
- [ ] hook 流事件到达后 1s 内 `lastActivityAt` 更新（02 §八·（二）第 2 条；台架可缩短 `CC_IDLE_TIMEOUT_MS` 验证）
- [ ] 持续 subagent/tool hook 活动下默认 5min idle 窗口内不误杀 idle 超时（01 验收 6、7；台架可缩短阈值）
- [ ] UI 日志含 `hook_event=` 及 `agent_type=` 或 `tool_name=` 至少一类；IM **无** hook 原文（01 验收 8）
- [ ] watchdog 超时后 `watchdogTimedOut === true` 且 Query 已 close（01 验收 1 前置）
- [ ] 主动 Stop 路径不置 `watchdogTimedOut`（01 验收 9 前置，完整验证在 T5）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1, T2
- 后续任务: T5

---

## T5: completeCcRun watchdog 超时对称收尾与 IM 通知

### 背景

现网 `completeCcRun` 在 watchdog 强杀后无 IM 超时友好 notify、无 `stop_progress`、可能误写 `failedCooldowns`，与 Cursor SDK `finalizeSdkRunOnTimeout` 不对称。本任务增超时专分支，对应设计 C6、C7、C9 与 01 F1–F5。

### 上下文文件

- CodeGraph: `completeCcRun` — callers（`streamCcSdkMessages` finally、`agent-claude-sdk` 注入）
- CodeGraph: `notifySessionChat` — CC 路径出站 notify 用法
- 必读: `electron/agent-cc-stream.ts` L253–294 — `completeCcRun` 全文（error 分支 L273–280）
- 必读: `electron/agent-cc-types.ts` — `watchdogTimedOut`、`errorNotified`、`runFinalizing`、`residentMode`
- 必读: `electron/sdk-failure-messages.ts` L87–107 — 超时文案（`formatTimeoutFailureMessage` 为模块内 private；可通过 `formatUserSdkFailureMessage({ isTimeoutFailure: true, ... })` 或 **最小 export** `formatTimeoutFailureMessage` 复用，禁止复制粘贴文案）
- 必读: `electron/finalize-sdk-run.ts` L110–175 — SDK 超时：一次 notify、`stop_progress`、不写 cooldown、report idle
- 必读: `electron/agent-claude-sdk.ts` — `stopClaudeCodeSession`（确认主动取消不走超时分支，01 验收 9）
- 参考: `electron/agent-cc-stream.ts` L62–67 — `notifySessionChat(..., stopProgress)` 第三参 `stop_progress`

### 实现范围

- 修改: `electron/agent-cc-stream.ts` `completeCcRun` —
  - 在现有 `runFinalizing` 幂等闩之后、error 分支之前（或合适位置）检测 **`session.watchdogTimedOut === true`**（或等价超时语义，与 T4 一致）
  - **超时分支**（与 generic error 互斥）：
    - 若 `!session.errorNotified`：构造超时 IM 文案（语义对齐「会话因等待超时已退出，请重新发送消息…」），`await notifySessionChat(sessionKey, msg, true)` — 第三参 true 即 `stop_progress`
    - 置 `session.errorNotified = true`，**禁止**重复 notify（01 验收 2）
    - **跳过** `setFailedCooldown`（F5 / C9）
    - 可选：消费后 `session.watchdogTimedOut = false` 或保留至函数末（须与 error 分支互斥）
  - **非超时 error** 分支保持现网：`lastStatus ERROR` / 非零 exitCode → 既有失败文案 + `setFailedCooldown`
  - **主动 Stop / 非超时** 不得走超时文案（01 验收 9、10）
  - 保留：`flushStreamPost`、`reportSessionAgentPhase(idle)`、`residentMode` 下 `resetPresentationState` + 保留 session、非 resident `deleteSession`
- 若改后文件 >300 行：按 02 YAGNI **仅** 将超时分支抽至同目录小函数（如 `finalizeCcRunOnWatchdogTimeout`），禁止新建通用 finalizer 框架
- 不改: `agent-cc-http.ts`、`agent-run-guard.ts` 阈值、Cursor SDK 路径

### 接口契约

- `completeCcRun` 在 `watchdogTimedOut` 时发送 **一条** 超时友好 IM + `stop_progress: true`
- 超时路径 **不** 调用 `setFailedCooldown`
- 超时路径仍 `reportSessionAgentPhase(sessionKey, "idle")`；resident 模式可续跑新 dispatch

### 验收标准

- [ ] TypeScript 编译通过；`agent-cc-stream.ts` ≤300 行（现 294 行，逼近上限须按 YAGNI 抽函数）
- [ ] **空闲超时**与**绝对时长超时**各至少一种台架场景：数秒内 Run 结束、IM **一条**简体中文超时提示、进度结束（01 验收 1–3）
- [ ] 超时后同会话 dispatch/launch 成功，无需 Stop/Reset（01 验收 4、F5；02 §八·（二）第 5 条）
- [ ] Claude Agent 与 Cursor SDK 路径超时用户感知对称（抽样：均有说明 + 进度结束 + 可续聊，01 验收 5）
- [ ] 边界外仍超时则满足 F1/F2/F4-notify（01 验收 1–4）
- [ ] watchdog 超时：**无** `failedCooldowns`（02 §八·（二）第 4 条）
- [ ] `stopClaudeCodeSession` 主动取消 **不** 走超时文案（01 验收 9）
- [ ] 非超时 error 仍走既有失败 notify，**不** 误用超时句（01 验收 10；02 §八·（二）第 6 条）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1, T4（T3 须已合并方可做端到端验证，但本任务代码仅依赖 T1+T4）
- 后续任务: 无
