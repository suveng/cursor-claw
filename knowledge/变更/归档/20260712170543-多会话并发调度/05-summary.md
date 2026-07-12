# 多会话并发调度 - 变更总结

> **变更 ID**：`20260712170543-多会话并发调度`  
> **来源**：kb-propose · standard flow  
> **阶段**：`reviewed`（05 已写；知识正文已由 librarian 落盘；**勿**改 `archived`，目录迁移交 release）  
> **依赖**：`20260712170438-Daemon批二拆分`（已 archived）

## 1、实际变更

### 1.1 代码

| 文件 | 关键改动 |
|------|----------|
| `src/daemon/daemon-orchestrator.ts` | `claimForOrchestratorDispatch`：`starting`\|`processing` 同挡；去掉全局跨 await 的串行 dispatch 模型；工厂注入 dispatch 子模块 |
| `src/daemon/daemon-orchestrator-dispatch.ts` | **新增**：`inFlightSessions` + 短生命周期 `dispatchScanBusy`；跨 session 并行 kickoff（`Promise.allSettled`）；INFO `dispatch_parallel` |
| `src/daemon/daemon-queue-merge-action.ts` | 改写原「单条顺序 dispatch」ponytail，对齐跨 session 可并行 kickoff |
| `src/daemon/AGENTS.md` | Orchestrator 节：会话间并行 / 会话内串行；门控与日志关键字含 `dispatch_parallel` |

**未改（显式）**：MergeBatch / `shouldDeferDispatch` 语义；retry/ack；飞书/微信出站；HTTP 契约；跨机队列 / worker pool。

**行数**：`daemon-orchestrator.ts` 285；`daemon-orchestrator-dispatch.ts` 72（均 ≤300）。

### 1.2 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`（通过，零 open）
- `00-manifest.json`、`05-summary.md`（本文件）

### 1.3 知识正文（librarian 已更）

- `knowledge/工程平台/Daemon守护进程/01-概览.md`
- `knowledge/业务域/Agent调度/00-README.md`、`01-概览.md`、`02-多会话模型.md`

## 2、与设计的差异

无功能偏差（04 §4 确认）。

| 项 | 设计预期 | 实际 | 说明 |
|----|----------|------|------|
| 文件落点 | 优先原地改；超 300 才拆 `daemon-orchestrator-dispatch.ts` | 已拆 dispatch 子文件 | 符合 `02` §二/§六 行数门禁 |
| 可观测 | 可选 `dispatch_parallel` / `dispatch_inflight` | 落地 `dispatch_parallel`（含 kickoffs/inflight 计数） | 满足 R6；可 grep |
| T7 债注释 | 勾销「单条顺序 dispatch」 | merge-action / AGENTS 已改写 | 产品债关闭，非另立债务 |

## 3、影响范围

- **模块**：Daemon Orchestrator 调度并发；queue-merge 注释对齐；`src/daemon/AGENTS.md`。
- **接口**：无对外 HTTP/MCP/proto 变更。
- **数据**：无持久化 schema；`inFlightSessions` / scan 锁为进程内。
- **用户可见**：多会话待办可并行启动，不再因他会话 launch await 全局串行；同会话顺序与合并门控不变。
- **可靠性**：busy/失败重入队与 ack 语义不弱化；关键字 `dispatch_failed` / `agent_busy_requeue` / `dispatch_retry_*` 保留。

### 3.1 Ponytail 技术债

本变更相关 diff 中的 `ponytail:`（非 open 评审项；04 Ponytail 轴：**Lean already. Ship.**）：

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `src/daemon/daemon-orchestrator-dispatch.ts:3` | 无 worker pool；仅 Set + 短生命周期 scan 锁 | 若引入池化/优先级队列须另立变更与产品验收 |
| `src/daemon/daemon-queue-merge-action.ts:63` | 取消合并后仍由 orchestrator 按未合并路径领取（跨 session 可并行 kickoff） | 说明性；并行模型已落地，无需再升「串行 T7」 |

## 4、知识库影响清单

> 继承 `02-design.md` §十；librarian 已落盘正文。勾选与 `manifest.files` 知识项一致。

### （一）必须更新

- [x] `knowledge/工程平台/Daemon守护进程/01-概览.md` — 调度并发现状；去掉「未做调度并发」；关键字含 `dispatch_parallel`；剩余限制写无 worker pool / 跨机队列
- [x] `knowledge/业务域/Agent调度/01-概览.md` — 会话间并行、会话内串行；可观测与全局限制对齐
- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — Daemon 调度并发决策、`dispatch_parallel`、同会话门控
- [x] `knowledge/业务域/Agent调度/00-README.md` — 源码锚点含 `daemon-orchestrator-dispatch.ts`

### （二）可能更新（视实现结果）

- [x] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — **不需要更新**（无 orchestrator loop 串行误述；HTTP 契约未变）
- [x] `src/daemon/AGENTS.md` — apply 已同步；与知识正文一致

### （三）不需要更新

- [x] 消息桥接 / 飞书·微信通道体验文档（本变更不改通道）
- [x] 工作流 / 定时任务知识
- [x] `knowledge/知识地图.md` / 领域·分区入口 README 结构（无新叶子入口）

## 5、阶段说明

- 04 **通过**；T1～T4 `done`；**无** open / accepted_debt 口径项。
- 本轮写 `05-summary.md` 并回写 `manifest.files`；**保持 `stage=reviewed`**。
- 目录 `mv` → `archived`、白名单 commit/push 交 **kb-release**（knowledge 正文已就绪）。
