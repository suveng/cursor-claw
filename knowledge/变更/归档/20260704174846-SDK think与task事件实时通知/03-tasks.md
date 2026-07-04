# SDK think与task事件实时通知 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **范围**：仅 Cursor SDK 路径；不改 Claude/Codex/OpenCode、watchdog、`STREAM_POST_INTERVAL_MS=400`、三态「Agent 处理中…」语义。

## 1、执行计划

### 1.1 依赖图

```
T1 ──→ T2 ──┐
T1 ──→ T3 ──┼──→ T5 ──→ T6
T1 ──→ T4 ──┘
```

- **T1**：共享 `PresentationKind`/`PresentationEvent` + 飞书门控扩展 `task`
- **T2**：Electron `postPresentationEvent` 飞书仍 POST；`markProcessEventSeen` 与门控/defer 联动
- **T3**：`handleSdkEvent` task 分支出站 + 文案映射 + UI 日志
- **T4**：Daemon 里程碑降级模块（新建 `daemon-presentation-milestone.ts`）
- **T5**：Daemon presentation 接线（task handler、thinking/tool 抑制降级、微信 task、清理 hook）
- **T6**：静态验收与残留检查（无业务代码改动）

### 1.2 分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1 | — | 类型与门控 SSOT；daemon 本地 `PresentationKind` 同步 |
| **第二轮** | T2、T3、T4 | 三任务并行 | T2↔`sdk-run-presentation.ts`；T3↔`sdk-run-stream.ts`；T4 新建文件，无冲突 |
| **第三轮** | T5 | — | **冲突**：`daemon.ts`（依赖 T4 导出 + T2 POST 可达 + T3 task 载荷） |
| **第四轮** | T6 | — | grep/类型/验收 checklist |

**同文件冲突清单**

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `electron/agent/cursor-sdk/sdk-session-types.ts` | T1 |
| `src/shared/feishu-presentation-gate.ts` | T1 |
| `src/daemon/daemon.ts` | T1（类型同步）→ T5 |
| `electron/agent/cursor-sdk/sdk-run-presentation.ts` | T2 |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | T3 |
| `src/daemon/daemon-presentation-milestone.ts` | T4（新建）→ T5 import |

## 2、任务清单

---

## T1: 共享类型与飞书门控扩展

### 背景

现网 `PresentationKind` 无 `task`，`handleSdkEvent` 的 `task` 事件无法出站；飞书门控仅抑制 `tool`/`thinking`，须扩展为含 `task` 的 CardKit 抑制（**抑制 CardKit ≠ 禁止出站**，daemon 侧将降级为里程碑文本）。daemon 在 `daemon.ts` L824 重复定义本地类型，须与 Electron SSOT 同步。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-session-types.ts` — `PresentationKind`（L89）、`PresentationEvent`（L91–103）
- 必读: `src/shared/feishu-presentation-gate.ts` — `isFeishuProcessPresentationSuppressed(channelType, eventKind)`（全文件 11 行）
- 必读: `src/daemon/daemon.ts` — 本地 `PresentationKind`（L824）、`PresentationEvent`（L835 附近）、`isFeishuProcessPresentationSuppressed` 包装（L441）
- 参考: `src/shared/AGENTS.md` — presentation gate 三端引用约定

### 实现范围

- 修改: `sdk-session-types.ts` —
  - `PresentationKind` 增加 `"task"`
  - `PresentationEvent` 增加 `task_status?: string`、`task_text?: string`
- 修改: `feishu-presentation-gate.ts` — 抑制条件扩展为 `tool` / `thinking` / `task`（飞书全通道 CardKit 抑制，assistant stream-text 不受影响）
- 修改: `daemon.ts` — 本地 `PresentationKind`/`PresentationEvent` 与 SSOT 字段对齐（含 `task`、`task_status`、`task_text`）

### 接口契约

```ts
export type PresentationKind = "assistant" | "thinking" | "tool" | "diff" | "merge_batch" | "task"

