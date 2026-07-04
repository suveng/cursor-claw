# IM 通知消息顺序与流式推送优化 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### 1.1 依赖图

```
T1 ──→ T3 ──→ T5
T2 ──→ T4 ──→ T5
```

### 1.2 分组调度

| 轮次 | 并行任务 | 说明 |
|------|----------|------|
| 第一轮 | T1, T2 | 无前置依赖；Electron 与 Daemon 里程碑模块互不冲突 |
| 第二轮 | T3, T4 | T3 依赖 T1；T4 依赖 T2；不同文件可并行 |
| 第三轮 | T5 | 依赖 T3、T4 全部落地后再同步文档 |

**同文件冲突表**（本轮无同文件并行写）：

| 文件 | 涉及任务 | 调度 |
|------|----------|------|
| `electron/agent/cursor-sdk/sdk-run-presentation.ts` | T1 | 第一轮独占 |
| `src/daemon/daemon-presentation-milestone.ts` | T2 | 第一轮独占 |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | T3 | 第二轮独占 |
| `src/daemon/daemon.ts` | T4 | 第二轮独占 |
| AGENTS / 知识库三文件 | T5 | 第三轮独占 |

## 2、任务清单

## T1: Electron defer 闩锁统一（markProcessEventSeen）

### 背景

飞书私聊里程碑路径虽会 POST presentation-event，但 `markProcessEventSeen` 对 `feishuSuppressesProcessKind` 与 `kind==="task"` 早退，导致 Electron 侧 `seenProcessEvent` / `presentationDeferStream` 未置位，assistant delta 不经 defer 即 `scheduleStreamPost`。本任务统一 defer 闩与呈现形态解耦，是 task 分支补闩（T3）的前置。

### 上下文文件

