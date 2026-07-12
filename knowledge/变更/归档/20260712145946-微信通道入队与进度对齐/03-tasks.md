# 微信通道入队与进度对齐 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 一、执行计划

### （一）依赖图

```
T1 ──→ T3
T2 ──→ T3
T4 ──→ T5 ──→ T6
T3、T5 可并行（不同文件簇）
T6 依赖 T3+T5
T7 依赖 T6（文档/契约，可与 T6 同轮收尾）
```

### （二）分组调度

| 轮次 | 并行任务 | 说明 |
|------|----------|------|
| 第一轮 | T1、T2、T4 | 配置类型、gate 纯函数、typing 续期（无互相依赖） |
| 第二轮 | T3、T5 | 入站 gate 接线；出站 track 接线 |
| 第三轮 | T6 | AGENTS 沉淀 + 调用方返回类型扫尾 |
| 第四轮 | T7 | 契约脚本 + `06-automation-test.md` 策略（`/kb-test`） |

## 二、任务清单

## T1: 通道配置 wechatGroupEnqueueMode

### 背景
01 R2 要求群聊默认 @ 过滤、可配置全量入队。需在通道配置层持久化策略并下发 Daemon，供 W1a gate 读取。

### 上下文文件
- CodeGraph: `MessageChannel` `DaemonChannelConfig` — 通道类型 SSOT
- 必读: `src/shared/channel-types.ts` — 增字段定义
- 必读: `electron/preload.ts`、`src/renderer/env.d.ts` — 三端同步
- 参考: `electron/daemon/daemon-manager.ts` — Daemon 下发映射

### 实现范围
- 修改: `src/shared/channel-types.ts` — `MessageChannel` / `DaemonChannelConfig` 增 `wechatGroupEnqueueMode?: "mention_required" | "all"`、`wechatBotDisplayName?: string`
- 修改: `electron/preload.ts`、`src/renderer/env.d.ts` — 同步字段
- 修改: Settings 通道表单（微信类型区块）— 下拉/开关，默认 `mention_required`
- 修改: config-store → daemon-manager 映射，缺省写 `mention_required`

### 接口契约
- `DaemonChannelConfig.wechatGroupEnqueueMode` — Daemon 只读；undefined 视为 `mention_required`
- `DaemonChannelConfig.wechatBotDisplayName?` — @ 匹配别名，缺省用 `name`

### 验收标准
- [ ] 新建/编辑微信通道默认「群聊须 @」；可切「全量入队」
- [ ] Daemon 启动后 `channels` Map 中微信 cfg 含 mode 字段
- [ ] 飞书通道配置 UI/JSON 无回归
- [ ] 三端类型一致；无未批准新依赖（Ponytail）

### 依赖
- 前置任务: 无
- 后续任务: T3

---

## T2: 微信群 @ 过滤纯函数

### 背景
W1a 需要可单测的 @ 判定 SSOT。iLink `WeixinMessage` 无 mention 元数据，首版用正文启发式，联调后可扩展。

### 上下文文件
- CodeGraph: `isBotMentioned` — 飞书对照实现
- 必读: `src/daemon/daemon.ts` L1091–1110 — 飞书 @ 语义
- 必读: `src/bridge/wechat/types.ts` — 确认无 mention 字段
- 参考: `knowledge/业务域/消息桥接/03-微信通道.md` §九

### 实现范围
- 新建: `src/daemon/wechat-group-enqueue-gate.ts`（≤120 行）— `shouldEnqueueWechatGroupMessage({ text, mode, botAliases })`
- 逻辑: `mode==="all"` → true；`mention_required` → 检测 `@` + 别名（大小写不敏感、trim）；可选 `@所有人`/`@all` 视为命中
- 导出: `buildWechatBotAliases(cfg)` helper（name + wechatBotDisplayName 去重）

### 接口契约
- `shouldEnqueueWechatGroupMessage(opts: { text: string; mode: "mention_required" | "all"; botAliases: string[] }): boolean`
- `buildWechatBotAliases(name: string, displayName?: string): string[]`

