# daemon 域编码约定

> 入口：`src/daemon-entry.ts` → `daemon/daemon.ts`（薄组装 ≤200）+ `daemon-*` 子模块。批1：HTTP / orchestrator / presentation；批2：logging / queue / channel / slash 路由 / wire / bootstrap。

## 目录职责（批2 模块边界）

| 文件 | 负责 | 不负责 |
|------|------|--------|
| `daemon.ts` | 工厂组装、`daemonMain` 冷启动顺序 | queue/MergeBatch/channel/logging 实现体 |
| `daemon-logging.ts` | `createDaemonLogger`、2MB 轮转、stderr 同步 | 日志双写统一 |
| `daemon-queue.ts` | `createQueueController`：SSE、`pushMessage`、`ackOnReply`、组装 merge | file-queue 磁盘格式、调度并发 |
| `daemon-queue-types.ts` | MergeBatch 类型与常量 | 状态机副作用 |
| `daemon-queue-merge*.ts` | MergeBatch 状态机 / 卡渲染 / action | presentation/orchestrator 直引 |
| `daemon-channel.ts` | `createChannelRegistry`、resolve/pick/status | lark-core / wechat-manager 内部 |
| `daemon-channel-feishu.ts` | `startFeishuChannel` | 微信路径 |
| `daemon-channel-wechat.ts` | `initWeChatChannel`、群 gate 接线 | 飞书路径 |
| `daemon-slash-command-router.ts` | TTL、`handleCommand` 壳、`.fcmd` 兼容 | 斜杠产品默认模式变更 |
| `daemon-session-maps.ts` | active/message 映射、Get/DONE、routing key | presentation 出站 |
| `daemon-wire.ts` | orchestrator/presentation/http/slash deps 接线 | 业务状态机实现 |
| `daemon-bootstrap.ts` | 通道 start、HTTP listen、定时任务、lock | 组装顺序决策（在 `daemonMain`） |
| `daemon-http-utils.ts` | `readBody` / `json` / `httpJson` | 路由业务 |

| 文件 | 职责（批1 保留） |
|------|------|
| `daemon-orchestrator.ts` | `createOrchestrator` — claim 门控、Electron API 转发、组装 dispatch |
| `daemon-orchestrator-dispatch.ts` | `createOrchestratorDispatch` — 会话级 in-flight、并行 kickoff、scan 锁 |
| `daemon-orchestrator-retry.ts` | `createDispatchRetry` — attempt 计数、退避延后、耗尽 ack |
| `daemon-orchestrator-notify.ts` | `createOrchestratorNotify` — IM 失败通知 |
| `daemon-presentation-ordering.ts` | `createPresentationOrdering` — 编排入口 |
| `daemon-presentation-ordering-eligible.ts` | eligible 门控、节流、`presentation_order_violation` |
| `daemon-presentation-ordering-release.ts` | deferred assistant release 串行链 |
| `daemon-presentation-stream.ts` | `createStreamTextHandler` |
| `daemon-presentation-process-events.ts` | tool/thinking presentation-event |
| `daemon-presentation-assistant-events.ts` | assistant/task/merge_batch presentation-event |
| `daemon-presentation-handlers.ts` | `createPresentationHandlers` |
| `daemon-presentation-enqueue.ts` | 入队确认、F1/Get、排队文案 |
| `daemon-presentation-merge-preview.ts` | 合并预览卡回复编辑 |
| `daemon-presentation-types.ts` | presentation 共享类型 |
| `daemon-presentation-milestone.ts` | 里程碑 send-text 降级 |
| `daemon-http-routes.ts` | `createAdminApiHandler` |
| `daemon-http-routes-types.ts` | `HttpRoutesDeps` |
| `daemon-http-routes-orchestrator.ts` | orchestrator / merge / agent 路由簇 |
| `daemon-http-routes-send.ts` | send-text/image/file、presentation、stream-text |
| `daemon-http-routes-session.ts` | active-session、session-fallback |
| `daemon-http-routes-misc.ts` | SSE queue-events、chat-names、user-names |
| `daemon-http-workflow-signal.ts` | `POST /api/workflow-signal` |
| `daemon-session-routing.ts` | `fallbackSessionMap`；`wireSessionRoutingPersist` |
| `daemon-session-routing-persist.ts` | `session-routing.json` load/save/prune |
| `daemon-http-admin-crud.ts` | admin CRUD 入口 |
| `daemon-http-admin-content.ts` | mcp / rules / skills admin |
| `daemon-http-mcp-admin.ts` | MCP 配置合并、开关、健康探测 |
| `daemon-http-admin-io.ts` | admin 文件 IO 辅助 |
| `daemon-http-server.ts` | `startHttpServer` |
| `daemon-http-mcp.ts` | MCP Server 工厂 |
| `daemon-http-non-api-routes.ts` | `/health`、`/enqueue`、队列/通道 bind |
| `daemon-merge-action-feedback.ts` | 合并动作 IM 反馈文案 SSOT |
| `feishu-card-action.ts` | 合并卡 `card.action.trigger` |
| `wechat-group-enqueue-gate.ts` | 微信群 @ 过滤 |
| `daemon-merge-command.ts` | `/merge` 斜杠闭环 |
| `daemon-slash-executor.ts` | `executeSlashCommand` |
| `daemon-slash-mcp.ts` | `/mcp` 斜杠子命令 |
| `feishu-event-handlers.ts` / `server-admin.ts` / `daemon-scheduled-tasks.ts` / `chat-name-resolve.ts` | 既有边界锚点 |

