# dispatch失败重入队与ack策略 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 一、执行计划

### （一）依赖图

```text
T1（file-queue releaseClaimedMessages）
 └──→ T2（OrchestratorDeps + daemon 接线 + dispatch 失败重试/耗尽）
```

冲突文件：`daemon-orchestrator.ts` 仅 T2 写入；`file-queue.ts` 仅 T1 写入；`daemon.ts` 仅 T2 接线。无并行写同文件。

### （二）分组调度

- **第一轮**：T1（独立，可先落地释放原语）
- **第二轮**：T2（依赖 T1；编排策略 + deps 注入一并完成）

不可并行写同文件的任务对：无（T1/T2 文件集合不相交）。

## 二、任务清单

## T1: 实现 releaseClaimedMessages 重入队原语

### 背景

现网 `dispatchSessionToAgent` 失败会 `ackMessages` 删掉 `.claimed`，busy 则消息卡在 `.claimed` 无法再 claim。本任务在 `file-queue` 新增按 messageId 的「释放」能力（`.claimed→.qmsg`），供编排层失败后重入队；对照冷启动 `cleanupOrphanClaimedOnColdStart` 的 rename 模式，不改 `ackMessages` 语义以免牵连成功路径。

### 上下文文件

- CodeGraph: `cleanupOrphanClaimedOnColdStart`、`ackMessages`、`claimSessionMessages` — 定位 rename/ack 与影响面（ack 影响 `ackOnReply`/`createStreamTextHandler`，故新建释放函数）
- 必读: `src/bridge/file-queue.ts` — 实现落点；重点读 `cleanupOrphanClaimedOnColdStart`（约 L512+）与 `ackMessages`（约 L334）
- 必读: `src/bridge/AGENTS.md` — 文件队列 `.qmsg`/`.claimed` 约定
- 参考: `electron/agent/shared/retry-policy.ts` — 仅知悉退避数值来源；本任务不改、不 import

### 实现范围

- 修改: `src/bridge/file-queue.ts` — 新增并导出：
  - `releaseClaimedMessages(messageIds: string[], filterSessionKey?: string): string[]`
  - 行为：在队列目录中查找匹配 `messageId` 的 `.claimed`，`rename` 为同名 `.qmsg`；若目标 `.qmsg` 已存在则删孤儿 `.claimed`（与冷启动双份处理一致）；找不到则跳过；返回实际释放的 messageId 列表
  - 中文注释说明「失败重入队用，勿与 ack 删除混淆」
- 不改: `ackMessages` 签名与删除语义；不新增 `.failed` 扩展名；不做 file-queue 整体拆分/性能重写（本期非目标；该文件已超 300 行，本任务仅增量函数）

### 接口契约

- `export function releaseClaimedMessages(messageIds: string[], filterSessionKey?: string): string[]` — 将指定 claimed 还原为可再次 claim 的 qmsg；返回实际释放的 id
- 与 `cleanupOrphanClaimedOnColdStart(): number` 同构（rename），范围按 messageId 而非全盘 orphan

### 验收标准

- [ ] 人为将某 session 下消息置为 `.claimed` 后调用 `releaseClaimedMessages([id], sessionKey)`，磁盘文件回到 `.qmsg`，且 `getSessionUnclaimedCount` 可再次计到（覆盖 01 R2 / §6.1.1；02 八·（二）busy/释放前置）
- [ ] 对不存在的 id 调用不抛错、返回空或跳过；并发 rename 失败可忽略（与 claim 既有策略一致）
- [ ] `ackMessages` 行为未变（成功路径仍删 `.claimed`）（01 R4 / §6.1.4）
- [ ] 无新 npm 依赖、无通用 Retry/Queue 抽象层；仅本函数（Ponytail；02 八·（二））
- [ ] 关键逻辑含中文注释

### 依赖

- 前置任务: 无
- 后续任务: T2

## T2: Orchestrator 失败释放重试与耗尽 ack 接线

### 背景

在 T1 释放原语就绪后，改写 `dispatchSessionToAgent`：非 busy 失败不再立刻 ack；busy 与瞬时失败统一「release + 延后 schedule」；每 session 最多 3 次自动重试，退避 600/1200/2400ms（busy 优先 `retry_after`）；耗尽后 `notifySessionUser`（停试可感知）再 `ackMessages`，日志 `dispatch_retry_exhausted`。经 `OrchestratorDeps` 注入 `releaseClaimedMessages`，在 `daemon.ts` `wireDaemonSubmodules` 接线。

### 上下文文件

