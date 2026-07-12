# 微信通道入队与进度对齐 - 实现设计

> **业务 PRD**：见同目录 `01-proposal.md`（验收标准以 01 为准）

## 一、业务流程与改动范围

> 业务口径以 `01-proposal.md` 场景 S1–S5 与验收 §6 为准；下图覆盖微信次通道主路径，飞书对照节点标注「不改」。

### （一）业务流程图

```mermaid
flowchart TD
  W0["W0 用户微信发消息<br/>不改"] --> W1{"W1 群聊?<br/>不改判定"}
  W1 -->|私聊| W2["W2 首条/context/指令<br/>不改"]
  W1 -->|群聊| W1a{"W1a @ 过滤 gate<br/>改动/新增"}
  W1a -->|未 @ 且默认策略| DROP["丢弃不入队<br/>新增"]
  W1a -->|@ 或全量策略| W2
  W2 --> W3["W3 pushMessage 入队<br/>不改"]
  W3 --> W4["W4 confirmEnqueue 确认+typing<br/>改动"]
  W4 --> W5["W5 调度/Agent 处理<br/>不改"]
  W5 --> W6["W6 stream/send 出站<br/>改动 track"]
  W6 --> W7["W7 stopSessionProgress<br/>改动 typing 续期/完成"]
  F0["F0 飞书 @/Get/DONE<br/>不改"] -.->|隔离| W0
```

**图例**：`不改` = 现网行为保持；`改动` = 调整既有节点；`新增` = 新分支或能力；`删除` = 本期无。

### （二）流程步骤与改动对照

| 步骤 ID | 业务含义 | 改动 | 落点（模块/文件） | 01 验收关联 |
|---------|----------|------|-------------------|-------------|
| W0 | iLink 长轮询收消息 | 不改 | `src/bridge/wechat-manager.ts` `handleMessage` | — |
| W1 | 群/私聊判定、去重、自消息过滤 | 不改 | `wechat-manager.ts` L257–261 | — |
| W1a | 群聊入队门槛：默认须 @ 机器人（或可配置全量） | 新增 | `src/daemon/wechat-group-enqueue-gate.ts`；`daemon.ts` `initWeChatChannel` | R1/R2、§6.1-1、S1/S2 |
| W2 | 首条私聊绑定、斜杠指令 | 不改 | `daemon.ts` L341–353 | S5 飞书隔离 |
| W3 | 写入 file-queue | 不改 | `daemon.ts` `pushMessage` | 依赖 #1+#3 已归档 |
| W4 | 入队确认文案 + 会话级 typing 启动 | 改动 | `daemon-presentation-enqueue.ts`；`wechat-manager.ts` typing 续期 | R3/R5、§6.1-2 |
| W5 | orchestrator dispatch/launch | 不改 | `daemon-orchestrator.ts` | S5 |
| W6 | 出站 send-text/stream 可 track | 改动 | `wechat-manager.ts`/`client.ts` 返回 `clientId`；`daemon-http-routes-send.ts`；`daemon-presentation-handlers.ts` | R4、§6.1-3 |
| W7 | 任务结束停止 typing；可选完成提示 | 改动 | `wechat-manager.ts` `stopProgressTyping`；`daemon-presentation-handlers.ts` `stopSessionProgress` | R3、§6.1-2 |
| F0 | 飞书 isBotMentioned / Get / DONE | 不改 | `daemon.ts` `startFeishuChannel` | §6.2-1 |

### （三）改动汇总

**改动**

- 群聊入队前增加 @ 过滤 gate（默认开启），配置可切回全量入队（W1a）。
- `startProgressTyping` 增加 ticket 续期循环，避免 5s 内 typing 消失（W4/W7）。
- 微信 `sendText`/`sendMedia` 向上返回 `outboundId`（`clientId` 等价 track），Daemon 出站路径调用 `trackMessageSession`（W6）。
- `POST /api/send-text` 微信分支响应补 `message_id`（实为 outbound 等价 id）。

**新增**