- CodeGraph: `markProcessEventSeen` — 定位 defer 闩调用链与 `shouldDeferAssistantPost` 影响面
- CodeGraph: `presentationOrderingEligible` — 确认 ordering 门控保留位置
- 必读: `electron/agent/cursor-sdk/sdk-run-presentation.ts` — `markProcessEventSeen`、`shouldDeferAssistantPost`、`appendAssistantStreamDelta` 现网逻辑
- 必读: `electron/agent/cursor-sdk/sdk-session-registry.ts` — `presentationOrderingEligible` 定义
- 参考: `src/shared/feishu-presentation-gate.ts` — `feishuSuppressesProcessKind` 语义（仅理解，本任务移除对其的早退）

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-run-presentation.ts` — `markProcessEventSeen`：
  - **移除** `kind === "task"` 早退
  - **移除** `feishuSuppressesProcessKind(...)` 早退
  - **保留** `presentationOrderingEligible(session)` 门控；不满足时直接 return
  - thinking / tool / task 三种 kind 在门控通过后均：`seenProcessEvent = true`、`presentationDeferStream = true`、`clearStreamPostTimer(session)`
  - 更新函数 JSDoc/注释：阐明「呈现抑制（飞书里程碑）≠ 不参与 ordering defer」
- 不改: `appendAssistantStreamDelta`、`schedulePreambleRelease`、`maybeReleaseDeferredAssistant` 释放路径

### 接口契约

- `markProcessEventSeen(session: SdkSessionAgent, kind: "thinking" | "tool" | "task"): void` — 在 `presentationOrderingEligible` 为 true 时，三种 kind 均置 defer 闩；不再因飞书抑制或 task 跳过
- `shouldDeferAssistantPost(session)` — 行为不变：仍读 `seenProcessEvent || presentationDeferStream`

### 验收标准

- [ ] `presentationOrderingEligible === false` 时 `markProcessEventSeen` 仍无副作用（`PRESENTATION_ORDERING=0` 回滚路径，对应 01 验收边界、02 §8.2 回滚项）
- [ ] ordering 开启 + 飞书抑制场景：thinking/tool/task 调用后 `session.seenProcessEvent === true` 且 `session.presentationDeferStream === true`
- [ ] ordering 开启：首个 assistant delta 在过程事件后调用 `shouldDeferAssistantPost` 返回 true，不立即 `scheduleStreamPost`（支撑 F1/F2、01 验收 1/3）
- [ ] task kind 不再在函数内早退（为 T3 铺路；单独测 T1 可通过直接调用 `markProcessEventSeen(session, "task")` 验证闩位）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T3

---

## T2: 里程碑 sendMilestoneText 返回 sent 布尔

### 背景

Daemon 飞书抑制分支需在里程碑**真实出站**后才更新 ordering 闩；节流跳过、去重上限、空文案不应误置 `presentationProcessActive`。`sendMilestoneText` 当前无返回值，handler 无法区分「已发送」与「被跳过」。本任务为 T4 闩锁更新提供 `sent` 契约。

### 上下文文件

- CodeGraph: `sendMilestoneText` — 调用方与节流/去重分支
- 必读: `src/daemon/daemon-presentation-milestone.ts` — `sendMilestoneText` 全文、节流常量、去重 Map
- 参考: `src/daemon/daemon.ts` — `handleThinkingPresentationEvent` / `handleToolPresentationEvent` / `handleTaskPresentationEvent` 飞书抑制分支（理解消费方，本任务不改 daemon）

### 实现范围

- 修改: `src/daemon/daemon-presentation-milestone.ts`：
  - `sendMilestoneText` 返回类型改为 `Promise<boolean>`
  - 返回 `true`：**仅当**实际调用 `sendFn` 且发送成功（await 完成无 throw）
  - 返回 `false`：空文案、节流跳过（3s 内同 kind）、单 Run 去重达上限（≤4 次）、`sendFn` 未调用或发送失败
  - 更新文件头注释说明返回值语义
- 不改: 节流间隔、去重上限、里程碑文案格式化逻辑

### 接口契约

- `sendMilestoneText(...): Promise<boolean>` — `true` = 本条里程碑已实际出站；`false` = 未出站（跳过/失败）
- 现有调用方在 T4 前可能仍忽略返回值；本任务须保证类型变更后 `tsc`/构建通过（必要时对未改调用点用 `void` 或暂存返回值）

### 验收标准

- [ ] 正常发送路径返回 `true`
- [ ] 3s 节流命中、Run 内同 key 超 4 次、空 `text` 均返回 `false` 且不调用 `sendFn`
- [ ] `sendFn` reject/throw 时返回 `false`（或按现网错误处理约定，须与 handler 不置闩一致）
- [ ] 里程碑条数与节流行为与变更前一致（F3.4、01 验收 4 不增加刷屏）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T4

---

## T3: Electron task 分支补 markProcessEventSeen

### 背景

T1 已允许 `markProcessEventSeen` 处理 task kind，但 `handleSdkEvent` 的 `case "task"` 仍未在 `postPresentationEvent` 前调用该函数，导致 task 里程碑不参与 Electron defer。本任务补齐与 thinking/tool 对称的置闩时机。

### 上下文文件

- CodeGraph: `handleSdkEvent` — task 分支与 `postPresentationEvent` 顺序
- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` — `case "task"` 分支（对照 thinking/tool 分支写法）
- 必读: `electron/agent/cursor-sdk/sdk-run-presentation.ts` — T1 完成后的 `markProcessEventSeen`（确认 import 可用）
- 参考: `electron/agent/cursor-sdk/sdk-session-types.ts` — `SdkSessionAgent` 字段

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-run-stream.ts` — `case "task"`：
  - 在 `postPresentationEvent(...)` **之前**调用 `markProcessEventSeen(session, "task")`
  - thinking / tool 分支**零改动**
- 不改: task 的 release 逻辑（task 只置闩，不单独 `maybeReleaseDeferredAssistant`）

### 接口契约

- task 事件路径：`markProcessEventSeen(session, "task")` → `postPresentationEvent` — 与 thinking/tool 对称
- `seenProcessEvent` / `presentationDeferStream` 在 task 到达时即置位（ordering 门控内）

### 验收标准

- [ ] ordering 开启：task 事件到达后、assistant 首 delta 前，`seenProcessEvent` 已为 true（02 §8.2「task 出现后 assistant 首包 defer」Electron 侧）
- [ ] 含 ≥2 次 task 里程碑的运行：defer 闩在首个 task 后即生效，支撑 01 验收 2（多过程顺序）
- [ ] thinking/tool 分支 diff 为零或仅 import 顺序（无行为变更）
- [ ] `PRESENTATION_ORDERING=0` 时 task 路径与变更前一致
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: T5

---

## T4: Daemon 飞书里程碑与 task ordering 闩锁

### 背景

根因之二：Daemon 飞书抑制分支 `sendMilestoneText` 后直接 return，未 mirror CardKit 路径的 `presentationProcessActive` / `thinkingOpen` / `activeToolNames` 更新；`handleTaskPresentationEvent` 亦未置闩。本任务在里程碑真实出站后更新 `SessionProgressState`，使 `handleStreamText` defer 首建 assistant CardKit，实现「过程在上、结论在下」（F1/F6）。

### 上下文文件

- CodeGraph: `handleThinkingPresentationEvent` / `handleToolPresentationEvent` / `handleTaskPresentationEvent` — 飞书抑制分支与 CardKit 分支对照
- CodeGraph: `handleStreamText` — `presentationProcessActive` 触发 defer 的条件
- 必读: `src/daemon/daemon.ts` — 上述三个 handler、`releaseDeferredAssistantStream`、`presentationOrderingEnabled`、`SessionProgressState`（约 L304）
- 必读: `src/daemon/daemon-presentation-milestone.ts` — T2 完成后的 `sendMilestoneText` 布尔返回值
- 参考: `src/shared/feishu-presentation-gate.ts` — 抑制判定
- 参考: `src/daemon/daemon.ts` `logPresentationOrderViolation` — NF1 回归（行为不应新增违规）

### 实现范围

- 修改: `src/daemon/daemon.ts` — `handleThinkingPresentationEvent` 飞书抑制分支：
  - `const sent = await sendMilestoneText(...)`
  - 若 `presentationOrderingEnabled(...) && sent`：`thinkingOpen = true`、`presentationProcessActive = true`
  - `event.final` 时 `thinkingOpen = false`；若过程 idle（无 open thinking、无 active tools）则 `releaseDeferredAssistantStream`
  - 抑制分支在置闩后仍 `return`（不改变里程碑呈现形态）
- 修改: `src/daemon/daemon.ts` — `handleToolPresentationEvent` 飞书抑制分支：
  - `const sent = await sendMilestoneText(...)`
  - 若 ordering && sent：mirror CardKit — `tool_status === "started"` → `activeToolNames.add`、`presentationProcessActive = true`；`completed`/`failed` → delete from set；idle 则 `releaseDeferredAssistantStream`
- 修改: `src/daemon/daemon.ts` — `handleTaskPresentationEvent`：
  - `const sent = await sendMilestoneText(...)`（或等价）
  - 若 ordering && sent → `presentationProcessActive = true`
  - **不**维护 `activeToolNames` / `thinkingOpen`；**不**在 task 单独 release
- 可选（同文件内联，≤15 行）：`applyMilestoneOrderingLatch(state, kind, status, sent)` 减少重复；YAGNI 允许，非必须独立模块
- 不改: CardKit 非抑制分支、工具分级 silent 路径、`handleStreamText` defer/release 核心逻辑、MergeBatch `getPresentationReplyAnchor`

### 接口契约

- 飞书抑制 + ordering + `sent === true` → `SessionProgressState.presentationProcessActive = true`（thinking/tool/task 按 kind 附加字段）
- 过程 idle 判定与 CardKit 路径一致 → 调用既有 `releaseDeferredAssistantStream`
- `sendMilestoneText` 返回 `false` 时**不**更新 ordering 闩（节流跳过不误 defer）

### 验收标准

- [ ] 飞书私聊「思考 → notify 工具 → 答复」：里程碑在 assistant CardKit 首包之前可见（02 §8.2 第 1 项；01 验收 1；F1/F6.1）
- [ ] 飞书私聊含 ≥2 次 task + 工具过程：会话时间轴与发生顺序一致（01 验收 2；F3）
- [ ] task 出现后 assistant 首包 defer，直至过程 idle 或 Run final（02 §8.2 第 3 项；F2）
- [ ] 短问答无实质过程：首包时延无明显劣化，preamble ≤400ms 仍生效（01 验收 5/6；02 §8.2 第 4 项；F5）
- [ ] read/glob silent 工具仍不出站、不置闩（01 验收 4；02 §8.2 第 5 项；F4）
- [ ] 里程碑节流跳过时 `presentationProcessActive` 不因该次调用误置 true
- [ ] NF1：长任务无新增 `presentation_order_violation` WARN（02 §8.2 第 6 项）
- [ ] `PRESENTATION_ORDERING=0` 行为与变更前一致（02 §8.2 第 7 项）
- [ ] MergeBatch 活跃时 deferred assistant 首建仍带 `getPresentationReplyAnchor`（02 §8.2 第 8 项；NF2）
- [ ] 运行结束/停止/失败：三态与过程—结论相对位置合理（01 验收 7；F7）
- [ ] 过程与流式结论并存时阅读无逻辑颠倒（01 验收 9）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径；内联 helper ≤15 行除外）

### 依赖

- 前置任务: T2
- 后续任务: T5

---

## T5: AGENTS 与知识库索引同步

### 背景

代码行为变更后，须同步 Electron SDK、Daemon 目录 AGENTS 及业务域 `06-CursorSDK执行引擎.md`，避免「呈现抑制≠不参与 ordering」「task 参与 defer」「飞书里程碑亦置闩」等描述与现网脱节。本任务无运行时逻辑，为 archive 知识库更新清单（02 §10.1）的落地。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/AGENTS.md` — 现有 PRESENTATION_ORDERING / `markProcessEventSeen` 描述
- 必读: `src/daemon/AGENTS.md` — Presentation 时序编排、飞书抑制分支
- 必读: `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — §二 PRESENTATION_ORDERING、§三 defer 闩规则
- 参考: T1–T4 已实现代码（以代码为准更新文档，不臆造）

### 实现范围

- 修改: `electron/agent/cursor-sdk/AGENTS.md` — 更新：`markProcessEventSeen` 不再因飞书抑制/task 早退；task 分支在 `postPresentationEvent` 前置闩；呈现抑制与 ordering defer 解耦说明
- 修改: `src/daemon/AGENTS.md` — 更新：飞书抑制里程碑路径在 `sendMilestoneText` 成功后亦更新 `presentationProcessActive` 等编排字段；`sendMilestoneText` 返回 `sent` 语义；task handler 置闩不单独 release
- 修改: `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — 同步 §二/§三：task 参与 defer、飞书抑制仍 POST 且置闩（Electron + Daemon 双侧一句带过）
- 不改: 工具分级、MergeBatch、里程碑节流参数文档（02 §10.3）

