# Cursor SDK 执行引擎事件流消费 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **CodeGraph 核实**：`agent-sdk.ts` 1696 行（超 300 行硬约束，实现末轮须拆分）；`streamRunEvents:915`、`handleSdkEvent:1053`、`armRunWatchdog:812`、`startSdkRun:1040`、`completeSdkRun:952`、`markSessionActivity:208`；`createAgentSendOptions` 在 `context-usage.ts:273`；`ensureAgentSdkHttpServer` 由 `daemon-manager.ts:1263` `initDaemonManager` 调用；`recoverSdkActiveRuns` 尚未存在（新增）。

## 1、执行计划

### （一）依赖图

```
T1（sdk-run-persistence） ──────────────────────────┐
T2（onDelta 活跃回调） ──→ T3（事件流 SSOT） ──→ T4（watchdog） ──→ T5（持久化挂接+续接） ──→ T6（启动挂接+行数治理）
```

### （二）分组调度

- **第一轮（并行）**：T1、T2 — 无文件冲突（T1 新建 `sdk-run-persistence.ts`；T2 仅改 `context-usage.ts`）
- **第二轮**：T3 — 改 `agent-sdk.ts` 事件流/呈现链；依赖 T2 的 `onActivity` 契约
- **第三轮**：T4 — 改 `agent-sdk.ts` watchdog/`runPhase`；依赖 T3 的 `handleSdkEvent` 阶段写入
- **第四轮**：T5 — 改 `agent-sdk.ts` 持久化钩子与续接；依赖 T1 模块与 T4 完整运行链
- **第五轮**：T6 — 改 `daemon-manager.ts`；可选新建 `sdk-run-stream.ts` 拆分；依赖 T5 导出 `recoverSdkActiveRuns`

## 2、任务清单

## T1: 活跃 Run 磁盘持久化模块

### 背景

F4 要求主进程重启后能续接未结束 Run，但现网 `sdkSessions` 纯内存。本任务新建 `sdk-run-persistence.ts`，提供活跃 Run 快照读写与 `userStopped` 标记，为后续挂接与 `recoverSdkActiveRuns` 提供数据层 SSOT。

### 上下文文件

- CodeGraph: `sdk-run-persistence` / `SdkSessionAgent` — 确认尚无持久化模块、session 字段落点
- 必读: `knowledge/变更/进行中/20260701212827-CursorSDK执行引擎事件流消费/02-design.md` §四、§五 — `SdkActiveRunRecord` 结构与导出符号
- 必读: `electron/agent-sdk.ts` — `SdkSessionAgent` 接口（约 L8–90）、`stopSdkSession`（约 L1607）现有收尾语义
- 参考: `electron/agent-api-port.json` 写入模式（同级 `userData` 文件权限约定）

### 实现范围

- 新建: `electron/sdk-run-persistence.ts` — `SdkActiveRunRecord` 类型；`persistActiveSdkRun`、`clearActiveSdkRun`、`listRecoverableSdkRuns`、`markSdkRunUserStopped`；读写 `userData/sdk-active-runs.json`（同 sessionKey 幂等 upsert，数组或 map 结构择一，文档注释说明）
- 修改: 无（本任务不挂接 `agent-sdk.ts`，避免与同文件后续任务冲突）

### 接口契约

- `interface SdkActiveRunRecord { sessionKey, agentId, runId, apiKey, workspaceDir, chatType, runStartedAt, streamId?, outboundMessageId?, inboundMessageIds?, userStopped?, updatedAt }`
- `persistActiveSdkRun(record: SdkActiveRunRecord): void` — upsert；写入失败 WARN 不 throw
- `clearActiveSdkRun(sessionKey: string): void`
- `listRecoverableSdkRuns(): SdkActiveRunRecord[]` — 过滤 `userStopped===true` 与可选过期记录
- `markSdkRunUserStopped(sessionKey: string): void` — 写 `userStopped=true` 或清除记录（与 02 §五 一致，implement 择一并注释）

### 验收标准

- [ ] 单元路径：手动调用 persist → list 可读到记录；clear / markSdkRunUserStopped 后 list 不再返回该 session（或 userStopped 被过滤）
- [ ] 写入 `userData/sdk-active-runs.json` 失败时仅 WARN，不抛错阻断调用方（02·八·（二）末项）
- [ ] 文件 ≤300 行且含中文注释
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T5

---

## T2: onDelta 活跃回调注入

### 背景

