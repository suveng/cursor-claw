# 巨型单体拆分 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **批1（本轮 kb-apply）**：T1～T7，仅自 `daemon.ts` 拆出 HTTP / orchestrator / presentation 子模块；queue / channel / logging 仍留 `daemon.ts`（批2）。
> **符号依据**：CodeGraph 未初始化（`codegraph init` 缺失）；上下文文件行号来自源码检索 + `02-design.md` §七，归档前建议补跑 CodeGraph 校验。

## 一、执行计划

### （一）依赖图

**批1（本轮 apply）**

```
T1 ──→ T2 ──→ T3 ──→ T4 ──→ T5 ──→ T6 ──→ T7
```

| 任务 | 落点文件 | 对应 02 步骤 / 流程 ID |
|------|----------|------------------------|
| T1 | `daemon.ts`（仅接口） | §六-1；P1 |
| T2 | `daemon-presentation-ordering.ts` | §六-3 前半；P4-a ordering |
| T3 | `daemon-orchestrator.ts` | §六-2；P3、P3-a～c |
| T4 | `daemon-presentation-handlers.ts` | §六-3 后半；P2-c、P4-a |
| T5 | `daemon-http-routes.ts` | §六-4 路由表 `/api/*` | P1-a |
| T6 | `daemon-http-server.ts` | §六-4 监听壳 | P1-a |
| T7 | `daemon.ts` 组装收敛 | §六-5 批1回归 | 验收 1～4 子集 |

**批2～4（deferred，本轮不 apply）**

```
T8 ──→ T11
T9 ──┘
T10 ─┘

T12（批3，独立）

T13 ──→ T15
T14 ──┘（批4，可并行拆文件，串行改 import 链）
T16（批4）
```

### （二）分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1 | — | 仅增 `DaemonContext` 与子域 deps 接口，零行为变更 |
| **第二轮** | T2 | — | **冲突**：`daemon.ts`（ordering 符号区 ~L310–636） |
| **第三轮** | T3 | — | **冲突**：`daemon.ts`（orchestrator 符号区 ~L783–1307） |
| **第四轮** | T4 | — | **冲突**：`daemon.ts`（presentation handlers ~L387–778、L1370–1915） |
| **第五轮** | T5 | — | **冲突**：`daemon.ts`（`handleAdminApi` 及 admin 子路由 ~L2823–3107、L3108–3290） |
| **第六轮** | T6 | — | **冲突**：`daemon.ts`（`startHttpServer` / MCP ~L2469–2795） |
| **第七轮** | T7 | — | `daemon.ts` 组装、`create*` 接线、批1冒烟 |
| **—** | T8～T16 | — | `status: deferred`，不在本轮 kb-apply |

**批1 无并行组**：所有任务均从同一 `daemon.ts` 搬移代码并回写 import，须严格串行。

**同文件冲突清单（须串行）**

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `src/daemon/daemon.ts` | T1 → T2 → T3 → T4 → T5 → T6 → T7 |

## 二、任务清单

---

## T1: DaemonContext 与子域 deps 接口定义

### 背景

批1 拆分前须确立子模块依赖注入契约（`02-design` §三、§四；Ponytail：禁止预建未论证的通用抽象层）。参照已有 `feishu-event-handlers.ts` 的 `FeishuEventHandlerDeps` 模式，在 `daemon.ts` 集中声明 `DaemonBootstrapContext` 及分域 `OrchestratorDeps`、`PresentationOrderingDeps`、`PresentationHandlerDeps`、`HttpRoutesDeps`、`HttpServerDeps`，**不改变任何运行时行为**。

### 上下文文件

- 必读: `knowledge/变更/进行中/20260711203953-巨型单体拆分/02-design.md` §三、§四、§六-1
- 必读: `src/daemon/feishu-event-handlers.ts` — `FeishuEventHandlerDeps`（L19–30）注入范例
- 必读: `src/daemon/daemon.ts` — 模块顶 import（L1–57）；共享 Map 声明区（`channels` L153、`sessionProgressMap` L779、`mergeBatchBySession` L838、`sessionAgentPhaseMap` L784）
- 参考: `src/daemon/AGENTS.md` — orchestrator / presentation 职责边界