## session-routing 持久化（`daemon-session-routing-persist.ts`）

- **纯函数导出**：禁止 Service 类；`lastTouchedAt` 由模块内 touch 旁路表维护，与传入 `Map` 键对齐。
- **触达接线**：运行期 `set*` / `clear*` 须在 `scheduleSessionRoutingPersist` **之前**对本键调用 `mark*Touched` / `clear*Touched`；禁止在 `buildSnapshot` 写盘路径全量刷新 touch。
- **冷启动解耦**：`loadSessionRoutingInto` 的 `onActiveSet` **禁止**直接传裸 `setActiveSession`；须 `setActiveSession(chatId, sessionKey, { touch: false })`（或薄回调只写 `sessionToChatMap`），禁止 load 路径 mark/schedule。
- **容错**：读盘/写盘失败不抛未捕获异常；写盘失败 `stderr` WARN（`[session-routing]` 前缀）。
- **接线**：`daemonMain` 在 `wireDaemonSubmodules` 前 `loadSessionRoutingInto`（失败 `session_routing_load_failed` WARN，空映射继续）；运行期 `setActiveSession` / `clearActiveSession` / fallback helper 末尾 `scheduleSessionRoutingPersist`；`startSessionRoutingPruneTimer` 6h `.unref()`，有剔除时 debounce 写盘；本文件不 import `daemon.ts`。

## 依赖注入规矩

- 子模块**禁止**互相 import 业务实现；跨域仅经 `daemon.ts` / `daemon-wire.ts` 注入 `*Deps`。
- 参照 `feishu-event-handlers.ts` 的 `FeishuEventHandlerDeps` 模式；禁止 `daemon-context.ts` barrel、`index.ts`。
- `scheduleAgentDispatch` 由 orchestrator 产出，queue 侧经 `scheduleAgentDispatchRef` 回调，避免 queue↔orchestrator 环引。
- `daemon-queue*` ↔ `daemon-presentation*` / `daemon-orchestrator`：**禁止**直接 import。

## import 规矩

