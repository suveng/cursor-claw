# 多会话并发调度 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **硬依赖**：`20260712170438-Daemon批二拆分`（已 archived）
> **现网锚点（2026-07-12）**：`daemon-orchestrator.ts` **294** 行；`dispatchLoopBusy` 全局互斥 + `for…await dispatchSessionToAgent`；claim 仅挡 `processing`（**不含** `starting`）

## 一、执行计划

### （一）依赖图

```
T1 ──→ T2 ──→ T4
         ↘ T3 ──→ T4
```

| 任务 | 落点 | 对应 02 步骤 / 01 |
|------|------|-------------------|
| T1 | `claimForOrchestratorDispatch`：`starting`\|`processing` 均不可 claim | C1；R2/S6；**禁止 defer** |
| T2 | `runAgentDispatchLoop` / `scheduleAgentDispatch`：会话级 in-flight + 并行 kickoff；超 300 拆 dispatch | L1/L2/D1；R1/R4；S1/S2 |
| T3 | ponytail 债注释 + `src/daemon/AGENTS.md` Orchestrator 节；可选并行日志 | Obs/Debt；R6/R7 |
| T4 | S1～S6 + 02 八·（二）工程补充验收 | Retry/Ok；§六 |

**同文件冲突**：`daemon-orchestrator.ts` 仅 T1→T2（及 T2 可选新建 `daemon-orchestrator-dispatch.ts`）。T3 不改 orchestrator 实现体。

### （二）分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1 | — | starting 门控先落地，消除并发双 claim 窗口 |
| **第二轮** | T2 | — | 替换全局 busy；并行 kickoff；本轮保证 orchestrator 相关文件各 ≤300 |
| **第三轮** | T3 | — | 文档/债注释；依赖 T2 语义已定 |
| **第四轮** | T4 | — | 手工/契约回归；依赖 T1～T3 |

## 二、任务清单

<!-- 子 agent 只读单条 T{n} + 上下文文件即可开工 -->

---

## T1: claim 门控纳入 starting

### 背景

现网 `claimForOrchestratorDispatch` 仅在 phase=`processing` 时拒绝领取；成功 claim 后才 `set("starting")`。并发改造后，同 session 可能在 starting 窗口被二次 claim 导致双 launch。本任务**必须**先合入，禁止 defer。

### 上下文文件

- CodeGraph: `claimForOrchestratorDispatch` / `AgentPhase` / `dispatchSessionToAgent` — claim→starting 时序
- 必读: `src/daemon/daemon-orchestrator.ts` — `claimForOrchestratorDispatch`（约 L179–205）；`dispatchSessionToAgent` 内 `sessionAgentPhaseMap.set(..., "starting")`（约 L214）
- 参考: `src/daemon/daemon-http-routes-orchestrator.ts` — phase 校验含 `starting`（只读对齐，不改 HTTP）

### 实现范围

- 修改: `src/daemon/daemon-orchestrator.ts` — `claimForOrchestratorDispatch`：当 `getSessionAgentPhase(sessionKey)` 为 `"starting"` **或** `"processing"` 时返回 `{ ok: false }`（现网仅挡 processing）
- 禁止: 改 MergeBatch / `shouldDeferDispatch` / retry / HTTP 契约；预建门控抽象层

### 接口契约

- `claimForOrchestratorDispatch(sessionKey): { ok: true; text; message_ids } | { ok: false }` — 签名不变
- 语义：`starting` 与 `processing` 同等不可领取；其余路径（defer/merge/claim）不变

### 验收标准

- [ ] 同 session 在 `starting` 期间第二次 `claimForOrchestratorDispatch` 返回 `{ ok: false }`
- [ ] `processing` 仍不可 claim；`idle`/无 phase 且未 defer 时行为与改前一致
- [ ] 中文注释说明为何 starting 与 processing 同挡
- [ ] 无 `02`/`03` 未要求的抽象层或未批准新依赖（Ponytail）

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: 会话级 in-flight 与跨 session 并行 kickoff

### 背景

根因是全局 `dispatchLoopBusy` 且 `for…await dispatchSessionToAgent`，使会话 A 的 launch HTTP 阻塞 B 的 claim/启动。本任务改为会话级 in-flight + 短生命周期 scan 锁，对可推进会话并行 kickoff（不顺序 await launch）。

### 上下文文件

- CodeGraph: `runAgentDispatchLoop` / `scheduleAgentDispatch` / `dispatchLoopBusy` / `dispatchSessionToAgent`
- 必读: `src/daemon/daemon-orchestrator.ts` — loop（约 L260–277）、`dispatchSessionToAgent`（约 L207–258）、T1 后的 claim
- 必读: `src/daemon/daemon-orchestrator-retry.ts` — `handleLaunchFailure` 语义不改（只读）
- 参考: `src/daemon/daemon-orchestrator-notify.ts` — 工厂拆分同构参考（仅当超 300 行时）

### 实现范围

- 修改: `src/daemon/daemon-orchestrator.ts`
  - 以 `Set<sessionKey>`（或等价）替换跨 await 的全局 `dispatchLoopBusy`
  - 短生命周期 scan 锁：仅保护「枚举 + 标记 in-flight + 启动」同步段；**禁止**持锁跨越 `forwardElectronAgentApi` await
  - `runAgentDispatchLoop`：对非 in-flight、可推进会话 fire-and-forget / `Promise.allSettled` kickoff；同 session in-flight 则跳过
  - kickoff 结束（含 claim 失败快速路径）须在 finally 清理该 session 的 in-flight
  - `scheduleAgentDispatch`：签名不变；他会话 in-flight 时仍可 debounce 触发扫描并 kickoff 本轮可推进会话