- `wechat-group-enqueue-gate.ts`：纯函数 `shouldEnqueueWechatGroupMessage` + 文本 @ 启发式（联调可扩展 raw 字段）。
- 通道配置 `wechatGroupEnqueueMode: "mention_required" | "all"`（缺省 = `mention_required`），三端类型同步。

**不改**

- Daemon 调度内核、MergeBatch、飞书 Presentation/CardKit 全链路（F0）。
- 工作流微信专属节点；iLink 协议层 HTTP 端点形状。

## 二、整体思路

**根因**：微信侧缺少飞书式群 @ gate；typing 单次 ticket 短时效；出站未 track，`messageSessionMap` 仅服务飞书。

**方案要点**（对齐 01 R1–R6）：

1. **入队门槛**：在 `initWeChatChannel` `onMessage` 内、入队前调用 gate；私聊不受影响；群聊默认 `mention_required`。
2. **@ 判定**：`WeixinMessage` 类型无 mention 元数据（CodeGraph/`types.ts`）；首版用正文 `@` + 通道机器人别名（`cfg.name`、可选 `wechatBotDisplayName`）启发式；联调若 raw 含字段再扩展 gate，不阻塞默认策略。
3. **进度**：复用 `confirmEnqueueAndStartProgress` → `startProgressTyping`；manager 内 4s 续期直至 `stopProgressTyping`；完成感依赖最终 Agent 回复 + typing 停止（无 Get/DONE API）。
4. **Track**：iLink `sendmessage` 无服务端 `message_id`（`api.ts` 无返回体解析）；以 `clientId` 作为 **等价 outbound id**（前缀 `wxc_`），写入 `messageSessionMap`；知识库明确不可与飞书 open_message_id 混用。

**最小方案三问**

1. **复用现有模块？** 是 — gate 仿 `isBotMentioned` 落 daemon；进度复用 `sessionProgressMap` + `WeChatManager` typing；track 复用 `trackMessageSession`。
2. **新增抽象必要？** 仅 `wechat-group-enqueue-gate.ts` 纯函数（≤120 行）+ 可选通道字段；不建跨通道 Notifier 框架。
3. **合并文件？** gate 独立小文件防 `daemon.ts` 超限；typing 续期留在 `wechat-manager.ts`（已有 typing 状态机）。

## 三、分层设计

| 层 | 落点 | 职责 |
|---|---|---|
| 通道配置 | `channel-types.ts`、preload、`env.d.ts`、config-store | `wechatGroupEnqueueMode` 下发 Daemon |
| Bridge | `wechat-manager.ts`、`wechat/client.ts` | typing 续期；send 返回 `outboundId` |
| Daemon 入站 | `daemon.ts` `initWeChatChannel` | 群聊 gate、飞书路径零触碰 |
| Daemon 出站/进度 | `daemon-presentation-enqueue.ts`、`daemon-presentation-handlers.ts`、`daemon-http-routes-send.ts` | typing 启停；track；send-text 响应 |
| 纯函数 | `wechat-group-enqueue-gate.ts` | @ 判定 SSOT，可单测 |

## 四、接口设计

**无新增 HTTP 路径**。行为扩展：

| 接口/函数 | 变更 |
|-----------|------|
| `POST /api/send-text` | 微信成功时响应 `{ ok, message_id?: string }`，`message_id` = `wxc_<clientId>` |
| `WeChatManager.sendText` | 返回 `{ ok: boolean; outboundId?: string }`（破坏性：调用方改判 `ok` 字段） |
| `shouldEnqueueWechatGroupMessage(opts)` | 入参：`text`、`mode`、`botAliases[]`；出参：`boolean` |

## 五、数据结构

| 项 | 说明 |
|---|---|
| `MessageChannel.wechatGroupEnqueueMode` | `"mention_required"` \| `"all"`；UI 默认 mention |
| `MessageChannel.wechatBotDisplayName?` | 可选；@ 匹配别名，缺省用 `name` |
| `messageSessionMap` | 微信 value 前缀 `wxc_`，与飞书 id 共存 |
| `WeChatManager` 内部 | `typingRefreshTimer: Map<userId, NodeJS.Timeout>` 续期句柄 |

无 DB / proto 变更。

## 六、实现步骤