### 接口契约

- 文档与 T1–T4 代码行为一致；术语与 `SessionProgressState` / `SdkSessionAgent` 字段名对齐
- 各文件「变更记录」或等效段落追加本变更日期一句摘要（若该文件有变更记录段）

### 验收标准

- [ ] 三份文档均明确：CardKit 呈现抑制 ≠ 不参与 `PRESENTATION_ORDERING` defer
- [ ] 三份文档均描述 task 里程碑参与 ordering 闩（Electron + Daemon）
- [ ] 飞书里程碑路径置闩条件写清「`sendMilestoneText` 返回 true」
- [ ] 与 01 功能需求 F1–F7 表述无矛盾
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T3, T4
- 后续任务: 无（实现完成后可 `/kb-test`、`/kb-archive`）

---

## 3、验收修复（08-verify-issue 第 1 轮）

> **来源**：`/kb-repair`（08-verify-issue — assistant 答复文案完全相同重复发送）

### 3.1 依赖图补充

```
T-FIX-1 ──→ T-FIX-3
T-FIX-2 ──→ T-FIX-3
```

### 3.2 分组调度

| 轮次 | 并行任务 | 说明 |
|------|----------|------|
| 第一轮 | T-FIX-1, T-FIX-2 | 无前置依赖；Daemon 与 Electron 不同文件可并行 |
| 第二轮 | T-FIX-3 | 依赖 T-FIX-1、T-FIX-2 全部落地后再同步文档 |

