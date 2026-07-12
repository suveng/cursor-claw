# Codex SDK 执行引擎

## 一、能力范围

`@openai/codex-sdk`：`new Codex` + `startThread`/`resumeThread` + `runStreamed`、launch/dispatch、Presentation ordering、`codex-agent-api`、MCP 内联、`codexSessionId` 续接。经 `engine-port-adapter.ts` 实现 `AgentEnginePort`，终态经 `RunLifecycle`+`completeRunFromTemplate`。不负责其他引擎与 Daemon claim。

## 二、设计决策与取舍

- **Engine Port**：`registerCodexEnginePort`；`mapCodexThreadEventToRunEvent` 映射 `ThreadEvent`→`RunEvent`。
- **终态出口**：`completeCodexViaLifecycle`/`notifyCodexRunFailure`/`notifyCodexWatchdogTimeout`→shared 模板；运行中 IM 直接 import `run-notify`。
- **失败文案**：`codex-failure-messages.ts` 脱敏+归因提取，用户句委托 `formatRunFailureMessage`。
- **resume**：`codexSessionId` 来自 `startThread`/`resumeThread`；dispatch 复用 `resolveCodexThread`。
- **续接（S7）**：`recoverCodexActiveRuns`；CLI 不可用→`failAllCodexRunsOnCliMissing` 逐条 IM+清盘；guard 前 `probeCodexRecoverTarget`→`startCodexRun`。
- **MCP**：`codex-mcp-loader` 读 `~/.codex` 与 `{ws}/.codex/config.toml`，project>global。
- **Presentation ordering（Rev2 end-only）**：对称 OpenCode/Cursor；门控 `presentationOrderingEligible`；defer 内联 `agent-codex-stream.ts`；notify 置双侧闩；禁止 Electron 飞书早退；终态 `flushCodexStreamPost(true)`；tool 分级见 `agent-codex-events.ts` 与 AGENTS.md。

## 三、服务端规则

1. `type==="codex"` + API Key；模型空 → `CODEX_DEFAULT_MODEL_ID`。
2. `pendingDispatch` 时 launch→dispatch；`enterGuardWithLifecycle` 单飞。
3. ContextRotation 清 `codexSessionId`；Profile 已删 → `codex-missing`。
4. 任务/工作流 POST `codex-agent-api`；IM 经统一网关 `agent-sdk-http`。
5. `PRESENTATION_ORDERING=0` 时 defer/preamble 全链 no-op，回滚现网直通。

## 四、客户端流程

ThreadEvent tool 分级→presentation-event；含过程 Run non-final assistant 仅 buffer；收尾 `completeCodexRun` final flush 唯一 assistant IM。

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
| 出站 | `POST /api/presentation-event`、`POST /api/stream-text`（Daemon） |

## 六、数据

`CodexSessionAgent`；ordering 闩 `seenProcessEvent`/`presentationDeferStream`/`streamBuffer`（`agent-codex-stream.ts`）；`codex-active-runs.json`；门控字段见 [10](./10-SDK上下文保护与失败归因.md)。

## 七、非功能与可观测

RunGuard+`enterGuardWithLifecycle`+`armCodexWatchdog`（S8 busy→`notifyGuardBusy`）；未知事件 WARN；apiKey 脱敏；`resetCodexRunPresentationState` 防跨 Run 串 POST；失败归档经 `completeRunFromTemplate`。

## 八、推送

无；出站对称 SDK/CC/OpenCode（stream-text/presentation-event）；终态 `notifySessionChat`。

## 九、已知限制与 TODO

Dashboard MCP 占位；须本机 Codex CLI；`probeCodexRecoverTarget` 空 prompt 探活；defer 内联 stream（可拆 `agent-codex-presentation.ts`）。

## 十、变更记录

- 2026-07-12：Presentation ordering Rev2 end-only（20260712145313）；续接 hardening（20260712145449）；主进程续接（20260712113332）；Engine Port（20260711232258）。
- 2026-06-30：Codex 三引擎接入（20260630104714）。
