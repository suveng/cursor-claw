# Daemon 批二拆分 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **承接**：批 1 `20260711203953` accepted_debt **R1**（queue / channel / logging）
> **现网锚点（2026-07-12）**：`src/daemon/daemon.ts` **1901 行**；`bridge/file-queue*` **禁止**本变更改内部；子模块禁止互 import，仅经枢纽 deps 注入。

## 一、执行计划

### （一）依赖图

```
T1 ──→ T2 ──→ T3 ──→ T4 ──→ T5 ──→ T6 ──→ T7
```

| 任务 | 落点 | 对应 02 §六 / 流程 ID |
|------|------|----------------------|
| T1 | `daemon-logging.ts` | §六-1；S1-a、S6 |
| T2 | `daemon-queue-types.ts` + `daemon-queue-merge*.ts` | §六-2；S2-b |
| T3 | `daemon-queue.ts` | §六-3；S2、S2-a、S6 |
| T4 | `daemon-channel*.ts` | §六-4；S1-c、S4 |
| T5 | slash / http / presentation-types 残留迁出 | §六-5；S5、S7 |
| T6 | `daemon.ts` 组装瘦身 + `AGENTS.md` | §六-6～7；S1、S3、S7 |
| T7 | 行为与结构回归 | §六-8；01 §六；02 八·（二） |

**无并行组**：T1～T6 均从同一 `daemon.ts` 搬移并回写 import/接线，须严格串行。T7 在 T6 完成后执行。

### （二）分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1 | — | 抽出 logging；冲突区 `daemon.ts` ~L147–190 |
| **第二轮** | T2 | — | 抽出 MergeBatch 簇并**本轮切分至各文件 ≤300**；冲突区 ~L411–861（及卡渲染辅助） |
| **第三轮** | T3 | — | 抽出 queue facade；冲突区 ~L380–410、~L951–1132 |
| **第四轮** | T4 | — | 抽出 channel 并**按飞书/微信再切至 ≤300**；冲突区 ~L194–379、~L862–950、~L1133–1371、~L1519–1584 |
| **第五轮** | T5 | — | 迁出 slash TTL / `handleCommand` / HTTP 辅助 / presentation 类型残片 |
| **第六轮** | T6 | — | `wireDaemonSubmodules` + `daemonMain` 目标 **≤200**；更新 `src/daemon/AGENTS.md` |
| **第七轮** | T7 | — | 全量回归；勾销批 1 R1 就绪检查 |

**同文件冲突清单（须串行）**

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `src/daemon/daemon.ts` | T1 → T2 → T3 → T4 → T5 → T6 |
| `src/daemon/daemon-slash-executor.ts` | T5（并入 slash TTL / handleCommand 壳） |
| `src/daemon/daemon-http-*.ts` / `daemon-presentation-types.ts` | T5（仅并入残留辅助/类型，禁止预建通用层） |

## 二、任务清单

<!-- 以下每条任务自包含；子 agent 执行时只读单条 T{n} + 上下文文件 -->

---

## T1: 抽出 daemon-logging.ts

### 背景

将 Daemon 文件日志（路径解析、目录确保、2MB 轮转、`log` 写入）从枢纽垂直迁出，对应 01 R3/R6 与场景 S1-a/S6。为后续 queue/channel 提供统一 `log` 注入源，且关键字字符串不得因搬迁改变。

### 上下文文件

- CodeGraph: `log` / `rotateLogIfNeeded` / `ensureLogDir` — 定位 logging 簇与调用面
- 必读: `src/daemon/daemon.ts` — logging 区（约 L147–190：`LOG_FILE_PATH` / `MAX_LOG_SIZE` / `escapeLogContentSingleLine` / `ensureLogDir` / `rotateLogIfNeeded` / `log`）
- 必读: `src/daemon/daemon-orchestrator.ts` — `OrchestratorDeps.log` 注入形态（批 1 工厂模式参考）
- 参考: `src/daemon/AGENTS.md` — 依赖注入规矩（子模块禁止互 import）
- 参考: `src/shared/format-unknown-error.ts` — 若 logging 侧已用则保持既有调用，不新增依赖

