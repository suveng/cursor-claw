# SDK 上下文保护与失败归因

## 一、能力范围

四引擎共享的 **Run 终态契约**：`RunFailureReason` 归因枚举、`errorNotified`/`watchdogTimedOut`/`runFinalizing` 闩、`formatRunFailureMessage` 文案、`completeRunFromTemplate` 收尾、`notifySessionChat` 唯一出站。Cursor SDK pre-send 上下文压力评估、高压轮转、`context_blocked` 快拒为本文件特有子能力。

## 二、设计决策与取舍

- **类型 SSOT**：`run-lifecycle-types.ts` — `RunPhase`、`RunEvent`、`RunFailureReason`、`AgentEnginePort`。
- **终态 IM 唯一出站**：`run-notify.notifySessionChat`；SDK/CC re-export，Codex/OpenCode 直接 import。
- **失败文案**：`formatRunFailureMessage` 引擎终态 SSOT；Daemon dispatch 文案 SSOT `src/shared/orchestrator-failure-formatter.ts`（electron re-export）。
- **收尾模板**：`completeRunFromTemplate` — 幂等闩、f41 成功路径禁止双写 assistant、失败挂 `archiveAgentFailureLogs`。
- **guard busy（S8）**：四引擎须 `enterGuardWithLifecycle`；busy→`notifyGuardBusy`（`session_abnormal`，`stop_progress`）一次 IM；`stale_aborted` 不二次 notify。
- **续接（S7）**：`RunLifecycle.resume()` 清零 `errorNotified`/`runFinalizing`→`guarding`；`sdk-run-recover` 续接前调用。
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

**errorNotified 契约**：`notifying` 入口检查；失败/超时/取消仅一次 IM；`aborted` 静默；`watchdogTimedOut` 与 complete 去重；S7 `resume()` 重置闩。

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

日志：`dispatch_failed`、`agent_failed`、`[compression] pre-send`；归档幂等；`npm run test:run-notify-contract` 断言 S1/S4/S5/S7/S8。

## 八、推送

终态均 `notifySessionChat(..., stop_progress: true)`；运行中「Agent 处理中…」等非终态不传 `stop_progress`。

## 九、已知限制与 TODO

SDK pre-send 边界见 §二；CC project scope 门控见 07。

## 十、变更记录

- 2026-07-12：四引擎终态契约 + D1～D3（S8 busy IM、S7 resume、契约冒烟）（archive 20260711232258）。
- 2026-07-05：SDK pre-send 保护、context_blocked（archive 20260705230806）。
