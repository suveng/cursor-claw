# Cursor SDK 执行引擎

## 一、能力范围

`@cursor/sdk` Electron 执行 IM/任务/工作流；`sdk-run-*` 事件流/续接；出站 `presentation-event`+`stream-text`。不负责 Daemon 队列与其他引擎（07–09）。

## 二、设计决策与取舍

- **API/MCP/续接**：长驻+二次 send；事件流 SSOT `run.stream()`；MCP inline+`settingSources`；`sdk-active-runs.json` 续接。
- **呈现/ordering/watchdog**：Rev2 end-only、飞书 f41、tool 分级、watchdog 门控见 `electron/agent/cursor-sdk/AGENTS.md`。
- **冷启动**：`launchSdkAgent` 内 `Agent.create`（一次 detailed bootstrap，`launchBootstrapDone=true`）∥ `resolveContextLimitForSession`→`Promise.all` 后才 send；A1 启发式 `MODEL_LIMIT_HEURISTICS` 同步写 `modelLimitCache`，`models.list` 后台 refresh（`context-usage-model-limit.ts`，`refreshInflight` 去重）；A3 `canReuseBootstrapSnapshot` 有 `lastInjectedMcpServers` 时 `buildSendOptions` 跳过 `logSdkConfigSources` 二次 detailed bootstrap；B1 `warmupSdkAfterBind` 三挂点（`init`/`bind-electron`/`POST /api/sdk-warmup`）fire-and-forget。热路径 `dispatchToSdkAgent` 串行 limit（cache 命中 no-op）。

## 三、服务端规则

1. SDK 资源+API Key；模型默认 `composer-2`；非超时 `failedCooldowns` 30s。
2. 呈现/pre-send/resident-refresh/opaque_retry 见 AGENTS.md 与 [10](./10-SDK上下文保护与失败归因.md)。
3. 冷启动 B2：`Promise.all` 后「正在准备模型…」；Daemon 阶段一「正在连接 Agent…」见 [03](./03-启动与自动重连.md)。

## 四、客户端流程

`launch`/`dispatch`→`startSdkRun`→`streamRunEvents`→`completeSdkRun`；冷启动三阶段时序见 [03](./03-启动与自动重连.md) §四。

## 五、接口

`launchSdkAgent`/`dispatchToSdkAgent`；`POST /api/agent/launch|dispatch`；`POST /api/sdk-warmup`（body `source`/`channel_id`/`workspace_dir`→`warmupSdkAfterBind`，200 即返）。出站 `presentation-event`、`stream-text`。

## 六、数据

冷启动相关：`contextLimitTokens`、`lastInjectedMcpServers`、`launchBootstrapDone?`；模块 `modelLimitCache`/`refreshInflight`（`context-usage-model-limit.ts`）。其余见 `SdkSessionAgent` 与 `sdk-active-runs.json`。

## 七、非功能与可观测

RunGuard+watchdog；400ms 节流；`[sdk_warmup]`/`[model_limit_refresh]` 可检索；失败 IM 见 [10](./10-SDK上下文保护与失败归因.md)。推送：`presentation-event`+`stream-text`（飞书 f41 收尾 plain）。

## 八、推送

无（并入 §七）。

## 九、已知限制与 TODO

`agent.send` 外部 ~12s 非本期范围；冷门 model 首条 limit 可能暂缺。

## 十、变更记录

- 2026-07-11：首条冷启动优化（archive 20260711211323）。
- 2026-07-11：SDK 1.0.23（archive 20260711201234）。
- 2026-07-05：pre-send 上下文保护（archive 20260705230806）。
- 2026-07-04：Rev2 end-only + ordering（archive 20260704190748）。