### 实现范围

- 新建: `src/daemon/daemon-logging.ts`（目标 ≪300 行）
  - 搬迁：`LOG_FILE_PATH`（读 `DAEMON_LOG_PATH` / `APP_DATA_DIR`）、`MAX_LOG_SIZE=2MB`、轮转计数、`escapeLogContentSingleLine`、`ensureLogDir`、`rotateLogIfNeeded`、`log`
  - 导出工厂：`createDaemonLogger()` → `{ log, ensureLogDir }`（名称可微调，职责不变）
- 修改: `src/daemon/daemon.ts` — 删除上述实现；`daemonMain` / 其余仍驻留符号改用工厂返回的 `log`（本任务可暂在枢纽顶层 `const { log, ensureLogDir } = createDaemonLogger()`，后续 T6 再收敛组装）
- 禁止: 改日志关键字文案；做日志双写统一；新建 barrel/`index.ts`；改 Electron stderr 回显策略

### 接口契约

- `createDaemonLogger(): { log: (level: string, ...args: unknown[]) => void; ensureLogDir: () => void }`
- `DAEMON_LOG_PATH` / `APP_DATA_DIR` 语义与搬迁前一致；轮转阈值与 2MB 阈值不变
- 日志行格式保持：`{ts} [Daemon] {level} {msg}`（换行仍用 `⏎` 标记）

### 验收标准

- [ ] `wc -l src/daemon/daemon-logging.ts` ≤300
- [ ] 枢纽内不再内嵌 `rotateLogIfNeeded` / `appendFileSync` 日志实现体
- [ ] `grep` 仍能在源码中定位既有关键字字符串（至少含后续仍写出的 `dispatch_failed` / `merge_action` / `presentation_failed` 调用点；本任务不改调用方文案）
- [ ] 冷启动后日志文件仍写入 `DAEMON_LOG_PATH`（或兜底路径）；stderr 同步写入行为不退化
- [ ] 中文注释覆盖公共导出与非显而易见分支
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准新依赖（Ponytail）
- [ ] **未**做日志双写统一（01 非目标）

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: 抽出 MergeBatch 类型与状态机（强制 ≤300 再切）

### 背景

MergeBatch 簇现约 450+ 行（类型/静默计时/入队衔接/`performClaimAndMerge`/`handleMergeBatchAction`），是 01 R1 与场景 S3 的核心。本任务将状态机从枢纽迁出，并**在本任务内一次切分到各文件 ≤300**，禁止「先单文件超限、下期再切」。

### 上下文文件

- CodeGraph: `MergeBatch` / `onMessageEnqueued` / `performClaimAndMerge` / `handleMergeBatchAction` — 合并簇边界
- 必读: `src/daemon/daemon.ts` — MergeBatch 区（约 L411–861：`MergeBatchPhase`、`MergeBatch`、`MERGE_QUIET_MS`、`mergeBatchBySession`、`mergeCardRegistry`、静默计时、`onMessageEnqueued`、`performClaimAndMerge`、`handleMergeBatchAction`、`flushReadyMergeBatches`、卡渲染/清理辅助）
- 必读: `src/daemon/daemon-merge-action-feedback.ts` — 合并动作反馈文案 SSOT（禁止改语义）
- 必读: `src/daemon/feishu-card-action.ts` — 按钮入口如何经 deps 调 `handleMergeBatchAction`
- 必读: `src/daemon/daemon-merge-command.ts` — `/merge` 斜杠如何经 deps 调 `handleMergeBatchAction`
- 参考: `src/daemon/daemon-presentation-merge-preview.ts` — 合并预览编辑与 `overrideText` 协作
- 参考: `src/bridge/lark-core.ts` — `renderMergeBatchCard` 等（只读调用约定，不改 lark-core）

### 实现范围

