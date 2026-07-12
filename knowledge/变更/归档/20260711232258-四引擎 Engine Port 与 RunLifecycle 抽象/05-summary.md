# 四引擎 Engine Port 与 RunLifecycle 抽象 - 变更总结

> **变更 ID**：`20260711232258`  
> **来源**：kb-propose · standard flow  
> **阶段**：`reviewed`（T17 知识库已同步；`stage=archived` 归 kb-release）  
> **用户可见性**：dispatch 失败开始有 IM；四引擎终态失败/取消/超时 notify 语义收敛

---

## 1、实际变更

### 代码（四期 T1～T16）

| 模块 | 改动要点 |
|------|----------|
| `electron/agent/shared/` | **新增** `run-lifecycle-types.ts`、`run-lifecycle.ts`、`agent-engine-port.ts`、`run-notify.ts`、`run-failure-formatter.ts`、`run-complete-template.ts` |
| 四引擎 `engine-port-adapter.ts` | **新增** Port 六方法；`agent-sdk-http` 注册 `sdk`/`claude-code`/`codex`/`opencode` |
| Cursor SDK | `sdk-run-port-lifecycle.ts`、`applySdkStreamRunEvent`、`completeSdkRunViaPort`、`notifySdkProcessingBusy` |
| Claude Code | `completeCcViaLifecycle`；删除 `cc-watchdog-finalize.ts` 平行路径 |
| Codex/OpenCode | `complete*ViaLifecycle`；本地 notify 副本收敛至 `run-notify` |
| Daemon | `daemon-orchestrator-notify.ts`；`daemon-http-routes-orchestrator` dispatch 失败对称 IM |
| `src/shared/orchestrator-failure-formatter.ts` | Daemon 失败文案 SSOT（R2 fixed） |

**静态验收**：`npm run build` 通过；T1～T16 `done`；04-review full-review T1～T16 `passed`。

### 知识库（T17）

- [x] `knowledge/业务域/Agent调度/06～10`、`01-概览.md`
- [x] `knowledge/业务域/消息桥接/02-飞书通道.md`
- [x] `knowledge/业务域/Agent调度/00-README.md` 关键源码锚点

---

## 2、关键落点

1. **AgentEnginePort**：launch/dispatch/stop/stream/watchdog/complete 六能力；网关 `getEnginePort(resourceType)` 查表。
2. **RunLifecycle**：`guarding→streaming→watching→completing→notifying`；引擎事件→`RunEvent`→状态机→`completeRunFromTemplate`。
3. **终态契约**：`errorNotified` 闩仅一次 IM；`formatRunFailureMessage`+`notifySessionChat` 唯一出站；f41 成功路径禁止双写 assistant。
4. **dispatch 对称 IM**：`POST /api/agent/dispatch` 非 `agent_busy` 失败 → `notifySessionUser`+`stop_progress: true`（对齐 launch）。
5. **RunFailureReason**：`dispatch_failed`/`run_error`/`timeout`/`user_cancelled`/`context_exhausted`/`stale_aborted`/`session_abnormal`。

---

## 3、与设计差异

1. **RunLifecycle.resume**：S7 续接 `errorNotified` 重置仍为 stub，与设计「二～三期完善」一致。
2. **运行态 IM**：T11/T14 静态+build pass，真机飞书矩阵未执行（见 accepted_debt）。

其余与 `02-design.md` 方案 B、R1～R8 落点一致。

---

## 4、accepted_debt（R3 / R5）

| 项 | 说明 | 建议 |
|----|------|------|
| **R3** | Cursor+Claude S1～S6 运行态 IM 待手工（06 §4.5） | 有飞书环境时按 `06-automation-test.md` §4.5 点验 |
| **R5** | 四引擎 S1～S8 运行态 IM 待手工（06 §4.6） | 发布 checklist 或 `/kb-test` 补证 |

不阻断 archive；kb-release 可标 `archived_with_debt`。

---

## 5、后续建议

1. kb-release：mv 至 `knowledge/变更/归档/`、`stage=archived`、可选 `archived_with_debt`。
2. 手工 IM 矩阵通过后关闭 R3/R5。
3. S7 续接完善 `RunLifecycle.resume()` 与 `errorNotified` 重置。
4. 关联变更 [`20260711232817-dispatch失败重入队与ack策略`](../进行中/20260711232817-dispatch失败重入队与ack策略/) 可独立跟进 busy 重入队策略。

---

## 6、知识库影响清单（02-design §十·（一））

- [x] `06-CursorSDK执行引擎.md` — Port adapter + RunLifecycle
- [x] `07-ClaudeCodeSDK执行引擎.md` — 同上
- [x] `08-CodexSDK执行引擎.md` — 同上
- [x] `09-OpenCodeSDK执行引擎.md` — 同上
- [x] `10-SDK上下文保护与失败归因.md` — RunFailureReason + errorNotified
- [x] `01-概览.md` — 架构图纳入 Port/Lifecycle
- [x] `消息桥接/02-飞书通道.md` — dispatch 对称 + 四引擎终态
- [x] `Agent调度/00-README.md` — 关键源码锚点
- [ ] `03-启动与自动重连.md` — resume 特例待 S7 完善后再补（design 可能更新）