### 验收标准
- [ ] `mention_required` + 无 @ → false；含 `@<botName>` → true
- [ ] `all` 模式恒 true
- [ ] 纯函数无 daemon/bridge import 环
- [ ] 中文注释说明启发式边界与联调扩展点

### 依赖
- 前置任务: 无
- 后续任务: T3

---

## T3: 微信入站 gate 接线

### 背景
在 `initWeChatChannel` 入队前插入群聊过滤，对齐飞书 `isBotMentioned` 位置；私聊、首条绑定、斜杠路径不变。

### 上下文文件
- CodeGraph: `initWeChatChannel` — 入站 SSOT
- 必读: `src/daemon/daemon.ts` L329–357 — onMessage 链路
- 必读: `src/daemon/wechat-group-enqueue-gate.ts` — T2 产出
- 参考: `daemon.ts` L1168–1170 — 飞书群过滤位置

### 实现范围
- 修改: `src/daemon/daemon.ts` `initWeChatChannel` — `chatType==="group"` 时调用 gate；未通过则 log INFO `wechat_group_skip` 并 return
- 修改: `ChannelRuntime`（若需）缓存 botAliases
- 不改: `pushMessage`、飞书 `startFeishuChannel`、MergeBatch

### 接口契约
- 群聊过滤仅依赖 T2 纯函数 + `rt.cfg.wechatGroupEnqueueMode`

### 验收标准
- [ ] 默认配置：群聊未 @ 消息不入队、无 typing/无队列写入
- [ ] @ 机器人后正常入队 + 入队确认（与现网一致）
- [ ] `all` 模式恢复全量入队
- [ ] 私聊、斜杠、首条绑定行为不变
- [ ] 飞书路径零 diff（ST-F1 人工或 grep 确认）

### 依赖
- 前置任务: T1, T2
- 后续任务: T6, T7

---

## T4: 微信 typing 续期

### 背景
01 R5 / 知识库 NF3：typing 约 5s 消失。需在 `startProgressTyping` 周期续 ticket 直至 `stopProgressTyping`，提升「处理中」可感知性。

### 上下文文件
- CodeGraph: `startProgressTyping` `stopProgressTyping` — bridge typing API
- 必读: `src/bridge/wechat-manager.ts` L191–250 — typing 实现
- 必读: `src/daemon/daemon-presentation-enqueue.ts` L91–95 — 启动入口
- 参考: `daemon-presentation-handlers.ts` L108–120 — 停止入口

### 实现范围
- 修改: `src/bridge/wechat-manager.ts` — `typingRefreshTimers: Map<string, NodeJS.Timeout>`；`startProgressTyping` 立即 typing + 每 4s 续期；`stopProgressTyping` clear interval + cancelTyping
- 常量: `TYPING_REFRESH_MS = 4000`（文件内声明，不抽框架）
- 不改: `sendText` 默认 `skipTyping: true` 语义

### 接口契约
- 对外方法签名不变：`startProgressTyping(userId)` / `stopProgressTyping(userId)`

### 验收标准
- [ ] 长任务（>10s）期间 typing 仍可见（联调或 mock interval 单测）
- [ ] `stopProgressTyping` 后 timer 清零，无泄漏（重复 stop 安全）
- [ ] 日志含 `wechat_typing_refresh`（续期失败 WARN 不阻断主路径）
- [ ] 文件 ≤300 行

### 依赖
- 前置任务: 无
- 后续任务: T6

---

## T5: 微信出站 track（clientId 等价）

### 背景
01 R4：出站可 track 或文档边界。iLink 无服务端 message_id，以 `clientId` 作等价 outbound id，对齐飞书 `trackMessageSession` 用法。

