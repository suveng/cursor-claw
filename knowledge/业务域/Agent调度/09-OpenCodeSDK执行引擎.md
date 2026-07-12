# OpenCode SDK 执行引擎

## 一、能力范围

`@opencode-ai/sdk`：内嵌/外部 Client、`session.create`/`prompt`、SSE、`opencode-agent-api`、MCP 内联、`opencodeSessionId` 续接。经 `engine-port-adapter.ts` 实现 `AgentEnginePort`，终态经 `RunLifecycle`+`completeRunFromTemplate`。出站 `presentation-event`+`stream-text`（ordering 见 §二）。不负责其他引擎与 Daemon claim。

## 二、设计决策与取舍

- **Engine Port**：`registerOpencodeEnginePort`；`mapOpencodeSseToRunEvent` 映射 SSE→`RunEvent`。
- **终态出口**：`completeOpencodeViaLifecycle`/`notifyOpencodeRunFailure`/`notifyOpencodeWatchdogTimeout`→shared 模板；运行中 IM 直接 import `run-notify`。
- **Client/MCP**：`resolveOpencodeClient` embedded/external；`opencode-mcp-loader` 读 `opencode.json`/项目配置。
- **resume/续接（S7）**：`opencodeSessionId` 续跑；`recoverOpencodeActiveRuns` 读 `opencode-active-runs.json`（含 embedded 连接字段）→探活→`startOpencodeRun`；失败 `notifyResumeFailure`。
- **Presentation ordering（Rev2 end-only）**：对称 Cursor；门控 `presentationOrderingEligible`；过程事件不抢 stream 首包；终态唯一 `flushOpencodeStreamPost(true)`。SSOT：`electron/agent/opencode/AGENTS.md`。

## 三、服务端规则

1. `type==="opencode"` 须 `providerId`/`apiKey`；模型空 → `OPENCODE_DEFAULT_MODEL`。
2. `pendingDispatch` launch→dispatch；`enterGuardWithLifecycle` 单飞。
3. 轮转清 `opencodeSessionId`；Profile 已删 → `opencode-missing`。
4. 任务/工作流 POST `opencode-agent-api`；IM 经统一网关。
5. `PRESENTATION_ORDERING=0` 时 defer/preamble 全链 no-op，行为回滚变更前直通。

## 四、客户端流程

SSE `handlePartUpdated`→stream defer 或 presentation-event；Run 收尾 `completeOpencodeRun` final flush。

```mermaid
sequenceDiagram
  GW["agent-sdk-http"]->>Port["engine-port-adapter"]
  Port->>OC["session.prompt SSE"]
  OC-->>EV["SSE→RunEvent"]
  EV->>Tpl["completeRunFromTemplate"]
```

## 五、接口

| 入口 | 说明 |
|------|------|
| `AgentEnginePort` 六方法 | `engine-port-adapter.ts` |
| `launchOpencodeAgent`/`dispatchToOpencodeAgent` | 首条/续跑 |
| `POST /api/opencode/agent/launch\|dispatch` | 本地 HTTP |
| `POST /api/agent/launch\|dispatch` | IM 统一网关 |
| 出站 | `POST /api/presentation-event`、`POST /api/stream-text`（Daemon） |

## 六、数据

`OpencodeSessionAgent`：`opencodeSessionId`、`errorNotified`、`watchdogTimedOut`、`runFinalizing`；`opencode-active-runs.json`（`OpencodeActiveRunRecord`）；ordering 字段 `seenProcessEvent`、`presentationDeferStream`、`streamBuffer`/`streamPostChain`/`outboundMessageId`；门控见 [10](./10-SDK上下文保护与失败归因.md)。

## 七、非功能与可观测

RunGuard+`enterGuardWithLifecycle`+watchdog；SSE 未知 WARN；失败经 `formatRunFailureMessage` 与模板归档。ordering 闩与 `resetOpencodeRunPresentationState` 防跨 Run 串 POST。

## 八、推送

无；出站对称 SDK/CC/Codex；终态 `notifySessionChat`。

## 九、已知限制与 TODO

外部探活依赖 `config.get`；embedded server 冷启动后 `opencodeSessionId` 有效性待验证。Codex ordering 不在本引擎范围。

## 十、变更记录

- 2026-07-12：主进程续接 `opencode-run-recover`+`opencode-active-runs.json`（archive 20260712113332）。
- 2026-07-12：Presentation defer/Rev2 end-only 对齐 Cursor（archive 20260712113320）。
- 2026-07-12：Engine Port + RunLifecycle（archive 20260711232258）。
- 2026-06-30：OpenCode 四引擎接入（archive 20260630105159）。