- 新建（**本轮必须 ≤300，超限同任务再切**）:
  - `src/daemon/daemon-queue-types.ts` — `MergeBatchPhase`、`MergeBatch`、`ClaimMergeResult` 等类型与常量（`MERGE_QUIET_MS` 默认 2500、`MERGE_MIN_COUNT` 等）
  - `src/daemon/daemon-queue-merge.ts` — 状态机核心（入队衔接、静默计时、flush、claim/merge、清理）
  - 若 `daemon-queue-merge.ts` 仍 >300：同任务新建 `daemon-queue-merge-action.ts`（或按卡渲染/动作再切），由 merge 工厂组装；**禁止 defer**
- 修改: `src/daemon/daemon.ts` — 删除已搬符号；临时经工厂或 re-export 保持编译与行为；**勿**改 `bridge/file-queue*` 内部
- 负责: MergeBatch phase 状态机、合并卡控制、`merge_action` 结构化日志字段保持
- 不负责: `pushMessage`/`initQueue`/`ackOnReply`/`sseClients`（归 T3）；file-queue 磁盘格式；presentation 出站语义

### 接口契约

- 导出（示意，名称可微调）:
  - 类型：`MergeBatch` / `MergeBatchPhase` / `ClaimMergeResult`
  - `createMergeBatchController(deps)` → `{ mergeBatchBySession, onMessageEnqueued, performClaimAndMerge, handleMergeBatchAction, flushReadyMergeBatches, clearMergeBatchState, … }`
- `deps` 至少含：`log`、`scheduleAgentDispatchRef`（或等价回调）、file-queue claim/ack/list API、presentation 确认/停进度回调、通道侧发卡/回复回调（经注入，**禁止** import `daemon-presentation-*` / `daemon-orchestrator`）
- phase 语义不变：`collecting → ready → locked → dispatched/cancelled`；`MERGE_QUIET_MS` 环境变量语义不变

### 验收标准

- [ ] 本任务新建/改动的每个 `daemon-queue-*.ts`：`wc -l` ≤300（含再切后）
- [ ] 合并卡按钮与 `/merge` 仍走同一 `handleMergeBatchAction`；`grep merge_action` 字段含 `action`/`session_key`/`ok`/`source`
- [ ] 入队后 MergeBatch 静默窗口 / `send_now` / `edit` / `split` 行为与搬迁前一致（不系统性丢消息或重复消费）
- [ ] 无 `daemon-queue-merge*` ↔ `daemon-presentation*` / `daemon-orchestrator` 直接 import（仅 deps）
- [ ] 中文注释覆盖公共导出与非显而易见分支
- [ ] 无未批准抽象层/新依赖（Ponytail）；**未**改调度并发策略
- [ ] **禁止**改 `src/bridge/file-queue*.ts` 内部实现与磁盘格式

### 依赖

- 前置任务: T1
- 后续任务: T3

---

## T3: 抽出 daemon-queue.ts facade（createQueueController）

### 背景

在 MergeBatch 已迁出后，将文件队列编排 facade（SSE、`initQueue`、`pushMessage`、`ackOnReply`、与 merge 组装）迁至 `daemon-queue.ts`，对应 01 R1/R5 与场景 S2。经 `scheduleAgentDispatchRef` 避免 queue↔orchestrator 环引。

### 上下文文件

- CodeGraph: `pushMessage` / `initQueue` / `ackOnReply` / `broadcastQueueEvent` — queue facade
- 必读: `src/daemon/daemon.ts` — SSE/`broadcastQueueEvent`（约 L380–387）；`ackOnReply` / `initQueue` / `pushMessage`（约 L951–1132）
- 必读: T2 产出的 `src/daemon/daemon-queue-merge.ts`（及 types）— 组装 `createMergeBatchController`
- 必读: `src/bridge/file-queue.ts` — **仅公共入口**（`pushToFileQueue` / `ackMessages` / `releaseClaimedMessages` / `cleanupOrphanClaimedOnColdStart` 等）；禁止改内部
- 必读: `src/daemon/chat-name-resolve.ts` — `pushMessage` 内 `group_name` 拼尾约定（`AGENTS.md`）
- 必读: `src/daemon/daemon-orchestrator.ts` — `OrchestratorDeps` 中 `performClaimAndMerge` / `flushReadyMergeBatches` 字段形态
- 参考: `src/daemon/daemon-presentation-enqueue.ts` — 入队确认/F1 经 deps 回调