### 实现范围

- 修改: `src/daemon/daemon.ts` — 新增接口与类型别名（仅声明，函数体不动）：
  - `DaemonBootstrapContext`：持有各子模块工厂所需 Map/回调引用
  - `OrchestratorDeps`：`forwardElectronAgentApi`、`performClaimAndMerge`、`flushReadyMergeBatches`、`mergeBatchBySession` 只读、`scheduleAgentDispatch` 自引用等
  - `PresentationOrderingDeps`：`sessionChatTypeMap`、`mergeBatchBySession` 只读、`log` 等
  - `PresentationHandlerDeps`：`ackOnReply`、`resolveChannel`、`channels`、`sendMilestoneText`（自 `daemon-presentation-milestone.ts`）、orchestrator `getSessionAgentPhase` 回调等
  - `HttpRoutesDeps` / `HttpServerDeps`：聚合 presentation / orchestrator / queue（仍驻 daemon）句柄
- 禁止: 新建 `daemon-context.ts` 等 02 未论证文件；禁止 barrel `index.ts`

### 可能冲突文件

- `src/daemon/daemon.ts`（本任务独占，后续 T2～T7 接续修改）

### 接口契约

- 各 `*Deps` 仅含批1 子模块**实际调用**的字段；queue/channel/logging 仍通过 deps 回调访问 `daemon.ts` 内驻留函数，**不**提前抽取 `daemon-queue.ts`
- `createOrchestrator(deps)` / `createPresentationLayer(deps)` 等工厂签名与 `02-design` §四表一致（名称可微调，语义不变）

### 验收标准

- [ ] `tsc` / `npm run build` 与拆分前行为一致（本任务仅增类型，无逻辑 diff）
- [ ] 接口覆盖 T2～T6 列出的跨模块调用点，无 `any` 逃逸 deps
- [ ] 无 02/03 未要求的中间抽象层或未批准新依赖
- [ ] ponytail 项未假装实现（`dispatchSessionAgents`、T7 统一调度、日志双写）

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: 抽出 daemon-presentation-ordering.ts

### 背景

将 Presentation 时序编排（`PRESENTATION_ORDERING`）与 eligible 门控从 `daemon.ts` 垂直切出，对应流程 P4-a ordering 子路径及 `02-design` §六-3 前半。为 T4 handlers 提供无 HTTP 耦合的纯编排函数。

### 上下文文件

- 必读: `src/daemon/daemon.ts` —
  - `SessionProgressState`（L310–362）
  - `streamTextThrottleMs`（L365–369）
  - `sessionChatTypeMap` / `rememberSessionChatType` / `resolveSessionChatType`（L371–385）
  - `presentationOrderingEnvEnabled` / `presentationOrderingEnabled`（L408–418）
  - `isPresentationProcessIdle` / `resetPresentationOrderingFields`（L420–433）
  - `isMainUserP2pEligible` / `isStreamTextEligible` / `isPresentationEligible`（L435–458）
  - `isFeishuProcessPresentationSuppressed` / `isWechatPresentationSession`（L460–470）
  - `logPresentationOrderViolation`（L502–514）
  - `releaseDeferredAssistantStreamImpl` / `enqueueReleaseDeferredAssistantStream`（L553–640）
- 必读: `src/shared/feishu-presentation-gate.js` — `feishuSuppressesProcessKind`（daemon L46–47 import）
- 必读: `src/daemon/daemon-presentation-milestone.ts` — 里程碑 sent 与 ordering 闩锁协作约定（`src/daemon/AGENTS.md`）
- 参考: `02-design.md` §一 P4-a、`§五` `SessionProgressState` 表

### 实现范围

- 新建: `src/daemon/daemon-presentation-ordering.ts`（目标 ≤300 行）
- 修改: `src/daemon/daemon.ts` — 删除已搬符号，改 import `createPresentationOrdering(deps)` 或等价导出
- 导出（示意）: `SessionProgressState`、`PresentationOrderingDeps`、`createPresentationOrdering(deps)` → ordering 函数集 + `streamTextThrottleMs`
- **不搬**: `handleStreamText`、`handlePresentationEvent` 族（归 T4）