watchdog 以 `lastActivityAt` 判 idle，但压缩/turn-ended 等 harness 活动仅走 `onDelta`，不刷新 stream 活跃时钟，长工具窗口可能误杀（01 验收 3、F3.3）。本任务在 `createAgentSendOptions` 增加可选 `onActivity` 回调，供 T3 在 `buildSendOptions` 注入 `markSessionActivity`。

### 上下文文件

- CodeGraph: `createAgentSendOptions` / `handleAgentSendDelta` — 定位 onDelta 链
- 必读: `electron/context-usage.ts` — `createAgentSendOptions`（L273）、`handleAgentSendDelta`
- 必读: `electron/agent-sdk.ts` — `markSessionActivity`（L208）、`buildSendOptions`（L701）只读签名
- 参考: `electron/agent-cc-utils.ts` — CC 路径 `markSessionActivity` 对称实现

### 实现范围

- 修改: `electron/context-usage.ts` — `createAgentSendOptions` 第三参扩展为 options 对象或增加可选 `onActivity?: () => void`；在 `handleAgentSendDelta` 处理 `summary-started`/`summary-completed`/`turn-ended` 等有意义更新后调用 `onActivity?.()`（避免空转刷屏）
- 修改: 无其他文件（`agent-sdk.ts` 挂接留给 T3）

### 接口契约

- `createAgentSendOptions(session, log, opts?: { onCompression?: CompressionNotifyFn; onActivity?: () => void })` — 向后兼容现有两参/三参调用
- `onActivity` 在 delta 处理成功路径调用，异常由现有 try/catch 包裹，不向外抛

### 验收标准

- [ ] 现有 `createAgentSendOptions` 调用方无需改动即可编译通过
- [ ] 注入 mock `onActivity` 后，模拟 `summary-started` delta 可触发回调
- [ ] `context-usage.ts` 仍 ≤300 行
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T3

---

## T3: 事件流 SSOT 与呈现活跃刷新

### 背景

01 F1/F2 要求运行期间持续消费 `run.stream()` 并驱动呈现，禁止主路径仅 `run.wait()`。现网已有 `streamRunEvents`/`handleSdkEvent`，本任务强化 SSOT、全分支 `markSessionActivity`，并挂接 T2 的 `onActivity`；为多步工具场景（S14）与 T4 `runPhase` 打基础。

### 上下文文件

- CodeGraph: `streamRunEvents` / `handleSdkEvent` / `startSdkRun` — 调用链与 impact（`launchSdkAgent`、`session-dispatcher.launchAgent`）
- 必读: `electron/agent-sdk.ts` — `streamRunEvents`（L915）、`handleSdkEvent`（L1053）、`startSdkRun`（L1040）、`buildSendOptions`（L701）、`postStreamText`/`scheduleStreamPost`
- 必读: `electron/context-usage.ts` — T2 完成后的 `createAgentSendOptions` 签名
- 参考: `electron/agent-cc-events.ts` — 事件映射拆分对称模式
- 参考: `electron/AGENTS.md` — f41 流式、Presentation 时序、`STREAM_POST_INTERVAL_MS=400`

### 实现范围

- 修改: `electron/agent-sdk.ts` —
  - 审计运行期主路径：确认无「仅 `run.wait()` 等待终态」旁路；`run.wait()` 仅保留在 `completeSdkRun`/`finalizeRunContextUsage` 收尾（与 02 §七 gap 一致）
  - `streamRunEvents`：`for await (run.stream())` 为 SSOT；catch/finally 仍走既有 `completeSdkRun`/`notifySdkFailure`
  - `handleSdkEvent`：assistant/thinking/tool_call/status 各分支调用 `markSessionActivity(session, "<source>")`；tool running 时更新 `session.lastTool`（已有则强化）；为 T4 预留 `session.runPhase` 写入（`tool_running`/`executing`/`awaiting_user`，按 SDK status 事件 best-effort）
  - `buildSendOptions`：传入 `onActivity: () => markSessionActivity(session, "onDelta")`
- 删除: 无

### 接口契约

- `streamRunEvents(session, run): Promise<void>` — 行为不变，注释标明 SSOT
- `handleSdkEvent(session, event): void` — 全事件类型刷新活跃
- `SdkSessionAgent.runPhase?: "executing" | "awaiting_user" | "tool_running"` — 内存字段（02 §五）
- `buildSendOptions` 使用 T2 `onActivity` 回调

### 验收标准

