# Codex SDK 执行引擎

## 一、能力范围

`@openai/codex-sdk`：`new Codex` + `startThread`/`resumeThread` + `runStreamed`、launch/dispatch、Presentation、`codex-agent-api`、MCP 内联、`codexSessionId` 续接。经 `engine-port-adapter.ts` 实现 `AgentEnginePort`，终态经 `RunLifecycle`+`completeRunFromTemplate`。不负责其他引擎与 Daemon claim。

## 二、设计决策与取舍

- **Engine Port**：`registerCodexEnginePort`；`mapCodexThreadEventToRunEvent` 映射 `ThreadEvent`→`RunEvent`。
- **终态出口**：`completeCodexViaLifecycle`/`notifyCodexRunFailure`/`notifyCodexWatchdogTimeout`→shared 模板；运行中 IM 直接 import `run-notify`（无本地 notify 副本）。
- **失败文案**：`codex-failure-messages.ts` 脱敏+归因提取，用户句委托 `formatRunFailureMessage`。
- **resume**：`codexSessionId` 来自 `startThread`/`resumeThread`；dispatch 复用 `resolveCodexThread`。
- **主进程续接（S7）**：`recoverCodexActiveRuns` 经 `recoverAllActiveRuns`；读 `codex-active-runs.json`；CLI 不可用→`failAllCodexRunsOnCliMissing` 逐条 IM+清盘（**不再**整函数静默早退，父变更 T-FIX-01 已清偿）；guard 前 `probeCodexRecoverTarget`（`codex-run-probe.ts`）→`startCodexRun`；失败经 `classifyResumeFailure`→`notifyResumeFailure`。
- **MCP**：`codex-mcp-loader` 读 `~/.codex` 与 `{ws}/.codex/config.toml`，project>global。

## 三、服务端规则

1. `type==="codex"` + API Key；模型空 → `CODEX_DEFAULT_MODEL_ID`。
2. `pendingDispatch` 时 launch→dispatch；`enterGuardWithLifecycle` 单飞。
3. ContextRotation 清 `codexSessionId`；Profile 已删 → `opencode-missing` 对称 `codex-missing`。
4. 任务/工作流 POST `codex-agent-api`；IM 经统一网关 `agent-sdk-http`。

## 四、客户端流程

```mermaid
sequenceDiagram
  GW["agent-sdk-http"]->>Port["engine-port-adapter"]
  Port->>CX["runStreamed"]
  CX-->>EV["ThreadEvent→RunEvent"]
  EV->>Tpl["completeRunFromTemplate"]
```

## 五、接口

| 入口 | 说明 |
|------|------|
| `AgentEnginePort` 六方法 | `engine-port-adapter.ts` |
| `launchCodexAgent`/`dispatchToCodexAgent` | 首条/resume |
| `POST /api/codex/agent/launch\|dispatch` | 本地 HTTP |
| `POST /api/agent/launch\|dispatch` | IM 统一网关 |

## 六、数据

`CodexSessionAgent`（`agent-codex-types.ts`）；`codex-active-runs.json`（`CodexActiveRunRecord`：`codexSessionId`、`lastTaskMessage`、呈现游标）；`errorNotified`/`watchdogTimedOut`/`runFinalizing` 门控见 [10](./10-SDK上下文保护与失败归因.md)。

## 七、非功能与可观测

RunGuard+`enterGuardWithLifecycle`+`armCodexWatchdog`（S8 busy→`notifyGuardBusy` 一次 IM）；事件未知类型 WARN；apiKey 脱敏 `maskCodexApiKey`；失败归档经 `completeRunFromTemplate`。

## 八、推送

无；出站对称 SDK/CC（stream-text/presentation-event）；终态 `notifySessionChat`。

## 九、已知限制与 TODO

Dashboard MCP 占位；须本机 Codex CLI；`probeCodexRecoverTarget` 用空 prompt 首事件探活（SDK 无只读 thread API）；ponytail 升级路径见 `electron/agent/codex/AGENTS.md`。

## 十、变更记录

- 2026-07-12：续接终态 hardening — CLI 缺失逐条 notify、`codex-run-probe`、失败分类（archive 20260712145449；清偿父变更 Codex CLI 早退债）。
- 2026-07-12：主进程续接 `codex-run-recover`+`codex-active-runs.json`（archive 20260712113332）。
- 2026-07-12：Engine Port + RunLifecycle（archive 20260711232258）。
- 2026-06-30：Codex 三引擎接入（archive 20260630104714）。