### 可能冲突文件

- `src/daemon/daemon.ts`（与 T1 接续，T3～T7 尚未开始）

### 接口契约

- `createPresentationOrdering(deps: PresentationOrderingDeps)` 返回对象须含：`presentationOrderingEnabled`、`resetPresentationOrderingFields`、`enqueueReleaseDeferredAssistantStream`、`isStreamTextEligible`、`isMainUserP2pEligible` 等 T4 所需方法
- `SessionProgressState` 类型从此模块 export，供 handlers 引用
- 环境变量语义不变：`PRESENTATION_ORDERING`、`STREAM_TEXT_THROTTLE_MS`

### 验收标准

- [ ] `wc -l daemon-presentation-ordering.ts` ≤300
- [ ] `PRESENTATION_ORDERING=0` 时编排函数行为与搬移前一致（门控返回 false）
- [ ] 无新增用户可见配置；无 orchestrator/HTTP 直接 import ordering 模块形成环
- [ ] 对齐 `02` §八·（二）验收3 之子集：ordering 闩锁与 defer 语义未被本任务意外改动
- [ ] ponytail 未假装交付

### 依赖

- 前置任务: T1
- 后续任务: T4

---

## T3: 抽出 daemon-orchestrator.ts

### 背景

搬迁 Agent 调度闭环（dispatch loop、Electron API 转发、busy 重排、claim 门控），对应 P3、P3-a～c。queue/merge 函数仍驻 `daemon.ts`（批2），经 `OrchestratorDeps` 注入。

### 上下文文件

- 必读: `src/daemon/daemon.ts` —
  - `AgentPhase` / `sessionAgentPhaseMap` / `getSessionAgentPhase`（L783–788）
  - `shouldDeferDispatch`（L1044–1055）
  - `scheduleAgentDispatch` / `runAgentDispatchLoop`（L1125–1306）
  - `readElectronAgentApiPort` / `forwardElectronAgentApi`（L1130–1151）
  - `parseBusyRetryDelayMs` / `scheduleBusyRetry` / `busyRetryTimerBySession`（L1152–1174）
  - `extractSessionChatId` / `isSessionMainUser` / `formatOrchestratorFailure`（L1175–1196）
  - `notifySessionUser`（L1197–1206）
  - `claimForOrchestratorDispatch` / `dispatchSessionToAgent`（L1207–1293）
- 必读: `src/daemon/chat-name-resolve.ts` — `resolveLaunchChatName`（dispatch launch 名称透传，`daemon/AGENTS.md`）
- 参考: `02-design.md` §四 `createOrchestrator` 表；`§七` 符号表 orchestrator 行

### 实现范围

- 新建: `src/daemon/daemon-orchestrator.ts`（≤300 行）
- 修改: `src/daemon/daemon.ts` — 删除上述符号，保留 `performClaimAndMerge` / `onMessageEnqueued` / `pushMessage` 等 queue 逻辑
- 导出: `createOrchestrator(deps: OrchestratorDeps)` → `{ scheduleAgentDispatch, runAgentDispatchLoop, claimForOrchestratorDispatch, getSessionAgentPhase, setSessionAgentPhase, ... }`

### 可能冲突文件

- `src/daemon/daemon.ts`

### 接口契约

- `forwardElectronAgentApi` 仍 POST `http://127.0.0.1:${ELECTRON_AGENT_API_PORT}/api/agent/launch|dispatch`；body 含 `chat_name` omit 规则不变
- `agent_busy` 统一走 `parseBusyRetryDelayMs + scheduleBusyRetry`；busy 分支不提前 ack batch
- `GET /api/poll-message` 仍由 routes 返回 404（非本任务新增）

### 验收标准

