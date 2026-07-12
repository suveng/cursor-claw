# dispatch失败重入队与ack策略 - 变更总结

> **变更 ID**：`20260711232817-dispatch失败重入队与ack策略`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（archive 步骤 5 完成；知识库正文待 librarian；迁移前 **勿** 标 archived；建议最终形态 `archived_with_debt`）  
> **用户可见性**：是 — launch 调度失败后任务可重入队并有限重试；耗尽后停试通知再 ack（主路径 IM Orchestrator）

---

## 1、实际变更

### 代码

| 任务 | 文件 | 改动要点 |
|------|------|----------|
| T1 | `src/bridge/file-queue.ts` | 新增 `releaseClaimedMessages`：按 id 将 `.claimed` 还原为 `.qmsg`；不存在 id / IO 失败不抛错；`ackMessages` 语义未改 |
| T1 | `src/bridge/AGENTS.md` | 登记 release 原语与 claim/ack 边界 |
| T2 | `src/daemon/daemon-orchestrator-retry.ts` | **新增**：`createDispatchRetry` / `handleLaunchFailure`；`MAX_DISPATCH_RETRIES=3`；退避 600/1200/2400；日志 `dispatch_retry_scheduled` / `dispatch_retry_exhausted` / `agent_busy_requeue` |
| T2 | `src/daemon/daemon-orchestrator.ts` | launch 失败改走 release + 有限重试；ok 清零 attempt；删除「非 busy 失败直接 ack」旧路径；行数 264（≤300） |
| T2 | `src/daemon/daemon.ts` | 注入 `releaseClaimedMessages` 与 retry deps |
| T2 | `src/daemon/AGENTS.md` | 登记失败重入队 / 耗尽 ack 约定 |

**未纳入（显式）**：HTTP `POST /api/agent/dispatch` 旁路（仍旧失败 ack / busy 无 release）；飞书卡片 UI；file-queue 整体拆分；Engine Port 通知总线（相邻变更）。

**统计**：1 新建 + 5 修改；`orchestrator` 264 / `retry` 96；`file-queue` 约 583（既有超限债）；ST-1～ST-7 / `tsc --noEmit` 通过（见 06）。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`、`05-summary.md`（本文件）

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **HTTP `/api/agent/dispatch`** | `02` §一·（三）/T2 明确不改对外 HTTP；主改 launch 编排 | 旁路仍失败即 `ackMessages`；busy 仅 `scheduleBusyRetry`、无 release | **已知范围外** — 04 D1 / reviews `D1` accepted_debt |
| **瞬时失败 notify `stopProgress`** | `02` §四默认保留失败 notify；现网曾传第三参 `true` | 可重试路径默认 `stopProgress=false`；仅耗尽传 `true` | **轻微可接受** — 04 未升警告；非阻断 |
| **拆文件** | 03 超 300 行才拆 | 新增 `daemon-orchestrator-retry.ts`（96 行）与 notify 同构 | **符合** — 04 yagni 批准 |
| **其余** | F1～F3、busy 释放、耗尽 ack、成功不提前 ack | 与 `01`/`02`/`03` 主路径一致 | **无功能偏差** |

---

## 3、影响范围

- **模块**：`file-queue` 释放原语；Daemon Orchestrator launch 失败路径与进程内 session 级重试计数。
- **用户可见**：IM 主路径调度失败不再静默丢任务；策略内自动重试；耗尽停试可感知（依赖既有/相邻 notify）；成功路径仍 final/`ackOnReply` 才 ack。
- **接口/proto**：无对外 HTTP/IPC 契约变更（旁路行为亦未改）。
- **数据**：无持久 schema；attempt 仅内存（进程重启依赖冷启动 orphan cleanup 恢复 `.qmsg`，计数可重置再试）。
- **风险残留**：HTTP 旁路仍可能「失败即丢」；E2E-1～4 未跑；`file-queue.ts` 超 300 行待另拆。

### 3.1 Ponytail 技术债

本变更相关 diff（`file-queue` / orchestrator / retry / `daemon.ts` 注入段）中 **无** `ponytail:` 注释。

> 说明：`src/daemon/daemon.ts:714` 存在既有 `ponytail: T7 单条顺序 dispatch…`，**不在本变更 diff 内**，不记入本表。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| （无） | — | — |

04-review Ponytail 轴结论：**Lean already. Ship.**（`scheduleBusyRetry` 薄包装收益极小，不建议再改。）

---

## 4、知识库影响清单

> 来源：`02-design.md` §九、§十；由 **kb-librarian** 在 archive 步骤 6 落盘（本步骤 **不写** 业务域/工程平台正文）。索引无需改。

### （一）必须更新

- [ ] `knowledge/工程平台/Daemon守护进程/01-概览.md` — §九 R3：改写为「失败重入队 + 有限重试；耗尽通知后 ack」
- [ ] `knowledge/业务域/消息桥接/01-概览.md` — §九：同步「不再须手动重发」边界与剩余限制
- [ ] `knowledge/业务域/消息桥接/04-消息队列与路由.md` — §二/§三/§九：写入 `releaseClaimedMessages` 与失败策略；更新源码锚点

### （二）可能更新（视 librarian 合并结果）

- [ ] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — 仅当运维说明需写入日志关键字时
- [ ] `knowledge/业务域/Agent调度/` 相关概览 — 仅划界「队列恢复在 Daemon Orchestrator」一句时

### （三）不需要更新

- [x] `knowledge/知识索引.md` — 入口结构无变化
- [x] 飞书/微信通道 UI 文档
- [x] Engine Port / RunLifecycle 正文（相邻变更 archive 负责）
- [x] 领域/分区 `00-README.md` — 无新增/删改叶子入口

### （四）代码侧 AGENTS（已随 apply）

- [x] `src/bridge/AGENTS.md`、`src/daemon/AGENTS.md` — 已更新；librarian 写知识正文时须与代码约定对齐

---

## 5、验收与遗留债务

| 维度 | 状态 |
|------|------|
| **T1 / T2** | done（manifest `tasks[]`；证据见 06 §7） |
| **04-review** | ✅ 通过（有债）；严重 0；警告 0 |
| **06 静态** | ✅ ST-1～ST-7、`tsc --noEmit` |
| **06 E2E-1～4** | ⏳ **accepted_debt** — 主路径必须手工，待用户；不阻断本步骤文档准备 |
| **01 §6.1 主路径（代码）** | ✅ 对照 04/静态；⏳ 运行时以 E2E 为准 |
| **知识库 R3** | ⏳ 待 librarian 步骤 6（非代码债） |

### 遗留债务（写入 `reviews[]`，建议迁移时 `archived_with_debt`）

| ID | 来源 | status | 摘要 |
|----|------|--------|------|
| D1 | 04 §7 | accepted_debt | HTTP `POST /api/agent/dispatch` 未接线 release + 有限重试 |
| D2 | 04 §7 | accepted_debt | `file-queue.ts` ≈583 行，超 AGENTS ≤300；整体拆分另任务 |
| D3 | 06 §2/§7 | accepted_debt | E2E-1～4 未跑（瞬时恢复 / busy / 耗尽 / 成功不双跑） |

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并登记 debt / files；**保持 `stage=tested`**。
- **暂勿** `mv` 至归档、**暂勿** 标 `archived` / `archived_with_debt`（迁移与 stage 收尾归 release/librarian）。
- inspector 建议最终形态：`archived_with_debt`（因 D1～D3）。
