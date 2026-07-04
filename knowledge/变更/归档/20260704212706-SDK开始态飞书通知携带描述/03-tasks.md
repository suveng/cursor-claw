# SDK 开始态飞书通知携带描述 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **范围**：仅 Cursor SDK 路径；补强飞书开始态里程碑文案（shell 命令摘要、task 描述）+ 飞书 thinking 零出站；**禁止**修改 `sdk-run-presentation.ts` Rev2 defer/release 链、`handleStreamText` final 语义、`daemon-presentation-milestone.ts` 节流算法。

## 1、执行计划

### 1.1 依赖图

```
T1 ──→ T2 ──┐
T3 ─────────┼──→ T4 ──→ T5
            ┘
```

- **T1**：`formatToolMilestoneText` 共享 SSOT（`tool-presentation.ts`）
- **T2**：Daemon `handleToolPresentationEvent` 飞书抑制路径接入新文案（依赖 T1）
- **T3**：Task 开始态文案映射（`sdk-run-stream.ts` + Daemon `buildTaskFallbackText`；与 T1 无依赖，宜先于 T2/T4 改 `daemon.ts`）
- **T4**：飞书 `handleThinkingPresentationEvent` 真静默（依赖 T2、T3 完成 `daemon.ts` 前序改动）
- **T5**：AGENTS + 知识库同步（依赖 T1–T4）

### 1.2 分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1 | — | 共享纯函数；无运行时副作用 |
| **第二轮** | T3 | — | `sdk-run-stream.ts` task 映射 + `daemon.ts` `buildTaskFallbackText` 收敛 |
| **第三轮** | T2 | — | `daemon.ts` `handleToolPresentationEvent`；依赖 T1 |
| **第四轮** | T4 | — | `daemon.ts` `handleThinkingPresentationEvent`；与 T2 同文件须串行 |
| **第五轮** | T5 | — | 文档；无源码冲突 |

**推荐串行顺序**：T1 → T3 → T2 → T4 → T5

**同文件冲突清单**

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `src/shared/tool-presentation.ts` | T1 |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | T3 |
| `src/daemon/daemon.ts` | T3（`buildTaskFallbackText`）→ T2（`handleToolPresentationEvent`）→ T4（`handleThinkingPresentationEvent`） |

## 2、任务清单

---

## T1: formatToolMilestoneText 共享 SSOT

### 背景

飞书抑制路径 `handleToolPresentationEvent` 里程碑硬编码 `` `${toolName}: ${status}` ``，shell started 时用户只见「shell: started」，丢弃 Electron 已透传的 `tool_shell_command`。本任务在 `tool-presentation.ts` 新增里程碑单行格式化纯函数，与既有 `extractShellPresentationFields` / `truncateText` 同文件，作为多通道文案 SSOT，供 T2 daemon 里程碑与未来通道复用。

### 上下文文件

- 必读: `src/shared/tool-presentation.ts` — `extractShellPresentationFields`、`truncateText`、`mergeShellToolDetail`（CardKit 对照，本任务不改）
- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` L130–136 — `extractShellPresentationFields` 调用与 `tool_shell_*` 透传
- 参考: `src/daemon/daemon.ts` L1457–1464 — 现网 `` `${toolName}: ${status}` `` 根因
- 参考: `01-proposal.md` — F1.1–F1.3、F1.5、验收 1–2、6、9

### 实现范围

- 修改: `src/shared/tool-presentation.ts` —
  - 新增常量 `TOOL_MILESTONE_TEXT_MAX = 120`（里程碑单行上限，区别于 CardKit `TOOL_CARD_SHELL_OUTPUT_MAX`）
  - 新增并导出 `formatToolMilestoneText(toolName, status, shell?)`：
    - `toolName === "shell"` 且 `status === "started"`：有 `tool_shell_command` → `执行命令：{truncateText(command, TOOL_MILESTONE_TEXT_MAX)}`
    - 无命令 → `命令执行已开始（具体命令暂不可展示）`（B F3.1 / 01 F1.5）
    - 其他 notify 工具或非 started：保持 `` `${toolName}：${状态中文标签}` `` 简短格式（不扩展 read/glob 等 silent 工具）
    - completed/failed：若 event 带 `tool_shell_command` 仍可在文案中保留命令摘要（02·八·（二）第 2 项）
  - 文件总行数须 ≤300；含必要中文注释

### 接口契约

```ts
export const TOOL_MILESTONE_TEXT_MAX = 120

