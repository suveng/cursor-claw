# SDK 预发送上下文保护与失败文案修复 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **范围**：`electron/agent/cursor-sdk/` 内 6～7 个文件；**不改**通道 `othersWorkspaceMode` 默认策略、`sdk-run-stream.ts` 主链、飞书 CardKit 呈现；**不新增**单元测试。

## 1、执行计划

### 1.1 依赖图

```
T1 ──→ T3 ──→ T5 ──→ T6（可选）
T2 ──→ T3
T1 ──→ T4 ──→ T5
```

- **T1**（session 类型 `lastPreSend`）：无前置；为 T3/T4 数据前提。
- **T2**（ratio≥100% 强制轮转）：无前置；与 T1 可并行。
- **T3**（dispatch 快照 + `context_blocked`）：依赖 T1、T2；独占 `sdk-run-dispatch.ts`。
- **T4**（失败文案 + `notifySdkFailure` 归因）：依赖 T1；`sdk-failure-messages.ts` 与 `sdk-run-finalize.ts` 同任务串行。
- **T5**（`context_blocked` IM 收尾）：依赖 T3、T4；`agent-sdk.ts` + `sdk-run-finalize.ts` 新增 `notifyPreSendContextFailure`。
- **T6**（可选 workspaceDir WARN）：依赖 T5（与 `agent-sdk.ts` 同文件串行）；registry 函数 + launch/dispatch 入口调用。

### 1.2 分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1, T2 | 是 | 无文件冲突 |
| **第二轮** | T3, T4 | 是 | T3 占 `sdk-run-dispatch.ts`；T4 占 `sdk-failure-messages.ts` + `sdk-run-finalize.ts`（仅 `notifySdkFailure`） |
| **第三轮** | T5 | — | 依赖 T3、T4；`agent-sdk.ts` + `sdk-run-finalize.ts`（`notifyPreSendContextFailure`） |
| **第四轮** | T6 | — | 可选；依赖 T5 后再改 `agent-sdk.ts` |

**推荐串行顺序**：T1 ∥ T2 → T3 ∥ T4 → T5 → T6（可选）

**同文件冲突表**

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `electron/agent/cursor-sdk/sdk-session-types.ts` | T1 |
| `electron/agent/cursor-sdk/context-rotation-lite.ts` | T2 |
| `electron/agent/cursor-sdk/sdk-run-dispatch.ts` | T3 |
| `electron/agent/cursor-sdk/sdk-failure-messages.ts` | T4 |
| `electron/agent/cursor-sdk/sdk-run-finalize.ts` | T4（`notifySdkFailure`）→ T5（`notifyPreSendContextFailure`） |
| `electron/agent/cursor-sdk/agent-sdk.ts` | T5 → T6（可选） |
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | T6（可选） |

## 2、任务清单

---

## T1: SdkSessionAgent 增加 lastPreSend 快照字段

### 背景

轮转成功后会清零 `contextUsagePeakTokens`，导致 Run 失败时无法归因「发送前已超限」。本任务在会话 SSOT 类型上增加 `lastPreSendUsedTokens` / `lastPreSendUsageRatio` 两个可选字段，供 T3 写入、T4 失败归因读取；对应设计 S4、02 §五。

### 上下文文件

- CodeGraph: `SdkSessionAgent` — 定位会话状态 SSOT 与引用方
- 必读: `electron/agent/cursor-sdk/sdk-session-types.ts` — `SdkSessionAgent` 接口全貌（L9–97）
- 必读: `knowledge/变更/进行中/20260705230806-SDK预发送上下文保护与失败文案修复/02-design.md` — §五 数据结构、`lastPreSend` 语义
- 参考: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` L59–110 — `maybeRotateSessionForPressure` 将写入快照
- 参考: `electron/agent/cursor-sdk/context-usage-pressure.ts` — `evaluatePreSendContextPressureCore` ratio 计算

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-session-types.ts` — 在 `SdkSessionAgent` 内 `contextLimitTokens` 附近（或上下文相关字段区）新增：
  - `lastPreSendUsedTokens?: number` — send 前最后一次压力评估 used tokens
  - `lastPreSendUsageRatio?: number` — used/limit，可 >1
  - 中文 JSDoc：说明「轮转清零 peak 后仍供失败归因；每次 dispatch pre-send 覆盖」

