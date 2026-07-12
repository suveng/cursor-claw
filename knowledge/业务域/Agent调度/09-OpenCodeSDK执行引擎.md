# OpenCode SDK 执行引擎

## 一、能力范围

`@opencode-ai/sdk`：内嵌/外部 Client、`session.create`/`prompt`、SSE、`opencode-agent-api`、MCP 内联、`opencodeSessionId` 续接。经 `engine-port-adapter.ts` 实现 `AgentEnginePort`，终态经 `RunLifecycle`+`completeRunFromTemplate`。不负责其他引擎与 Daemon claim。

## 二、设计决策与取舍

- **Engine Port**：`registerOpencodeEnginePort`；`mapOpencodeSseToRunEvent` 映射 SSE→`RunEvent`。
- **终态出口**：`completeOpencodeViaLifecycle`/`notifyOpencodeRunFailure`/`notifyOpencodeWatchdogTimeout`→shared 模板；运行中 IM 直接 import `run-notify`。
- **Client**：`resolveOpencodeClient` — embedded 懒启动 / external 连 `baseUrl`；探活 `config.get()`。
- **MCP**：`opencode-mcp-loader` 读 `opencode.json`/项目配置。

## 三、服务端规则

1. `type==="opencode"` 须 `providerId`/`apiKey`；模型空 → `OPENCODE_DEFAULT_MODEL`。
2. `pendingDispatch` launch→dispatch；`enterGuardWithLifecycle` 单飞。
3. 轮转清 `opencodeSessionId`；Profile 已删 → `opencode-missing`。
4. 任务/工作流 POST `opencode-agent-api`；IM 经统一网关。

## 四、客户端流程

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

## 六、数据

`OpencodeSessionAgent`：`opencodeSessionId`、`errorNotified`、`watchdogTimedOut`、`runFinalizing` 等；门控见 [10](./10-SDK上下文保护与失败归因.md)。

## 七、非功能与可观测

RunGuard+watchdog；SSE 未知 WARN；`opencode-failure-messages` 委托 `formatRunFailureMessage`；失败归档经模板。

## 八、推送

无；出站对称 SDK/CC/Codex；终态 `notifySessionChat`。

## 九、已知限制与 TODO

`presentationOrderingEligible` 未接入；外部探活依赖 `config.get`；运行态 IM 全矩阵待手工（accepted_debt R5）。

## 十、变更记录

- 2026-07-12：Engine Port + RunLifecycle（archive 20260711232258）。
- 2026-06-30：OpenCode 四引擎接入（archive 20260630105159）。