- [ ] `wc -l daemon-orchestrator.ts` ≤300
- [ ] 入队后 `scheduleAgentDispatch` → `runAgentDispatchLoop` → `forwardElectronAgentApi("/api/agent/launch")` 链路可冒烟（依赖 T7 组装后实测）
- [ ] `sessionAgentPhaseMap` 与 `sessionProgressMap` 职责分离不变
- [ ] 对齐 01 验收3、02 §八·（二）dispatch 项
- [ ] 无未批准抽象层

### 依赖

- 前置任务: T1
- 后续任务: T4、T5

---

## T4: 抽出 daemon-presentation-handlers.ts

### 背景

搬迁流式出站、presentation-event 全族、入队确认（F1/Get/排队文案），对应 P2-c、P4-a。依赖 T2 ordering 与 T3 orchestrator 回调（经 deps，避免模块互引）。

### 上下文文件

- 必读: `src/daemon/daemon.ts` —
  - `resolveChannelRuntime`（L387–406）
  - `sendMilestonePlainText` / `milestoneLogFn` / `getPresentationReplyAnchor` / `logPresentationFailed`（L472–501）
  - `sendStreamSegments` / `handleStreamText`（L516–778）
  - `sessionProgressMap` / `sessionGetReactedIds`（L779–782）
  - `handleToolPresentationEvent` / `handleThinkingPresentationEvent` / `handleAssistantPresentationEvent` / `handleTaskPresentationEvent` / `handleMergeBatchPresentationEvent` / `handlePresentationEvent`（L1370–1756）
  - `tryHandleMergePreviewReply`（L1757–1817）
  - `buildEnqueueStatusText` / `getGetReactedIds` / `recordGetReactions` / `clearGetReactions`（L1818–1863）
  - `stopSessionProgress` / `confirmEnqueueAndStartProgress`（L1864–1915）
  - 相关类型 `ToolProgressCardState` / `PresentationEvent` / `PresentationKind`（L808–837）
- 必读: `src/daemon/daemon-presentation-ordering.ts`（T2 产出）— ordering 导出
- 必读: `src/daemon/daemon-presentation-milestone.ts` — `sendMilestoneText` / `clearMilestoneState`
- 必读: `src/bridge/lark-core.js` — CardKit 流式 API（`createStreamingCardEntity` 等，daemon L12 import）
- 必读: `src/shared/tool-presentation.js` — tool 里程碑文案（daemon L14 import）

### 实现范围

- 新建: `src/daemon/daemon-presentation-handlers.ts`（≤300 行；若超限按职责再拆须单独立项，批1 优先单文件）
- 修改: `src/daemon/daemon.ts` — 删除已搬符号
- 导出: `createPresentationHandlers(deps)` → `{ handleStreamText, handlePresentationEvent, confirmEnqueueAndStartProgress, stopSessionProgress, buildEnqueueStatusText, tryHandleMergePreviewReply, ... }`
- **保留独立**: `daemon-presentation-milestone.ts` 不合并

### 可能冲突文件

- `src/daemon/daemon.ts`
- `src/daemon/daemon-presentation-ordering.ts`（只读 import）

### 接口契约

- `POST /api/stream-text` 响应契约不变：含 `{ deferred: true }`、CardKit `outbound_message_id`、`final: true` ack 语义
- `POST /api/presentation-event` 路由种类不变：`tool`/`thinking`/`task`/`assistant`/`merge_batch`
- F1 排队计数基于 `getSessionUnclaimedCount`（deps 注入，实现仍在 daemon）
- 飞书抑制 thinking **零出站**；tool 里程碑降级行为不变

### 验收标准

- [ ] `wc -l daemon-presentation-handlers.ts` ≤300（或 documented 例外并附 follow-up）
- [ ] 飞书入队后 F1/Get/排队文案与拆分前一致（01 验收2 子集）
- [ ] stream-text / presentation-event 冒烟通过（01 验收3 子集）
- [ ] `presentation_order_violation` 日志字段保留（NF1）
- [ ] 无 queue ↔ presentation 模块互引（仅 deps）

### 依赖

- 前置任务: T2、T3
- 后续任务: T5

---

## T5: 抽出 daemon-http-routes.ts

### 背景