- [ ] **01 验收 1（全路径消费）**：IM / 任务 / 工作流经 `launchSdkAgent`/`dispatchToSdkAgent` → `startSdkRun` → `streamRunEvents`，运行中 UI 日志可见 `[stream:...]`/`[tool]`/`[status]` 交替，非仅结束一条（02·八·（二）第 1 项）
- [ ] **01 验收 2（过程事件覆盖）**：多步工具 Run 中 thinking/tool/assistant 与事件时序一致，无 Run 结束后批量补发过程
- [ ] **01 验收 6（短任务不退化）**：短问答首段反馈时延无明显变慢；无「先 wait 再 stream」双倍等待；400ms 节流与 preamble 短窗不变（S16/S17）
- [ ] `grep run\.wait()` 主路径：运行期 consumer 循环内无阻塞 wait
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T2
- 后续任务: T4

---

## T4: Watchdog 活动感知增强

### 背景

F3.1/F3.3 与 01 验收 3：长工具执行或等待用户回复时，墙钟 idle 不应触发 `cancelling`。本任务扩展 `armRunWatchdog.onTick`，在 `tool_running`/`awaiting_user`/`lastTool.status==="running"`/run 未终态时豁免 idle 取消，保留 `draining` 宽限期与 `NEVER_CANCEL_ON_DURATION` 默认。

### 上下文文件

- CodeGraph: `armRunWatchdog` / `markSessionActivity` / `finalizeSdkRunOnTimeout` — watchdog 状态机与超时收尾边界
- 必读: `electron/agent-sdk.ts` — `armRunWatchdog`（L812）、`markSessionActivity`（L208）、`SdkSessionAgent.watchdogState`
- 必读: `electron/finalize-sdk-run.ts` — `finalizeSdkRunOnTimeout`（只读，本任务不改阈值）
- 参考: `electron/agent-cc-utils.ts` — CC idle/absolute 解耦对称

### 实现范围

- 修改: `electron/agent-sdk.ts` —
  - `armRunWatchdog.onTick`：增加豁免条件（`runPhase==='tool_running'|'awaiting_user'`、`session.lastTool?.status==='running'`、run 仍 active 且无终态 status）
  - 保留 `running→draining→cancelling` 状态机、`RUN_WATCHDOG_DRAIN_GRACE_MS`、`NEVER_CANCEL_ON_DURATION`
  - 与 T3 协作：确保 `handleSdkEvent` 已写入 `runPhase`（若 T3 未完整实现，本任务补齐 status/tool 分支）
- 删除: 无

### 接口契约

- `armRunWatchdog(session, run, token): void` — onTick 签名不变，内部豁免逻辑扩展
- 日志：进入 cancelling 前若有豁免应可 DEBUG/WARN 区分「真 idle」与「活动豁免」（中文注释说明判定顺序）

### 验收标准

- [ ] **01 验收 3（长任务不误杀）**：模拟长工具 running 或等待用户（mock `lastTool.running` / `runPhase=awaiting_user`）10min+，watchdog 日志不出现 `cancelling`（除非真实超时策略触发）（02·八·（二）第 5 项）
- [ ] 真实超时/平台长时仍可走 `finalizeSdkRunOnTimeout`，行为与改造前一致
- [ ] draining 宽限期内 `markSessionActivity` 仍可将状态恢复 `running`
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T3
- 后续任务: T5

---

## T5: 持久化挂接与进程重启续接

### 背景

F4 核心：Run 启动/呈现态变化时持久化快照；终态与用户停止清除；主进程重启后 `Agent.resume` + `Agent.getRun` 重挂 `streamRunEvents`；失败一次 IM 提示。本任务在 `agent-sdk.ts` 集成 T1 模块并实现 `recoverSdkActiveRuns`/`notifyResumeFailure`。

### 上下文文件

- CodeGraph: `launchSdkAgent` / `dispatchToSdkAgent` / `stopSdkSession` / `completeSdkRun` — 三路径入口与收尾
- 必读: `electron/sdk-run-persistence.ts` — T1 导出（本任务 import）
- 必读: `electron/agent-sdk.ts` — `startSdkRun`、`completeSdkRun`、`stopSdkSession`、`launchSdkAgent`（L1174）、`dispatchToSdkAgent`（L1324）
- 必读: `electron/daemon-client.ts` — `notifySessionChat` / send-text 路径（续接失败提示）
- 参考: Cursor SDK skill — `Agent.resume`、`Agent.getRun`、`run.stream()`；resume 须重传 `mcpServers`（对称 `buildSendOptions`/`appendInlineMcpToSendOptions`）

### 实现范围

