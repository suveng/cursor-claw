# Cursor SDK 执行引擎

## 一、能力范围

`@cursor/sdk` Electron 执行 IM/任务/工作流；`sdk-run-*` 事件流/续接；出站 `presentation-event`+`stream-text`。经 `engine-port-adapter.ts` 实现 `AgentEnginePort` 六能力，终态经 `RunLifecycle`+`completeRunFromTemplate`。不负责 Daemon 队列与其他引擎（07–09）。

## 二、设计决策与取舍

- **Engine Port**：`engine-port-adapter.ts` 注册 `sdk`；`agent-sdk-http.ts` 查 `getEnginePort` 委托 launch/dispatch；`sdk-run-port-lifecycle.ts` 缓存 Lifecycle、`applySdkStreamRunEvent`、`completeSdkRunViaPort`。
- **RunLifecycle**：`guarding→streaming→watching→completing→notifying`；`streamRunEvents` 终态经 `RunEvent` 路由，**禁止** adapter 外平行完整终态 notify。
- **API/MCP/续接**：长驻+二次 send；`sdk-active-runs.json` 续接；冷启动并行见 `electron/agent/cursor-sdk/AGENTS.md`。
- **呈现/ordering/watchdog**：Rev2 end-only、飞书 f41、tool 分级、watchdog 门控见 AGENTS.md。

## 三、服务端规则

1. SDK 资源+API Key；模型默认 `composer-2`；非超时 `failedCooldowns` 30s。
2. 终态 IM：`completeSdkFailureViaTemplate`→`enterNotifying`→`completeRunFromTemplate`；`errorNotified` 闩防重复；用户 `stopSdkSession`（aborted）静默。
3. pre-send/context_blocked 见 [10](./10-SDK上下文保护与失败归因.md)；冷启动三阶段见 [03](./03-启动与自动重连.md)。

## 四、客户端流程

`launch`/`dispatch`→`startSdkRun`→`streamRunEvents`（`RunEvent`）→`completeSdkRunViaPort`；失败/超时/取消统一 `completeSdkFailureViaTemplate`。

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
| `launchSdkAgent`/`dispatchToSdkAgent` | 业务入口，经 Port 或直连 |
| `POST /api/agent/launch\|dispatch` | Daemon 统一网关 |
| `POST /api/sdk-warmup` | bind 后预热 |

出站 `presentation-event`、`stream-text`；终态 `notifySessionChat(..., stop_progress: true)`。

## 六、数据

`SdkSessionAgent`：`errorNotified`、`watchdogTimedOut`、`runFinalizing`、`abortController`；Lifecycle 门控语义见 [10](./10-SDK上下文保护与失败归因.md)。`sdk-active-runs.json` 续接。

## 七、非功能与可观测

RunGuard+`enterGuardWithLifecycle`；busy 经 `notifySdkProcessingBusy`；400ms 节流；`[sdk_warmup]` 可检索；失败归档经 `completeRunFromTemplate` 挂接 `archiveAgentFailureLogs`。

## 八、推送

无（并入 §七）。

## 九、已知限制与 TODO

`RunLifecycle.resume()` S7 续接阶段重置待完善；运行态 IM 矩阵待手工点验（accepted_debt R3）。

## 十、变更记录

- 2026-07-12：Engine Port + RunLifecycle 抽象，终态委托 shared（archive 20260711232258）。
- 2026-07-11：首条冷启动优化（archive 20260711211323）。
- 2026-07-05：pre-send 上下文保护（archive 20260705230806）。