- bridge 域：`../bridge/file-queue.js`、`../bridge/wechat-manager.js`、`../bridge/lark-core.js`
- workflow 域：`../workflow/server-workflow.js`
- shared 跨域类型：`../shared/channel-types.js`、`../shared/feishu-presentation-gate.js`、`../shared/tool-presentation.js`、`../shared/constants.js`
- 域内同目录：`./daemon-orchestrator.js`、`./daemon-orchestrator-dispatch.js`、`./daemon-logging.js`、`./daemon-queue*.js`、`./daemon-channel*.js`、`./daemon-slash-*.js`、`./daemon-session-*.js`、`./daemon-wire.js`、`./daemon-bootstrap.js`、`./daemon-http-*.js`、`./daemon-presentation-*.js`、`./daemon-merge-*.js`、`./feishu-card-action.js`、`./daemon-scheduled-tasks.js`、`./server-admin.js`、`./chat-name-resolve.js`、`./feishu-event-handlers.js`

## MCP admin HTTP（`/api/mcp`）

- **开关**：`enable`/`disable` 经 `daemon-http-mcp-admin.ts` 写 `mcp.json` `disabled`，与 Electron `toggleMcpServer` 一致。
- **健康**：`info` 经 `fetchElectronMcpStatusMap` 转发主进程 `POST /api/mcp/status-map`；失败响应须含中文 `healthError`，禁止静默成功；展示文案 SSOT 为 `src/shared/mcp-health-label.ts`（`formatMcpHealthDisplay` / `formatMcpHealthDisplayIm`），**禁止**裸「未知」。
- **manage_mcp**：`server-admin.ts` action 与 POST `/api/mcp` 一一对应。

## Orchestrator launch 名称透传

- **IM → Electron launch**：`dispatchSessionToAgent` 在 `forwardElectronAgentApi("/api/agent/launch")` **之前**须 await 解析名称；有名则 body 带 `chat_name`，无名 **omit 字段**（不传空串）。
- **解析落点**：`chat-name-resolve.ts`（仅解析函数，≤300 行）；复用与 `/api/chat-names`、`/api/user-names` 同等 Lark client 调用；**禁止**为此大拆 `daemon.ts`。
- **失败策略**：拉名异常 `log("WARN", …)`，**不阻断** launch。

## 入队正文 group_name 拼尾

- **落点**：`pushMessage` 在 `pushToFileQueue` **之前** await `resolveLaunchChatName`；有名则 `content` 末尾 append `\ngroup_name: <名称>`，无名/失败不拼、不阻断入队。
- **语义**：群聊=群名，私聊=对方显示名；解析复用 `chat-name-resolve.ts`，禁止另起拉名体系。
- **`pushMessage` 为 async**：同步回调处须 `.catch`；已在 async 路径（飞书 enqueue、`/enqueue`）则 `await`。

## 合并控制双入口观测

- 飞书合并卡按钮与 `/merge` 斜杠共用 `merge_action` 结构化日志（`grep merge_action`）；字段含 `action`、`session_key`、`ok`、`source`（`button`|`slash`）、可选 `error`。
- 500ms 同 session 同 action 进程内防抖（`feishu-card-action.ts`），仅友好提示，不改 `MergeBatch` phase 与队列 ack。

## 禁止

- 禁止 barrel `index.ts` 或 re-export shim
- 枢纽 `daemon.ts` 仅做组装（≤200）；子模块单文件 ≤300 行；超限须再切
- **未**做日志双写统一、**未**改 file-queue 磁盘语义
- 调度并发：跨 session 并行、同会话串行（见「Orchestrator 调度」）；禁止再引入跨 await 的全局 `dispatchLoopBusy`

---

## 会话进行中指示（sessionProgressMap）