### 接口契约

- `SdkSessionAgent.lastPreSendUsedTokens?: number` — T3/T4 读写
- `SdkSessionAgent.lastPreSendUsageRatio?: number` — T3/T4 读写；≥1 表示 ≥100% 占用

### 验收标准

- [ ] `SdkSessionAgent` 含上述两字段，TypeScript 编译通过，现有构造/赋值处无需改行为（可选字段）
- [ ] 字段注释与 02 §五 语义一致（不清零策略：保留至下次 pre-send 覆盖）
- [ ] 覆盖 **01 验收 1、3** 的数据前提（pre-send 快照可跨轮转保留）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: 无
- 后续任务: T3, T4

---

## T2: context-rotation-lite ratio≥1.0 强制首轮轮转

### 背景

现网 `maybeRotateContext` 需 ratio≥90% **且连续命中 2 次** 才轮转，故障样本占用 361%～969% 时首次 send 仍直接进入 `agent.send`，造成 3～7 秒无反馈后通用失败。本任务在 ratio≥`FULL_ROTATION_RATIO`（1.0）时跳过 `ROTATION_HITS` 并 bypass 冷却，单次即 `rotated: true`；ratio∈[0.9,1.0) 保留现网 2 次规则。对应设计 S5、02 §六 步骤 2。

### 上下文文件