搬迁 `handleAdminApi` 及全部 `/api/*` 路由表（含 admin CRUD、`/api/stream-text`、`/api/presentation-event`、orchestrator 相关 API），对应 P1-a。非 `/api` 路径留 T6。

### 上下文文件

- 必读: `src/daemon/daemon.ts` —
  - `json` / `readBody`（L2469–2485）
  - `readTasks` 及 task CRUD 辅助（L2823 起）
  - `handleWorkspaceAdmin` / `handleAgentAdmin`（L3041–3101）
  - `ADMIN_ENTITY_ROUTES` / `ADMIN_CRUD_ROUTES`（L3103–3107 附近）
  - `handleAdminApi`（L3108–3290+）
- 必读: `src/daemon/server-admin.ts` — MCP admin 工具（routes 仅委托，不搬迁）
- 必读: T3/T4 产出 — orchestrator / presentation 句柄注入
- 参考: `02-design.md` §四 `createAdminApiHandler`

### 实现范围

- 新建: `src/daemon/daemon-http-routes.ts`（≤300 行）
- 修改: `src/daemon/daemon.ts` — 删除 `handleAdminApi` 族
- 导出: `createAdminApiHandler(deps: HttpRoutesDeps): (pathname, method, req, res) => Promise<boolean>`
- `/api/session-agent-phase` 路由体可委托 `orchestrator.setSessionAgentPhase` + daemon 内 merge 刷新回调（deps）

### 可能冲突文件

- `src/daemon/daemon.ts`

### 接口契约

- 对外 HTTP 路径与 JSON 响应形状**不变**（`02-design` §四「无对外契约变更」）
- `GET /api/status` 字段集不变；`GET /api/poll-message` → 404
- 错误响应保持 `json(res, { ok: false, error })` 语义

### 验收标准

- [ ] `wc -l daemon-http-routes.ts` ≤300
- [ ] `GET /api/status`、`POST /api/stream-text`、`POST /api/orchestrator/claim-and-merge` 路由可达（T7 后）
- [ ] 对齐 02 §八·（二）验收1、3、6（poll-message 404）
- [ ] `server-admin.ts` 未被重复搬迁

### 依赖

- 前置任务: T3、T4
- 后续任务: T6

---

## T6: 抽出 daemon-http-server.ts

### 背景

搬迁 HTTP 监听壳：`startHttpServer`、MCP `/mcp`/`/mcp-admin`、`/health`、`/queue`、通道 bind、enqueue 等非 `/api/*` 路由；lock 写入触发点仍在 `daemonMain`（T7）。

### 上下文文件

- 必读: `src/daemon/daemon.ts` —
  - `createMcpServer` / `createAdminMcpServer`（L2517–2590）
  - `startHttpServer`（L2592–2795）
  - `localDaemonUrl` / `httpJson` 等 MCP 工具回调（若与 server 同簇）
- 必读: `src/daemon/daemon-http-routes.ts`（T5 产出）— `createAdminApiHandler`
- 必读: `../workflow/server-workflow.js`、`./server-admin.js` — MCP 工具注册（daemon L56–57 import）
- 参考: `02-design.md` §四 `startHttpServer(deps)`

### 实现范围

- 新建: `src/daemon/daemon-http-server.ts`（≤300 行）
- 修改: `src/daemon/daemon.ts` — 删除 `startHttpServer` / MCP 工厂
- 导出: `startHttpServer(deps: HttpServerDeps): Promise<number>`
- 端口回退逻辑（`EADDRINUSE` → 随机端口）原样保留

### 可能冲突文件

- `src/daemon/daemon.ts`
- `src/daemon/daemon-http-routes.ts`（import handler）

### 接口契约

- 监听路径不变：`/mcp`、`/mcp-admin`、`/health`、`/status`、`/queue`、`/shutdown`、`/enqueue` 等
- 返回值为实际监听端口；`daemonMain` 仍写 lock 文件（T7）

### 验收标准

- [ ] `wc -l daemon-http-server.ts` ≤300
- [ ] 冷启动后 `/health` 返回 `status: ok`（01 验收1）
- [ ] MCP agent/admin 连接计数 `activeMcpConnections` 行为不变
- [ ] 对齐 02 §八·（二）验收1

