# SDK 工具调用通知分级 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **范围**：仅 Cursor SDK `tool_call` 出站分级；不改 thinking/task 分支、daemon、飞书门控、Claude/Codex/OpenCode 引擎；`06-CursorSDK执行引擎.md` 留 `/kb-archive`。

## 1、执行计划

### 1.1 依赖图

```
T1 ──→ T2 ──→ T3
```

- **T1**：新建 `src/shared/sdk-tool-presentation-tier.ts`（分级 SSOT）
- **T2**：`sdk-run-stream.ts` `case "tool_call"` presentation 门控（依赖 T1）
- **T3**：`electron/agent/cursor-sdk/AGENTS.md` + `src/shared/AGENTS.md` 文档索引（依赖 T2）

### 1.2 分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1 | — | 共享纯函数 SSOT；无运行时副作用 |
| **第二轮** | T2 | — | 唯一代码门控点；须 T1 导出稳定后方可 import |
| **第三轮** | T3 | — | 文档与实现对齐；无源码冲突 |

**同文件冲突清单**

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `src/shared/sdk-tool-presentation-tier.ts` | T1（新建） |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | T2 |
| `electron/agent/cursor-sdk/AGENTS.md` | T3 |
| `src/shared/AGENTS.md` | T3 |

## 2、任务清单

---

## T1: SDK 工具呈现分级 SSOT

### 背景

现网 `handleSdkEvent` 对每一次 `tool_call` 无条件 `markProcessEventSeen` + `postPresentationEvent`，read/glob 等高频只读探查全量出站导致 IM 刷屏（违背 01 F2）。本任务新建共享纯函数模块，将工具名 → `notify`/`silent` 映射固化为 SSOT，供 T2 单点门控引用。

### 上下文文件

- 参考: `src/shared/tool-presentation.ts` — 邻域呈现辅助纯函数风格（~154 行）
- 参考: `src/shared/AGENTS.md` — shared 域职责与 import 约定
- CodeGraph: `codegraph_context({ query: "resolveSdkToolPresentationTier sdk-tool-presentation-tier" })` — 确认新建前无同名符号
- CodeGraph: `codegraph_explore({ symbols: ["handleSdkEvent", "extractShellPresentationFields"] })` — 了解 T2 消费方，本任务不改动

### 实现范围

- **新建**: `src/shared/sdk-tool-presentation-tier.ts`（≤300 行，中文注释）—
  - 导出 `SdkToolPresentationTier = "notify" | "silent"`
  - 导出 `resolveSdkToolPresentationTier(toolName: string): SdkToolPresentationTier`
  - 归一化：`toolName.toLowerCase().trim()` 后查表
  - **notify 白名单**：`shell`、`write`、`strreplace`、`delete`、`task`
  - **默认 silent**：`read`、`glob`、`grep`、`semanticsearch`、`websearch`、`webfetch`、`callmcptool`、`generateimage`、`switchmode`、`await`、`ls`、`head` 及一切未命中白名单者
  - 内联注释或单测覆盖：大小写不敏感、空串/未知工具默认 `silent`

### 接口契约

```ts
export type SdkToolPresentationTier = "notify" | "silent"

/** 基于 SDK tool_name 判定用户侧过程是否出站；大小写不敏感；未命中白名单默认 silent */
export function resolveSdkToolPresentationTier(toolName: string): SdkToolPresentationTier
```

- 判定表与 02 §1.4 一致；**不** import daemon/electron/bridge（保持 shared 无环）
- import 路径：`../../shared/sdk-tool-presentation-tier.js`（Node16 ESM `.js` 后缀）

### 验收标准

- [ ] `resolveSdkToolPresentationTier("Shell")` / `"WRITE"` / `"StrReplace"` / `"Delete"` / `"Task"` → `"notify"`
- [ ] `resolveSdkToolPresentationTier("Read")` / `"Glob"` / `"Grep"` / `"SemanticSearch"` / `"CallMcpTool"` / `""` / `"UnknownTool"` → `"silent"`
- [ ] 文件 ≤300 行；含必要中文注释说明分级原则与扩展方式
- [ ] TypeScript 编译通过；shared 内无反向依赖
- [ ] 无 `03` 未要求的抽象层、配置开关或未批准新依赖（**Ponytail**）

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: sdk-run-stream tool_call 呈现门控

