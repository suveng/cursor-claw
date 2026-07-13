---
type: ChangeSummary
title: 长任务多会话体验优化
description: 飞书长任务心跳/CardKit 续期、空闲后台预热、同目录通道提示、tool「正在执行」与卡住提示、入队「已排队」文案；发版 1.15.0
timestamp: 2026-07-13T22:46:08+08:00
related: []
depends_on:
  - 20260712170543-多会话并发调度
  - 20260627150041-飞书排队消息状态反馈与合并预览
  - 20260711113147-长驻Agent空闲后静默失败修复
---

# 长任务多会话体验优化 — 变更总结

> **lite** · 变更 ID：`20260713220111-长任务多会话体验优化` · 版本 **1.15.0**
> **来源**：kb-lite（知识同步型）
> **阶段**：`archived`

---

## 归档结论

`archived`，无债务（无 04-review；无 ponytail；知识库已同步）。

---

## 1、实际变更

### LITE-01 飞书长任务进度心跳 / CardKit 续期

| 文件 | 关键改动 |
|------|----------|
| `src/bridge/lark-cardkit-renewal.ts` | **新增**：静默间隔（默认 60s）CardKit 续期控制器；禁止假 SDK turn |
| `src/daemon/daemon-presentation-feishu-heartbeat.ts` | **新增**：优先 CardKit settings 续期，否则轻量 milestone「仍在处理中…」 |
| `src/bridge/lark-sender-stream.ts` | `renewStreamingCardSettings`：PATCH settings 保持 streaming_mode |
| `src/bridge/lark-core.ts` | 挂接续期能力 |
| `src/daemon/daemon-presentation-handlers.ts` | 组装飞书心跳；入队 start / 出站 note / stop |
| `src/daemon/daemon-presentation-enqueue.ts` | 飞书 Get 进度时 `startFeishuHeartbeat` |
| `src/daemon/daemon-presentation-stream.ts` | 出站后 noteOutbound，重置静默计时 |
| `src/daemon/daemon-presentation-process-events.ts` | 过程事件路径配合心跳 |
| `src/daemon/daemon-presentation-types.ts` | 心跳相关类型扩展 |
| `src/daemon/AGENTS.md` / `src/bridge/AGENTS.md` | 心跳/续期约定 |

### LITE-02 空闲 ≥15min 后台预热 recreate + 多会话节流

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/sdk-resident-bg-warmup.ts` | **新增**：60s 扫描；idle≥15min 后台 `recreateSessionAgent`；多会话串行+jitter |
| `electron/agent/cursor-sdk/sdk-resident-refresh.ts` | recreate inFlight 闩，与发前 refresh 共用 |
| `electron/agent/cursor-sdk/agent-sdk.ts` / `agent-sdk-http.ts` / `sdk-run-recover.ts` | 启动/续接后 `startResidentBgWarmup` |
| `electron/agent/cursor-sdk/sdk-binary-paths.ts` | **新增**：自 `agent-sdk.ts` 抽出 `ensureSdkBinaryPaths`（单文件 ≤300） |
| `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` | `stopAll` 停预热 timer |
| `electron/agent/cursor-sdk/AGENTS.md` | resident-bg-warmup 约定 |

### LITE-03 同 workspaceDir 第二会话通道提示

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | `SHARED_WORKSPACE_DIR_HINT`；UI WARN + `notifySessionChat`（不硬阻断） |
| `electron/agent/cursor-sdk/AGENTS.md` | 同目录提示约定 |

### LITE-04 tool_running「正在执行」+ 卡住提示

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/sdk-tool-stuck-hint.ts` | **新增**：默认 10min（`SDK_TOOL_STUCK_MS`）卡住提示 `/stop` `/status` |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | tool running 武装 / 结束清除计时器 |
| `electron/agent/cursor-sdk/sdk-session-types.ts` | stuck 状态字段 |
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | Run 复位清 stuck 状态 |
| `src/shared/tool-presentation.ts` | 里程碑「正在执行」+ `formatToolStuckHintText` |
| `src/bridge/lark-sender-progress.ts` | CardKit 工具状态文案「正在执行」 |
| `src/daemon/daemon-presentation-process-events.ts` | 过程事件配合 tool 展示 |
| `electron/agent/cursor-sdk/AGENTS.md` / `src/shared/AGENTS.md` | 卡住提示 / 文案 SSOT |

### LITE-05 同会话入队「已排队」文案

| 文件 | 关键改动 |
|------|----------|
| `src/daemon/daemon-presentation-enqueue.ts` | starting/processing →「已排队，…结束后处理」 |
| `src/daemon/daemon-queue-merge-card.ts` | ready+processing footer「已排队，当前任务结束后发送」 |
| `src/daemon/AGENTS.md` | 入队三态文案约定 |

### 发版、知识库与变更文档

| 文件 | 关键改动 |
|------|----------|
| `package.json` | version `1.14.9` → **`1.15.0`** |
| `changelog/1.15.0.json` | 用户可见五条要点 |
| `knowledge/业务域/消息桥接/{00-README,01-概览,02-飞书通道,04-消息队列与路由,log}.md` | 心跳续期、入队文案（librarian） |
| `knowledge/业务域/Agent调度/{00-README,01-概览,02-多会话模型,03-启动与自动重连,06-CursorSDK执行引擎,log}.md` | 同目录提示、预热、tool 卡住（librarian） |
| `00-manifest.json` / `01-proposal.md` / `05-summary.md` | 本变更目录 |

## 2、与设计的差异

无。与 `01-proposal.md` 五条验收一致：无假 SDK turn；不默认硬阻断同目录第二会话；心跳 / 预热 / tool 可见 / 入队文案均按任务落地。

## 3、影响范围

- **模块**：飞书 CardKit/Presentation 心跳、SDK 长驻预热与会话注册表、tool 呈现与卡住提示、Daemon 入队/合并卡文案。
- **接口**：无 proto/跨端契约变更；IM 文案与通道提示行为变更（用户可见）。
- **数据结构**：会话侧 stuck 计时字段；无库表变更。
- **用户可见**：长任务续期、空闲预热、同目录提示、工具执行/卡住提示、入队「已排队」。

### 3.1 Ponytail 技术债

无。（本次 diff / 新增文件无 `ponytail:` 注释）

## 4、知识库影响清单

> librarian 已按「现在是什么」回写下列业务域正文；代码侧 AGENTS 随 apply 同步。

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — CardKit 静默续期 / 长任务心跳
- [x] `knowledge/业务域/消息桥接/04-消息队列与路由.md` — F1「已排队」文案 / 合并卡 footer
- [x] `knowledge/业务域/消息桥接/01-概览.md` / `00-README.md` / `log.md` — 概览、分区索引与结构性 log
- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — 同 workspaceDir 通道可见提示
- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — 空闲≥15min 后台预热 recreate + 节流
- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — tool「正在执行」、卡住提示、bg-warmup
- [x] `knowledge/业务域/Agent调度/01-概览.md` / `00-README.md` / `log.md` — 概览、分区索引与结构性 log
- [x] 相关 `AGENTS.md`（daemon / bridge / cursor-sdk / shared）— apply 已同步
- [x] `knowledge/index.md` — 总入口无新领域，无需更新