**同文件冲突表**：

| 文件 | 涉及任务 | 调度 |
|------|----------|------|
| `src/daemon/daemon.ts` | T-FIX-1 | 第一轮独占 |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | T-FIX-2 | 第一轮独占 |
| `src/daemon/AGENTS.md`、`electron/agent/cursor-sdk/AGENTS.md` | T-FIX-3 | 第二轮独占 |

---

## T-FIX-1: Daemon releaseDeferredAssistantStream 串行化与首建占位

### 背景

08-verify-issue 第 1 轮：并发 `void releaseDeferredAssistantStream` 竞态导致相同 assistant 文案双首建（两条内容完全一致的 assistant 消息）。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `releaseDeferredAssistantStream`、`handleStreamText`、`SessionProgressState`、`resetPresentationOrderingFields`
- 参考: `08-verify-issue.md` — 第 1 轮复现与根因分析
- 参考: T4 已落地的 defer/release 路径（本任务仅串行化与占位，不改闩锁语义）

### 实现范围

- 修改: `src/daemon/daemon.ts` only：
  - `SessionProgressState` 增加 `assistantReleaseChain?: Promise<void>`
  - 新增 `enqueueReleaseDeferredAssistantStream` 链式包装；所有 `void`/`await releaseDeferredAssistantStream` 改走 enqueue
  - 通过链 + 首建前 `assistantCardReleased` 占位（发送失败回滚）消除 check-then-act 竞态
  - `resetPresentationOrderingFields` 清理 chain
  - `// ponytail:` 注释说明已知简化
