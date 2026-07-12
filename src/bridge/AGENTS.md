# bridge 域编码规矩

## 目录与迁移

- 消息桥接源码统一放在 `src/bridge/`（含 `wechat/` 子树）；跨域引用用 `../bridge/<file>.js`。
- 域内文件调整路径须用 `git mv`，保留 Git 历史；禁止在旧路径留 re-export shim 或 barrel `index.ts`。

## import 约定

- 域内模块互引用用**同目录相对路径** + **`.js` 后缀**（Node16 ESM），例如：
  - `./lark-core.js`
  - `./wechat/index.js`
  - `./file-queue.js`
- `lark-core.ts` 引用跨域 presentation 工具：`../shared/tool-presentation.js`。
- 禁止域内再写 `./shared/lark-core` 或根级 `./wechat-manager` 等旧扁平路径。

## 职责边界

- 本目录含文件队列、飞书 Lark 核心、微信客户端子树与 WeChatManager。
- daemon 枢纽、Electron 对 bridge 的跨域 import 由对应任务更新，不在此目录内硬编码 daemon 路径。

---

## 文件队列（file-queue 子模块族）

- **对外入口**：域外仅 `import "../bridge/file-queue.js"`；`file-queue.ts` 为薄组装 re-export，禁止 barrel `index.ts`。
- **子模块职责**（域内直引 `./file-queue-*.js` 仅限子模块互引，daemon 不得绕过入口）：

| 文件 | 职责 |
|------|------|
| `file-queue-path.ts` | 目录初始化、`APP_DATA_DIR/file-queue/<hash>/`、会话子目录 helper |
| `file-queue-types.ts` | `QueueMessage*` 类型定义 |
| `file-queue-message-io.ts` | JSON 解析、`safeId` 匹配、tmp+rename 原子写 |
| `file-queue-enqueue.ts` | `pushToFileQueue` 入队与 dedup |
| `file-queue-claim.ts` | `claimSessionMessages` / `claimNextMessage` / `waitForSessionMessages` |
| `file-queue-lifecycle.ts` | `ackMessages`、`releaseClaimedMessages`、冷启动 recycle、`.tmp` 清理 |
| `file-queue-query.ts` | 计数、列表、合并替换、管理面 CRUD |

- **磁盘布局**：`.qmsg`（待处理）与 `.claimed`（已 claim 待 ack）；`initFileQueue` 须在 daemon 启动早期调用。
- **lifecycle 划界**：`ackMessages` 删 `.claimed`；`releaseClaimedMessages` / `cleanupOrphanClaimedOnColdStart` 为 `.claimed→.qmsg` rename；**禁止**混用语义。
- **计数口径**：`getSessionUnclaimedCount` 仅统计 `.qmsg`；**禁止**用 `.claimed` 推断 Agent processing（phase 以 daemon `sessionAgentPhaseMap` 为准）。
- **单文件行数**：各子模块与入口均 ≤300 行；新增原语落入对应职责文件，禁止重建 `IQueueStore` 等未批准抽象。

## 飞书 Lark 核心（lark-core 门面 + 子模块）

- **对外入口**：域外仅 `import "../bridge/lark-core.js"`；`lark-core.ts` 为 `LarkSender` 门面 + 类型/工具 re-export；**禁止** barrel `index.ts`；禁止 daemon 绕过入口直引 `lark-sender-*`。
- **子模块职责**（域内互引 `./lark-*.js`，均 ≤300）：

| 文件 | 职责 |
|------|------|
| `lark-types.ts` | Card/事件/`LarkSenderOptions`/`LarkSenderCtx` 等类型 |
| `lark-utils.ts` | `MEDIA_CACHE_DIR`、缓存清理、代理剥离、`createLarkClient` |
| `lark-sender-stream.ts` | 流式 CardKit create / send / PATCH / close |
| `lark-sender-outbound.ts` | plain text/post+md、回复、表情、图片/文件、下载；含 @ 降级 text |
| `lark-sender-merge.ts` | 合并批次卡 create/send/PATCH/`renderMergeBatchCard` |
| `lark-sender-progress.ts` | 工具/思考进度卡；shell 经 `../shared/tool-presentation.js` |
| `lark-sender-help.ts` | 帮助卡 create / `sendHelpCard` |
| `lark-sender-parse.ts` | `parseMessageContent` / `processIncomingMessage` / `extractCardText` |
| `lark-sender-connection.ts` | `startConnection` 与 EventDispatcher 注册 |

- **降级路径**：CardKit 创建或 PATCH 失败须抛出或可判失败（返回 null/false），不吞错；由 daemon 回退 `sendStreamMessage` 或分段文本。
- **WS 事件注册**：须为已订阅事件提供 handler；可选回调经 `FeishuConnectionCallbacks`，未提供时 early return。
- **卡片回调透传**：`card.action.trigger` 须 `return await onCardAction(...)`；禁止 `void Promise.resolve` 丢弃返回值。
- **单文件行数**：门面与全部 `lark-*.ts` ≤300；新增能力落入对应子模块，禁止重建未批准抽象。

## 微信客户端（wechat-manager.ts + wechat/）

- **对外入口**：域外仅 `import "../bridge/wechat-manager.js"`；类型可由门面 re-export；**禁止** daemon 直引 `wechat-progress-typing` / `wechat-manager-types`。
- **子模块职责**（域内互引 `./wechat-*.js`，均 ≤300）：

| 文件 | 职责 |
|------|------|
| `wechat-manager.ts` | 门面：连接/出站/入站；委托 typing |
| `wechat-manager-types.ts` | 对外类型（Incoming/Options/SendResult/Status） |
| `wechat-progress-typing.ts` | ticket + 4s 续期 timer；`start/stopProgress` / `ensure` / `cancel` |
| `wechat/` | 协议与客户端实现；域外不直引 |

- **群聊入队门控**：daemon `initWeChatChannel` 在 `pushMessage` 前调用 `wechat-group-enqueue-gate.ts` 纯函数；策略字段 `wechatGroupEnqueueMode`（默认 `mention_required`）。
- **typing 续期**：`startProgressTyping` → `WeChatProgressTyping.startProgress`；立即 typing + 每 4s `wechat_typing_refresh`；`stopProgressTyping` / `stop()` 须清 timer 防泄漏。
- **出站 track**：`sendText`/`sendMedia` 返回 `{ ok, outboundId? }`，`outboundId` 前缀 `wxc_`（iLink `clientId` 等价物）；daemon `trackMessageSession` 消费。
- **typing 指示**：由 daemon `sessionProgressMap` 驱动；最终回复与流式分段须 `{ skipTyping: true }`，**禁止**在 `sendText` 内 cancelTyping。
- **续期可观测**：`wechat_typing_refresh` 成功 INFO；无 ticket / 抛错均 WARN（不阻断主路径）。
- **出站**：`sendText`、分段流式、图片/文件发送；与飞书 CardKit 路径互斥，由 daemon 按通道分流。
- **子树**：`wechat/` 为协议与客户端实现；域外仅经 `wechat-manager.ts` 暴露，不直接 import 子模块。
- **单文件行数**：门面与 `wechat-*.ts` 均 ≤300；typing 增量落入 `wechat-progress-typing.ts`。

## 入队进度与 Get 表情（bridge  primitives）

- bridge 提供飞书 Get 表情、微信 typing 等**原子能力**；何时启动/停止由 daemon `confirmEnqueueAndStartProgress` / `stopSessionProgress` 编排。
- `idsNeedingPollGetReaction` 等去重状态在 daemon 内存维护；bridge 层无状态重复记录。
