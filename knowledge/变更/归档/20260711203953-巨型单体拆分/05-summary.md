# 巨型单体拆分 - 变更总结

> **变更 ID**：`20260711203953-巨型单体拆分`  
> **来源**：kb-propose · standard flow  
> **阶段**：`archived_with_debt`（批1 子集已归档至 `knowledge/变更/归档/`）  
> **用户可见性**：无 — **跳过** `changelog/` 与 `package.json` version bump（内部技术债，参照 `20260711205108-Orchestrator会话路由SSOT收尾`）  
> **关联变更**：[`20260711205108-Orchestrator会话路由SSOT收尾`](../归档/20260711205108-Orchestrator会话路由SSOT收尾/) — 并行渗透 `daemon-session-routing.ts` 与 `fallbackSessionMap` deps（R4）

---

## 1、实际变更

### 代码（批1）

| 文件 | 改动 |
|------|------|
| `src/daemon/daemon.ts` | **修改**：3591 → **1710** 行；保留 queue/MergeBatch/channel/logging；新增 `wireDaemonSubmodules` 薄组装 |
| `src/daemon/daemon-orchestrator.ts` | **新建**（274 行）：`createOrchestrator` — dispatch loop、Electron API 转发、busy 重排 |
| `src/daemon/daemon-presentation-ordering.ts` | **修改**（130 行）：ordering 入口组装 |
| `src/daemon/daemon-presentation-ordering-eligible.ts` | **新建**（118 行）：eligible 门控、节流、`presentation_order_violation` |
| `src/daemon/daemon-presentation-ordering-release.ts` | **新建**（104 行）：deferred assistant release 串行链 |
| `src/daemon/daemon-presentation-handlers.ts` | **修改**（221 行）：`createPresentationHandlers` 工厂壳层 |
| `src/daemon/daemon-presentation-enqueue.ts` | **新建**（109 行）：入队确认、F1/Get、排队文案 |
| `src/daemon/daemon-presentation-merge-preview.ts` | **新建**（96 行）：合并预览卡回复编辑 |
| `src/daemon/daemon-presentation-stream.ts` | **新建**（206 行）：`/api/stream-text` |
| `src/daemon/daemon-presentation-process-events.ts` | **新建**（277 行）：tool/thinking presentation-event |
| `src/daemon/daemon-presentation-assistant-events.ts` | **新建**（113 行）：assistant/task/merge_batch presentation-event |
| `src/daemon/daemon-presentation-types.ts` | **新建**（90 行）：presentation 共享类型（防环引） |
| `src/daemon/daemon-http-routes.ts` | **修改**（52 行）：`createAdminApiHandler` 分发入口 |
| `src/daemon/daemon-http-routes-types.ts` | **新建**（49 行）：`HttpRoutesDeps` |
| `src/daemon/daemon-http-routes-orchestrator.ts` | **新建**（140 行）：orchestrator / merge / agent launch\|dispatch 路由簇 |
| `src/daemon/daemon-http-routes-send.ts` | **新建**（144 行）：send-text/image/file、presentation、stream-text |
| `src/daemon/daemon-http-routes-session.ts` | **新建**（97 行）：active-session、session-fallback |
| `src/daemon/daemon-http-routes-misc.ts` | **新建**（70 行）：SSE queue-events、chat-names、user-names |
| `src/daemon/daemon-http-admin-crud.ts` | **修改**（163 行）：admin CRUD 入口 |
| `src/daemon/daemon-http-admin-content.ts` | **新建**（170 行）：mcp / rules / skills admin 子路由 |
| `src/daemon/daemon-http-admin-io.ts` | **新建**（55 行）：admin 文件 IO、`AdminRouteHandler` 类型 |
| `src/daemon/daemon-http-server.ts` | **修改**（115 行）：`startHttpServer` 监听壳 |
| `src/daemon/daemon-http-mcp.ts` | **新建**（106 行）：MCP Server 工厂（agent + admin） |
| `src/daemon/daemon-http-non-api-routes.ts` | **新建**（191 行）：`/health`、`/enqueue`、队列/通道 bind 等非 `/api` |
| `src/daemon/AGENTS.md` | **修改**：批1 模块边界表、deps 注入规矩 |

**批1 子模块行数**：T-FIX-01 垂直切分后 **23 个** `daemon-*.ts` 子模块（含 T2～T6 初拆 + FIX 再切）均 **≤300 行**（最大 `daemon-presentation-process-events.ts` 277 行）。

**静态验收**：`npm run build:mcp` 通过；`wireDaemonSubmodules` deps 接线完整；runtime 无 orchestrator ↔ presentation 环引；`GET /api/poll-message` 仍 404。

**未纳入批1 manifest、并行渗透**：`src/daemon/daemon-session-routing.ts`（21 行，归属 `20260711205108`）。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`05-summary.md`、`06-automation-test.md`（本文）
- `00-manifest.json`（T1～T7、T-FIX-01 `done`；T8～T16 `deferred`；R1/R3 `resolved`；R2/R4/R5 `debt_accepted`；stage=`archived_with_debt`）

---

## 2、与设计的差异

