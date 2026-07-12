# 四引擎 Engine Port 与 RunLifecycle 抽象 - 变更总结

> **变更 ID**：`20260711232258`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（T1～T16 + D1～D3 清偿；`stage=archived` 归 kb-release）  
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

1. **运行态真机飞书**：R3/R5 已由 D3 契约冒烟（mock notify）提供可重复断言；有飞书凭据时仍可按 `06-automation-test.md` §4.5/§4.6 补手工点验，**非 archive blocker**。
2. **S7 非 Cursor 引擎**：D2 已挂接 Cursor `sdk-run-recover`；Claude/Codex/OpenCode 续接路径仍无独立 recover 模块（与 design 二期 scope 一致）。

其余与 `02-design.md` 方案 B、R1～R8 落点一致。

---

## 4、债务清偿（验收打回 round 1 · D1～D3）

> 来源：`08-verify-issue.md` 第 1 轮；用户拒绝 `accepted_debt` / `archived_with_debt` 口径。清偿顺序 D1 → D2 → D3。

| 任务 | 场景 | 落点 | 验收 |
|------|------|------|------|
| **D1** | **S8** 四引擎 guard busy IM | CC/Codex/OpenCode `agent-*-sdk.ts` 改 `enterGuardWithLifecycle`（对齐 Cursor `agent-sdk.ts`） | 四引擎 launch/dispatch busy 经 `notifyGuardBusy` 一次 IM，不静默 |
| **D2** | **S7** 续接 | `run-lifecycle.ts` `resume()` 清零 `errorNotified`/`runFinalizing` 并 `setPhase("guarding")`；`sdk-run-recover.ts` 续接前调用 `lifecycle.resume()` + `enterGuardWithLifecycle` | Cursor 主进程重启 recover 路径与 Lifecycle 对称 |
| **D3** | **R3/R5** 契约冒烟 | 变更目录 `auto_test/`（mock `httpPost`，无需 daemon/飞书） | `npm run test:run-notify-contract` 或 `./auto_test/run-notify-contract.sh`；断言 S1/S4/S5/S7/S8 等 notify 契约 |

**D3 脚本路径（SSOT）**

| 项 | 路径 |
|----|------|
| 入口 shell | `knowledge/变更/进行中/20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象/auto_test/run-notify-contract.sh` |
| 断言脚本 | `…/auto_test/run-notify-contract.mts` |
| Electron mock | `…/auto_test/electron-import-hook.mjs`、`electron-resolve-hook.mjs`、`stubs/*.mjs` |
| 说明 | `…/auto_test/README.md` |
| npm 别名 | 仓库根 `package.json` → `test:run-notify-contract` |

**静态验收**：D1～D3 `done`；`npm run build` + `npm run test:run-notify-contract` 通过（2026-07-12）。

---

## 5、残余项（非 blocker）

| 项 | 说明 | 建议 |
|----|------|------|
| **真机飞书** | D3 覆盖 mock 契约；S1～S6 运行态语义类别仍可选手工对照 | 有飞书环境时按 `06` §4.5/§4.6 补 §7 记录 |
| **S7 非 Cursor** | 仅 Cursor `sdk-run-recover` 挂接 D2 | 各引擎 recover 若需对称，单独立项 |
| **shrink** | `run-failure-formatter` 仍委托 `sdk-failure-messages` | 维护性建议，见 `04-review` §3.2 |

不标 `archived_with_debt`；可进入 `/kb-archive`。

---

## 6、后续建议

1. kb-release：mv 至 `knowledge/变更/归档/`、`stage=archived`。
2. 可选：有飞书环境时补 `06` §4.5/§4.6 手工 IM 矩阵 §7 记录。
3. 关联变更 [`20260711232817-dispatch失败重入队与ack策略`](../进行中/20260711232817-dispatch失败重入队与ack策略/) 可独立跟进 busy 重入队策略。

---

## 7、知识库影响清单（02-design §十·（一））

- [x] `06-CursorSDK执行引擎.md` — Port adapter + RunLifecycle
- [x] `07-ClaudeCodeSDK执行引擎.md` — 同上
- [x] `08-CodexSDK执行引擎.md` — 同上
- [x] `09-OpenCodeSDK执行引擎.md` — 同上
- [x] `10-SDK上下文保护与失败归因.md` — RunFailureReason + errorNotified
- [x] `01-概览.md` — 架构图纳入 Port/Lifecycle
- [x] `消息桥接/02-飞书通道.md` — dispatch 对称 + 四引擎终态
- [x] `Agent调度/00-README.md` — 关键源码锚点
- [ ] `03-启动与自动重连.md` — Cursor recover + `resume()` 已实装（D2）；全文锚点待 archive 时补