export function formatToolMilestoneText(
  toolName: string,
  status: "started" | "completed" | "failed",
  shell?: Pick<ToolShellPresentationFields, "tool_shell_command" | "tool_shell_cwd">,
): string
```

- 纯函数、无 import daemon/electron；复用既有 `truncateText`
- import 路径：`../../shared/tool-presentation.js`（ESM `.js` 后缀）

### 验收标准

- [ ] `formatToolMilestoneText("shell","started",{tool_shell_command:"npm test"})` 含 `npm test`，且不含裸 `` shell: started ``（02·八·（二）第 1 项）
- [ ] 无 `tool_shell_command` 时返回明确降级句，非无信息占位（01 F1.5、验收 1）
- [ ] 超长命令经 `truncateText` 截断至 `TOOL_MILESTONE_TEXT_MAX`，核心意图可辨认（01 验收 6）
- [ ] `formatToolMilestoneText("read","started",...)` 等行为不触发 notify 级以外扩展（分级不变，01 验收 4）
- [ ] TypeScript 编译通过；`tool-presentation.ts` ≤300 行
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: 无
- 后续任务: T2、T5

---

## T2: Daemon tool 飞书里程碑文案

### 背景

T1 提供 `formatToolMilestoneText` 后，须在 Daemon 飞书抑制（文本里程碑）路径替换现网 `` `${toolName}: ${status}` ``，使 shell started 与 CardKit 路径信息等价。ordering `sendMilestoneText` 返回 `sent` 后置闩语义、节流 3s、同文案 ≤4 次/Run **不变**；CardKit 非抑制分支 **不改**。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `handleToolPresentationEvent`（L1428–1561）、飞书抑制分支与 `sendMilestoneText` 调用
- 必读: `src/shared/tool-presentation.ts` — T1 完成的 `formatToolMilestoneText`
- 必读: `src/daemon/daemon-presentation-milestone.ts` — `sendMilestoneText` 节流/去重（只读，本任务不改）
- 参考: `src/shared/feishu-presentation-gate.ts` — `isFeishuProcessPresentationSuppressed`（门控不变）
- 参考: `01-proposal.md` — F1、F4.2、验收 1–2、7、9

### 实现范围

- 修改: `src/daemon/daemon.ts` — `handleToolPresentationEvent`：
  - 飞书抑制分支：`sendMilestoneText` 第三参由 `` `${toolName}: ${status}` `` 改为 `formatToolMilestoneText(toolName, status, { tool_shell_command: event.tool_shell_command, tool_shell_cwd: event.tool_shell_cwd })`
  - 保留 ordering 闩：`sent === true` 时更新 `presentationProcessActive` / `activeToolNames` 等现网逻辑
  - CardKit 路径、`mergeShellToolDetail`、微信通道 **不改**
- **禁止**修改: `sdk-run-presentation.ts`、`handleStreamText`、`enqueueReleaseDeferredAssistantStream`

### 接口契约

- 消费: `formatToolMilestoneText(toolName, status, shellFields)` — 自 T1 导入
- `sendMilestoneText(sessionKey, "tool", formattedText, state): Promise<boolean>` — 调用契约不变；仅 `formattedText` 来源变更
- `PresentationEvent` 字段不变；继续读 `tool_shell_command` / `tool_shell_cwd`

### 验收标准

- [ ] **01 验收 1**：飞书私聊 shell started，里程碑含命令摘要（≥3 条不同命令抽检）
- [ ] **01 验收 2**：文本里程碑路径与 CardKit 路径命令摘要信息等价（允许措辞差异）
- [ ] **01 验收 7**（群聊）：触发者可见 started 含命令摘要，符合群聊抑制规则
- [ ] **01 验收 9**：同次 shell completed/failed 不退化；若 event 带命令字段，完成/失败里程碑仍可见命令信息（02·八·（二）第 2 项）
- [ ] read/glob 等 silent 工具仍无 started 里程碑（01 验收 4；门控在 Electron 侧，本任务不扩展 tool handler 至 silent）
- [ ] `grep` 本任务 diff **未修改** `sdk-run-presentation.ts`（02·八·（二）第 5 项）
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T1
- 后续任务: T5

---

## T3: Task 开始态里程碑文案（Electron 映射 + Daemon 兜底）

### 背景

现网 `mapTaskMilestoneText` 在 `status=started` 且 `text` 空时返回固定「子任务进行中…」；daemon `buildTaskFallbackText` 重复同类兜底，用户无法区分步骤。本任务扩展 Electron 侧 task 文案映射与 Run 级 `taskSeq`，使 `postPresentationEvent` 传出可理解 `task_text`；收敛 daemon 兜底避免再次覆盖为无信息句。`handleTaskPresentationEvent` **结构不变**，继续消费 `event.task_text` 经 `sendMilestoneText` 出站。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` — `mapTaskMilestoneText`（L55–68）、`case "task"`、`handleSdkEvent`
- 必读: `src/daemon/daemon.ts` — `buildTaskFallbackText`（L1724–1729）、`handleTaskPresentationEvent`（L1732–1765）
- 必读: `electron/agent/cursor-sdk/sdk-session-types.ts` — `SdkSessionAgent` 字段；`resetSdkRunPresentationState` / `startSdkRun` 清零点
- 参考: `src/daemon/daemon-presentation-milestone.ts` — 里程碑节流（只读）
- 参考: `01-proposal.md` — F2、验收 3、6、8

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-run-stream.ts` —
  - 扩展 `mapTaskMilestoneText(status?, text?, taskSeq?)`：
    - `started` + 有 `text` → `正在执行：{截断 text}`（复用合理长度常量，与里程碑上限协调）
    - `started` + 无 `text` + `taskSeq` → `子任务 #${taskSeq} 已开始`
    - `started` + 无 `text` + 无 seq → `子任务已开始`（优于「子任务进行中…」）
    - completed/failed 等态保持现网语义或等价改进
  - `case "task"`：`status=started` 时递增 `session.taskSeq`（Run 级，在 `resetSdkRunPresentationState`/`startSdkRun` 清零）
  - `postPresentationEvent` 仍传 `task_text: mappedText`；**不**调用 `markProcessEventSeen`（ordering 语义不变）