1. **S1 配置字段**：三端类型 + Settings 微信通道区下拉（mention/全量）+ config-store 持久化。
2. **S2 gate 纯函数**：`wechat-group-enqueue-gate.ts` + 单元级契约脚本（可选 `auto_test`）。
3. **S3 入站接线**：`initWeChatChannel` 群聊分支调用 gate；结构化日志 `wechat_group_skip reason=not_mentioned`。
4. **S4 typing 续期**：`startProgressTyping` 启动 interval；`stopProgressTyping` 清理；防泄漏 `.unref()`。
5. **S5 outbound track**：client → manager → send-text/stream/handlers 链路返回并 `trackMessageSession`。
6. **S6 回归**：飞书 @/Get/DONE 冒烟；微信群未 @ 不入队、@ 后入队+typing+track 契约。

## 七、参考实现

CodeGraph（`projectPath=/home/suveng/doger/cursor-claw`）：

| 符号 | 路径 | 用途 |
|------|------|------|
| `WeChatManager` | `src/bridge/wechat-manager.ts:32` | typing、入站 emit |
| `initWeChatChannel` | `src/daemon/daemon.ts:329` | 微信 onMessage 入队入口 |
| `isBotMentioned` | `src/daemon/daemon.ts:1091` | 飞书 @ 过滤对照 |
| `confirmEnqueueAndStartProgress` | `src/daemon/daemon-presentation-enqueue.ts:71` | 微信 startProgressTyping |
| `stopSessionProgress` | `src/daemon/daemon-presentation-handlers.ts:108` | stopProgressTyping |
| `WeChatClient.sendText` | `src/bridge/wechat/client.ts:170` | 返回 `clientId` |
| `trackMessageSession` | `src/daemon/daemon.ts:893` | 出站 session 映射 |

知识库现状：`knowledge/业务域/消息桥接/03-微信通道.md` §九 三项限制为本变更目标。

## 八、技术影响

### （一）影响范围

- **模块**：bridge/wechat、daemon 入站/出站/presentation、Settings 通道配置。
- **接口/proto**：无对外契约路径变更；`sendText` TS 返回类型变更（内部调用方同步）。
- **数据**：无持久化 schema；通道 JSON 增可选字段。
- **风险**：@ 启发式误判（过严/过松）→ 联调日志 + `all` 模式回退；typing 续期 API 限频 → 4s 间隔 + stop 必清理；`clientId` track 非服务端 id → 文档边界（§6.1-3 等价方案）。

### （二）工程补充验收项

- [ ] 飞书群 @ 过滤、Get、DONE、track 回归用例无 diff 行为（ST-F1）。
- [ ] 微信 `wechat_group_skip` / `wechat_typing_refresh` 日志可 grep。
- [ ] `WeChatManager.sendText` 返回类型变更处编译通过（`tsc --noEmit`）。
- [ ] 单文件 ≤300 行；新增中文注释。

## 九、知识库影响

- `knowledge/业务域/消息桥接/03-微信通道.md` — 高：@ 过滤、typing 续期、track 等价 id、已知限制更新。
- `knowledge/业务域/消息桥接/04-消息队列与路由.md` — 中：次通道入队门槛差异一句。
- `knowledge/业务域/消息桥接/01-概览.md` — 中：主/次通道能力对照表。
- `knowledge/业务域/消息桥接/02-飞书通道.md` — 低：仅对照引用，正文不改。
- 两级索引：叶子正文变更，**不**触发 `知识索引.md`（README 失真时再更）。

## 十、知识库更新计划

### （一）必须更新

- `03-微信通道.md`：§一 能力范围、§三 @ 规则、§九 限制（track 边界、typing 联调结论）。
- `04-消息队列与路由.md`：§三 入队门槛一句（微信群 @）。
- `01-概览.md`：§九 或对照表一行。

### （二）可能更新（视实现结果）

- `工程平台/Daemon守护进程`：若 sessionProgress 口径跨通道文档化。
- Settings 工程说明（若存在通道配置专文）。

### （三）不需要更新

- `02-飞书通道.md` 正文（无共享行为变更）。
- `知识索引.md`、变更目录外归档证据。