- **启动**：入队确认后 `confirmEnqueueAndStartProgress` — 微信 `startProgressTyping`（4s 续期），飞书原消息 `Get` 表情。
- **停止**：统一经 `stopSessionProgress(sessionKey)` — 微信 `stopProgressTyping`（清续期 timer），并 `delete` Map 条目防泄漏。
- **微信群聊 gate**：`initWeChatChannel` 群聊入队前调用 `wechat-group-enqueue-gate.ts`；跳过打 `wechat_group_skip` INFO；私聊/斜杠/首条绑定不经 gate。
- **微信出站 track**：`POST /api/send-text` 微信成功须 `trackMessageSession`，`message_id` 以 `wxc_` 开头；调用方判 `sendText` 返回 `.ok` 而非 boolean。
- **完成路径须 stop**：带 `message_id` 的最终回复经 `ackOnReply`（已含 stop）；异常 notify 经 `/api/send-text` 传 `stop_progress: true`；`/api/stream-text` 的 `final: true`（可选 `message_id` 触发 ack）；`/api/send-image|send-file` 成功且带 `message_id` 时经 `ackOnReply`。三态进度文案（「正在启动」「Agent 处理中…」）走 send-text **不带** `message_id`/`stop_progress`，**不** stop。
- **poll Get 去重**：`sessionGetReactedIds` 按 inbound `messageId` 记录已打 Get；入队确认与 orchestrator claim 均写入，`idsNeedingPollGetReaction` 按 id 过滤，不依赖 `sessionProgressMap` 生命周期。
- **勿在 sendText 内 cancelTyping**：最终回复与流式分段用 `{ skipTyping: true }`；进行中指示仅由进度状态机 stop。

## 斜杠执行器（daemon-slash-executor）

- **SSOT**：`executeSlashCommand` 进程内即时执行并 `replyToMessage`；`handleCommand` 主路径接线（T5）。
- **`SLASH_EXEC_MODE`**：`daemon` | `dual` | `electron`；**稳态默认 `daemon`**；`getSlashExecMode()` 读 env，非法值回退 `daemon`。
- **`handleCommand` 顺序**：T8 `tryHandleMergeSlashCommand` → `electron` 仅 `pushCommandToQueue` → 否则 `executeSlashCommand` → `markSlashMessageIdExecuted` → **仅 `dual`** 双写 `.fcmd`。
- **`slashExecutedMessageIds`**：60s TTL Map；`wireDaemonSubmodules` 注入 `slashExecutorDeps`；**仅 dual** poll 经 `GET /commands/skip-check|executed-ids` 查询。
- **本地指令**：`/help`、`/status`、`/list`、`/clean` 不调 Electron；`/mcp` 走 `daemon-slash-mcp.ts`（复用 T3）。
- **Electron 依赖**：`forwardElectronCommandApi` → `POST /api/command/execute`；未就绪返回「应用未运行」类中文。
- **T8 划界**：执行器忽略 `/merge` 与 `merge_*` 前缀（double-guard）；**禁止**在 T5 改 `handleMergeBatchAction`。
- **日志**：结构化字段 `slash_exec`（command、message_id、mode、ok、source=im|menu、exec_path=skip|local|mcp|electron）。
- **子模块禁止互引环**：`daemon-slash-mcp` 不 import `daemon-slash-executor`。
- **T6 菜单与 admin**：`feishu-event-handlers` 菜单经 `handleSlashCommand`（= `handleCommand`，source=`menu`）；`POST /api/agent` stop/restart/reset 经 `forwardElectronCommandApi` 同步返回；`electron` 模式仍回滚 `.fcmd`。

## Orchestrator 调度