### 实现范围

- 新建: `src/daemon/daemon-queue.ts`（≤300 行）
  - 搬迁：`sseClients`、`broadcastQueueEvent`、`ackOnReply`、`initQueue`、`pushMessage`
  - 组装：`createQueueController(deps)` 内创建/挂载 T2 merge controller，对外一次性暴露 queue+merge API
- 修改: `src/daemon/daemon.ts` — 删除已搬符号；临时 `const queue = createQueueController(...)` 供仍驻留的 channel/wire 使用
- 修改（仅类型/deps 指向，必要时）: `daemon-orchestrator.ts` / `daemon-presentation-handlers.ts` / 个别 `daemon-http-*.ts` — **实现引用**改指向 queue 模块导出类型或经枢纽注入的同一函数；**禁止**子模块直接 import 彼此业务实现形成环
- 不改: file-queue 磁盘语义；调度并发；presentation 出站逻辑本体

### 接口契约

- `createQueueController(deps: QueueControllerDeps)` → `{
    pushMessage, initQueue, onMessageEnqueued, performClaimAndMerge,
    handleMergeBatchAction, ackOnReply, broadcastQueueEvent,
    mergeBatchBySession, flushReadyMergeBatches, …
  }`
- `deps` 含：`log`、`scheduleAgentDispatchRef`、`resolveChannel`（可先 ref，T4 接通）、presentation 确认/停进度、`resolveLaunchChatName`、file-queue API
- `pushMessage` 保持 **async**；`group_name` 拼尾与冷启动 `cleanupOrphanClaimedOnColdStart` 语义不变
- SSE 事件名 `queue-update` 不变

### 验收标准

- [ ] `wc -l src/daemon/daemon-queue.ts` ≤300
- [ ] `/enqueue` 与 IM 入队仍写入 file-queue；冷启动 `initQueue` 回收 orphan claimed
- [ ] `ackOnReply` 仍清理 MergeBatch 并 stop 进度（与搬迁前一致）
- [ ] 无 queue ↔ presentation/orchestrator 直接 import（仅 deps / ref）
- [ ] 对齐 01 §六·6.1-2（队列与合并不退化）子集
- [ ] 中文注释；Ponytail；**未**改 file-queue 内部

### 依赖

- 前置任务: T2
- 后续任务: T4

---

## T4: 抽出 daemon-channel*（飞书/微信强制再切 ≤300）

### 背景

ChannelRuntime、飞书/微信启动绑定、`resolveChannel` 等合计约 550+ 行，对应 01 R2 与场景 S4。本任务迁出通道生命周期，并**本轮按飞书/微信垂直切分到各文件 ≤300**，禁止超限 defer。

### 上下文文件

- CodeGraph: `ChannelRuntime` / `startFeishuChannel` / `initWeChatChannel` / `resolveChannel` — channel 簇
- 必读: `src/daemon/daemon.ts` —
  - `ChannelRuntime` / `channels`（约 L194–211）及通道辅助（约 L162–329 内 channel 段）
  - `initWeChatChannel`（约 L330+）
  - `resolveChannel` / `resolveChannelRuntime`（约 L862–950、L1519+）
  - `startFeishuChannel`（约 L1133–1370 附近飞书启动体）
- 必读: `src/daemon/feishu-event-handlers.ts` — `FeishuEventHandlerDeps` / `onFeishuMenuV6` 注入范例
- 必读: `src/daemon/wechat-group-enqueue-gate.ts` — `shouldEnqueueWechatGroupMessage`（复用，不改语义）
- 必读: T3 产出 `src/daemon/daemon-queue.ts` — `pushMessage` 经 deps 注入给通道入队
- 参考: `src/bridge/wechat-manager.ts` — `WeChatManager` 启动约定（不改 bridge 大结构）
- 参考: `src/shared/channel-types.ts` — 通道配置类型

### 实现范围