1. **T-FIX-01 追加垂直切分**（04-review R1 → resolved）：初版 T2/T4/T5/T6 各产出单文件，5 个模块超 300 行硬上限；FIX 按路由簇 / MCP / 非 API / enqueue / merge-preview / eligible / release 再切 **12 个**子文件，对外 HTTP 路径与 JSON 响应不变；顺带修复 `daemon-http-server` 重复 MCP 工厂与 `daemonPort` 未赋值。
2. **presentation 多文件簇**（04-review §4.1）：设计预期 T4 单文件 `daemon-presentation-handlers.ts` ≤300；实际为 handlers + stream + process-events + assistant-events + types + enqueue + merge-preview + ordering 三件套，共 8 文件；方向与 `02-design` §三「禁止循环依赖」一致，超出原单文件假设。
3. **HTTP 多文件簇**（04-review §4.2～4.3）：设计预期 T5/T6 各单文件 ≤300；实际 routes 拆 5 路由簇 + types、admin 拆 crud/content/io、server 拆 mcp/non-api-routes，共 10 文件；模块边界更清晰。
4. **`daemon.ts` 仍 1710 行**（符合批1 预期）：queue/channel/logging 按 design 留批2（T8～T11）；未达批2 目标 ≤200 行。
5. **并行变更渗透**（R4）：`fallbackSessionMap` 经 `daemon-session-routing.ts` 注入，非 T1～T7 设计范围，功能等价。

其余与 `02-design.md` 批1 模块边界、deps 注入、对外契约不变一致。

---

## 3、影响范围

- **Daemon 主路径**：IM 入队 → MergeBatch → `runAgentDispatchLoop` → Electron `POST /api/agent/launch|dispatch` → presentation 出站；**语义不变**，仅源码落点自 `daemon.ts` 扩散至 `daemon-orchestrator` / `daemon-presentation-*` / `daemon-http-*`。
- **用户可见**：飞书收发、排队/合并预览、Agent 回复、流式展示、`/restart` **无产品变更**；无新增配置项。
- **Electron 侧**：批1 **未触及** `daemon-manager.ts`、`session-dispatcher.ts`、`command-handler.ts`、`lark-core.ts`。
- **批2 仍驻 `daemon.ts`**：`pushMessage`、`MergeBatch` 全族、`startFeishuChannel`、`log` 等；orchestrator/presentation 经 deps 回调访问。

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `daemon.ts:713` | **既有** `ponytail: T7 单条顺序 dispatch…` | T7 统一调度独立变更 |
| **T8～T11（deferred）** | queue/channel/logging 仍混驻 `daemon.ts` | 批2 拆分后 `daemon.ts` 瘦身至 ≤200 行 |
| **01 非目标** | `dispatchSessionAgents` 空实现、日志双写、T7 调度 SSOT 迁移 | 各独立变更，本轮不验收 |

---

## 4、知识库影响清单

- [x] `src/daemon/AGENTS.md` — builder 已补批1 模块表、deps 注入规矩、目录 import
- [x] `src/AGENTS.md` — 根索引 daemon 行已与 `src/daemon/AGENTS.md` 对齐（**R3 resolved**）
- [x] `knowledge/业务域/Agent调度/00-README.md` — 源码锚点已补 daemon 子模块清单（kb-librarian 归档同步）
- [x] `knowledge/业务域/消息桥接/00-README.md` — 队列/Presentation 新落点已同步（kb-librarian 归档同步）
- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md`、`04-消息队列与路由.md` — 视批2～4 完成后再同步（**T16 deferred**）
- [x] `knowledge/业务域/Agent调度/01-概览.md` — 术语/架构未变，无需更新
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新

---

## 5、遗留债务（归档可接受）

### 5.1 开放评审项（R2～R5）

| 项 | 说明 | 建议消化时机 |
|----|------|--------------|
| **R2** `@ts-nocheck` | 批1 部分模块曾用整文件 nocheck 削弱 deps 类型检查（T1 要求无 any 逃逸）；T-FIX-01 已移除新拆文件 nocheck，主壳文件类型收紧待跟进 | 批2 前 T-FIX-02 或随 queue 拆分一并收紧 |
| **R3** `src/AGENTS.md` | ~~根索引与 `src/daemon/AGENTS.md` 批1 模块边界可能不一致~~ **已 resolved** | — |
| **R4** 并行变更渗透 | `daemon-session-routing.ts` 未在本 manifest `files` 登记 | 关联 [`20260711205108`](../归档/20260711205108-Orchestrator会话路由SSOT收尾/) 交叉引用或拆分 commit |
| **R5** 无 E2E 冒烟 | 01 验收 1～4（冷启动、入队、dispatch、`/restart`）无运行证据 | `/kb-test` 补证或发布 checklist 点验 |

### 5.2 延后任务（批2～4，T8～T16）

| 任务 | 批次 | 范围 | 说明 |
|------|------|------|------|
| **T8** | 批2 | `daemon-queue.ts` | 文件队列、MergeBatch 状态机、SSE |
| **T9** | 批2 | `daemon-feishu-channel.ts` | `ChannelRuntime`、飞书/微信通道 |
| **T10** | 批2 | `daemon-logging.ts` | `log`、日志轮转 |
| **T11** | 批2 | `daemon.ts` 瘦身 | 目标 ≤200 行薄入口 |
| **T12** | 批3 | `electron/daemon/daemon-manager.ts` | 生命周期 / 轮询 / 指令 |
| **T13** | 批4 | `src/bridge/lark-core.ts` | CardKit 渲染与流式发送 |
| **T14** | 批4 | `session-dispatcher.ts` | launch/dispatch 分文件；`dispatchSessionAgents` 仍空 |
| **T15** | 批4 | `command-handler.ts` | 斜杠指令；T7 调度不迁移 |
| **T16** | 批4 | 知识库全量同步 | `Agent调度`/`消息桥接` README + AGENTS 锚点对齐 |

### 5.3 历史关联债（01 非目标，本轮不阻塞）

| 项 | 说明 |
|----|------|
| T7 调度 SSOT 统一 | Electron 5s 轮询与 Daemon orchestrator 未完全统一 |
| 日志双写 | Daemon 文件日志 + Electron stderr 回显 |
| `dispatchSessionAgents` 空实现 | 会话 Agent 批量下发未落地 |
