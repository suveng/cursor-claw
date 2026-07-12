# Claude Code SDK 执行引擎

## 一、能力范围

`claude-agent-sdk` `query()` 执行：launch/dispatch、事件映射 Presentation、`cc-agent-api` HTTP、MCP 内联与 `ccSessionId` 续接。经 `engine-port-adapter.ts` 实现 `AgentEnginePort`，终态经 `RunLifecycle`+`completeRunFromTemplate`。不负责 Cursor SDK（[06](./06-CursorSDK执行引擎.md)）、Daemon IM 编排。

## 二、设计决策与取舍

- **Engine Port**：`registerCcEnginePort` 于 `agent-sdk-http`；`mapCcSdkMessageToRunEvent`/`emitCcQueryTerminalRunEvent` 供 `agent-cc-events.ts` 路由。
- **终态出口**：`completeCcViaLifecycle`/`notifyCcRunFailure`/`notifyCcWatchdogTimeout`→`enterNotifying`→`completeRunFromTemplate`；`agent-cc-notify.ts` **仅** re-export `run-notify`。
- **resume/续接（S7）**：`ccSessionId`+`options.resume`；`recoverCcActiveRuns` guard 前 `probeCcRecoverTarget`（`cc-run-probe.ts`）→`RunLifecycle.resume`→guard→`startCcQuery`（可重发 `lastTaskMessage`）；失败经 `classifyResumeFailure`→`notifyResumeFailure(reason,category)`；`userStopped` 跳过。
- **MCP inline**：`cc-mcp-loader`+审批门控；`strictMcpConfig:true` 见 AGENTS.md。

## 三、服务端规则

1. 通道 `type === "claude-code"` 且配 API Key；默认 `claude-sonnet-4-6`。
2. `activeQuery` 非空时 launch 转 dispatch；`createRunLifecycle`+`enterGuardWithLifecycle` 单飞（S8：busy 经 `notifyGuardBusy` 一次 IM，`session_abnormal`/`agent_busy`，handler 仅 `{ ok: false, error: "agent busy" }` 不二次 notify）。
3. 超时：`finalizeCcRunOnWatchdogTimeout`→`completeCcViaLifecycle`，`watchdogTimedOut` 闩；用户 stop 不 notify。
4. ContextRotation 命中清 `ccSessionId`。

## 四、客户端流程

```mermaid
sequenceDiagram
  GW["agent-sdk-http"]->>Port["engine-port-adapter"]
  Port->>CC["query()"]
  CC-->>EV["agent-cc-events RunEvent"]
  EV->>LC["RunLifecycle"]
  LC->>Tpl["completeRunFromTemplate"]
```

IM 委托 `launchCcAgentFromHttp`（统一网关路由）。

## 五、接口

| 入口 | 说明 |
|------|------|
| `AgentEnginePort` 六方法 | `engine-port-adapter.ts` |
| `launchClaudeCodeAgent`/`dispatchToClaudeCodeAgent` | query 首条 / resume |
| `POST /api/cc/agent/launch\|dispatch` | 任务/工作流直连 |
| `POST /api/agent/launch\|dispatch` | IM 经 Daemon 统一网关 |

## 六、数据

`CcSessionAgent`：`errorNotified`、`watchdogTimedOut`、`runFinalizing`、`ccSessionId`、`activeQuery` 等；`cc-active-runs.json` 快照（`CcActiveRunRecord`：续接键 `ccSessionId`、`lastTaskMessage`、呈现游标）；Lifecycle 门控见 [10](./10-SDK上下文保护与失败归因.md)。

## 七、非功能与可观测

RunGuard+`enterGuardWithLifecycle`+`armCcWatchdog`；busy IM 对称四引擎；`[recover]` 可检索；续接分类 IM 见 [10](./10-SDK上下文保护与失败归因.md)。

## 八、推送

无独立推送；IM 出站对称 Cursor SDK（stream-text/presentation-event/send-text）；f41 plain 收尾经 `flushFeishuPlainAssistantIfNeeded`。

## 九、已知限制与 TODO

project scope 审批未并读 settings 多源（R1 accepted_debt）；`probeCcRecoverTarget` 用 `getSessionInfo` 仅校验会话文件存在性（非 Run 运行时态）；ponytail 升级路径见 `electron/agent/claude-code/AGENTS.md`。

## 十、变更记录

- 2026-07-12：续接 hardening — `cc-run-probe`+分类 IM（20260712145449）。
- 2026-07-12：主进程续接 `cc-run-recover`+`cc-active-runs.json`（archive 20260712113332）。
- 2026-07-12：Engine Port + RunLifecycle，终态委托 shared（archive 20260711232258）。
- 2026-07-05：飞书 f41 assistant plain 收尾。
- 2026-06-30：审批门控与 `query()` 落地（archive 20260630140113）。