- 修改: `electron/agent-sdk.ts` —
  - `startSdkRun`：Run 获得 runId 后 `persistActiveSdkRun`（含 apiKey、workspaceDir、chatType、呈现游标 streamId/outboundMessageId/inboundMessageIds）
  - 呈现态显著变化时节流 upsert（避免每 delta 写盘）
  - `completeSdkRun` / 终态：`clearActiveSdkRun`
  - `stopSdkSession`：`markSdkRunUserStopped` + `clearActiveSdkRun` + 既有 abort 语义
  - 新增 `recoverSdkActiveRuns(): Promise<RecoverSummary>`：`listRecoverableSdkRuns` → 每条 `Agent.resume` → `Agent.getRun` → 重建最小 `SdkSessionAgent` → `streamRunEvents`（复用 T3 SSOT）；MCP inline 重传
  - 新增 `notifyResumeFailure(sessionKey, reason)`：经 daemon **一次**可理解 IM 提示
  - Run 已终态 / resume 失败：清除脏记录 + 失败提示
- 导出: `recoverSdkActiveRuns` 供 T6 `daemon-manager` 调用

### 接口契约

- `recoverSdkActiveRuns(): Promise<{ resumed: number; failed: number; skipped: number }>`（或等价 `RecoverSummary`）
- `notifyResumeFailure(sessionKey: string, reason: string): Promise<void>`
- 依赖 T1：`persistActiveSdkRun` / `clearActiveSdkRun` / `listRecoverableSdkRuns` / `markSdkRunUserStopped`

### 验收标准

- [ ] **01 验收 4（重启续接）**：进行中 Run 未结束时 kill 主进程并重启，原 IM/任务会话可继续收到后续 stream-text，上下文一致
- [ ] **01 验收 5（续接失败兜底）**：Run 已结束或 resume 失败时，用户收到**一次**明确提示，非静默（02·八·（二）第 2、3 项）
- [ ] **01 验收 7（主动停止不续接）**：`stopSdkSession` 后持久化 `userStopped=true`；重启不再向该 session 推送续接事件（02·八·（二）第 4 项）
- [ ] 启动日志每条记录 `resumed|failed|skipped` 可检索
- [ ] 持久化写入失败不阻断 Run（WARN）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1、T4
- 后续任务: T6

---

## T6: 启动挂接与 agent-sdk 行数治理

### 背景

续接须在应用 init 时触发（S9）。`daemon-manager.initDaemonManager` 已在 L1263 调用 `ensureAgentSdkHttpServer`，其后挂接 `recoverSdkActiveRuns`。`agent-sdk.ts` 现 1696 行，违反 AGENTS ≤300 行；若 T3–T5 后仍超限，将 `streamRunEvents`+`handleSdkEvent` 拆至 `sdk-run-stream.ts`（对称 `agent-cc-events.ts`），`agent-sdk.ts` 保留编排 re-export。

### 上下文文件

- CodeGraph: `ensureAgentSdkHttpServer` / `initDaemonManager` — 启动顺序
- 必读: `electron/daemon-manager.ts` — `initDaemonManager`（L1257）、`ensureAgentSdkHttpServer` import（L21）
- 必读: `electron/agent-sdk.ts` — T5 完成后的行数与 export 面
- 参考: `electron/agent-cc-events.ts` — 事件模块拆分模式（≈280 行）

### 实现范围

- 修改: `electron/daemon-manager.ts` — `initDaemonManager` 内 `ensureAgentSdkHttpServer()` **之后** `void recoverSdkActiveRuns().catch(...)`（失败 WARN 不阻断 init）
- 新建（条件）: `electron/sdk-run-stream.ts` — 若 `agent-sdk.ts` >300 行，迁移 `streamRunEvents`、`handleSdkEvent` 及相关私有 helper；`agent-sdk.ts` import 并 re-export，避免循环依赖（持久化模块单向依赖）
- 修改（条件）: `electron/agent-sdk.ts` — 拆后保留 launch/dispatch/recover/watchdog 编排，≤300 行

### 接口契约

- `initDaemonManager` 启动顺序：`ensureAgentSdkHttpServer` → `recoverSdkActiveRuns`（async fire-and-forget 或 await，注释说明）
- 若拆分：`export { streamRunEvents, handleSdkEvent } from "./sdk-run-stream"` 或内部 import，对外 HTTP handler 行为不变

### 验收标准

- [ ] 冷启动后自动执行续接；`recoverSdkActiveRuns` 日志可见（与 T5 验收叠加）
- [ ] **01 验收 1/4/6** 回归：IM、任务面板、工作流各一条典型路径仍正常
- [ ] 新增/拆分文件均 ≤300 行且含中文注释；`agent-sdk.ts` 达标或已拆分并注明 re-export（02·八·（二）第 7 项）
- [ ] 无循环 import（`sdk-run-persistence` 不 import `agent-sdk`）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T5
- 后续任务: 无（实现完成后 `/kb-test` → `/kb-archive`）
