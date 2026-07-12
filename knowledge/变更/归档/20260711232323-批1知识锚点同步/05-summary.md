# 批1知识锚点同步 - 变更总结

> **变更 ID**：`20260711232323-批1知识锚点同步`
> **来源**：kb-lite
> **lite 类型**：知识同步型 lite
> **阶段**：`applied`（LITE-01 done；待 `/kb-archive` 迁移）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `knowledge/业务域/消息桥接/03-微信通道.md` | L14：首条私聊不入队锚点由裸 `daemon.ts` 精确至 `src/daemon/daemon.ts` L291–297；「十、变更记录」追加摘要 |
| `knowledge/业务域/工作流/04-触发与管理入口.md` | L11：admin/agent MCP 入口拆分为 `server-workflow.ts` + `daemon-http-mcp.ts` 注册路径；「十、变更记录」追加摘要 |
| `knowledge/业务域/消息桥接/02-飞书通道.md` | presentation/stream 落点对齐 `daemon-presentation-stream.ts`、`daemon-presentation-process-events`、`daemon-presentation-milestone`；「十、变更记录」追加摘要 |
| `knowledge/业务域/消息桥接/04-消息队列与路由.md` | dispatch/`handleStreamText` 落点精确至 `daemon-orchestrator.ts`、`daemon-presentation-stream.ts`；「十、变更记录」追加摘要 |
| `knowledge/变更/归档/20260711203953-巨型单体拆分/05-summary.md` | 追加「§6 批1 知识锚点同步备注」，链至本变更；**T16 仍为 deferred** |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入（显式）**：业务代码、proto、配置；`knowledge/知识地图.md`、`knowledge/知识索引.md`；批2（T8～T16）queue/channel/logging 拆分说明。

**统计**：4 知识叶子文件 + 1 归档 summary 备注；无代码 diff。

## 2、与设计的差异

无结构性偏差。可选归档 summary 备注已落盘；巨型单体拆分 T16 状态保持 `deferred`，未标 `done`。

## 3、影响范围

- **涉及模块**：消息桥接、工作流叶子知识文件中 daemon 批1 源码锚点。
- **行为变更**：无运行时变更；仅知识检索与 CodeGraph 对照精度提升。
- **产品语义**：保留既有业务描述，仅修正模块路径与行号锚点。
- **批2 范围**：queue/channel/logging 仍驻 `daemon.ts` 的表述未在本 lite 展开。

### 3.1 Ponytail 技术债

无（本次 diff 未新增 `ponytail:` 注释）。

### 3.2 剩余漂移（未修）

| 项 | 说明 |
|----|------|
| **T16 deferred** | 巨型单体拆分全量知识库同步仍待批2～4；本变更仅覆盖批1 叶子锚点 |
| **知识地图/总索引** | 入口结构未变，按 proposal 刻意不更新 |

## 4、知识库影响清单

知识同步型 lite：以下文件已更新。

| 文件 | 摘要 |
|------|------|
| `knowledge/业务域/消息桥接/03-微信通道.md` | 首条 p2p 不入队 → `src/daemon/daemon.ts` L291–297 |
| `knowledge/业务域/工作流/04-触发与管理入口.md` | MCP CRUD/流转 → `server-workflow.ts` + `daemon-http-mcp.ts` |
| `knowledge/业务域/消息桥接/02-飞书通道.md` | stream/presentation 门控 → `daemon-presentation-*` 子模块 |
| `knowledge/业务域/消息桥接/04-消息队列与路由.md` | dispatch loop、final ack → `daemon-orchestrator.ts`、`daemon-presentation-stream.ts` |
| `knowledge/变更/归档/20260711203953-巨型单体拆分/05-summary.md` | §6 批1 锚点同步备注（可选项已落盘） |

**无需更新**：

- [x] `knowledge/知识索引.md` — 总入口未变化
- [x] `knowledge/知识地图.md` — 领域/子模块清单未变
- [x] 消息桥接/工作流 `00-README.md`、`01-概览.md` — 批1 薄组装锚点已在巨型单体拆分中更新，叶子文件与本变更对齐即可