- 修改: `src/daemon/daemon.ts` —
  - `buildTaskFallbackText` 与映射逻辑对齐或删除冗余，确保 `handleTaskPresentationEvent` 不会在 started 态将已有描述覆盖为「子任务进行中…」
  - `handleTaskPresentationEvent` 路由与 `sendMilestoneText` 结构 **不改**
- 可选: `SdkSessionAgent` 增加 `taskSeq?: number`（内存字段，无持久化）

### 接口契约

```ts
function mapTaskMilestoneText(
  status?: string,
  text?: string,
  taskSeq?: number,
): string
```

- `postPresentationEvent(session, { kind: "task", task_status, task_text: mappedText })` — 载荷不变
- `handleTaskPresentationEvent` — 继续 `sendMilestoneText(sessionKey, "task", event.task_text ?? buildTaskFallbackText(...), state)`；兜底须与映射一致

### 验收标准

- [ ] **01 验收 3**：含 ≥2 个可区分子任务的 Run，飞书各 started 里程碑含对应描述或可读序号（F2.3）
- [ ] 同一 Run 连续 2 个无 text 的 task started，文案可区分序号（02·八·（二）第 3 项）
- [ ] 长描述截断后核心意图可辨认（01 验收 6）
- [ ] **01 验收 8**：与变更前相比无「完成先于开始」明显错乱（task 里程碑时序不因文案变长而倒置）
- [ ] 桌面 UI 日志 `[task]` 仍输出映射后文案
- [ ] `sdk-run-stream.ts` ≤300 行；未改 `sdk-run-presentation.ts` defer 链
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: 无（可与 T1 并行；须在 T2/T4 改 `daemon.ts` 其他 handler 前完成 stream 部分）
- 后续任务: T5

---

## T4: 飞书 thinking 真静默

### 背景

