# HTTP dispatch失败重入队对齐 - 变更总结

> **变更 ID**：`20260712144755-HTTP dispatch失败重入队对齐`  
> **来源**：kb-propose · standard flow · **父变更**：`20260711232817-dispatch失败重入队与ack策略`  
> **阶段**：`tested`（archive 步骤 5 完成；知识库正文待 librarian；迁移前 **勿** 标 `archived`）  
> **用户可见性**：是 — HTTP/MCP/工作流经 `POST /api/agent/dispatch` 触发任务在失败/busy 时可释放回队、有限重试；耗尽后停试通知再 ack，与 IM launch 语义对齐

---

## 1、实际变更

### 代码

| 任务 | 文件 | 改动要点 |
|------|------|----------|
| T1 | `src/daemon/daemon-http-routes-types.ts` | 新增 `DispatchLaunchFailureOpts` / `DispatchLaunchFailureResult`；`HttpRoutesDeps` 扩展 `handleLaunchFailure`、`clearDispatchRetryAttempt` |
| T2 | `src/daemon/daemon-orchestrator.ts` | `OrchestratorApi` 透出上述两方法，绑定同一 `dispatchRetry` 实例（294 行，≤300） |
| T3 | `src/daemon/daemon-http-routes-orchestrator.ts` | 删除 HTTP 内联「失败即 `ackMessages`」「busy 仅 `scheduleBusyRetry` 无 release」；`!result.ok` 统一 `handleLaunchFailure`；成功 `clearDispatchRetryAttempt`（148 行） |
| T4 | `src/daemon/daemon.ts` | `createAdminApiHandler` 注入 orchestrator retry 回调（+2 行接线） |
| T5 | `src/daemon/AGENTS.md` | 登记 HTTP dispatch 与 IM launch 共用 retry、日志关键字、ack 规矩 |
| T6 | `auto_test/run-http-dispatch-retry-contract.sh`、`.mts` | ST-H1～H7 契约冒烟 + mock retry + `tsc --noEmit` |

**未纳入（显式）**：`daemon-orchestrator-retry.ts` 实现（父债 SSOT，仅复用）；`file-queue.ts` 存储拆分（归变更 `20260712145152`）；对外 HTTP 路径/字段形状；IM 卡片 UI；Engine Port 总线。