- 新建（**仅当**改后 `daemon-orchestrator.ts` >300 行）：`src/daemon/daemon-orchestrator-dispatch.ts` — 仅 loop/in-flight/scan 锁，经 `createOrchestrator` 工厂注入；禁止预建通用调度框架/worker pool
- 禁止: 改 retry/ack/MergeBatch/file-queue/Electron busy 契约；引入第三方并发库

### 接口契约

- `scheduleAgentDispatch(sessionKey?: string): void` — 签名不变
- `runAgentDispatchLoop(): Promise<void>` — 语义改为「扫描并并行 kickoff 非 in-flight 会话」
- 进程内：`inFlightSessions: Set<string>`；scan 锁布尔不跨 launch await

### 验收标准

- [ ] 双独立 sessionKey 几乎同时有待办时，第二路 launch **不必**等第一路 `forwardElectronAgentApi` 返回（02 八·（二））
- [ ] 同 session in-flight / starting / processing 不会双 kickoff；他 session 仍可推进（S1/S2/R4）
- [ ] 无全局锁跨越 launch await；源码中不再用跨 await 的 `dispatchLoopBusy` 串行整轮
- [ ] `daemon-orchestrator*.ts` 各文件 ≤300 行；中文注释
- [ ] 无 `02`/`03` 未要求的抽象层或未批准新依赖（Ponytail）

### 依赖

- 前置任务: T1
- 后续任务: T3, T4

---

## T3: 可观测与 T7 债勾销（AGENTS + ponytail）

### 背景

关闭产品债 T7「单条顺序 dispatch」注释口径，并同步 `src/daemon/AGENTS.md` Orchestrator 调度节为「会话间并行、会话内串行」。可选增加可 grep 的并行日志，保留既有 retry/busy 关键字。

### 上下文文件

- 必读: `src/daemon/daemon-queue-merge-action.ts` — ponytail「单条顺序 dispatch」注释（约 L63）
- 必读: `src/daemon/AGENTS.md` — 「Orchestrator 调度」与「未改调度并发」类表述
- 参考: `src/daemon/daemon-orchestrator.ts`（T2 后）— 确认实际 in-flight/日志落点后再写 AGENTS

### 实现范围

- 修改: `src/daemon/daemon-queue-merge-action.ts` — 更新/删除「单条顺序 dispatch」ponytail 注释，改为与并行调度一致的简述（取消合并后仍由 orchestrator 按未合并路径领取）
- 修改: `src/daemon/AGENTS.md` — Orchestrator 调度：写明跨 sessionKey 并行、同会话 MergeBatch/phase 串行；去掉「未改调度并发」；若落地 `daemon-orchestrator-dispatch.ts` 则补目录表一行
- 可选修改: `daemon-orchestrator*.ts` — INFO `dispatch_parallel` / `dispatch_inflight`（实现任选其一或等价，须可 grep）；**不得**删除 `dispatch_failed` / `agent_busy_requeue` / `dispatch_retry_*`
- 禁止: 改业务域/工程平台 knowledge 正文（归 archive + librarian）

### 接口契约

- 无对外 API 变更
- 日志：既有关键字仍可检索；可选新增并行相关关键字可 grep

### 验收标准

- [ ] `daemon-queue-merge-action.ts` 无「单条顺序 dispatch」误导表述（R7）
- [ ] `AGENTS.md` 描述与 T2 实现一致：会话间并行、会话内顺序/合并门控
- [ ] `grep` 仍能定位 `dispatch_failed` / `agent_busy_requeue` / `dispatch_retry_scheduled`（或现网等价 retry 关键字）（R6）
- [ ] 无未批准新依赖（Ponytail）

### 依赖

- 前置任务: T2
- 后续任务: T4

---

## T4: 多会话并发与可靠性回归

### 背景

对照 01 §六与 02 八·（二）做手工/契约验收，确认并行体感与同会话顺序、合并卡、失败重试均不退化。

### 上下文文件

- 必读: 本变更 `01-proposal.md` §四 S1～S6、§六验收
- 必读: `02-design.md` 「八·（二）工程补充验收项」
- 参考: 归档 `20260711232817-dispatch失败重入队与ack策略` 验收矩阵（可靠性不退化）
- 参考: T1～T3 改动后的 `daemon-orchestrator*.ts`、`daemon-orchestrator-retry.ts`

### 实现范围

- 无生产代码必改；按清单执行验收并记录结论（可写入后续 `04`/`05`，本任务不强制新建测试文件）
- 若发现回归：回修落在 T1/T2 对应文件，禁止用 defer 放过 starting 门控或全局串行残留

### 接口契约

- 无

### 验收标准

- [ ] **S1**：双独立会话同时入队，可观察到并行启动（不再互相长时间阻塞）
- [ ] **S2/S4**：一会话 busy/collecting/合并卡等待时，另一会话仍可 kickoff
- [ ] **S3**：同会话短时间多条仍合并/顺序正确，无乱序双跑
- [ ] **S5**：busy/失败仍走 `handleLaunchFailure`；可见 `agent_busy_requeue` / `dispatch_retry_*` / `dispatch_failed`；不误伤他会话
- [ ] **S6**：成功路径无提前 ack；无同会话双 launch（含 starting 窗口）
- [ ] 02 八·（二）五项全部勾选通过
- [ ] `daemon-orchestrator*.ts` 各 ≤300 行

### 依赖

- 前置任务: T1, T2, T3
- 后续任务: 无
