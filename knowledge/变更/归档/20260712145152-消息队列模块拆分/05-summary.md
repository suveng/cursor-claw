# 消息队列模块拆分 - 变更总结

> **变更 ID**：`20260712145152-消息队列模块拆分`  
> **来源**：kb-propose · standard flow · **依赖**：`20260712144755-HTTP dispatch失败重入队对齐`（archived）  
> **阶段**：`tested`（archive 步骤 5 完成；知识库正文待 librarian；迁移前 **勿** 标 `archived`）  
> **用户可见性**：否 — 纯内部结构拆分；入队 / claim / ack / release 对外语义与 import 路径不变

---

## 1、实际变更

### 1.1 变更摘要

将 `src/bridge/file-queue.ts`（原 ~584 行单体）按职责拆为 7 个子模块 + 薄组装入口（40 行 re-export）；`daemon.ts` / `daemon-orchestrator-retry.ts` 等调用方仍 `../bridge/file-queue.js`，零路径变更。`releaseClaimedMessages` / `ackMessages` 迁入 `file-queue-lifecycle.ts`，逻辑与父债 #1 定稿一致。

### 1.2 代码（T1–T9）

| 任务 | 文件 | 行数 | 改动要点 |
|------|------|------|----------|
| T1 | `src/bridge/file-queue-path.ts` | 55 | `initFileQueue` / `getQueueDir`、session 目录 helper、`POLL_INTERVAL_MS` / `STALE_TMP_MS` |
| T1 | `src/bridge/file-queue-types.ts` | 41 | `QueueMessage*` 类型导出 |
| T2 | `src/bridge/file-queue-message-io.ts` | 53 | `parseMessageFile` / `matchesSafeId` / `writeMessageAtomically` |
| T3 | `src/bridge/file-queue-enqueue.ts` | 44 | `pushToFileQueue` + dedup |
| T4 | `src/bridge/file-queue-claim.ts` | 115 | `claimSessionMessages` / `claimNextMessage` / `waitForSessionMessages` |
| T5 | `src/bridge/file-queue-lifecycle.ts` | 148 | `ackMessages` / `releaseClaimedMessages` / 冷启动 orphan / tmp 清理 |
| T6 | `src/bridge/file-queue-query.ts` | 196 | 计数、列表、admin、`replaceSessionUnclaimedMessages` |
| T7 | `src/bridge/file-queue.ts` | 40 | 唯一公共入口；全量 re-export，无业务逻辑残留 |
| T8 | `src/bridge/AGENTS.md` | — | 子模块职责表、阅读顺序、lifecycle 划界 |
| T9 | `auto_test/run-file-queue-split-contract.sh`、`.mts` | — | ST-Q1～Q7 契约冒烟 + `tsc --noEmit` |

**未纳入（显式）**：`daemon-orchestrator-retry.ts`（零改动）；队列策略常量；磁盘格式迁移；barrel `index.ts` / `IQueueStore` 抽象；IM / HTTP 契约。

**统计**：7 新建子模块 + 1 瘦身入口 + 1 AGENTS 更新 + 2 验收脚本；最大子模块 196 行（query）；`tsc --noEmit` 通过；ST-Q1～Q7 契约全绿（见 `06-automation-test.md` §7）；E2E-Q1～Q3 可选未跑，不阻断 archive。

### 1.3 变更文档

| 文件 | 说明 |
|------|------|
| `00-manifest.json` | T1～T9 done；`reviews[]` 空 |
| `01-proposal.md` | 技术债 PRD（R1～R6、§六验收） |
| `02-design.md` | 分层拆分方案、对外 API 表、ST-Q* |
| `03-tasks.md` | T1～T9 任务分解 |
| `04-review.md` | focused-review **通过**（零阻断） |
| `06-automation-test.md` | ST-Q1～Q7 契约全绿 |
| `05-summary.md` | 本文件 |

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **子模块切分** | 7 子模块 + facade ≤80 行 | 与 `02` §三～§四 符号落点一致；facade 40 行 | **无功能偏差** |
| **writeMessageAtomically** | T2 批准之 IO 原语抽取 | 已落地 `file-queue-message-io.ts` | **符合** — `04-review` Ponytail 批准 |
| **ack/release 语义** | 与父债 #1 一字不差搬移 | diff 逐行对照；唯一差异 `queueDir`→`getQueueDir()` 访问器 | **无漂移** |
| **调用方 import** | `daemon.ts` 等仍 `file-queue.js` | grep 核实 5 处不变 | **符合** ST-Q7 |
| **E2E 实机** | 可选 Daemon IM 补强 | E2E-Q1～Q3 未执行 | **不阻断** — 契约已覆盖核心 rename/ack/release |