### 依赖

- 前置任务: T5
- 后续任务: T7

---

## T7: daemon.ts 组装入口收敛与批1回归

### 背景

将 `daemonMain` 改为薄组装：按启动顺序 `createOrchestrator` → `createPresentationOrdering` → `createPresentationHandlers` → `createAdminApiHandler` → `startHttpServer`，注入 `DaemonBootstrapContext`。批1 后 `daemon.ts` 仍含 queue/channel/logging（可 >300 行，可接受）。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `daemonMain`（L3495–3591）、`writeLockFile` / `removeLockFile`（L3470–3491）
- 必读: 批1 新建五文件（T2～T6 产出）
- 必读: `knowledge/变更/进行中/20260711203953-巨型单体拆分/01-proposal.md` §七 验收 1～4
- 必读: `02-design.md` §八·（二）工程补充验收项

### 实现范围

- 修改: `src/daemon/daemon.ts` —
  - `daemonMain` 内子模块工厂调用与 deps 接线
  - 保留：queue（`pushMessage`、`MergeBatch` 全族）、channel（`startFeishuChannel`）、logging、`initQueue`、`broadcastQueueEvent` 等批2 范围
  - 信号处理 / 全局异常兜底 / `initQueue` 启动顺序不变
- 不改: `src/daemon-entry.ts`（除非 import 路径断裂）

### 可能冲突文件

- `src/daemon/daemon.ts`
- `src/daemon/daemon-*.ts`（五文件 import 回指）

### 接口契约

- 对外导出仍为 `export async function daemonMain()`（`daemon-entry.ts` 不变）
- 子模块间**禁止**循环 import；跨域调用仅经 deps

### 验收标准

- [ ] 冷启动：`daemonMain` 完成后 `/health` 与 `/api/status` 返回 ok，lock 含 `port`（验收1）
- [ ] 飞书入队 + 合并预览 + F1/Get 不回归（验收2 子集；queue 仍在 daemon）
- [ ] dispatch + stream-text / presentation 回复不回归（验收3）
- [ ] `/restart` 不回归（验收4；指令链未改）
- [ ] 批1 新建五文件各 `wc -l` ≤300
- [ ] `daemon.ts` >300 行**可接受**；须显著小于 3591
- [ ] ponytail：`dispatchSessionAgents` 仍空；T7 调度未迁移；日志双写未改
- [ ] `npm run build`（或项目等价构建）通过

### 依赖

- 前置任务: T2、T3、T4、T5、T6
- 后续任务: T8（deferred）

---

## T8: 抽出 daemon-queue.ts `status: deferred`

### 背景

批2：搬迁文件队列、MergeBatch 状态机、入队侧效应，对应 P2-a、P2-b。本轮 **不 apply**。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `initQueue`（L2090）、`pushMessage`（L2115）、`MergeBatch` 全族（L790–1108）、`ackOnReply`（L2054）、`broadcastQueueEvent`（L293）、`sseClients`
- 必读: `src/bridge/file-queue.js` — 磁盘队列 API
- 参考: `02-design.md` §六-6～7

### 实现范围

- 新建: `src/daemon/daemon-queue.ts`
- 修改: `src/daemon/daemon.ts` — 删除 queue 符号，deps 改指向 queue 模块

### 可能冲突文件

- `src/daemon/daemon.ts`、`src/daemon/daemon-orchestrator.ts`（deps 调整）

### 接口契约

- `createQueueController(deps)` → `pushMessage`、`onMessageEnqueued`、`performClaimAndMerge`、`ackOnReply`（§四表）

### 验收标准

- [ ] `wc -l daemon-queue.ts` ≤300；01 验收2、3 全量回归
- [ ] 文件队列 `.qmsg`/`.claimed` 格式不变

### 依赖

- 前置任务: T7
- 后续任务: T11

---

## T9: 抽出 daemon-feishu-channel.ts `status: deferred`

### 背景