### 上下文文件
- CodeGraph: `trackMessageSession` `WeChatClient.sendText` — track 与 send 返回
- 必读: `src/bridge/wechat/client.ts` L170–183
- 必读: `src/daemon/daemon-http-routes-send.ts` L36–57 — 微信 send-text 缺口
- 必读: `src/daemon/daemon-presentation-handlers.ts` L89–101 — milestone 微信路径

### 实现范围
- 修改: `wechat/client.ts` — 已有 `return clientId`（确认）
- 修改: `wechat-manager.ts` — `sendText`/`sendMedia` 返回 `{ ok, outboundId?: string }`，outboundId=`wxc_${clientId}`
- 修改: `daemon-http-routes-send.ts` — 微信分支解析 outboundId，`trackMessageSession`，响应 `message_id`
- 修改: `daemon-presentation-handlers.ts`、`daemon-presentation-stream.ts`、`daemon-presentation-ordering-release.ts` — 微信 send 成功后 track（与飞书 sentMsgId 对称）
- 修改: `daemon.ts` `replyToMessage` 微信路径（若需 track 入队确认回复，可选仅 final 路径）

### 接口契约
- `WeChatManager.sendText(...): Promise<{ ok: boolean; outboundId?: string }>`
- `messageSessionMap` 键：`wxc_<clientId>`

### 验收标准
- [ ] `POST /api/send-text` 微信成功返回 `message_id` 以 `wxc_` 开头
- [ ] `trackMessageSession` 可被 `ackOnReply` / 排障 grep 到
- [ ] 飞书 send-text 响应与 track 行为不变
- [ ] 所有 `sendText` 调用方适配新返回类型，编译通过

### 依赖
- 前置任务: T4（可与 T4 并行，但同文件 wechat-manager 需串行：先 T4 后 T5 或同 agent 合并）
- 后续任务: T6, T7

---

## T6: 调用方扫尾与 AGENTS 沉淀

### 背景
T5 改变 `sendText` 返回类型；需在 daemon/bridge 全域适配，并在涉及目录写入规矩摘要。

### 上下文文件
- 必读: `src/bridge/AGENTS.md`、`src/daemon/AGENTS.md`
- Grep: `wechat!.sendText` / `.sendText(ch` 全仓调用点

### 实现范围
- 修改: 所有微信 `sendText` 调用方 — 判 `ok` 字段，不再当 boolean
- 修改: `src/daemon/AGENTS.md` — 微信 gate、typing 续期、wxc track 前缀
- 修改: `src/bridge/AGENTS.md` — send 返回契约、typing timer 清理

### 接口契约
- 无新增；文档与代码一致

### 验收标准
- [ ] `npm run build` 或 `tsc --noEmit` 通过
- [ ] AGENTS 为高度总结规矩，非流水账
- [ ] 无 02/03 未要求的抽象层（Ponytail）

### 依赖
- 前置任务: T3, T5
- 后续任务: T7

---

## T7: 契约验收脚本

### 背景
覆盖 01 §6 与 02 §八·（二）：微信 @ 过滤、typing、track 等价 id；飞书无回归（轻量契约）。

### 上下文文件
- 必读: `01-proposal.md` §六
- 参考: `knowledge/变更/归档/20260712144755-HTTP dispatch失败重入队对齐/auto_test/` — 脚本结构

### 实现范围
- 新建: `auto_test/run-wechat-enqueue-progress-contract.mts` + `.sh`
- 场景: gate 纯函数表驱动；mock sendText 返回 outboundId；可选 skip 需联调项并注明
- 新建/更新: `06-automation-test.md`（`/kb-test` 阶段写入策略与追溯矩阵）

### 接口契约
- 脚本 exit 0 = ST-W1～W4 通过；飞书 ST-F1 为 grep/静态声明

### 验收标准
- [x] 脚本本地可跑通（gate 单元 + tsc）
- [x] `06` 含与 T1–T6 追溯矩阵
- [x] 联调项（typing 肉眼）标「未自动化」与原因

### 依赖
- 前置任务: T6
- 后续任务: 无（→ `/kb-review`）