**统计**：0 新建源模块 + 5 修改 + 2 验收脚本；`tsc --noEmit` 通过；ST-H1～H7 契约全绿（见 `06-automation-test.md` §7）；E2E-H1～H5 可选未跑，不阻断 archive。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`、`05-summary.md`（本文件）

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **父债 D1（HTTP 旁路）** | 父变 `20260711232817` `reviews` D1：`accepted_debt` — HTTP dispatch 未接线 release + 有限重试 | 本变更删除内联 ack；失败/busy 改调 `handleLaunchFailure`；与 IM 共用 `attemptBySession` | **已清偿** — 父债 `05-summary` §5 D1 应标 `closed_by: 20260712144755`（librarian archive 步骤同步） |
| **共享类型** | `02` 未强制独立类型别名 | 新增 `DispatchLaunchFailureOpts` / `DispatchLaunchFailureResult`（`daemon-http-routes-types.ts`） | **轻微增强** — `04-review` Ponytail「native」建议已采纳；非行为偏差 |
| **HTTP 无 phase 门控** | `04-review`：HTTP 不经 `sessionAgentPhaseMap` claim/phase | 与 IM `dispatchSessionToAgent` 架构差异既有，非本变更引入 | **符合范围** — `02` 仅对齐 retry 策略 |
| **其余 DEL-1/DEL-2、F1/B1、H4/S4、H5/S5、R6** | 与 `02`/`03` 逐步对照 | 实现一致 | **无功能偏差** |

---

## 3、影响范围

- **模块**：Daemon HTTP 路由（`POST /api/agent/dispatch`）、Orchestrator API 透出、HttpRoutesDeps 接线；复用父债 `createDispatchRetry` / `releaseClaimedMessages`。
- **用户可见**：经 HTTP/MCP/工作流触发的 Agent 任务在可恢复失败或 busy 时不再静默丢失；策略内自动重试（`MAX_DISPATCH_RETRIES=3`，退避 600/1200/2400ms）；耗尽停试可感知；成功路径仍仅 stream final / `ackOnReply` 最终 ack。
- **接口/proto**：无对外 HTTP 契约形状变更；响应仍 `{ ok, error? }` + 200/400 规则。
- **数据**：无持久 schema；HTTP 与 IM 共用进程内 `attemptBySession`（同 session 跨入口共享计数，属 S5 设计预期）。
- **风险残留**：`HttpRoutesDeps.scheduleBusyRetry` 在 HTTP dispatch 路由已不再调用，deps 仍注入（`04-review` 评分 50，后续清理变更可移除）；E2E-H1～H5 未跑（契约已覆盖接线与 retry SSOT）；知识库 R3 正文待 librarian。

### 3.1 Ponytail 技术债

本变更 diff 中 **无** `ponytail:` 注释。

> 说明：`src/daemon/daemon.ts:763` 存在既有 `ponytail: T7 单条顺序 dispatch…`，**不在本变更 diff 内**，不记入本表。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| （无） | — | — |

`04-review` Ponytail 轴结论：**Lean already. Ship.**（未新建 HTTP 专用 retry 模块。）

**非阻断精简建议**（评审记入，**不**写入 `reviews[]`）：`HttpRoutesDeps.scheduleBusyRetry` 可于后续清理变更从 types / `daemon.ts` 接线移除（HTTP 路由已改经 `handleLaunchFailure`）。

---

## 4、知识库影响清单

> 来源：`02-design.md` §九、§十；由 **kb-librarian** 在 archive 步骤 6 落盘（本步骤 **不写** 业务域/工程平台正文）。

### （一）必须更新

- [ ] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — `POST /api/agent/dispatch` 失败策略：release + 有限重试 + 耗尽停试 ack；日志 `dispatch_retry_scheduled` / `dispatch_retry_exhausted` / `agent_busy_requeue`
- [ ] `knowledge/工程平台/Daemon守护进程/01-概览.md` §九 — 移除 HTTP 旁路「失败即 ack」残留；补充与 launch 共用 retry
- [ ] `knowledge/业务域/消息桥接/04-消息队列与路由.md` — HTTP 与 IM 共用 `handleLaunchFailure`；`releaseClaimedMessages` 适用场景含 HTTP dispatch

### （二）可能更新（视 librarian 合并结果）

- [ ] `knowledge/业务域/消息桥接/01-概览.md` §九 — 若仍有「HTTP 须手动重发」特例表述
- [ ] `knowledge/业务域/Agent调度/` 相关概览 — 划界「队列恢复在 Daemon Orchestrator + HTTP 路由共用 retry」一句
- [ ] `knowledge/变更/归档/20260711232817-dispatch失败重入队与ack策略/05-summary.md` §5 D1 — 标 `closed_by: 20260712144755`（HTTP 旁路已清偿）

### （三）不需要更新

- [x] `knowledge/知识索引.md` — 入口结构无变化
- [x] 飞书/微信通道 UI 文档
- [x] `file-queue` 整体拆分方案（变更 `20260712145152` 负责）
- [x] Engine Port / RunLifecycle 正文
- [x] 领域/分区 `00-README.md` — 无新增/删改叶子入口

### （四）代码侧 AGENTS（已随 apply）

- [x] `src/daemon/AGENTS.md` — 已更新；librarian 写知识正文时须与代码约定对齐

---

## 5、验收与债务状态

| 维度 | 状态 |
|------|------|
| **T1～T6** | done（manifest `tasks[]`；T6 证据：`run-http-dispatch-retry-contract.sh` 全绿，ST-H1～H7 pass） |
| **04-review** | ✅ 通过；严重 0；警告 0；父债 D1 代码侧已清偿 |
| **06 契约** | ✅ ST-H1～H7、`tsc --noEmit` |
| **06 E2E-H1～H5** | ⏳ 可选未执行 — 不阻断本步骤；上线前可 Daemon 实机补强 |
| **01 §6.1（行为）** | ✅ 契约 + mock 覆盖；运行时 E2E 为可选 |
| **知识库 R3** | ⏳ 待 librarian 步骤 6（非代码债） |
| **`reviews[]`** | **空** — 本变更 **不得** `archived_with_debt` |

### 父债清偿（不写入本 manifest `reviews[]`）

| ID | 父变更 | 原 status | 本变更处置 |
|----|--------|-----------|------------|
| D1 | `20260711232817` | `accepted_debt`（HTTP dispatch 旁路） | **closed_by: `20260712144755`** — HTTP 失败/busy 已接线 `handleLaunchFailure` |

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并登记 `manifest.files`；**保持 `stage=tested`**。
- **暂勿** `mv` 至归档、**暂勿** 标 `archived` / `archived_with_debt`（迁移与 stage 收尾归 release/librarian）。
- inspector 预期：本变更无开放代码债；父债 D1 由本变更清偿后，父变 `05-summary` 须同步 `closed_by` 字段。