批2：搬迁 `ChannelRuntime`、飞书/微信通道启动与 `resolveChannel`，对应 P1-b、P2。本轮 **不 apply**。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `ChannelRuntime`（L136）、`channels` Map、`startFeishuChannel`（L2236）、`initWeChatChannel`（L250）、`resolveChannel`（L1965）
- 必读: `src/daemon/feishu-event-handlers.ts` — `FeishuEventHandlerDeps`

### 实现范围

- 新建: `src/daemon/daemon-feishu-channel.ts`
- 修改: `src/daemon/daemon.ts`；接线 `feishu-event-handlers`

### 可能冲突文件

- `src/daemon/daemon.ts`、`src/daemon/feishu-event-handlers.ts`

### 接口契约

- `createChannelRegistry(deps)` → `channels`、`startFeishuChannel`、`resolveChannel`（§四表）

### 验收标准

- [ ] 飞书/微信通道冷启动与绑定不回归（01 验收1、2）

### 依赖

- 前置任务: T7
- 后续任务: T11

---

## T10: 抽出 daemon-logging.ts `status: deferred`

### 背景

批2：搬迁 `log`、`rotateLogIfNeeded`、`ensureLogDir`，对应 P1。本轮 **不 apply**。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `log`（L122）、`ensureLogDir`（L104）、`rotateLogIfNeeded`（L111）、`LOG_FILE_PATH`（L92）

### 实现范围

- 新建: `src/daemon/daemon-logging.ts`
- 修改: `src/daemon/daemon.ts` — 全域 `log` 改 deps 注入

### 可能冲突文件

- `src/daemon/daemon.ts` 及所有 `deps.log` 消费方

### 接口契约

- `createDaemonLogger()` → `{ log, ensureLogDir }`；`DAEMON_LOG_PATH` 不变

### 验收标准

- [ ] 日志轮转与双写现状不恶化（ponytail 不要求统一）

### 依赖

- 前置任务: T7
- 后续任务: T11

---

## T11: daemon.ts 瘦身至薄入口 `status: deferred`

### 背景

批2 收官：`daemon.ts` 仅留 `daemonMain`、信号处理、子模块组装，目标 ≤200 行（02 §六-9）。

### 上下文文件

- 必读: T8～T10 产出；`02-design.md` §六-9

### 实现范围

- 修改: `src/daemon/daemon.ts` 大幅删减，仅组装

### 可能冲突文件

- `src/daemon/daemon.ts`

### 接口契约

- `daemonMain` 对外签名不变

### 验收标准

- [ ] `wc -l daemon.ts` ≤200（01 验收5 对 daemon 域）

### 依赖

- 前置任务: T8、T9、T10
- 后续任务: T12

---

## T12: 拆分 electron/daemon/daemon-manager.ts `status: deferred`

### 背景

批3：按生命周期 / 状态轮询 / 通道绑定 / 指令轮询垂直切分，对应 P1、P5。本轮 **不 apply**。

### 上下文文件

- 必读: `electron/daemon/daemon-manager.ts` — `startDaemon`（L526）、`checkAndExecutePendingCommands`（L874）
- 参考: `02-design.md` §六-10

### 实现范围

- 新建: `electron/daemon/daemon-manager-*.ts`（具体切分待批3 design 细化）
- 修改: `electron/daemon/daemon-manager.ts` 瘦身为入口

### 可能冲突文件

- `electron/daemon/**`

### 接口契约

- Electron 拉起 Daemon、`/restart` 指令语义不变

### 验收标准

- [ ] 各新文件 ≤300 行；01 验收1、4

### 依赖

- 前置任务: T11
- 后续任务: T13

---

## T13: 拆分 src/bridge/lark-core.ts `status: deferred`

### 背景

批4：CardKit 渲染与流式发送分文件，对应 P4-b。本轮 **不 apply**。

### 上下文文件

- 必读: `src/bridge/lark-core.ts` — `createLarkClient`（L114）、`renderToolProgressCard` 等
- 参考: `02-design.md` §六-11

### 实现范围

- 新建: `src/bridge/lark-*.ts` 子模块（待批4 细化）
- 修改: `src/bridge/lark-core.ts` 及 daemon presentation import

### 可能冲突文件

