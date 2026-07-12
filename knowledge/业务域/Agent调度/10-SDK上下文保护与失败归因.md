# SDK 上下文保护与失败归因

## 一、能力范围

四引擎共享的 **Run 终态契约**：`RunFailureReason` 归因枚举、`errorNotified`/`watchdogTimedOut`/`runFinalizing` 闩、`formatRunFailureMessage` 文案、`completeRunFromTemplate` 收尾、`notifySessionChat` 唯一出站。Cursor SDK pre-send 上下文压力评估、高压轮转、`context_blocked` 快拒为本文件特有子能力。

## 二、设计决策与取舍

- **类型 SSOT**：`run-lifecycle-types.ts` — `RunPhase`、`RunEvent`、`RunFailureReason`、`AgentEnginePort`。
- **终态 IM 唯一出站**：`run-notify.notifySessionChat`；SDK/CC re-export，Codex/OpenCode 直接 import。
- **失败文案**：`formatRunFailureMessage` 引擎终态 SSOT；Daemon dispatch 文案 SSOT `src/shared/orchestrator-failure-formatter.ts`（electron re-export）。
- **收尾模板**：`completeRunFromTemplate` — 幂等闩、f41 成功路径禁止双写 assistant、失败挂 `archiveAgentFailureLogs`。
- **pre-send（SDK 专有）**：`lastPreSend*` 快照；ratio≥100% 且未轮转 → `context_blocked`。

## 三、服务端规则

**RunFailureReason**（对齐 `crash-log-archiver`）：

| 枚举 | 典型场景 |
|------|----------|
| `dispatch_failed` | Daemon/Electron 调度失败 |
| `run_error` | 引擎执行出错 |
| `timeout` | 看门狗/平台长时 |
| `user_cancelled` | 用户 stop（aborted 静默，不 notify） |
| `context_exhausted` | 上下文已满/pre-send≥95% |
| `stale_aborted` | 会话过期/中止 |
| `session_abnormal` | busy/异常 |

**errorNotified 契约**：`notifying` 入口检查；失败/超时/取消仅一次 IM；`abortController.aborted` 跳过 failure notify；`watchdogTimedOut` 与 complete 去重。

**Daemon dispatch 对称**：`daemon-http-routes-orchestrator` 在 `!ok` 且非 `agent_busy` 时 `notifySessionUser`+`stop_progress: true`，与 launch 失败同类语义。

## 四、客户端流程

```mermaid
flowchart TD
  ev["引擎原生事件"] --> map["adapter→RunEvent"]
  map --> lc["RunLifecycle"]
  lc --> tpl["completeRunFromTemplate"]
  tpl --> chk{"errorNotified?"}
  chk -->|否| im["notifySessionChat"]
  chk -->|是| skip["跳过重复 IM"]
```

SDK pre-send 分支见 §二；`context_blocked` 走 `notifyPreSendContextFailure`（非终态模板）。

## 五、接口

| 符号 | 路径 |
|------|------|
| `formatRunFailureMessage` | `electron/agent/shared/run-failure-formatter.ts` |
| `completeRunFromTemplate` | `electron/agent/shared/run-complete-template.ts` |
| `notifySessionChat` | `electron/agent/shared/run-notify.ts` |
| `createOrchestratorNotify` | `src/daemon/daemon-orchestrator-notify.ts` |
| SDK pre-send | `electron/agent/cursor-sdk/context-rotation-lite.ts` 等 |

## 六、数据

各引擎 session 保留：`errorNotified`、`watchdogTimedOut`、`runFinalizing`、`abortController`、`failureArchiveDone`。SDK 另含 `lastPreSendUsedTokens`/`lastPreSendUsageRatio`。

## 七、非功能与可观测

日志：`dispatch_failed`、`agent_failed`、`[compression] pre-send`；归档 `failureArchiveDone` 幂等；`run-notify` 仅依赖 `daemon-client` 防环引。

## 八、推送

终态均 `notifySessionChat(..., stop_progress: true)`；运行中「Agent 处理中…」等非终态不传 `stop_progress`。

## 九、已知限制与 TODO

`RunLifecycle.resume()` S7 续接 `errorNotified` 重置待完善；运行态 IM 矩阵 R3/R5 accepted_debt 待手工点验。

## 十、变更记录

- 2026-07-12：四引擎统一 RunFailureReason/errorNotified/notify 契约（archive 20260711232258）。
- 2026-07-05：SDK pre-send 保护、context_blocked（archive 20260705230806）。