- CodeGraph: `maybeRotateContext` — 轮转决策入口与调用方
- 必读: `electron/agent/cursor-sdk/context-rotation-lite.ts` — 现网 `ROTATION_RATIO`/`ROTATION_HITS`/冷却逻辑（L22–56）
- 必读: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` L59–66 — `maybeRotateSessionForPressure` 传入 `usageRatio`
- 参考: `knowledge/变更/进行中/20260705230806-SDK预发送上下文保护与失败文案修复/02-design.md` — §五 常量、`§六` 步骤 2
- 参考: `crash_log/20260705225838～20260705230040` — 高压 ratio 回归基准（手动）

### 实现范围

- 修改: `electron/agent/cursor-sdk/context-rotation-lite.ts` —
  - 新增 `const FULL_ROTATION_RATIO = 1.0`
  - `maybeRotateContext`：当 `usageRatio >= FULL_ROTATION_RATIO` 时，将 `highPressureHits` 视为已满足（或直接跳过 hits 检查），且 **bypass** `ROTATION_COOLDOWN_MS`（`cooldownRemain > 0` 不阻断）
  - `usageRatio < ROTATION_RATIO`（0.9）时行为与现网一致（清零 hits、不轮转）
  - `usageRatio ∈ [0.9, 1.0)` 时保留 2 次命中 + 冷却逻辑

### 接口契约

- `FULL_ROTATION_RATIO = 1.0` — 模块内常量，不导出亦可
- `maybeRotateContext(input)` — 返回值 `ContextRotationDecision` 不变；ratio≥1.0 且未在冷却 bypass 场景外时，首次调用即可 `rotated: true`

### 验收标准

- [ ] ratio=150%（或 ≥100%）首次调用 `maybeRotateContext` 返回 `rotated: true`（无二次命中要求）
- [ ] ratio≥1.0 时冷却窗口内仍可轮转（bypass 冷却）
- [ ] ratio=95% 首次调用仍 `rotated: false`；连续 2 次 95% 后且冷却外才 `rotated: true`（现网行为保留）
- [ ] 覆盖 **01 验收 2**（超限快响应：轮转路径不再等待第二次命中）
- [ ] 覆盖 **02·八·（二）** ratio=150% 场景下日志可见 pre-send 后尽快进入轮转或阻断（与 T3 联调）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: 无
- 后续任务: T3

---

## T3: sdk-run-dispatch 预发送快照写入与 context_blocked 阻断

### 背景

`evaluatePreSendContextPressure` 现仅打日志不持久化用量；`sendWithRetry` 在高压轮转失败后仍调用 `agent.send` 导致慢失败。本任务在 `maybeRotateSessionForPressure` 内评估后写入 session `lastPreSend*` 快照，并在 attempt===1 后若 `ratio >= 1.0 && !rotated` 直接返回 `finalReason: "context_blocked"` 且不进入 `agent.send`。对应设计 S4、S6、02 §六 步骤 1、3。

### 上下文文件

- CodeGraph: `sendWithRetry` `maybeRotateSessionForPressure` — dispatch 主链
- 必读: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` — 全文（L59–150 为核心）
- 必读: `electron/agent/cursor-sdk/context-usage.ts` — `evaluatePreSendContextPressure`（L235–242）
- 必读: `electron/agent/cursor-sdk/context-usage-pressure.ts` — `evaluatePreSendContextPressureCore` 返回 `used`/`ratio`
- 参考: `electron/agent/cursor-sdk/agent-sdk.ts` L189–201、L247–256 — `!sendResult.run` 清理路径（T5 将补 notify）
- 参考: `knowledge/变更/进行中/20260705230806-SDK预发送上下文保护与失败文案修复/02-design.md` — §四 `sendWithRetry` 返回值扩展

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` —
  - `maybeRotateSessionForPressure`：`evaluatePreSendContextPressure` 之后赋值 `session.lastPreSendUsedTokens`、`session.lastPreSendUsageRatio`（来自 pressure 结果；每次 dispatch 覆盖）
  - `sendWithRetry`：attempt===1 完成 `maybeRotateSessionForPressure` 后，读取 pressure ratio（可复用评估结果或再读 session.lastPreSendUsageRatio），若 `ratio >= 1.0 && !rotated`，**立即** `return { attempts: 1, finalReason: "context_blocked", rotated: false }`，不调用 `session.agent.send`
  - 保持 `rotated: true` 时仍进入 send（换新后继续处理路径）

### 接口契约

- `sendWithRetry` 返回值扩展：`finalReason` 可能为 `"context_blocked"`（字符串字面量，与 `"agent_busy"` 并列）
- `session.lastPreSendUsedTokens` / `session.lastPreSendUsageRatio` — 每次 pre-send 由本任务写入

### 验收标准

- [ ] 每次 `maybeRotateSessionForPressure` 执行后 session 含最新 `lastPreSend*`（与 `[compression] pre-send usage` 日志一致）
- [ ] ratio≥100% 且轮转未成功（`!rotated`）时 `sendWithRetry` 不调用 `agent.send`，返回 `finalReason: "context_blocked"`
- [ ] ratio≥100% 且轮转成功时正常 `agent.send`，`rotated: true`
- [ ] 覆盖 **01 验收 2**（阻断路径无 3s+ send 等待）
- [ ] 覆盖 **02·八·（二）** `context_blocked` 路径与 `launch`/`dispatch` 的 `!sendResult.run` 清理兼容（notify 由 T5 完成，本任务确保 finalReason 正确）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T1, T2
- 后续任务: T5

---

## T4: sdk-failure-messages 与 notifySdkFailure 失败归因

### 背景

`notifySdkFailure` 仅用 peak/limit 组装文案；轮转后 peak 清零导致落入「建议精简输入」兜底。本任务扩展 `SdkFailureContext` 与 `formatUserSdkFailureMessage`，在 peak 路径之后、BUSY 之前增加 `isContextExhaustedByPreSend`；`notifySdkFailure` 从 session 传入 `preSendUsedTokens`/`preSendUsageRatio`。对应设计 S8、S9、02 §五、§六 步骤 5。

### 上下文文件

- CodeGraph: `formatUserSdkFailureMessage` `notifySdkFailure` — 失败文案链
- 必读: `electron/agent/cursor-sdk/sdk-failure-messages.ts` — `SdkFailureContext`、`formatUserSdkFailureMessage`（L7–142）
- 必读: `electron/agent/cursor-sdk/sdk-run-finalize.ts` — `notifySdkFailure`（L58–98）、`formatSdkStreamFailure`
- 参考: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` L106–107 — 轮转后 peak 清零原因
- 参考: `knowledge/变更/进行中/20260705230806-SDK预发送上下文保护与失败文案修复/01-proposal.md` — 验收 1、3；场景 C
- 参考: `knowledge/变更/进行中/20260705230806-SDK预发送上下文保护与失败文案修复/02-design.md` — §五 `isContextExhaustedByPreSend` 伪代码

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-failure-messages.ts` —
  - `SdkFailureContext` 新增 `preSendUsedTokens?: number`、`preSendUsageRatio?: number`
  - 新增 `isContextExhaustedByPreSend(ctx)`（私有函数）：`preSendUsageRatio >= CONTEXT_EXHAUSTED_RATIO`（0.95）或 `preSendUsedTokens/contextLimit >= 0.95`
  - `formatUserSdkFailureMessage`：在现有 `isContextExhaustedByUsage` 分支之后、BUSY 之前，若 `isContextExhaustedByPreSend(ctx)` 为 true，返回现网上下文已满句：`⚠️ 上下文窗口已接近或达到上限，请精简需求或开启新话题后重新发送。`
- 修改: `electron/agent/cursor-sdk/sdk-run-finalize.ts` —
  - `formatSdkStreamFailure` / `notifySdkFailure` 组装 ctx 时传入 `session.lastPreSendUsedTokens`、`session.lastPreSendUsageRatio`
  - **本任务不新增** `notifyPreSendContextFailure`（归 T5）

### 接口契约

- `SdkFailureContext.preSendUsedTokens?` / `preSendUsageRatio?` — T5 `notifyPreSendContextFailure` 可复用同一文案器
- `formatUserSdkFailureMessage(ctx)` — peak 为零时仍可通过 pre-send 判定上下文已满

### 验收标准

- [ ] 轮转成功后 Run 再失败：IM 正文含「上下文窗口已接近或达到上限」，**不出现**仅「建议精简输入后重新发送」兜底（**01 验收 1、3**）
- [ ] pre-send ratio≥95%（或 used/limit≥95%）且 peak 已清零时，文案走上下文已满分支
- [ ] 实际上下文未超限且失败为其他类型时，仍可走 BUSY/兜底等既有分支（**01 验收 1** 负例）
- [ ] 覆盖 **02·八·（二）** 轮转成功后再失败 IM 文案与 footer 行为（footer 可显示换新后低占用，正文不误报）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T1
- 后续任务: T5

---

## T5: agent-sdk context_blocked 收尾与即时 IM

### 背景

T3 返回 `context_blocked` 后，`launchSdkAgent` / `dispatchToSdkAgent` 现仅清理 session 并返回 error，**无**用户 IM。本任务在 `sdk-run-finalize.ts` 新增薄封装 `notifyPreSendContextFailure(session)`，并在 `agent-sdk.ts` 两处 `!sendResult.run && finalReason === "context_blocked"` 分支调用，确保 launch 与 dispatch 均能收到上下文已满提示且 `errorNotified` 不重复。对应设计 S6 阻断 notify、02 §六 步骤 4。

### 上下文文件

- CodeGraph: `launchSdkAgent` `dispatchToSdkAgent` — launch/dispatch 失败清理链
- 必读: `electron/agent/cursor-sdk/agent-sdk.ts` — L179–201（launch）、L243–256（dispatch）`!sendResult.run` 分支
- 必读: `electron/agent/cursor-sdk/sdk-run-finalize.ts` — `notifySdkFailure`、`notifySessionChat` 模式
- 必读: `electron/agent/cursor-sdk/sdk-failure-messages.ts` — T4 完成的 `formatUserSdkFailureMessage` + pre-send 字段
- 参考: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` — `context_blocked` 返回值语义（T3）
- 参考: `knowledge/变更/进行中/20260705230806-SDK预发送上下文保护与失败文案修复/02-design.md` — §四 `notifyPreSendContextFailure`

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-run-finalize.ts` —
  - 新增 `export async function notifyPreSendContextFailure(session: SdkSessionAgent): Promise<void>`
  - 若 `session.errorNotified` 或 aborted 则 return（与 `notifySdkFailure` 一致）
  - 置 `session.errorNotified = true`
  - 调用 `formatUserSdkFailureMessage` 传入 `preSendUsedTokens/Ratio`、`contextLimit`、`isTimeoutFailure: false` 等，组装上下文已满文案；可选 `appendContextFooter`（与 `notifySdkFailure` 对齐）
  - `notifySessionChat(session.sessionKey, text, true)`（`stop_progress: true`）
- 修改: `electron/agent/cursor-sdk/agent-sdk.ts` —
  - `launchSdkAgent`：`!sendResult.run` 且 `sendResult.finalReason === "context_blocked"` 时，在删 session **前** `await notifyPreSendContextFailure(session)`（注意 launch 路径会 close+delete session，须在删除前 notify）
  - `dispatchToSdkAgent`：同条件调用 `notifyPreSendContextFailure`（resident 会话保留，仅清 guard/pendingDispatch）
  - 改动控制在 ≤10 行级增量；文件总行数仍 ≤300

### 接口契约

- `notifyPreSendContextFailure(session: SdkSessionAgent): Promise<void>` — T5 对外导出；复用 T4 文案器，无新 notifier 类
- `agent-sdk.ts` — 识别 `finalReason === "context_blocked"` 字符串

### 验收标准

- [ ] **launch** 路径 ratio≥100% 轮转失败：用户收到含「上下文」语义的 IM，无 3s+ send 等待（**01 验收 1、2**）
- [ ] **dispatch** 路径同上（**02·八·（二）** `launch` 与 `dispatch` 均能收到 IM）
- [ ] `errorNotified` 不与其他 notify 路径重复发送
- [ ] `agent-sdk.ts` 修改后仍 ≤300 行（**02·八·（二）**）
- [ ] 覆盖 **01 验收 4**（各群独立：仅本会话 context_blocked 时本会话收到提示）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T3, T4
- 后续任务: T6（可选）

---

## T6（可选）: sdk-session-registry 共享 workspaceDir WARN

### 背景

多飞书群若被配置为共用同一 `workspaceDir`，排查多群并发失败时易误判为会话串扰。本可选任务在 launch/dispatch 入口统计 `sdkSessions` 同目录活跃会话数，>1 时输出 WARN 日志（模块级 Set 去重，每 workspaceDir 每进程至多 1 条），不改变用户可见行为。对应设计 S10、01 F4、验收 5。

### 上下文文件

- CodeGraph: `sdkSessions` `launchSdkAgent` — 会话注册表与入口
- 必读: `electron/agent/cursor-sdk/sdk-session-registry.ts` — `sdkSessions` Map、现有工具函数
- 必读: `electron/agent/cursor-sdk/agent-sdk.ts` — `launchSdkAgent` / `dispatchToSdkAgent` 入口（T5 之后改）
- 参考: `knowledge/变更/进行中/20260705230806-SDK预发送上下文保护与失败文案修复/01-proposal.md` — 场景 D、验收 5
- 参考: `knowledge/变更/进行中/20260705230806-SDK预发送上下文保护与失败文案修复/02-design.md` — §六 步骤 6

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-session-registry.ts` —
  - 模块级 `const warnedWorkspaceDirs = new Set<string>()`
  - 新增 `export function warnIfSharedWorkspaceDir(workspaceDir: string | undefined, sessionKey: string): void`
  - 无 `workspaceDir` 则 return；遍历 `sdkSessions` 统计同 `workspaceDir` 且未 aborted 的会话数；若 >1 且目录未在 Set 中， `pushUiLog("SDK", "WARN", ...)` 含 `workspaceDir`、计数、`sessionKey` 样本，并 `Set.add(workspaceDir)`
- 修改: `electron/agent/cursor-sdk/agent-sdk.ts` —
  - `launchSdkAgent` 创建 session 后、`resolveContextLimitForSession` 前或后调用 `warnIfSharedWorkspaceDir(session.workspaceDir, sessionKey)`
  - `dispatchToSdkAgent` 在 `resolveContextLimitForSession` 前调用（传入 `session.workspaceDir`）

### 接口契约

- `warnIfSharedWorkspaceDir(workspaceDir?: string, sessionKey: string): void` — 副作用仅 UI 日志，无 IM

### 验收标准

- [ ] 两及以上活跃 session 共用同一 `workspaceDir` 时，日志可检索 WARN（每目录每进程至多 1 条）（**01 验收 5**，若纳入实现）
- [ ] 单 session 或不同目录无 WARN
- [ ] 用户可见 IM/行为与现网一致（**01 验收 6**）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（**Ponytail**）

### 依赖

- 前置任务: T5（`agent-sdk.ts` 串行）
- 后续任务: 无
