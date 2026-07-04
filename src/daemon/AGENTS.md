# daemon 域编码约定

> 入口：`src/daemon-entry.ts` → `daemon/daemon.ts`。HTTP 路由、orchestrator、MergeBatch、Presentation、stream-text 均在本域枢纽实现。

## 目录职责

- `daemon.ts` — 守护进程枢纽（HTTP 路由、orchestrator、Presentation、stream-text）
- `daemon-presentation-milestone.ts` — 飞书 CardKit 抑制时的里程碑 `send-text` 降级；`sendMilestoneText` 返回 `sent` 布尔（true=实际出站）；节流 ≥3s、同文案 ≤4 次/Run
- `daemon-scheduled-tasks.ts` — 定时任务调度
- `server-admin.ts` — MCP admin 工具注册

## import 规矩

- bridge 域：`../bridge/file-queue.js`、`../bridge/wechat-manager.js`、`../bridge/lark-core.js`
- workflow 域：`../workflow/server-workflow.js`
- shared 跨域类型：`../shared/channel-types.js`、`../shared/feishu-presentation-gate.js`、`../shared/tool-presentation.js`、`../shared/constants.js`
- 域内同目录：`./daemon-presentation-milestone.js`、`./daemon-scheduled-tasks.js`、`./server-admin.js`

## 禁止

- 禁止 barrel `index.ts` 或 re-export shim
- 枢纽文件改动以 import 路径为主；业务逻辑变更须独立变更单

---

## 会话进行中指示（sessionProgressMap）

- **启动**：入队确认后 `confirmEnqueueAndStartProgress` — 微信 `startProgressTyping`，飞书原消息 `Get` 表情。
- **停止**：统一经 `stopSessionProgress(sessionKey)` — 微信 `stopProgressTyping`，并 `delete` Map 条目防泄漏。
- **完成路径须 stop**：带 `message_id` 的最终回复经 `ackOnReply`（已含 stop）；异常 notify 经 `/api/send-text` 传 `stop_progress: true`；`/api/stream-text` 的 `final: true`（可选 `message_id` 触发 ack）；`/api/send-image|send-file` 成功且带 `message_id` 时经 `ackOnReply`。三态进度文案（「正在启动」「Agent 处理中…」）走 send-text **不带** `message_id`/`stop_progress`，**不** stop。
- **poll Get 去重**：`sessionGetReactedIds` 按 inbound `messageId` 记录已打 Get；入队确认与 orchestrator claim 均写入，`idsNeedingPollGetReaction` 按 id 过滤，不依赖 `sessionProgressMap` 生命周期。
- **勿在 sendText 内 cancelTyping**：最终回复与流式分段用 `{ skipTyping: true }`；进行中指示仅由进度状态机 stop。

## Orchestrator 调度

- **单进程闭环**：IM 入站 → 队列/合并 → `runAgentDispatchLoop` → Electron `POST /api/agent/launch|dispatch` → 展示出站。
- **触发**：`broadcastQueueEvent` debounce 300ms；`session-agent-phase` → idle 时 `flushReadyMergeBatches`。
- **门控**：`shouldDeferDispatch` + `sessionAgentPhaseMap` processing；合并 batch 须 `ready` 才 claim。
- **SSOT**：`POST /api/agent/launch|dispatch` 在 Daemon 暴露并转发 Electron；`GET /api/poll-message` 返回 404。
- **日志**：调度失败用 `dispatch_failed` 字段；SDK Run 错误在 Electron 侧用 `agent_failed`。
- **busy 重排一致性**：`agent_busy` 必须统一走 `parseBusyRetryDelayMs + scheduleBusyRetry`（含 launch 与 dispatch 两条入口）；busy 分支不应提前 ack 当前 batch。

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
- **飞书 Presentation 门控**：`handleToolPresentationEvent` / `handleThinkingPresentationEvent` 经 `isFeishuProcessPresentationSuppressed` — 飞书全通道抑制 tool/thinking CardKit，改 `sendMilestoneText` 降级（**非**静默 `{ ok: true }`）。**呈现抑制 ≠ 不参与 ordering**：`sendMilestoneText` 返回 `sent === true`（实际出站；节流/去重/空文案/发送失败为 `false`）且 ordering 开启时，抑制路径 **mirror CardKit** 更新 `presentationProcessActive` 等编排字段——thinking：`thinkingOpen`；tool：`activeToolNames`（started 入集、completed/failed 出集）；**Rev2：过程 idle 不再 `enqueueReleaseDeferredAssistantStream`**，仅更新闩锁。`handleTaskPresentationEvent` 始终走里程碑 `sendMilestoneText`；ordering && sent → 仅 `presentationProcessActive = true`（不维护 `thinkingOpen`/`activeToolNames`，不单独 release）。CardKit 非抑制路径亦**禁止** process-idle release。assistant stream-text 与 PRESENTATION_ORDERING（仅 p2p）不受影响。微信路径不变。
- **eligible 分层**：`isMainUserP2pEligible`（合并批次）⊂ `isStreamTextEligible`（+ S1.8 飞书群聊且 `allowOthers`）；`sessionChatTypeMap` 在 `pushMessage` 写入。
- **NF2**：活跃 MergeBatch 时 stream/tool/thinking 首包经 `getPresentationReplyAnchor` → `sendStreamingCardMessage` reply 到 `lastInboundMessageId`，不争用合并卡首屏。

## Presentation 时序编排（PRESENTATION_ORDERING）

- **开关**：`PRESENTATION_ORDERING` 环境变量；未设置或 `1`/`true` 为开启，`0`/`false` 关闭（回滚至先到先展示）。默认开启。
- **MVP 范围**：`presentationOrderingEnabled(sessionKey)` = 开关开启 **且** `isMainUserP2pEligible`；群聊/CLI 不在本阶段。
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