### 背景

根因：`sdk-run-stream.ts` L129–137 对全量 `tool_call` 调用 `markProcessEventSeen(session, "tool")` 与 `postPresentationEvent`，read/glob burst 既刷屏又误置 `presentationDeferStream`（劣化 F4.2）。本任务在 `case "tool_call"` 引入 T1 分级：`notify` 保留现网 presentation 块；`silent` 跳过 `markProcessEventSeen`/`postPresentationEvent` 但保留 UI 日志与 watchdog 副作用。**禁止**改动 `thinking`/`task` 分支。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` — `handleSdkEvent`（L95–182）；`case "tool_call"`（L121–141）；`case "thinking"`（L111–119）；`case "task"`（L165–175，只读不改）
- 必读: `src/shared/sdk-tool-presentation-tier.ts` — T1 导出（本任务 import）
- 必读: `electron/agent/cursor-sdk/sdk-run-presentation.ts` — `markProcessEventSeen`（~L217–225）、`postPresentationEvent`、`maybeReleaseDeferredAssistant`
- 必读: `src/shared/tool-presentation.ts` — `extractShellPresentationFields`（仅 notify 路径使用）
- 参考: `electron/agent/cursor-sdk/AGENTS.md` — PRESENTATION_ORDERING、`toolPresentationOutboundIds` 语义
- CodeGraph: `codegraph_context({ query: "handleSdkEvent tool_call markProcessEventSeen postPresentationEvent" })`
- CodeGraph: `codegraph_node({ symbol: "maybeReleaseDeferredAssistant" })` — 确认非 running 释放条件

### 实现范围

- 修改: `sdk-run-stream.ts` `case "tool_call"` —
  1. `import { resolveSdkToolPresentationTier } from "../../shared/sdk-tool-presentation-tier.js"`（路径按现网相对 import 调整）
  2. `const tier = resolveSdkToolPresentationTier(event.name)` — 在公共副作用之前或之后均可，须在 presentation 门控前求值
  3. **始终执行**（tier 无关）：`markSessionActivity`；`flushSdkLog`；`closeThinkingIfOpen`；`session.lastTool`；`session.runPhase`；`pushUiLog` `[tool]`
  4. **仅 `tier === "notify"`**：
     - `markProcessEventSeen(session, "tool")`
     - `event.status === "running"` 时 `session.toolPresentationOutboundIds?.delete(event.name)`
     - `void postPresentationEvent(session, { kind: "tool", tool_name, tool_status, final, ...extractShellPresentationFields(...) })`
     - `event.status !== "running"` 时 `maybeReleaseDeferredAssistant(session)`
  5. **`tier === "silent"`**：跳过步骤 4 全部；**不**新置 defer 闩
  6. `case "thinking"`、`case "task"` diff 为零（回归核对）

### 接口契约

| 步骤 | tier=notify | tier=silent |
|------|-------------|-------------|
| `markSessionActivity` / `flushSdkLog` / `closeThinkingIfOpen` | 执行 | 执行 |
| `session.lastTool` / `runPhase` | 执行 | 执行 |
| `pushUiLog` `[tool]` | 执行 | 执行 |
| `markProcessEventSeen(session, "tool")` | 执行 | **跳过** |
| `toolPresentationOutboundIds` delete（running） | 执行 | **跳过** |
| `postPresentationEvent({ kind: "tool", ... })` | 执行 | **跳过** |
| `maybeReleaseDeferredAssistant`（status≠running） | 执行 | **跳过**（silent 不新置闩） |

- `mapToolPresentationStatus` 与 `formatToolCallLogSuffix` 调用不变
- HTTP `/api/presentation-event` body 无变更；silent 工具不产生 POST

### 验收标准

- [ ] **01 验收 1**：典型多步任务含多次 Read/Glob，IM 过程流**无** read/glob 逐条推送
- [ ] **01 验收 2**：shell / Write / Delete / Task(tool) 在合理时延内可见可区分的过程通知
- [ ] **01 验收 3**：thinking 首包与 task 里程碑时延与 `20260704174846` 归档水平一致（thinking/task 分支零改动）
- [ ] **01 验收 4**：与变更前同类任务相比过程通知条数明显下降；高价值信号仍可见
- [ ] **01 验收 6**：短任务首包过程反馈不明显退化；完成/失败三态与正文时序正常
- [ ] **02·八·（二）1**：silent 工具运行时 Electron UI 日志仍有 `[tool] Read: running` 等；`session.lastTool` 正确更新
- [ ] **02·八·（二）2**：notify 工具飞书私聊可见里程碑、微信可见 CardKit 或等价呈现
- [ ] **02·八·（二）3**：多轮 read burst + 少量 write 任务，assistant 首包不因 read 误置 defer 而明显迟于短任务
- [ ] **02·八·（二）4**：thinking/task 行为不变（与上 01 验收 3 联调）
- [ ] **02·八·（二）5**：连续 shell running → assistant 在 p2p+ordering 场景仍按现网 defer 至 tool 完成
- [ ] **02·八·（二）6**：silent 探查后 notify 类 write/delete 失败，用户仍经 tool 完成态/三态/正文得知错误
- [ ] `sdk-run-stream.ts` ≤300 行；含必要中文注释
- [ ] 无 daemon 二次分级、无事件总线、无未批准新依赖（**Ponytail**）

### 依赖

- 前置任务: T1
- 后续任务: T3

---

## T3: AGENTS.md 分级门控文档

### 背景

T2 落地后须在代码旁 AGENTS 索引中固化 tool_call tier 门控约定，避免后续维护者回退全量出站。`06-CursorSDK执行引擎.md` 由 `/kb-archive` 更新，本任务仅改两处 AGENTS.md。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/AGENTS.md` — 「SDK 流式与 Presentation」§Presentation 出站 段落（现网 tool/thinking 描述）
- 必读: `src/shared/AGENTS.md` — 「目录职责」表与 presentation 引用约定
- 必读: T2 完成后的 `sdk-run-stream.ts` `case "tool_call"` — 与文档逐条对齐
- 必读: `src/shared/sdk-tool-presentation-tier.ts` — T1 导出与分级表
- CodeGraph: `codegraph_context({ query: "resolveSdkToolPresentationTier sdk-run-stream tool_call" })` — 核对文档引用路径

