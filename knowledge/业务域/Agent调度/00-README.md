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
| Daemon 薄组装 | `daemon.ts`（`daemonMain`）；接线 `daemon-wire.ts`；队列 `daemon-queue.ts` |
| Daemon 编排 | `daemon-orchestrator.ts`（dispatch loop / launch|dispatch 转发） |
| Daemon agent HTTP | `daemon-http-routes-orchestrator.ts`（`/api/agent/launch|dispatch`） |
| 回退/路由持久化 | `daemon-session-routing.ts`、`daemon-session-routing-persist.ts` |
| Electron Daemon | `electron/daemon/daemon-manager.ts`、`daemon-client.ts` |
| 远程/Cron | `electron/scheduling/command-handler.ts`、`cron-scheduler.ts` |
| 四引擎 SDK | 见 [06](./06-CursorSDK执行引擎.md)～[09](./09-OpenCodeSDK执行引擎.md)；共享 `electron/agent/shared/*` |
| Session MCP / 配置 | `session-mcp-status.ts`、`config-store.ts` |
| Daemon notify | `daemon-orchestrator-notify.ts`、`orchestrator-failure-formatter.ts` |
| 契约冒烟 | `npm run test:run-notify-contract` |

## 变更记录

- 2026-07-12：勾销批2 注记；薄组装锚点对齐 queue/wire（archive 20260712170438）。
- 2026-07-12：`daemon-session-routing-persist`、四引擎 recover、Engine Port/notify（20260712113356 等）。
- 2026-07-11：Daemon 编排锚点扩散（巨型单体拆分批1）。
- 2026-07-05～06-29：10 上下文保护、06～09 引擎文档与 Codex/OpenCode/Claude 扩展。