其余与 `02-design.md` 一致，无阻断性设计偏差。

---

## 3、影响范围

- **模块**：`src/bridge/file-queue*.ts`（8 文件）+ `src/bridge/AGENTS.md`；Daemon / Orchestrator **import 路径不变**。
- **用户可见**：无界面或协议变化；可靠投递主路径（入队→claim→ack/release）行为与拆分前契约一致。
- **接口/proto**：无对外 breaking；`file-queue.js` 导出符号集合不变。
- **数据**：无 schema 变更；现网 `.qmsg`/`.claimed` 直接兼容（ST-Q4）。
- **风险残留**：知识库 `04-消息队列与路由.md` 仍标「待拆」直至 librarian 步骤 6；并发多进程 claim 压测未自动化（既有 rename 原子语义，本变更纯搬移）。

### 3.1 Ponytail 技术债

本变更 diff 中 **无** `ponytail:` 注释。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| （无） | — | — |

`04-review` Ponytail 轴结论：**Lean already. Ship.**（未引入 `IQueueStore`、barrel `index.ts` 或未授权框架层。）

---

## 4、知识库影响清单

> 来源：`02-design.md` §九、§十；由 **kb-librarian** 在 archive 步骤 6 落盘（本步骤 **不写** 业务域/工程平台正文）。

### （一）必须更新

- [ ] `knowledge/业务域/消息桥接/04-消息队列与路由.md`
  - **§二**：`releaseClaimedMessages` / `ackMessages` 锚点由 `file-queue.ts` 改为 `file-queue-lifecycle.ts`；补充子模块职责一句（path / enqueue / claim / lifecycle / query）
  - **§五**：接口表增加子模块落点列或脚注（`pushToFileQueue`→`file-queue-enqueue.ts` 等）
  - **§九**：**关闭**「`file-queue.ts` 超 300 行待拆（变更 `20260712145152`）」TODO
  - **§十**：追加 `2026-07-12：file-queue 按职责拆分子模块（archive 20260712145152）`
- [x] `src/bridge/AGENTS.md` — 子模块表、lifecycle 划界、对外仍只 import `file-queue.js`（已随 T8 apply）

### （二）可能更新（视 librarian 合并结果）

- [ ] `knowledge/业务域/消息桥接/01-概览.md` §二 — 若架构图仍绘单体 `file-queue`
- [ ] `knowledge/业务域/消息桥接/00-README.md` — 增加子模块阅读路径一句

### （三）不需要更新

- [x] `knowledge/工程平台/Daemon守护进程/` — 调度/retry 策略未变，仅队列实现落点内聚
- [x] `knowledge/变更/归档/20260712144755-HTTP dispatch失败重入队对齐/` — release/ack 语义本变更未改
- [x] `knowledge/变更/归档/20260711232817-dispatch失败重入队与ack策略/` — 策略正文不变
- [x] IM 协议、飞书/微信通道 UI 文档
- [x] `daemon-orchestrator-retry.ts` 源码（零改动）
- [x] `knowledge/知识索引.md` — 入口结构无变化
- [x] 领域/分区 `00-README.md` — 无新增/删改叶子入口

---

## 5、验收与债务状态

| 维度 | 状态 |
|------|------|
| **T1～T9** | done（manifest `tasks[]`；T9 证据：`run-file-queue-split-contract.sh` 全绿） |
| **04-review** | ✅ 通过；严重 0；警告 0 |
| **06 契约** | ✅ ST-Q1～Q7、`tsc --noEmit` |
| **06 E2E-Q1～Q3** | ⏳ 可选未执行 — 不阻断本步骤；上线前可 Daemon 实机补强 |
| **01 §6.1～6.3** | ✅ 契约覆盖行为回归、结构合规、工程规范 |
| **知识库 §十** | ⏳ 待 librarian 步骤 6（非代码债） |
| **`reviews[]`** | **空** — 本变更 **不得** `archived_with_debt` |

### 技术债清偿（不写入本 manifest `reviews[]`）

| ID | 原记载位置 | 本变更处置 |
|----|------------|------------|
| file-queue 待拆 | `04-消息队列与路由.md` §九「超 300 行待拆」 | **closed_by: `20260712145152`** — 8 文件均 ≤300 行；librarian 步骤 6 同步正文 |

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并登记 `manifest.files`；**保持 `stage=tested`**。
- **暂勿** `mv` 至归档、**暂勿** 标 `archived` / `archived_with_debt`（迁移与 stage 收尾归 release/librarian）。
- inspector 预期：本变更无开放代码债；`reviews[]` 保持空；知识库 `04-消息队列与路由.md` 待 librarian 步骤 6 关闭「待拆」表述。
