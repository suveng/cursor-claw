---
type: DomainModule
title: Cursor SDK 执行引擎
description: Cursor SDK 长驻 Run、空闲预热、同目录提示、tool 呈现与卡住提示
timestamp: 2026-07-13T22:40:00+08:00
related:
  - 业务域/Agent调度/02-多会话模型
  - 业务域/Agent调度/03-启动与自动重连
  - 业务域/Agent调度/10-SDK上下文保护与失败归因
  - 业务域/消息桥接/02-飞书通道
depends_on:
  - 业务域/Agent调度/01-概览
---

# Cursor SDK 执行引擎

## 一、能力范围

`@cursor/sdk` Electron 执行 IM/任务/工作流；`sdk-run-*` 事件流/续接；出站 `presentation-event`+`stream-text`。经 `engine-port-adapter` 实现 `AgentEnginePort`；终态经 `RunLifecycle`+`completeRunFromTemplate`。不负责 Daemon 队列与其他引擎（07–09）。

## 二、设计决策与取舍

- **Engine Port / RunLifecycle**：`guarding→streaming→watching→completing→notifying`；终态经 `RunEvent` 路由，禁止 adapter 外平行完整终态 notify。
- **长驻空闲双保险**：空闲 ≥15min（`RESIDENT_STALE_IDLE_MS`）时，`sdk-resident-bg-warmup` 后台扫描 `recreate`（多会话串行+jitter，processing 跳过）；发前 `sdk-resident-refresh` 仍可 recreate；二者共用 recreate inFlight 闩。
- **同 workspaceDir**：`warnIfSharedWorkspaceDir` → UI `[shared-workspace]` WARN + 通道 `notifySessionChat`（`SHARED_WORKSPACE_DIR_HINT`）；每目录每进程 dedup；**不默认硬阻断**。
- **tool 呈现**：notify 白名单 `presentation-event`；`started` 文案「正在执行：…」（`formatToolMilestoneText`）；`tool_call running` 武装 `armToolStuckHint`（默认 10min，`SDK_TOOL_STUCK_MS`），文案含 `/stop` `/status`；**禁止**假 SDK turn 保活。
- **API/MCP/续接（S7）**：`recoverAllActiveRuns`；`Agent.resume`→guard→`startSdkRun`。呈现/ordering/watchdog 见 AGENTS.md。

## 三、服务端规则

1. SDK 资源+API Key；模型默认 `composer-2`；非超时 `failedCooldowns` 30s。
2. 终态 IM：`completeSdkFailureViaTemplate`→`enterNotifying`；`errorNotified` 闩；用户 stop 静默。
3. pre-send/context_blocked 见 [[10-SDK上下文保护与失败归因]]；冷启动见 [[03-启动与自动重连]]。

## 四、客户端流程

`launch`/`dispatch`→`startSdkRun`→`streamRunEvents`→`completeSdkRunViaPort`；失败/超时/取消统一 finalizer。

```mermaid
sequenceDiagram
  GW["agent-sdk-http"]->>Port["engine-port-adapter"]
  Port->>LC["RunLifecycle"]
  LC->>Stream["streamRunEvents"]
  Stream->>Tpl["completeRunFromTemplate"]
  Tpl->>IM["run-notify.send-text"]
```

## 五、接口

| 入口 | 说明 |
|------|------|
| `AgentEnginePort` 六方法 | launch/dispatch/stop/stream/watchdog/complete |
| `launchSdkAgent`/`dispatchToSdkAgent` | 业务入口 |
| `POST /api/agent/launch\|dispatch` | Daemon 网关 |
| `POST /api/sdk-warmup` | bind 后预热（与空闲 bg-warmup 不同） |

## 六、数据

`SdkSessionAgent`：`errorNotified`、`runPhase`（含 `tool_running`）、`toolRunningSince`/`toolStuckHintSent`、`watchdogTimedOut`；`sdk-active-runs.json`。

## 七、非功能与可观测

RunGuard busy IM；400ms 节流；`[sdk_warmup]`/`[resident-bg-warmup]`/`[shared-workspace]`/`tool_stuck_hint`；`npm run test:run-notify-contract`。

## 八、推送

无（并入 §七）。

## 九、已知限制与 TODO

S7 四引擎 recover 已对称；Cursor 独有 `Agent.resume`+`getRun`；同目录仅提示不硬阻断。

## 十、相关

- [[01-概览]]
- [[02-多会话模型]]
- [[03-启动与自动重连]]
- [[10-SDK上下文保护与失败归因]]
- [[业务域/消息桥接/02-飞书通道]]