- CodeGraph: `createOrchestrator`、`dispatchSessionToAgent`、`scheduleBusyRetry`、`parseBusyRetryDelayMs`、`wireDaemonSubmodules` — 主改点与接线
- 必读: `src/daemon/daemon-orchestrator.ts` — 全文；重点 L176–231 失败/busy 分支、L123–132 `scheduleBusyRetry`、`OrchestratorDeps`
- 必读: `src/daemon/daemon.ts` — `wireDaemonSubmodules` 中 `createOrchestrator({...})` 注入段（约 L1474+）；import `releaseClaimedMessages`
- 必读: `src/bridge/file-queue.ts` — T1 已导出的 `releaseClaimedMessages` 签名
- 必读: `src/daemon/AGENTS.md` — Orchestrator 调度与 busy 重排约定
- 参考: `src/daemon/daemon-orchestrator-notify.ts` — 复用 `notifySessionUser`/`formatOrchestratorFailure`，不改出口
- 参考: `electron/agent/shared/retry-policy.ts` — 仅对齐 `BASE_BACKOFF_MS = [600,1200,2400]` 数值；**禁止** import Electron 模块

### 实现范围

- 修改: `src/daemon/daemon-orchestrator.ts`
  - `OrchestratorDeps` 增加：`releaseClaimedMessages: (messageIds: string[], sessionKey?: string) => string[]`
  - 进程内 `dispatchRetryAttemptBySession: Map<string, number>`
  - 常量：`MAX_DISPATCH_RETRIES = 3`；退避数组 `[600, 1200, 2400]`
  - 扩展或并列 `scheduleDispatchRetry(sessionKey, delayMs, reason)`：清除旧 timer、延后 `scheduleAgentDispatch`；日志含可检索关键字 `dispatch_retry_scheduled`（busy 可保留/兼容 `agent_busy_requeue`）
  - 改写 `dispatchSessionToAgent` 失败路径：
    - `result.ok`：清零该 session attempt（若有）；**不** ack、**不** release（等 final/`ackOnReply`）
    - busy（`parseBusyRetryDelayMs > 0`）或非 busy 且 attempt &lt; max：`releaseClaimedMessages(claimed.message_ids, sessionKey)` → attempt++ → 延后重调度；非 busy 默认仍每次 `notifySessionUser`（与现网一致）；**禁止**未耗尽时 `ackMessages`
    - attempt ≥ max：`notifySessionUser(..., true)`（文案可含停试语义）→ `ackMessages(lastId)` → 日志 `dispatch_retry_exhausted` → 清零 attempt
  - 删除现网「非 busy 失败 → 直接 `ackMessages`」路径
  - 若本文件将超 300 行：按现有模式拆出小模块（如 `daemon-orchestrator-retry.ts`），**仅在超限时拆**，禁止预建通用重试框架
- 修改: `src/daemon/daemon.ts`
  - import `releaseClaimedMessages`；在 `createOrchestrator({...})` 注入该函数
- 不改: 成功路径 `ackOnReply` / stream final；通知出口文件；对外 HTTP；Electron `retry-policy.ts`

### 接口契约

- `OrchestratorDeps.releaseClaimedMessages` — 与 T1 导出签名对齐
- 内部：`scheduleDispatchRetry(sessionKey: string, delayMs: number, reason: string): void`（或扩展现有 `scheduleBusyRetry` 等价能力）
- 日志关键字（运维可检索）：`dispatch_retry_scheduled`、`dispatch_retry_exhausted`；保留既有 `dispatch_failed`
- 行为表：成功不 ack；可重试 → release + 延后；耗尽 → notify 后 ack；busy 同可重试（可不发失败文案）

### 验收标准

- [ ] 人为制造一次可恢复调度失败（如 Agent API 未就绪）：消息从 `.claimed` 回到 `.qmsg`，策略窗口内无需手动重发 IM 即可再次进入 `dispatchSessionToAgent` 或仍处于可重试待办（01 §6.1.1 / R1 / R2；02 八·（二）busy 项同源）
- [ ] 调度失败后不再出现「已 ack 移除且无重试/保留痕迹」的旧行为（01 §6.1.2）
- [ ] busy：磁盘 `.claimed→.qmsg`，延时后能再次 dispatch；与 `agent_busy_requeue`/`dispatch_retry_scheduled` 可观测（02 八·（二）第 1 项；01 S1）
- [ ] 连续非 busy 失败达上限（3 次重试耗尽）后出现 `dispatch_retry_exhausted`，用户侧有停试可感知通知，之后无该 session 自动重调度轰炸（01 §6.1.3 / S2 / R3 / R6；02 八·（二）第 2 项）
- [ ] launch 成功一次后 `dispatchRetryAttemptBySession` 已清零；后续新消息重试计数独立（02 八·（二）第 3 项；01 §6.1.4 / R4 / S4）
- [ ] 成功路径不因本变更对同一任务重复领取执行轰炸（01 §6.1.4）
- [ ] 仅有失败通知、无队列恢复视为未完成——本任务必须落地 release+重试（01 §6.2.1 / R5）
- [ ] `daemon-orchestrator.ts`（及若拆出的 retry 小文件）≤300 行或已按模式拆分；关键分支有中文注释（01 §6.3.2；02 八·（二）第 4 项）
- [ ] 无 02/03 未要求的新抽象层与新依赖；不 import Electron `retry-policy`（Ponytail；02 八·（二）第 5 项；01 §6.3.1）

### 依赖

- 前置任务: T1
- 后续任务: 无