export interface PresentationEvent {
  // ...existing
  task_status?: string
  task_text?: string
}
```

- `isFeishuProcessPresentationSuppressed(channelType, eventKind)` — `channelType==="feishu"` 且 `eventKind ∈ {tool, thinking, task}` 返回 `true`；微信及其他通道返回 `false`

### 验收标准

- [ ] TypeScript 编译通过；三处 `PresentationKind` 均含 `task`
- [ ] `feishu` + `kind=task` 经 gate 返回抑制；`wechat` + `task` 返回不抑制
- [ ] `POST /api/presentation-event` body 可解析 `task_status`/`task_text`（daemon 路由尚未实现时 handler 可返回 unsupported，本任务仅保证类型不丢字段）
- [ ] 无 `03` 未要求的抽象层、trait/mixin 或未批准新依赖（**Ponytail**）

### 依赖

- 前置任务: 无
- 后续任务: T2、T3、T4、T5

---

## T2: Electron 出站与 defer 联动

### 背景

根因：`postPresentationEvent` 在飞书路径 L48 `early return`，daemon 收不到 thinking/tool/task 过程事件，用户完全沉默；同时 `markProcessEventSeen` 无条件置 `presentationDeferStream`，飞书抑制下既无过程卡又延迟 assistant 首包。本任务：**飞书仍 POST** presentation-event；仅当过程 presentation **实际可见**（非飞书抑制）且 `kind !== "task"` 时才置 defer 闩。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-run-presentation.ts` — `postPresentationEvent`（L44–75）、`markProcessEventSeen`（L221–227）、`isFeishuProcessPresentationSuppressed` 包装（L37–42）
- 必读: `src/shared/feishu-presentation-gate.ts` — T1 完成后的 gate
- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` — `markProcessEventSeen` 调用点（thinking L100、tool L113）；只读，本任务不改 stream
- 参考: `electron/agent/cursor-sdk/AGENTS.md` — PRESENTATION_ORDERING、`seenProcessEvent`/`presentationDeferStream` 语义

### 实现范围

- 修改: `sdk-run-presentation.ts` —
  - **删除** `postPresentationEvent` 入口对 `isFeishuProcessPresentationSuppressed` 的 early return（L48）；飞书 tool/thinking/task 仍 POST 至 daemon，由 daemon 降级
  - 扩展 `markProcessEventSeen(session, kind: PresentationKind)`（或等价参数）：仅当 `!feishuSuppressesProcessKind(resolveSessionChannelType(session.sessionKey), kind)` **且** `kind !== "task"` 时设置 `seenProcessEvent=true` 与 `presentationDeferStream=true`（须 `presentationOrderingEligible`）
  - 保留 `clearStreamPostTimer` 于 thinking/tool 路径（调用方不变）
- 修改: `sdk-run-stream.ts` — 仅更新 `markProcessEventSeen` 调用签名传入 `kind`（`"thinking"` / `"tool"`）；**不在本任务实现 task 分支**（归 T3）

### 接口契约

- `postPresentationEvent(session, event)` — 不因飞书抑制跳过 POST；微信/飞书行为一致到达 daemon
- `markProcessEventSeen(session, kind: PresentationKind): void` —
  - `kind==="task"` → 永不置 defer 闩
  - 飞书抑制 kind → 不置 `seenProcessEvent`/`presentationDeferStream`（ordering 闩锁由 daemon CardKit 成功路径维护；飞书抑制由 daemon 里程碑文本提供可见性）
  - 其他 eligible 过程 kind → 现网 defer 语义不变

### 验收标准

- [ ] 飞书 SDK Run：thinking 到达后 daemon 日志可见 `presentation-event` 入站（非 electron 侧静默丢弃）
- [ ] 飞书抑制 + ordering 开启：assistant 首包时延相对变更前**无显著劣化**（01 验收 3；02·八·（二）第 3 项）
- [ ] `markProcessEventSeen(session, "task")` 不修改 `presentationDeferStream`
- [ ] 微信 thinking/tool defer 行为与变更前一致（回归 smoke）
- [ ] `sdk-run-presentation.ts` ≤300 行；含必要中文注释
- [ ] 无 `03` 未要求的抽象层或未批准新依赖（**Ponytail**）

### 依赖

- 前置任务: T1
- 后续任务: T5

---

## T3: SDK task 事件消费与文案映射

### 背景

现网 `handleSdkEvent` 将 `task` 与 `usage`/`system`/`user` 合并，仅 `markSessionActivity`（L150–154），用户看不到子任务里程碑。本任务独立 `task` 分支：映射用户可理解文案 → `postPresentationEvent({ kind: "task", ... })` → UI 日志 `[task]`；**不**调用 `markProcessEventSeen`（task 不参与 assistant defer）。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/sdk-run-stream.ts` — `handleSdkEvent`（L95–155）、`case "task"` 合并分支（L149–154）
- 必读: `electron/agent/cursor-sdk/sdk-run-presentation.ts` — T2 完成后的 `postPresentationEvent`
- 必读: `electron/agent/cursor-sdk/sdk-session-types.ts` — T1 的 `PresentationEvent` 扩展字段
- 参考: `@cursor/sdk` — task 事件 `status`/`text` 字段（`SDKTaskMessage` 或 stream 事件 `type==="task"`）