- 新建（**合计超 300 则必须拆，本轮一次达标**）:
  - `src/daemon/daemon-channel.ts` — `ChannelRuntime`、`channels`、`createChannelRegistry`、`resolveChannel` / `pickChannel` / `getChannelStatusList` 等公共注册表
  - `src/daemon/daemon-channel-feishu.ts` — `startFeishuChannel` 及飞书绑定/事件接线
  - `src/daemon/daemon-channel-wechat.ts` — `initWeChatChannel` 及微信 gate 接线
- 修改: `src/daemon/daemon.ts` — 删除已搬符号；经 `createChannelRegistry(deps)` 取得 API
- `deps` 含：`log`、`pushMessage`、`handleCommand`（可先保留枢纽函数，T5 迁出后改指向）、`FeishuEventHandlerDeps` 所需回调
- 禁止: 改 lark-core 内部；改微信产品行为；新建 Channel 插件框架/通用抽象层

### 接口契约

- `createChannelRegistry(deps)` → `{
    channels, startFeishuChannel, initWeChatChannel,
    resolveChannel, pickChannel, getChannelStatusList, …
  }`
- 飞书/微信启动、断连恢复、入队回调签名与搬迁前一致
- 微信群 gate：跳过时仍打 `wechat_group_skip` INFO；私聊/斜杠/首条绑定不经 gate

### 验收标准

- [ ] 本任务新建每个 `daemon-channel*.ts`：`wc -l` ≤300
- [ ] 飞书/微信通道 bind 与消息收发路径不退化（01 §六·6.1-3）
- [ ] `resolveChannel` 返回形态满足 presentation/http 既有消费者
- [ ] 无 channel ↔ queue/presentation/orchestrator 直接 import（仅 deps）
- [ ] 中文注释；Ponytail；**未**改 Electron daemon-manager / lark-core 内部结构

### 依赖

- 前置任务: T3
- 后续任务: T5

---

## T5: 枢纽残留清理（slash / HTTP / presentation 类型）

### 背景

即便 queue/channel/logging 迁出后，枢纽仍残留 slash TTL、`handleCommand` 壳、HTTP `readBody`/`json`/lock 小工具、以及已在 `daemon-presentation-types.ts` 存在的 presentation 类型残片。若不清理，`daemon.ts` 无法达到 ≤200 组装目标（01 R4、场景 S5/S7）。

### 上下文文件

- CodeGraph: `handleCommand` / `getSlashExecMode` / `markSlashMessageIdExecuted` — slash 残留
- 必读: `src/daemon/daemon.ts` —
  - slash TTL / mode（约 L102–141：`getSlashExecMode`、`slashExecutedMessageIds`、`markSlashMessageIdExecuted`、`isSlashMessageIdExecuted`）
  - `handleCommand`（约 L1372–1413）
  - HTTP 辅助（约 L1415+：`readBody`、`json`、`httpJson`、lock 相关若仍驻留）
  - presentation 类型残片（约 L429+：`PresentationKind`/`PresentationEvent`/`ToolProgressCardState` 等与 `daemon-presentation-types.ts` 重复者）
- 必读: `src/daemon/daemon-slash-executor.ts`（现约 174 行）— 优先并入；若并入后必超 300，再建单文件（如 `daemon-slash-command-router.ts`），禁止预建通用层
- 必读: `src/daemon/daemon-presentation-types.ts` — 已有 `PresentationKind`/`PresentationEvent`，枢纽残片应删除并改 import
- 必读: `src/daemon/daemon-http-admin-io.ts` / `daemon-http-server.ts` / `daemon-http-non-api-routes.ts` — HTTP 辅助优先并入既有 http 文件（并入后各文件仍 ≤300）
- 参考: `src/daemon/daemon-merge-command.ts` — `handleCommand` 内 `/merge` 优先分支保持

### 实现范围

- 修改: `src/daemon/daemon-slash-executor.ts`（或超限时新建单文件）—
  - 迁入：`getSlashExecMode`、`slashExecutedMessageIds` TTL API、`handleCommand` 壳（顺序：`tryHandleMergeSlashCommand` → electron 仅入队 → `executeSlashCommand` → mark → dual 双写）