### 实现范围

- 修改: `electron/agent/cursor-sdk/AGENTS.md` —
  - 在 Presentation 出站（tool/thinking）段落补充 **tool_call 分级门控**：
    - `resolveSdkToolPresentationTier` 判定 notify/silent
    - notify：shell/write/strreplace/delete/task → `markProcessEventSeen` + `postPresentationEvent`
    - silent：跳过 presentation 与 `markProcessEventSeen`；`pushUiLog` `[tool]` 与 `lastTool` 仍全量
    - thinking/task 分支不受本次分级影响
    - 引用 `src/shared/sdk-tool-presentation-tier.ts`
- 修改: `src/shared/AGENTS.md` —
  - 「目录职责」表新增 `sdk-tool-presentation-tier.ts` 一行：SDK tool_name → notify/silent 分级 SSOT；主要引用方 electron cursor-sdk

### 接口契约

- 无新增代码导出；文档须与 T1/T2 行为一致，**不得**承诺用户可配置开关或 daemon 二次分级
- 术语：`notify` = 用户侧过程出站；`silent` = 仅 UI 日志/lastTool，不产生 `presentation-event`

### 验收标准

- [ ] `electron/agent/cursor-sdk/AGENTS.md` 含 tool_call tier 门控说明及 `sdk-tool-presentation-tier.ts` 路径引用
- [ ] `src/shared/AGENTS.md` 目录表含 `sdk-tool-presentation-tier.ts` 职责一行
- [ ] 文档描述与 T2 代码行为一致（notify 白名单五项、silent 默认、thinking/task 不变）
- [ ] 未改动 `knowledge/业务域/**` 正文（留 archive）
- [ ] 无超范围 UI/配置文档、无未批准新依赖（**Ponytail**）

### 依赖

- 前置任务: T2
- 后续任务: 无（完成后 `/kb-test` → `/kb-archive`）