飞书抑制 CardKit 后 `handleThinkingPresentationEvent` 仍 `sendMilestoneText`「正在思考…」，与 01 F5/D「零出站」冲突。本任务在飞书抑制分支**移除**里程碑出站与 `thinkingBuffer` 的 IM 用途，直接 `return { ok: true }`；**显式 supersede** 变更 A·F8.1 飞书 thinking 实时里程碑条款。Electron `case "thinking"` POST 与桌面 `[thinking]` 日志 **不改**；非飞书 CardKit 路径 **不改**。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `handleThinkingPresentationEvent`（L1563–1629）、`thinkingBuffer` 用法
- 必读: `src/shared/feishu-presentation-gate.ts` — `isFeishuProcessPresentationSuppressed`
- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` — `case "thinking"`、`appendSdkLog`（只读，本任务不改）
- 参考: `electron/agent/cursor-sdk/sdk-run-presentation.ts` — `markProcessEventSeen`（只读，**禁止修改**）
- 参考: `01-proposal.md` — F5、验收 5、10；`supersedes` A·F8.1 脚注

### 实现范围

- 修改: `src/daemon/daemon.ts` — `handleThinkingPresentationEvent`：
  - `isFeishuProcessPresentationSuppressed(..., "thinking")` 为 true 时：**不**调用 `sendMilestoneText`；**不**将 delta 累积至 `thinkingBuffer` 用于 IM 出站
  - 直接 `return { ok: true }`（可保留必要 session 状态清理，但无飞书消息）
  - 非飞书 / 未抑制 CardKit 分支保持现网
- **禁止**修改: `sdk-run-presentation.ts`、`handleStreamText`、`maybeReleaseDeferredAssistant`、Rev2 `flushStreamPost(true)` 语义

### 接口契约

- 飞书抑制 + thinking：`handleThinkingPresentationEvent` → `{ ok: true }`，无 `sendMilestoneText` 副作用
- Electron 侧：`postPresentationEvent({ kind: "thinking", ... })` 仍到达 daemon（行为由本 handler 静默消费）
- ordering：thinking 静默后飞书侧无过程消息；defer 闩仍可能由 Electron `markProcessEventSeen` 置位——**不修改** release 时机（02 §二 方案要点 3）

### 验收标准

- [ ] **01 验收 5**：含 thinking 阶段的 Run，飞书**无**独立思考过程通知；运行开始后 10s 内仍有处理中态/正文/子任务或工具 started 等至少一种可见反馈
- [ ] **01 验收 10**：桌面 SDK 运行日志 `[thinking]` 仍有输出（02·八·（二）第 4 项后半）
- [ ] 含多段 thinking delta 的 run，飞书会话 thinking 类消息数为 0（02·八·（二）第 4 项）
- [ ] **微信**通道 thinking 行为与变更前一致（抽检 1 场景，02·八·（二）第 6 项）
- [ ] `grep` diff **未修改** `sdk-run-presentation.ts` 的 `shouldEndOnlyAssistantDefer` / `flushStreamPost`（02·八·（二）第 5 项）
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T2（同文件 `daemon.ts` 串行；T3 daemon 兜底宜先于本任务）
- 后续任务: T5

---

## T5: AGENTS 与知识库同步

### 背景

代码行为落地后，须同步开发指引与业务知识：飞书 thinking 零出站、shell/task started 里程碑文案规则、与变更 A Rev2 边界及 supersede A·F8.1（仅飞书 thinking）说明，供 `/kb-archive` 与后续维护者检索。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/AGENTS.md` — Presentation、ordering、Rev2 段落
- 必读: `src/daemon/AGENTS.md` — 飞书 Presentation 门控与 handler 说明
- 必读: `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — §二 Presentation、§八推送
- 参考: T1–T4 已落地的 `tool-presentation.ts`、`sdk-run-stream.ts`、`daemon.ts` 实际行为
- 参考: `02-design.md` §十 知识库更新计划（本任务只写文档，不回读 02 作为执行依据）

### 实现范围

- 修改: `electron/agent/cursor-sdk/AGENTS.md` —
  - 补充 `mapTaskMilestoneText` / `taskSeq` 与 task started 文案规则
  - 声明 ordering/Rev2 相关文件（`sdk-run-presentation.ts`）**不在本变更范围**
- 修改: `src/daemon/AGENTS.md` —
  - `handleToolPresentationEvent` 飞书里程碑使用 `formatToolMilestoneText`
  - `handleThinkingPresentationEvent` 飞书真静默（零 `sendMilestoneText`）
- 修改: `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` —
  - §八推送：shell/task started 文案、飞书 thinking 零出站
  - 一句边界：与 A Rev2 assistant end-only 正交；supersede A·F8.1 飞书 thinking 部分
- 可选: `src/shared/AGENTS.md` — 若新增 `formatToolMilestoneText` / `TOOL_MILESTONE_TEXT_MAX` 索引条目（视 T1 导出情况）

### 接口契约

- 文档描述须与 T1–T4 代码行为一致；不得承诺未实现的通道行为
- 不改业务源码；`06-CursorSDK执行引擎.md` 变更记录段追加本日摘要

### 验收标准

- [ ] 三份必更文档（`electron/.../AGENTS.md`、`src/daemon/AGENTS.md`、`06-CursorSDK执行引擎.md`）均提及：飞书 thinking 零出站、shell started 命令摘要、task started 描述/序号
- [ ] AGENTS 中明确 **未修改** `sdk-run-presentation.ts` Rev2 链
- [ ] 文档无与 01 验收 1–10 相矛盾的陈述
- [ ] 各文档单文件 ≤3000 字符（超限则按 AGENTS 规范拆分，本变更优先最小 diff）
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T1、T2、T3、T4
- 后续任务: 无（完成后 `/kb-apply` 结束 → `/kb-test` → `/kb-archive`）