- 修改: 既有 `daemon-http-*.ts` — 迁入 `readBody`/`json`/lock 等仍被 http 使用的辅助
- 修改: `src/daemon/daemon-presentation-types.ts` — 仅当枢纽残片字段有缺失时补齐；删除 `daemon.ts` 内重复类型定义
- 修改: `src/daemon/daemon.ts` — 删除上述残留；更新 import / wire 注入点
- 禁止: 改斜杠产品行为与 `SLASH_EXEC_MODE` 默认 `daemon`；改调度并发；新建未论证的 context barrel

### 接口契约

- `handleCommand(text, messageId, chatId?, chatType?, source?)` 签名与语义不变；供 channel / feishu menu 注入
- `markSlashMessageIdExecuted` / `isSlashMessageIdExecuted` 仍可供 dual 模式 HTTP skip-check 路由使用
- HTTP `json(res, data, status?)` 错误形态保持 `{ ok: false, error }` 既有约定

### 验收标准

- [ ] 授权斜杠（含重启类）路径与搬迁前一致（01 §六·6.1-4 子集）
- [ ] 并入后相关文件各自 `wc -l` ≤300；若新建 slash 单文件亦 ≤300
- [ ] `daemon.ts` 不再残留大段 presentation 类型定义 / slash TTL 实现体 / HTTP 小工具实现体
- [ ] 中文注释；Ponytail；**未**改斜杠默认模式与双写统一范围外行为

### 依赖

- 前置任务: T4
- 后续任务: T6

---

## T6: 重接 wireDaemonSubmodules + daemonMain 瘦身（≤200）并更新 AGENTS.md

### 背景

将 logging/queue/channel/slash/http 工厂在枢纽内按既有启动顺序组装接线，使 `daemon.ts` 仅保留薄组装入口（目标 ≤200），对应 01 R4/R7 与场景 S1/S7，并更新工程内模块表 SSOT。

### 上下文文件

- CodeGraph: `wireDaemonSubmodules` / `daemonMain` — 组装入口
- 必读: `src/daemon/daemon.ts` — `wireDaemonSubmodules`（约 L1585+）、`daemonMain`（约 L1765+）及仍残留的 Map/组装变量
- 必读: T1～T5 产出 — `daemon-logging.ts`、`daemon-queue*.ts`、`daemon-channel*.ts`、slash/http 迁入结果
- 必读: `src/daemon/daemon-orchestrator.ts` / `daemon-presentation-handlers.ts` / `daemon-http-server.ts` / `daemon-slash-executor.ts` — 既有 `create*` 工厂签名
- 必读: `src/daemon/daemon-session-routing.ts` / `daemon-session-routing-persist.ts` — load/wire 顺序约束
- 必读: `src/daemon/AGENTS.md` — 目录职责表（本任务改为批 2 边界）

### 实现范围

- 修改: `src/daemon/daemon.ts` —
  - `daemonMain` 启动顺序保持：`createDaemonLogger` → `initQueue` → session-routing load → `wireDaemonSubmodules`（orchestrator/presentation/http/slash）→ `createChannelRegistry` 并 start 通道 → `startDaemonHttpServer` → scheduled tasks
  - 删除一切已迁出的大段实现；仅组装、信号处理、必要的共享 Map 持有（若 Map 已随模块迁出则只注入引用）
  - **硬门槛**：`wc -l src/daemon/daemon.ts` ≤ **200**
- 修改: `src/daemon/AGENTS.md` — 模块表改为批 2：标明 `daemon-logging` / `daemon-queue*` / `daemon-channel*` 负责/不负责；去掉「queue/channel/logging 仍驻 daemon.ts」
- 禁止: 改对外 HTTP 路径/MCP 工具名；改调度并发；改 file-queue；引入子模块互 import

### 接口契约

- `wireDaemonSubmodules` 继续向批 1 子模块注入同一语义 deps（`log`、`channels`、`pushMessage`、`mergeBatchBySession`、`ackOnReply`、`resolveChannel`、`handleCommand` 等），仅**实现来源**变为新模块
- 子模块之间仍禁止互 import；`scheduleAgentDispatchRef` 仍断开 queue↔orchestrator 环
- 导出 `daemonMain` 供 `src/daemon-entry.ts` 不变