- 不改: `daemon-presentation-milestone.ts`、里程碑 handler 闩锁逻辑、`handleStreamText` defer 判定条件

### 接口契约

- `enqueueReleaseDeferredAssistantStream(state, ...): Promise<void>` — 同一 session 内 release 调用串行入链；并发调用不并行执行 `releaseDeferredAssistantStream` 首建逻辑
- 首建前 `assistantCardReleased` 占位：占位成功才发送首包；`sendFn` 失败时回滚占位，允许后续 release 重试
- `resetPresentationOrderingFields` 须清空 `assistantReleaseChain`，避免跨 Run 链污染

### 验收标准

- [ ] 同一 session 并发 release 只首建一条 assistant 消息（消除 08-verify-issue 第 1 轮双首建）
- [ ] `handleStreamText` final 路径仍正确更新/关闭已建 CardKit（非首建路径不受影响）
- [ ] 过程 idle 后 release、Run final/stop 路径均经 enqueue，无裸 `void releaseDeferredAssistantStream` 残留
- [ ] `PRESENTATION_ORDERING=0` 或 reset 后 chain 不泄漏、不阻塞后续 Run
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径；`// ponytail:` 注明已知简化）

### 依赖

- 前置任务: 无
- 后续任务: T-FIX-3

---

## T-FIX-2: Electron Run 收尾取消冗余 non-final flush

### 背景

08-verify-issue：`flushDeferredStreamPost` + `flushStreamPost(true)` 在 Run 收尾叠加，放大双首包风险（与 Daemon 侧并发 release 叠加时更易触发重复 assistant 消息）。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` — `streamRunEvents` 收尾块、`flushDeferredStreamPost`、`flushStreamPost`、`maybeReleaseDeferredAssistant`
- 参考: `08-verify-issue.md` — 收尾双 flush 分析
- 参考: T3 已落地的 task 分支置闩（本任务不改 `markProcessEventSeen` 调用）

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-run-stream.ts` only：
  - 移除 `streamRunEvents` 收尾处 `flushDeferredStreamPost` 块
  - 仅保留 `flushStreamPost(session, true)` 作为 Run 收尾唯一 final POST
- 不改: `maybeReleaseDeferredAssistant`、`flushDeferredStreamPost` 其他调用点（过程 idle、里程碑 release 等仍由既有路径承担）

