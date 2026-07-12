# daemon 域编码约定

> 入口：`src/daemon-entry.ts` → `daemon/daemon.ts`（薄组装）+ `daemon-*` 子模块。批1 已拆 HTTP / orchestrator / presentation；queue / channel / logging 仍驻 `daemon.ts`（批2）。

## 目录职责（批1 模块边界）

| 文件 | 职责 |
|------|------|
| `daemon.ts` | 组装入口、`wireDaemonSubmodules`、queue/MergeBatch/channel/logging |
| `daemon-orchestrator.ts` | `createOrchestrator` — dispatch loop、Electron API 转发、claim 门控 |
| `daemon-orchestrator-retry.ts` | `createDispatchRetry` — attempt 计数、退避延后、耗尽 ack（超 300 行时从 orchestrator 拆出） |
| `daemon-orchestrator-notify.ts` | `createOrchestratorNotify` — IM 失败通知 |
| `daemon-presentation-ordering.ts` | `createPresentationOrdering` — 编排入口（eligible + release 组装） |
| `daemon-presentation-ordering-eligible.ts` | eligible 门控、节流、`presentation_order_violation` 日志 |
| `daemon-presentation-ordering-release.ts` | deferred assistant release 串行链 |
| `daemon-presentation-stream.ts` | `createStreamTextHandler` — `/api/stream-text` |
| `daemon-presentation-process-events.ts` | tool/thinking presentation-event |
| `daemon-presentation-assistant-events.ts` | assistant/task/merge_batch presentation-event |
| `daemon-presentation-handlers.ts` | `createPresentationHandlers` — 工厂壳层 |
| `daemon-presentation-enqueue.ts` | 入队确认、F1/Get、排队文案 |
| `daemon-presentation-merge-preview.ts` | 合并预览卡回复编辑 |
| `daemon-presentation-types.ts` | presentation 共享类型（避免 handlers/events 环引） |
| `daemon-presentation-milestone.ts` | 里程碑 send-text 降级（已有） |
| `daemon-http-routes.ts` | `createAdminApiHandler` — `/api/*` 分发入口 |
| `daemon-http-routes-types.ts` | `HttpRoutesDeps`（routes 子模块共享，防环引） |
| `daemon-http-routes-orchestrator.ts` | orchestrator / merge / agent launch|dispatch 路由簇 |
| `daemon-http-routes-send.ts` | send-text/image/file、presentation、stream-text |
| `daemon-http-routes-session.ts` | active-session、session-fallback 等 |
| `daemon-http-routes-misc.ts` | SSE queue-events、chat-names、user-names |
| `daemon-session-routing.ts` | `fallbackSessionMap` — 临时会话回退栈 SSOT（与 `activeSessionMap` 并列） |
| `daemon-http-admin-crud.ts` | admin CRUD 入口（tasks + workspace/agent entity） |
| `daemon-http-admin-content.ts` | mcp / rules / skills admin 子路由 |
| `daemon-http-mcp-admin.ts` | MCP 配置合并、开关、健康探测转发（供 admin-content） |
| `daemon-http-admin-io.ts` | admin 文件 IO 辅助、`AdminRouteHandler` 类型 |
| `daemon-http-server.ts` | `startHttpServer` — 监听壳 |
| `daemon-http-mcp.ts` | MCP Server 工厂（agent + admin） |
| `daemon-http-non-api-routes.ts` | `/health`、`/enqueue`、队列/通道 bind 等非 `/api` |
| `daemon-merge-action-feedback.ts` | 合并动作 IM 反馈文案 SSOT（纯函数，禁止 import daemon/bridge） |
| `feishu-card-action.ts` | `onFeishuCardAction` — 合并卡 `card.action.trigger` 路由（Deps 注入，≤300 行） |
| `daemon-merge-command.ts` | `tryHandleMergeSlashCommand` — `/merge` 斜杠 Daemon 内闭环（不写 `.fcmd`） |
| `daemon-http-mcp-admin.ts` | MCP 配置读写、开关与健康探测（admin 与斜杠共用） |
| `daemon-slash-executor.ts` | `executeSlashCommand` — IM 斜杠 SSOT（T5 接线） |
| `daemon-slash-mcp.ts` | `/mcp` 斜杠子命令（复用 `daemon-http-mcp-admin`） |
| `feishu-event-handlers.ts` / `feishu-card-action.ts` / `server-admin.ts` / `daemon-scheduled-tasks.ts` / `chat-name-resolve.ts` | 飞书事件与合并卡按钮回调；其余为已有边界锚点 |

## 依赖注入规矩（批1）

- 子模块**禁止**互相 import；跨域仅经 `daemon.ts` 内 `wireDaemonSubmodules` 注入 `*Deps`。
- 参照 `feishu-event-handlers.ts` 的 `FeishuEventHandlerDeps` 模式；禁止 `daemon-context.ts` barrel、`index.ts`。
- `scheduleAgentDispatch` 由 orchestrator 产出，queue 侧经 `scheduleAgentDispatchRef` 回调，避免 queue↔orchestrator 环引。

## import 规矩

- bridge 域：`../bridge/file-queue.js`、`../bridge/wechat-manager.js`、`../bridge/lark-core.js`
- workflow 域：`../workflow/server-workflow.js`
- shared 跨域类型：`../shared/channel-types.js`、`../shared/feishu-presentation-gate.js`、`../shared/tool-presentation.js`、`../shared/constants.js`
- 域内同目录：`./daemon-orchestrator.js`、`./daemon-slash-executor.js`、`./daemon-slash-mcp.js`、`./daemon-presentation-*.js`、`./daemon-http-*.js`、`./daemon-session-routing.js`、`./daemon-presentation-milestone.js`、`./daemon-merge-action-feedback.js`、`./daemon-merge-command.js`、`./feishu-card-action.js`、`./daemon-scheduled-tasks.js`、`./server-admin.js`、`./chat-name-resolve.js`、`./feishu-event-handlers.js`