### 验收标准

- [ ] `wc -l src/daemon/daemon.ts` ≤ **200**
- [ ] 本变更新建/纳入改动的各 `src/daemon/daemon-*.ts` ≤ **300**
- [ ] 无 `daemon-queue` ↔ `daemon-presentation` / `daemon-orchestrator` 直接 import（02 八·（二））
- [ ] `/health`（或等价）在组装后仍可注册；启动顺序与拆分前一致
- [ ] `src/daemon/AGENTS.md` 已反映 batch2 模块边界与「负责/不负责」
- [ ] 中文注释；Ponytail；**未**改调度并发、**未**做日志双写统一、**未**改 file-queue 磁盘语义

### 依赖

- 前置任务: T5
- 后续任务: T7

---

## T7: 行为与结构全量回归（覆盖 01 §六 + 02 八·（二））

### 背景

结构搬迁完成后做行为等价与工程门槛验收，确保 S1～S7 / R1～R7 达成，并确认批 1 R1 debt 可在 archive 勾销。本任务以验证与必要的接线修复为主，不新开功能。

### 上下文文件

- 必读: 同目录 `01-proposal.md` §六验收、场景 S1～S7
- 必读: 同目录 `02-design.md` §八·（二）工程补充验收项
- 必读: `src/daemon/daemon.ts` 及 T1～T6 新建模块 — 抽检导出与 deps 完整性
- 必读: `src/daemon/AGENTS.md` — 与实现落点一致
- 参考: 批 1 归档 `knowledge/变更/归档/20260711203953-巨型单体拆分/` — R1 debt 表述（本变更完成后可勾销）

### 实现范围

- 验证（必须执行并记录结论到本变更后续 review/summary，本任务可修接线漏洞）:
  1. 冷启动 bind；`/health` 可用
  2. 入队 → 合并卡（若启用）→ claim/dispatch → 回复
  3. 飞书/微信通道收发
  4. 授权斜杠（含重启）→ 重启后主路径仍成立
  5. `grep` 命中：`dispatch_failed`、`merge_action`、`presentation_failed`（及既有 retry/busy 关键字）
  6. `wc -l`：枢纽 ≤200；纳入范围各 `daemon-*.ts` ≤300
  7. 确认无子模块环引；未改调度并发 / 日志双写 / file-queue 内部
- 修改: 仅当回归失败时做最小接线修复（仍遵守 ≤300 / 枢纽 ≤200）；不得借回归扩大 scope

### 接口契约

- 对外 HTTP/MCP/IM 契约与拆分前一致（无新 endpoint、无改错误码形态）
- 运维检索关键字集合不缩小

### 验收标准

- [ ] 01 §六·6.1 主路径 1～4 全部通过（冷启动、队列与合并、通道、斜杠重启）
- [ ] 01 §六·6.2 可观测与结构 1～3 全部通过（关键字、枢纽仅组装、单文件 ≤300）
- [ ] 01 §六·6.3 非功能：中文注释；无无关策略默认值变更
- [ ] 02 §八·（二）全部勾选：
  - [ ] `wc -l src/daemon/daemon.ts` ≤200；相关 `daemon-*.ts` ≤300
  - [ ] 无 queue ↔ presentation/orchestrator 直接 import
  - [ ] 冷启动 `/health`；入队→合并→dispatch→回复一致
  - [ ] 授权斜杠（含重启）可用
  - [ ] `grep` 命中 `dispatch_failed` / `merge_action` / `presentation_failed`
  - [ ] 中文注释覆盖迁出模块公共导出与非显而易见分支
  - [ ] **未**改调度并发、**未**做日志双写统一、**未**改 file-queue 磁盘语义
  - [ ] 批 1 R1（queue/channel/logging 仍驻枢纽）具备勾销条件
- [ ] Ponytail：无未批准抽象层/新依赖

### 依赖

- 前置任务: T6
- 后续任务: 无