- **单进程闭环**：IM 入站 → 队列/合并 → `runAgentDispatchLoop` → Electron `POST /api/agent/launch|dispatch` → 展示出站。
- **并发模型**：**跨 sessionKey 并行 kickoff**（`inFlightSessions` + 短生命周期 scan 锁，不跨 `forwardElectronAgentApi` await）；**同会话串行**（MergeBatch / phase `starting`|`processing` 门控，禁止同会话双 claim）。
- **触发**：`broadcastQueueEvent` debounce 300ms；`session-agent-phase` → idle 时 `flushReadyMergeBatches`。
- **门控**：`shouldDeferDispatch` + `sessionAgentPhaseMap` 的 `starting`|`processing` 均不可 claim；合并 batch 须 `ready` 才 claim。
- **SSOT**：`POST /api/agent/launch|dispatch` 在 Daemon 暴露并转发 Electron；`GET /api/poll-message` 返回 404。
- **HTTP dispatch 失败重试对齐**：`POST /api/agent/dispatch` 失败/busy 与 `dispatchSessionToAgent`（IM launch）**共用** `handleLaunchFailure` / 同一 session `attemptBySession` Map；成功时 `clearDispatchRetryAttempt`，**不**提前 ack。
- **日志关键字**（运维区分重试中 / busy 待调度 / 已停试 / 并行 kickoff）：`dispatch_retry_scheduled`、`dispatch_retry_exhausted`、`agent_busy_requeue`、`dispatch_failed`、`dispatch_parallel`；SDK Run 错误在 Electron 侧用 `agent_failed`。
- **ack 规矩**：HTTP dispatch 失败未耗尽时**禁止** `ackMessages`；耗尽后由 `handleLaunchFailure` ack；成功最终 ack 仍仅 stream final / `ackOnReply`。
- **失败重入队接线**：`releaseClaimedMessages` 经 `OrchestratorDeps` 由 `daemon.ts` 注入；**禁止**在 orchestrator 内重复实现 rename；退避常数本地声明，**禁止** import Electron `retry-policy`。
- **拆分模式**：`daemon-orchestrator.ts` 超 300 行时按 notify 同构拆 `daemon-orchestrator-*.ts`（dispatch / retry 等），经工厂注入，禁止预建通用调度框架 / worker pool。
- **busy 重排一致性**：busy 经 `handleLaunchFailure` → `parseBusyRetryDelayMs` + `scheduleDispatchRetry`（reason=busy，日志 `agent_busy_requeue`）；未耗尽勿 ack。

## 合并预览与 Agent 阶段（daemon 内存）

- **Agent 阶段**：`sessionAgentPhaseMap` 由 electron `reportSessionAgentPhase`（`daemon-client.ts`）写入；`idle` 即 delete 条目。与 `sessionProgressMap`（流式/typing）职责分离。
- **冷启动 claimed 回收**：`initQueue` 调用 `cleanupOrphanClaimedOnColdStart`（`file-queue.ts`）将遗留 `.claimed` 还原为 `.qmsg`；全应用重启后无 live Agent，避免 F1 误报 processing。
- **F1 排队计数**：`confirmEnqueueAndStartProgress` / `buildEnqueueStatusText` 的排队数基于 `getSessionUnclaimedCount`（仅 `.qmsg`）；`phase` 缺失时默认 `idle`，不用磁盘 `.claimed` 推断 `processing`。
- **idle 补偿**：`POST /api/session-agent-phase` 转 `idle` 后刷新合并卡、`flushReadyMergeBatches`，并 **`scheduleAgentDispatch`**（processing 期间入队的 unclaimed 当时无法 claim，idle 后须重跑 dispatch）。

## 合并批次 CardKit（MergeBatch，daemon 内存）

