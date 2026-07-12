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

## 文件队列（file-queue.ts）

- **磁盘布局**：`APP_DATA_DIR/file-queue/<sessionHash>/` 下 `.qmsg`（待处理）与 `.claimed`（已 claim 待 ack）；`initFileQueue` 须在 daemon 启动早期调用。
- **入队/出队**：`pushMessage` 写入 `.qmsg`；orchestrator claim 时原子 rename 为 `.claimed`；`ackOnReply` 删除 `.claimed`。
- **冷启动回收**：`cleanupOrphanClaimedOnColdStart` 将遗留 `.claimed` 还原为 `.qmsg`（由 daemon `initQueue` 调用，全应用重启后无 live Agent）。
- **按 id 释放**：`releaseClaimedMessages(ids, sessionKey?)` 将匹配的 `.claimed` rename 回 `.qmsg`（与冷启动同构）；**禁止**与 `ackMessages`（unlink）混用同一语义。
- **计数口径**：`getSessionUnclaimedCount` 仅统计 `.qmsg`；**禁止**用 `.claimed` 推断 Agent processing（phase 以 daemon `sessionAgentPhaseMap` 为准）。
- **导出**：`pushToFileQueue` 等对外符号不变；队列目录路径变更不影响 HTTP 契约。
- **行数债务**：`file-queue.ts` 已超 300 行硬限；新增原语优先同文件增量，整体拆分另开任务，禁止顺手扩 scope。

## 飞书 Lark 核心（lark-core.ts）

- **出站能力**：文本/图片/文件发送、post+md 默认 Markdown 渲染（含 @ 时降级 text）、流式 CardKit（`createStreamingCardEntity`、`updateStreamingCardText`、`closeStreamingCardMode`）、合并批次卡（`renderMergeBatchCard`）、工具/思考进度卡（`renderToolProgressCard`、`renderThinkingCard`）。
- **presentation 依赖**：shell 工具展示字段经 `../shared/tool-presentation.js` 解析，不在本文件重复实现截断/格式化逻辑。
- **降级路径**：CardKit 创建或 PATCH 失败时由 daemon 回退 `sendStreamMessage` 或分段文本；lark-core 函数应抛出或可判失败，不吞错。
- **WS 事件注册**：`startConnection` 内 `EventDispatcher.register` 须为已订阅事件提供 handler（避免 SDK no handler WARN）；可选业务回调经 `FeishuConnectionCallbacks` 注入，未提供时 early return，不破坏既有 menu_v6/p2p_entered 行为。
- **卡片回调透传**：`card.action.trigger` handler 须 `return await onCardAction(...)`，将 `{ toast: { type, content } }` 回传 SDK；禁止 `void Promise.resolve` 丢弃返回值（menu_v6/p2p_entered 仍 fire-and-forget）。
- **行数债务**：`lark-core.ts` 已超 300 行硬限；本文件增量须克制，整体拆分另开任务，禁止顺手扩 scope。

## 微信客户端（wechat-manager.ts + wechat/）

- **typing 指示**：`startProgressTyping` / `stopProgressTyping` 由 daemon `sessionProgressMap` 驱动；最终回复与流式分段须 `{ skipTyping: true }`，**禁止**在 `sendText` 内 cancelTyping。
- **出站**：`sendText`、分段流式、图片/文件发送；与飞书 CardKit 路径互斥，由 daemon 按通道分流。
- **子树**：`wechat/` 为协议与客户端实现；域外仅经 `wechat-manager.ts` 暴露，不直接 import 子模块。

## 入队进度与 Get 表情（bridge  primitives）

- bridge 提供飞书 Get 表情、微信 typing 等**原子能力**；何时启动/停止由 daemon `confirmEnqueueAndStartProgress` / `stopSessionProgress` 编排。
- `idsNeedingPollGetReaction` 等去重状态在 daemon 内存维护；bridge 层无状态重复记录。