### 实现范围

- 修改: `sdk-run-stream.ts` —
  - 从合并 `case` 拆出独立 `case "task":`
  - 新增内联 `mapTaskMilestoneText(status?: string, text?: string): string`：

    | SDK status | 用户文案 |
    |------------|----------|
    | （空）/started | `正在执行：{text}` 或 `子任务进行中…`（text 空时） |
    | completed | `已完成：{text}` |
    | failed | `子任务失败：{text}` |
    | 其他 | `{text}` 或 `子任务更新（{status}）` |

  - `markSessionActivity(session, "task")`
  - `void postPresentationEvent(session, { kind: "task", task_status: event.status, task_text: mappedText })`（`task_text` 传映射后全文或保留 raw+映射策略二选一，daemon 以 `task_text` 展示，须在注释说明）
  - `pushUiLog("SDK", "INFO", \`[${session.sessionKey}] [task] ${mappedText}\`)`
  - **禁止** `markProcessEventSeen`

### 接口契约

- `mapTaskMilestoneText(status?: string, text?: string): string` — 纯函数，中文用户可见文案
- `postPresentationEvent` 载荷示例：

```ts
{ kind: "task", task_status: string | undefined, task_text: string }
```

### 验收标准

- [ ] **01 验收 2**：含 ≥2 个子任务里程碑的 Run，UI 日志可见 `[task]` 且 daemon 收到 `kind=task` presentation-event
- [ ] **首个 task 通知**：子任务开始后合理时延内（通常 10s）用户侧可见（依赖 T5 呈现；本任务保证 electron 出站不迟于事件到达）
- [ ] task 事件不触发 `seenProcessEvent`/`presentationDeferStream`
- [ ] `sdk-run-stream.ts` ≤300 行
- [ ] 无 `03` 未要求的抽象层或未批准新依赖（**Ponytail**）

### 依赖

- 前置任务: T1
- 后续任务: T5

---

## T4: Daemon 里程碑降级模块

### 背景

飞书抑制 CardKit 时，现网 thinking/tool handler 静默 `return { ok: true }`，用户无任何过程信号（违背 01 F1.4/F4.2）。本任务新建独立模块，提供 session 级里程碑 `send-text` 降级：节流 ≥3s、同文案去重、Run 结束清理；**不带** `message_id`/`stop_progress`（与三态进度区分）。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `stopSessionProgress`（L1767）、`sessionProgressMap`、`SessionProgressState`（L300–344）；现有 `sendText`/`replyToMessage` 路径（只读）
- 必读: `src/daemon/AGENTS.md` — 三态进度与 `stop_progress` 约定
- 参考: `handleThinkingPresentationEvent`（L1475）/ `handleToolPresentationEvent`（L1354）飞书抑制分支（L1392、L1509）— T5 将改调本模块

### 实现范围

- **新建**: `src/daemon/daemon-presentation-milestone.ts`（≤300 行）—
  - 常量 `MILESTONE_THROTTLE_MS = 3000`
  - `SessionProgressState` 扩展字段（本模块类型或 daemon 接口扩展，由 T5 挂接）：
    - `lastMilestoneText?: string`
    - `lastMilestoneAt?: number`
    - `milestoneDedupSet?: Set<string>` — Run 级 `(kind + hash(text))` 去重
  - `sendMilestoneText(sessionKey, kind, text, state): Promise<void>` —
    - 节流键：`sessionKey + kind + hash(text)`；同键 3s 内跳过
    - 去重：同 Run 同全文里程碑累计 ≤4 次（对齐 02·八·（二）第 4 项与 01 验收 7）
    - 经现有 send-text 发送简短文本；不传 `message_id`/`stop_progress`
    - 失败 WARN 日志含可检索字段 `milestone_fallback`
  - `clearMilestoneState(state): void` — 清里程碑字段与 dedup 集合
  - 导出供 `daemon.ts` import（`.js` 后缀 ESM）

