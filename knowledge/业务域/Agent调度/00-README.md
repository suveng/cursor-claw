# Agent 调度

> 多会话并行、启动/重连、远程指令与定时任务调度。

## 职责边界

**负责**：五类会话、Cursor/Claude/Codex/OpenCode **四引擎** IM/任务/工作流、续接、Daemon 调度、远程指令、Cron。

**不负责**：消息通道连接、MCP 工具实现、工作流 YAML（见工作流域）。

## 文件清单

| 编号 | 文件 | 内容 |
|------|------|------|
| 01 | [01-概览.md](./01-概览.md) | 总图、架构、术语 |
| 02 | [02-多会话模型.md](./02-多会话模型.md) | ChatType、sessionKey |
| 03 | [03-启动与自动重连.md](./03-启动与自动重连.md) | 四引擎启动、resume |
| 04 | [04-远程指令.md](./04-远程指令.md) | 远程指令 |
| 05 | [05-定时任务.md](./05-定时任务.md) | Cron |
| 06 | [06-CursorSDK执行引擎.md](./06-CursorSDK执行引擎.md) | Cursor SDK（含冷启动并行与 bind 预热） |
| 07 | [07-ClaudeCodeSDK执行引擎.md](./07-ClaudeCodeSDK执行引擎.md) | Claude Agent SDK |
| 08 | [08-CodexSDK执行引擎.md](./08-CodexSDK执行引擎.md) | Codex SDK |
| 09 | [09-OpenCodeSDK执行引擎.md](./09-OpenCodeSDK执行引擎.md) | OpenCode SDK |
| 10 | [10-SDK上下文保护与失败归因.md](./10-SDK上下文保护与失败归因.md) | RunFailureReason、errorNotified、pre-send 保护 |

## 推荐阅读路径

1. 新人：01 → 02 → 03
2. 运维：04 → 05
3. IM 排查：03 → 04
4. SDK 排查：06 → 10（上下文已满/pre-send）→ 07 → 08 → 09 → 03

## 关键源码

| 模块 | 路径 |
|------|------|
| 调度 | `electron/session/session-dispatcher.ts`、`electron/agent/cursor-sdk/agent-sdk.ts` |
| Daemon 薄组装 | `src/daemon/daemon.ts`（`daemonMain`/`wireDaemonSubmodules`；queue/channel 仍驻此，批2） |
| Daemon 编排 | `src/daemon/daemon-orchestrator.ts`（`runAgentDispatchLoop`、`forwardElectronAgentApi`、`dispatchSessionToAgent`） |
| Daemon agent HTTP | `src/daemon/daemon-http-routes-orchestrator.ts`（`/api/agent/launch|dispatch` 路由簇） |
| 回退栈 | `src/daemon/daemon-session-routing.ts` |
| Daemon | `electron/daemon/daemon-manager.ts`、`electron/daemon/daemon-client.ts` |
| 远程/Cron | `electron/scheduling/command-handler.ts`、`electron/scheduling/cron-scheduler.ts` |
| Cursor | `electron/agent/cursor-sdk/agent-sdk.ts`、`electron/agent/cursor-sdk/sdk-run-*.ts`、`electron/agent/cursor-sdk/sdk-warmup.ts`、`electron/agent/cursor-sdk/context-usage-model-limit.ts`、`electron/mcp/loaders/mcp-sdk-loader.ts` |
| Claude | `electron/agent/claude-code/agent-claude-sdk.ts`、`electron/agent/claude-code/agent-cc-*.ts`、`electron/mcp/loaders/cc-mcp-loader.ts` |
| Codex | `electron/agent/codex/agent-codex-sdk.ts`、`electron/agent/codex/agent-codex-*.ts`、`electron/mcp/loaders/codex-mcp-loader.ts` |
| OpenCode | `electron/agent/opencode/agent-opencode-sdk.ts`、`electron/agent/opencode/agent-opencode-*.ts`、`electron/mcp/loaders/opencode-mcp-loader.ts`、`electron/agent/opencode/opencode-failure-messages.ts` |
| Session MCP | `electron/session/session-mcp-status.ts` |
| 跨引擎 Port/Lifecycle | `electron/agent/shared/run-lifecycle*.ts`、`agent-engine-port.ts`、`run-notify.ts`、`run-failure-formatter.ts`、`run-complete-template.ts` |
| Daemon dispatch notify | `src/daemon/daemon-orchestrator-notify.ts`、`src/shared/orchestrator-failure-formatter.ts` |
| 契约冒烟 | `npm run test:run-notify-contract`（变更 auto_test，mock 终态 IM） |
| 跨引擎 | `electron/agent/shared/agent-launcher.ts`、`electron/agent/shared/crash-log-archiver.ts`、`electron/agent/shared/agent-run-guard.ts` |
| HTTP | `electron/agent/cursor-sdk/agent-sdk-http.ts`（统一网关）、`electron/agent/claude-code/agent-cc-http.ts`（cc）、`electron/agent/codex/agent-codex-http.ts`（codex）、`electron/agent/opencode/agent-opencode-http.ts`（opencode） |
| 配置 | `electron/config/config-store.ts`（`newOpencodeResourceId`/`isOpencodeResourceId`） |

## 变更记录

- 2026-07-12：关键源码补 Engine Port / RunLifecycle / dispatch 对称 notify（archive 20260711232258）。
- 2026-07-11：关键源码 Daemon 编排锚点扩散（巨型单体拆分批1）。
2026-07-05：新增 10 SDK 上下文保护（archive 20260705230806）。
2026-07-02：关键源码增补 Daemon 编排（archive 20260702120154）。
2026-07-02：关键源码补 sdk-run-* 事件流/续接模块（archive 20260701212827）。
2026-07-02：关键源码补 Cursor SDK 配置加载模块（archive 20260701212732）。
2026-06-30：新增 09 OpenCode SDK；四引擎 `agent-opencode-*`（archive 20260630105159）。
2026-06-30：07 §二/§五/§七/§九 补 project scope 审批门控与启用展示（archive 20260630140113）。
2026-06-30：新增 08 Codex SDK；三引擎 `agent-codex-*`（archive 20260630104714）。
2026-06-30：新增 06/07 执行引擎文档（kb-sync）。
2026-06-29：扩展 Claude Code SDK（archive 20260629164130）。