## MCP admin HTTP（`/api/mcp`）

- **开关**：`enable`/`disable` 经 `daemon-http-mcp-admin.ts` 写 `mcp.json` `disabled`，与 Electron `toggleMcpServer` 一致。
- **健康**：`info` 经 `fetchElectronMcpStatusMap` 转发主进程 `POST /api/mcp/status-map`；失败响应须含中文 `healthError`，禁止静默成功。
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
- 枢纽 `daemon.ts` 仅做组装与批2 域（queue/channel/logging）；子模块单文件目标 ≤300 行，超限须再切或批2 跟进

---

## 会话进行中指示（sessionProgressMap）

- **启动**：入队确认后 `confirmEnqueueAndStartProgress` — 微信 `startProgressTyping`，飞书原消息 `Get` 表情。
- **停止**：统一经 `stopSessionProgress(sessionKey)` — 微信 `stopProgressTyping`，并 `delete` Map 条目防泄漏。
- **完成路径须 stop**：带 `message_id` 的最终回复经 `ackOnReply`（已含 stop）；异常 notify 经 `/api/send-text` 传 `stop_progress: true`；`/api/stream-text` 的 `final: true`（可选 `message_id` 触发 ack）；`/api/send-image|send-file` 成功且带 `message_id` 时经 `ackOnReply`。三态进度文案（「正在启动」「Agent 处理中…」）走 send-text **不带** `message_id`/`stop_progress`，**不** stop。
- **poll Get 去重**：`sessionGetReactedIds` 按 inbound `messageId` 记录已打 Get；入队确认与 orchestrator claim 均写入，`idsNeedingPollGetReaction` 按 id 过滤，不依赖 `sessionProgressMap` 生命周期。
- **勿在 sendText 内 cancelTyping**：最终回复与流式分段用 `{ skipTyping: true }`；进行中指示仅由进度状态机 stop。

## 斜杠执行器（daemon-slash-executor）

- **SSOT**：`executeSlashCommand` 进程内即时执行并 `replyToMessage`；`handleCommand` 主路径接线（T5）。
- **`SLASH_EXEC_MODE`**：`daemon` | `dual` | `electron`；默认 `dual`；`getSlashExecMode()` 读 env，非法值回退 `dual`。
- **`handleCommand` 顺序**：T8 `tryHandleMergeSlashCommand` → `electron` 仅 `pushCommandToQueue` → 否则 `executeSlashCommand` → `markSlashMessageIdExecuted` → `dual` 双写 `.fcmd`。
- **`slashExecutedMessageIds`**：60s TTL Map；`wireDaemonSubmodules` 注入 `slashExecutorDeps`；dual poll 经 `GET /commands/skip-check|executed-ids` 查询。
- **本地指令**：`/help`、`/status`、`/list`、`/clean` 不调 Electron；`/mcp` 走 `daemon-slash-mcp.ts`（复用 T3）。
- **Electron 依赖**：`forwardElectronCommandApi` → `POST /api/command/execute`；未就绪返回「应用未运行」类中文。
- **T8 划界**：执行器忽略 `/merge` 与 `merge_*` 前缀（double-guard）；**禁止**在 T5 改 `handleMergeBatchAction`。
- **日志**：结构化字段 `slash_exec`（command、message_id、mode、ok、source）。
- **子模块禁止互引环**：`daemon-slash-mcp` 不 import `daemon-slash-executor`。
- **T6 菜单与 admin**：`feishu-event-handlers` 菜单经 `handleSlashCommand`（= `handleCommand`，source=`menu`）；`POST /api/agent` stop/restart/reset 经 `forwardElectronCommandApi` 同步返回；`electron` 模式仍回滚 `.fcmd`。

## Orchestrator 调度

- **单进程闭环**：IM 入站 → 队列/合并 → `runAgentDispatchLoop` → Electron `POST /api/agent/launch|dispatch` → 展示出站。
- **触发**：`broadcastQueueEvent` debounce 300ms；`session-agent-phase` → idle 时 `flushReadyMergeBatches`。
- **门控**：`shouldDeferDispatch` + `sessionAgentPhaseMap` processing；合并 batch 须 `ready` 才 claim。
- **SSOT**：`POST /api/agent/launch|dispatch` 在 Daemon 暴露并转发 Electron；`GET /api/poll-message` 返回 404。
- **日志**：调度失败 `dispatch_failed`；重试排期 `dispatch_retry_scheduled`（busy 兼 `agent_busy_requeue`）；耗尽 `dispatch_retry_exhausted`；SDK Run 错误在 Electron 侧用 `agent_failed`。
- **失败重入队接线**：`releaseClaimedMessages` 经 `OrchestratorDeps` 由 `daemon.ts` 注入；**禁止**在 orchestrator 内重复实现 rename；退避常数本地声明，**禁止** import Electron `retry-policy`。
- **拆分模式**：`daemon-orchestrator.ts` 超 300 行时按 notify 同构拆 `daemon-orchestrator-*.ts`（retry 等），经工厂注入，禁止预建通用 Retry 框架。
- **busy 重排一致性**：`agent_busy` 走 `parseBusyRetryDelayMs` + `scheduleBusyRetry`/`scheduleDispatchRetry`（含 launch 与 HTTP dispatch 入口）；未耗尽勿 ack。

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
