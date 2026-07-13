# Agent 调度

> 多会话并行、启动/重连、远程指令与定时任务调度。

## 职责边界

**负责**：五类会话、Cursor/Claude/Codex/OpenCode **四引擎** IM/任务/工作流、续接、Daemon 调度、远程指令、Cron。

**不负责**：消息通道连接、MCP 工具实现、工作流 YAML（见工作流域）。

## 文件清单

* [[01-概览]] - 总图、架构、术语
* [[02-多会话模型]] - ChatType、sessionKey、同目录提示
* [[03-启动与自动重连]] - 四引擎启动、resume、空闲预热
* [[04-远程指令]] - 远程指令（含 /stop /status）
* [[05-定时任务]] - Cron
* [[06-CursorSDK执行引擎]] - Cursor SDK（空闲预热、同目录提示、tool 卡住提示）
* [[07-ClaudeCodeSDK执行引擎]] - Claude Agent SDK
* [[08-CodexSDK执行引擎]] - Codex SDK
* [[09-OpenCodeSDK执行引擎]] - OpenCode SDK
* [[10-SDK上下文保护与失败归因]] - RunFailureReason、errorNotified、pre-send 保护

## 推荐阅读路径

1. 新人：01 → 02 → 03
2. 运维：04 → 05
3. IM 排查：03 → 04
4. SDK 排查：06 → 10 → 07 → 08 → 09 → 03
5. 长任务/多会话体感：06 → 02 → [[业务域/消息桥接/02-飞书通道]] → [[业务域/消息桥接/04-消息队列与路由]]

## 关键源码

| 模块 | 路径 |
|------|------|
| 调度 | `electron/session/session-dispatcher.ts`、`electron/agent/cursor-sdk/agent-sdk.ts` |
| Cursor 空闲预热/卡住提示 | `sdk-resident-bg-warmup.ts`、`sdk-resident-refresh.ts`、`sdk-tool-stuck-hint.ts`、`sdk-session-registry.ts` |
| Daemon 薄组装 | `daemon.ts`（`daemonMain`）；接线 `daemon-wire.ts`；队列 `daemon-queue.ts` |
| Daemon 编排 | `daemon-orchestrator.ts` + `daemon-orchestrator-dispatch.ts` |
| Daemon agent HTTP | `daemon-http-routes-orchestrator.ts`（`/api/agent/launch|dispatch`） |
| 回退/路由持久化 | `daemon-session-routing.ts`、`daemon-session-routing-persist.ts` |
| Electron Daemon | `electron/daemon/daemon-manager.ts`、`daemon-client.ts` |
| 远程/Cron | `electron/scheduling/command-handler.ts`、`cron-scheduler.ts` |
| 四引擎 SDK | [[06-CursorSDK执行引擎]]～[[09-OpenCodeSDK执行引擎]]；共享 `electron/agent/shared/*` |
| Session MCP / 配置 | `session-mcp-status.ts`、`config-store.ts` |
| Daemon notify | `daemon-orchestrator-notify.ts`、`orchestrator-failure-formatter.ts` |
| 契约冒烟 | `npm run test:run-notify-contract` |