### 接口契约

- `export const MILESTONE_THROTTLE_MS = 3000`
- `export async function sendMilestoneText(sessionKey: string, kind: string, text: string, state: SessionProgressState): Promise<void>`
- `export function clearMilestoneState(state: SessionProgressState): void`
- 节流键：`${sessionKey}:${kind}:${hash(text)}`（hash 可用简单 djb2 或 `text.slice(0,64)`，注释说明）

### 验收标准

- [ ] 模块可独立 import；`daemon-presentation-milestone.ts` ≤300 行、含中文注释
- [ ] 单元/手工：连续相同文案 3s 内第二次调用被节流；同 Run 第 5 次同文案被去重拒绝
- [ ] `clearMilestoneState` 清空 dedup 与 `lastMilestoneAt`
- [ ] 无循环依赖（本模块不 import `daemon.ts` 全量；可接受注入 `sendText` 回调或 import daemon 内已有低级发送函数，须无环）
- [ ] 无 `03` 未要求的抽象层或未批准新依赖（**Ponytail**）

### 依赖

- 前置任务: T1
- 后续任务: T5

---

## T5: Daemon presentation 接线

### 背景

汇聚 T2 POST 可达、T3 task 载荷、T4 里程碑模块：新增 `handleTaskPresentationEvent`；`handlePresentationEvent` 路由 `task`；飞书抑制时 thinking/tool/**task** 改调 `sendMilestoneText` 替代静默 return；微信 task 走 send-text 或简短 CardKit（复用 thinking/tool 模式）；`stopSessionProgress` 等 Run 结束路径 hook `clearMilestoneState`。

### 上下文文件

- 必读: `src/daemon/daemon-presentation-milestone.ts` — T4 导出
- 必读: `src/daemon/daemon.ts` —
  - `handlePresentationEvent`（L1642）
  - `handleThinkingPresentationEvent`（L1475）、`handleToolPresentationEvent`（L1354）
  - `stopSessionProgress`（L1767）
  - `isFeishuProcessPresentationSuppressed`（L441）
- 必读: `src/shared/feishu-presentation-gate.ts` — T1 gate
- 参考: `electron/agent/cursor-sdk/AGENTS.md` — f41Eligible / 群聊 presentation eligible

### 实现范围

- 修改: `daemon.ts` —
  - `SessionProgressState` 增加 T4 里程碑字段（若 T4 仅声明类型则在此挂接）
  - 新增 `handleTaskPresentationEvent(event)`：
    - 校验 `session_key`、`task_text`（或从 `task_status` 生成兜底文案）
    - 飞书抑制 → `sendMilestoneText(sessionKey, "task", text, state)`
    - 微信 → `sendText` 简短里程碑或等价 CardKit（与 thinking 降级一致，优先文本）
    - ordering 开启时：**不**因 task 置 `presentationProcessActive`（task 不参与 assistant defer；与 02 方案一致）
    - 返回 `{ ok: true }`
  - `handlePresentationEvent` — `case "task":` 路由至 `handleTaskPresentationEvent`
  - `handleThinkingPresentationEvent` / `handleToolPresentationEvent` — 飞书抑制分支（现 L1392–1396、L1509–1511）：
    - 保留 ordering 闩锁更新（`presentationProcessActive`、`activeToolNames`、`thinkingOpen`）
    - **改**：构造用户可理解摘要后 `await sendMilestoneText(...)`，再 `releaseIfProcessIdle` / deferred release
    - thinking：首 delta 或摘要变更时发里程碑（避免仅 final 无首包）
    - tool：`started`/`completed`/`failed` 发简短摘要（工具名 + 状态）
  - `stopSessionProgress` 与 stream `final`/ack 等等价 Run 结束清理路径：对 state 调用 `clearMilestoneState`（删除 map 前）
  - 默认分支 `unsupported kind` 不再命中 `task`

### 接口契约

- `handleTaskPresentationEvent(event: PresentationEvent): Promise<{ ok: boolean; error?: string }>`
- 降级 send-text：**不带** `message_id`、`stop_progress`
- 飞书抑制 + thinking：`sendMilestoneText(sessionKey, "thinking", "正在思考…" 或摘要截断, state)`
- 飞书抑制 + tool：`sendMilestoneText(sessionKey, "tool", \`${toolName}: ${status}\`, state)`

### 验收标准

- [ ] **01 验收 1**：飞书私聊/群聊，思考阶段 10s 内可见 CardKit **或** 降级里程碑文本
- [ ] **01 验收 2**：含 task 的 Run，首个子任务相关通知 10s 内可见
- [ ] **01 验收 4**：长任务（>30s、正文稀疏）等待期间 ≥2 次过程类更新（think/task/tool 里程碑合计）
- [ ] **01 验收 5**：停止 Run 后过程通知停止；失败场景过程不掩盖失败提示
- [ ] **01 验收 6**：飞书私聊、微信（若配置）、任务面板入口各 1 场景可感知过程信号
- [ ] **01 验收 7**：单次 Run 无连续 5 条以上语义完全相同的过程通知
- [ ] **02·八·（二）第 1–2 项**：飞书 thinking / 首个 task 10s 内可见
- [ ] **02·八·（二）第 4 项**：同文案里程碑 ≤4 条/Run
- [ ] **02·八·（二）第 5 项**：`kind=task` 微信路径 HTTP 200，不 500
- [ ] **02·八·（二）第 6 项**：`stopSessionProgress` 后无残留 milestone 定时器；`milestoneDedupSet` 已清
- [ ] PRESENTATION_ORDERING 开启时飞书抑制场景 assistant 首包不异常延迟（与 T2 联调）
- [ ] 无 `03` 未要求的抽象层或未批准新依赖（**Ponytail**）

### 依赖

- 前置任务: T2、T3、T4
- 后续任务: T6

---

## T6: 静态验收与残留检查

### 背景

全链路合并后做静态与 checklist 验收，确保无飞书 early return 残留、类型三端一致、非 Cursor SDK 路径未误改。本任务**不写业务代码**，产出可勾选的验证记录供 `/kb-test`。

### 上下文文件

- 必读: 本文件 T1–T5 验收标准
- 必读: `01-proposal.md` §验收标准 1–7
- 必读: `02-design.md` §8.2 工程补充验收项（任务内已内联，本任务执行 grep/编译验证）
- 参考: `electron/agent/cursor-sdk/AGENTS.md`、`src/daemon/AGENTS.md`

### 实现范围

- 静态检查（命令行，不修改源码）：
  - `grep`：`postPresentationEvent` 内无 `isFeishuProcessPresentationSuppressed` early return
  - `grep`：`handleSdkEvent` 存在独立 `case "task"` 且含 `postPresentationEvent`
  - `grep`：`daemon.ts` `handlePresentationEvent` 含 `case "task"`
  - `grep`：thinking/tool 飞书抑制分支调用 `sendMilestoneText`（非裸 `return { ok: true }`）
  - 类型：`PresentationKind` 在 `sdk-session-types.ts` 与 `daemon.ts` 均含 `task`
  - `feishu-presentation-gate.ts` 含 `task`
- 编译：`npm run build` 或项目等价 TypeScript 检查通过
- 行数：新增 `daemon-presentation-milestone.ts` ≤300；改动文件无意外超限
- 回归声明：Claude/Codex/OpenCode 引擎文件无 diff；`STREAM_POST_INTERVAL_MS` 仍为 400

### 接口契约

- 无新增导出；产出为 `/kb-test` 可引用的 checklist 勾选状态（写入 `06-automation-test.md` 由 kb-recorder 执行，本任务仅验证）

### 验收标准

- [ ] 上述 grep 项零残留违规
- [ ] TypeScript 编译通过
- [ ] **01 验收 1–7** 与 **02·八·（二）1–6** 已在联调环境逐项勾选（或标注 blocked 原因）
- [ ] **03 Ponytail**：全变更无事件总线、无未批准依赖、无超范围 UI 改造
- [ ] 确认未修改非 Cursor SDK 引擎与 watchdog 阈值

### 依赖

- 前置任务: T5
- 后续任务: 无（完成后 `/kb-test` → `/kb-archive`）