- **状态机**：`mergeBatchBySession` 存 `MergeBatch`（phase: collecting→ready→locked→dispatched/cancelled）；`MERGE_QUIET_MS` 默认 2500，`MERGE_MIN_COUNT`=2。
- **入队**：`onMessageEnqueued` 在 `pushMessage` 写入成功后调用；≥2 条进入 collecting 并重置静默计时；`renderMergeBatchCardForSession` 单卡 PATCH（`lark-core.renderMergeBatchCard`）。
- **F1 门控**：`shouldSendEnqueueF1` — collecting 批次第 2+ 条不发逐条 F1，仅 Get 表情；单条仍 `confirmEnqueueAndStartProgress`。
- **dispatch 门控**：`shouldDeferDispatch` — collecting 静默窗口或 ready 但 Agent processing 时禁止 claim；`isMergeDispatchAllowed` 读 `sessionAgentPhaseMap`；`performClaimAndMerge` / `pollClaimMessagesForSession` 仅 ready|locked 且 M7 通过；`flushReadyMergeBatches` 在 idle 或 send_now 后广播 queue-update。
- **HTTP**：`POST /api/merge-batch/action`（send_now|edit|split）；`POST /api/orchestrator/claim-and-merge` → `{ text, message_ids[] }`。
- **编辑 fallback**：`mergeCardRegistry` 仅注册 `cardMessageId`；`tryHandleMergePreviewReply` 只认合并卡 outbound id，更新 `overrideText`。
- **清理**：`clearMergeBatchState` 在 `ackOnReply` 与 claim 后调用。
- **Presentation**：`POST /api/presentation-event` 路由 `tool`/`thinking`/`task`/`assistant`/`merge_batch`；`task` → `handleTaskPresentationEvent`；失败日志含可检索字段 `presentation_failed`。
- **飞书 Presentation 门控**：`handleToolPresentationEvent` / `handleThinkingPresentationEvent` 经 `isFeishuProcessPresentationSuppressed`。**tool 飞书抑制**：`sendMilestoneText` 降级，文案用 `formatToolMilestoneText`（读 `event.tool_shell_command` / `event.tool_task_description`，electron `extractShellPresentationFields` / `extractTaskPresentationFields` 透传；shell started 含命令摘要；task started 含 description，禁止裸 `task：已开始`；completed/failed 仍保留命令/描述字段时可见摘要）。**thinking 飞书抑制**：**零出站**——不调用 `sendMilestoneText`、不用 `thinkingBuffer` 做 IM，直接 `{ ok: true }`（Electron 仍 POST 并 `markProcessEventSeen` 置 ordering 闩；daemon 无 sent 故不 mirror `thinkingOpen`）。**呈现抑制 ≠ 不参与 ordering**（tool/task）：`sendMilestoneText` 返回 `sent === true` 且 ordering 开启时 mirror 编排字段——tool：`activeToolNames`；task：仅 `presentationProcessActive`。**Rev2：过程 idle 不再 `enqueueReleaseDeferredAssistantStream`**。CardKit 非抑制路径亦**禁止** process-idle release。assistant stream-text 与 PRESENTATION_ORDERING（与 `isStreamTextEligible` 对齐）不受影响。微信路径不变。
- **eligible 分层**：`isMainUserP2pEligible`（合并批次）⊂ `isStreamTextEligible`（+ S1.8 飞书群聊且 `allowOthers`）；`sessionChatTypeMap` 在 `pushMessage` 写入。
- **NF2**：活跃 MergeBatch 时 stream/tool/thinking 首包经 `getPresentationReplyAnchor` → `sendStreamingCardMessage` reply 到 `lastInboundMessageId`，不争用合并卡首屏。

## Presentation 时序编排（PRESENTATION_ORDERING）