- `src/bridge/lark-core.ts`、`src/daemon/daemon-presentation-handlers.ts`

### 接口契约

- 飞书卡片/流式出站对外行为不变

### 验收标准

- [ ] 各文件 ≤300；01 验收3

### 依赖

- 前置任务: T12
- 后续任务: T15

---

## T14: 拆分 session-dispatcher.ts `status: deferred`

### 背景

批4：launch/dispatch 逻辑分文件；**不实现** `dispatchSessionAgents` 本体（ponytail）。本轮 **不 apply**。

### 上下文文件

- 必读: `electron/session/session-dispatcher.ts` — `dispatchSessionAgents`（L480，空实现）
- 参考: `02-design.md` §六-12、§二 ponytail

### 实现范围

- 拆分文件；保留 `dispatchSessionAgents` 空实现

### 可能冲突文件

- `electron/session/session-dispatcher.ts`

### 接口契约

- `launchSessionAgent` 等现有导出不变

### 验收标准

- [ ] `dispatchSessionAgents` 仍为空；各文件 ≤300

### 依赖

- 前置任务: T12
- 后续任务: T16

---

## T15: 拆分 command-handler.ts `status: deferred`

### 背景

批4：斜杠指令处理分文件；T7 统一调度 **不迁移**（ponytail）。本轮 **不 apply**。

### 上下文文件

- 必读: `electron/scheduling/command-handler.ts`
- 参考: `02-design.md` P5-a ponytail

### 实现范围

- 垂直拆分指令处理；Electron 5s 轮询保持现状

### 可能冲突文件

- `electron/scheduling/command-handler.ts`

### 接口契约

- 斜杠指令语义不变

### 验收标准

- [ ] 各文件 ≤300；01 验收4

### 依赖

- 前置任务: T13、T14
- 后续任务: 归档知识库同步（kb-librarian）

---

## T16: 全批完成后知识库与 AGENTS.md 同步 `status: deferred`

### 背景

归档阶段更新源码锚点与模块表（`02-design` §十）。本轮 **不 apply**。

### 上下文文件

- 必读: `02-design.md` §九、§十
- 必读: `src/daemon/AGENTS.md`（删除「不拆 daemon.ts」条款）

### 实现范围

- 修改: `knowledge/业务域/Agent调度/00-README.md`、`knowledge/业务域/消息桥接/00-README.md`、`src/daemon/AGENTS.md`（归 kb-librarian）

### 可能冲突文件

- `knowledge/业务域/**`、`src/daemon/AGENTS.md`

### 接口契约

- 无代码接口变更

### 验收标准

- [ ] 知识库锚点与批1～4 最终文件路径一致

### 依赖

- 前置任务: T15
- 后续任务: 无

---

## T-FIX-01: R1 批1 超限文件垂直切分 `status: done`

### 背景

评审 R1（P0）：5 个批1 模块超过 AGENTS 300 行硬上限。按 `04-review.md` §8 建议垂直切分，对外 HTTP 路径与 JSON 响应不变。

### 实现范围

- 切分：`daemon-http-server` → `daemon-http-mcp` + `daemon-http-non-api-routes`；`daemon-http-routes` → 4 路由簇 + `daemon-http-routes-types`；`daemon-http-admin-crud` → `daemon-http-admin-io` + `daemon-http-admin-content`；`daemon-presentation-handlers` → `daemon-presentation-enqueue` + `daemon-presentation-merge-preview`；`daemon-presentation-ordering` → `daemon-presentation-ordering-eligible` + `daemon-presentation-ordering-release`
- 修复：`daemon-http-server` 重复 MCP 工厂与 `daemonPort` 未赋值
- 移除新拆文件 `@ts-nocheck`（routes/handlers 主文件保留待 T-FIX-02）

### 验收标准

- [x] 全部 `src/daemon/daemon-*.ts` `wc -l` ≤300
- [x] `npm run build:mcp` 通过
- [x] 对外 HTTP 路径与 JSON 响应形状不变

### 依赖

- 前置任务: T7
- 后续任务: T-FIX-02（R2 @ts-nocheck）