### 接口契约

- Run 正常结束/失败收尾：`flushStreamPost(session, true)` 单次 final POST；不再在收尾前额外 `flushDeferredStreamPost`
- ordering 场景过程 idle 后 release 仍由 daemon / `maybeReleaseDeferredAssistant` 承担，Electron 收尾不重复 non-final flush

### 验收标准

- [ ] Run 收尾只触发一次 final POST（`flushStreamPost(session, true)`），收尾块无 `flushDeferredStreamPost`
- [ ] ordering 场景：过程 idle 后 deferred assistant 仍由 `maybeReleaseDeferredAssistant` / daemon release 正常出站
- [ ] 非 ordering 或短问答路径：流式更新与 final 关闭行为与变更前一致
- [ ] `maybeReleaseDeferredAssistant`、`flushDeferredStreamPost` 非收尾调用点 diff 为零或仅 import 顺序
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T-FIX-3

---

## T-FIX-3: 文档同步 release 串行化与收尾语义

### 背景

T-FIX-1、T-FIX-2 落地后，须同步 Daemon / Electron SDK 目录 AGENTS，描述 enqueue release 链与 Run 收尾单 final flush，避免实现与文档脱节。不改 knowledge 业务域文件（archive 时合并）。

### 上下文文件

- 必读: T-FIX-1、T-FIX-2 已实现代码（以代码为准更新文档）
- 必读: `src/daemon/AGENTS.md` — Presentation 时序、defer/release 段落
- 必读: `electron/agent/cursor-sdk/AGENTS.md` — Run 收尾、流式 POST 段落
- 参考: T5 已更新内容（本任务在其基础上追加修复说明，不重复臆造）

### 实现范围

- 修改: `src/daemon/AGENTS.md` — 补充 `enqueueReleaseDeferredAssistantStream` 串行语义、`assistantReleaseChain` 与首建占位、`resetPresentationOrderingFields` 清理 chain
- 修改: `electron/agent/cursor-sdk/AGENTS.md` — 明确 Run 收尾仅 `flushStreamPost(session, true)`，移除收尾双 flush 描述
- 不改: `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md`（archive 时合并）；里程碑节流、MergeBatch 等无关段落

### 接口契约

- 文档术语与 `SessionProgressState.assistantReleaseChain`、`enqueueReleaseDeferredAssistantStream` 字段/函数名对齐
- 文档明确 Run 收尾「单 final flush」与过程 idle release 职责分界（Electron vs Daemon）

### 验收标准

- [ ] `src/daemon/AGENTS.md` 描述 enqueue release 链、首建占位与 chain 清理
- [ ] `electron/agent/cursor-sdk/AGENTS.md` 描述 Run 收尾单 `flushStreamPost(true)`，无收尾 `flushDeferredStreamPost`
- [ ] 与 T-FIX-1、T-FIX-2 代码行为一致，无与 08-verify-issue 修复目标矛盾的表述
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T-FIX-1, T-FIX-2
- 后续任务: 无（修复完成后可 `/kb-test`、`/kb-verify-issue` 复验）

---

## T-FIX-4: handleStreamText 飞行窗口门控与 release 异常回滚

### 背景

T-FIX-1 占位后 `outboundMessageId` 未写入时，并发 `handleStreamText` 仍可能 `isFirst=true` 重复首建 assistant 卡。

### 实现范围

- 修改: `src/daemon/daemon.ts` — ordering 路径飞行窗口门控；`releaseDeferredAssistantStreamImpl` try/catch 回滚
- 修改: `src/daemon/AGENTS.md` — 术语与 `assistantReleaseChain` 字段表

### 验收标准

- [ ] ordering 且 `assistantCardReleased && !outboundMessageId` 时 await chain 并刷新 `isFirst`
- [ ] 飞行窗口内非 final 返回 `deferred: true`
- [ ] release impl 任意 throw 回滚 `assistantCardReleased` 并 rethrow

### 依赖

- 前置任务: T-FIX-1
- 后续任务: 无