- **开关**：`PRESENTATION_ORDERING` 环境变量；未设置或 `1`/`true` 为开启，`0`/`false` 关闭（回滚至先到先展示）。默认开启。
- **ordering 范围**：`presentationOrderingEnabled(sessionKey)` = 开关开启 **且** `isStreamTextEligible`（主用户私聊 + 飞书群聊 `allowOthers`）；合并批次仍仅 `isMainUserP2pEligible`。
- **编排字段**（`SessionProgressState`）：`presentationProcessActive`、`activeToolNames`、`thinkingOpen`、`deferredAssistantText`、`assistantCardReleased`、`assistantReleaseChain`、`runPresentationEpoch`。
- **规则（Rev2 end-only）**：本 Run 一旦过程活跃（tool/thinking/task；CardKit 路径或飞书里程碑 **`sendMilestoneText` 成功出站**），assistant CardKit **延迟首建**；过程未结束前 `handleStreamText` non-final 仅累积 `deferredAssistantText` 并返回 `{ deferred: true }`，**禁止** mid-run 首建。**首建仅**在 `stream-text` `final: true`（含 `presentationProcessActive` 时经 `enqueueReleaseDeferredAssistantStream`）触发；纯对话（从未过程活跃）首 delta 仍立即建卡。里程碑节流跳过（`sent === false`）**不**误置 `presentationProcessActive`。**ordering 闩锁与 Rev2 分工**：`presentationProcessActive`/`activeToolNames`/`thinkingOpen` 仍由过程事件或里程碑 sent 置位；Rev2 仅取消 process-idle release，不改闩锁置位与里程碑 `sendMilestoneText` 行为（节流 ≥3s、同文案 ≤4 次/Run 不变）。
- **release 串行化**：`releaseDeferredAssistantStreamImpl` 须经 `enqueueReleaseDeferredAssistantStream` 入 `assistantReleaseChain`（复用 Electron `streamPostChain` 模式），串行化 final 首建，避免并发双首建重复 assistant 卡；**不再**以 process-idle 为主路径 enqueue；仅 `handleStreamText` final 等收尾入口走 enqueue，不直接并发调用 impl。
- **首建占位与回滚**：`releaseDeferredAssistantStreamImpl` 异步发送前设 `assistantCardReleased = true` 占位；微信发送失败或飞书 CardKit/`sendStreamMessage` 均失败时回滚 `assistantCardReleased = false`，允许后续 release 重试。`resetPresentationOrderingFields` 清零 `assistantCardReleased` 与 `assistantReleaseChain`。
- **defer 响应**：`POST /api/stream-text` 可返回 `{ ok: true, deferred: true }`（无 `outbound_message_id`）；Electron 据此设 `presentationDeferStream`。
- **NF1**：assistant 已建卡后再首建过程卡 → WARN 日志 `presentation_order_violation`（字段：`session_key`、`stream_id`、`assistant_msg_id`、`process_kind`、`process_msg_id`、`ordering_enabled`）；不阻断出站。
- **MergeBatch 不变**：`getPresentationReplyAnchor` / `MergeBatchController` 逻辑**未改**；defer release 首建仍带 reply 锚点。

## stream-text（`/api/stream-text`）

- **ordering 飞行窗口（T-FIX-4，Rev2 保留）**：`assistantCardReleased && !outboundMessageId` 时 await `assistantReleaseChain` 再判 `isFirst`；窗口内 non-final 返回 `{ deferred: true }`，防 release 占位与并发 stream-text 双首建。
- **队列 ack**：`final: true` 且带 `message_id` 时经 `ackOnReply` 确认 `.claimed`（SDK 路径由 launch/dispatch 转发 `message_ids`，electron final flush 传末条 id）。
- **微信**：首包 `sendText` + 后续分段，逻辑不变。
- **飞书首选 CardKit**：首包 `createStreamingCardEntity` → `sendStreamingCardMessage`，`SessionProgressState` 记 `cardId`/`elementId`/`cardSequence`/`streamCardKitMode`；后续 `updateStreamingCardText`（`cardSequence` 递增）；`final: true` 时 `closeStreamingCardMode(cardSequence+1)` 再 stop/ack。
- **CardKit 降级**：创建/发卡片任一步失败 → 回退 `sendStreamMessage`（`streamPatchMode`）；流式更新失败 → `streamCardKitMode=false`，再 PATCH 或 `sendStreamSegments` 分段。
- **节流**：`streamTextThrottleMs()`（500–1500ms）对 CardKit 更新同样生效；`isFirst`/`final` 不受节流跳过。
- **工具/思考 CardKit**：`lark-core.renderToolProgressCard` / `renderThinkingCard`；`SessionProgressState.toolCards` 按 `tool_name` 分卡（并发工具各自 PATCH/关闭 streaming）；`started` 仅清该工具条目并发新卡。
