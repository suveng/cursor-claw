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
| 06 | [06-CursorSDK执行引擎.md](./06-CursorSDK执行引擎.md) | Cursor SDK |
| 07 | [07-ClaudeCodeSDK执行引擎.md](./07-ClaudeCodeSDK执行引擎.md) | Claude Agent SDK |
| 08 | [08-CodexSDK执行引擎.md](./08-CodexSDK执行引擎.md) | Codex SDK |
| 09 | [09-OpenCodeSDK执行引擎.md](./09-OpenCodeSDK执行引擎.md) | OpenCode SDK |

## 推荐阅读路径

1. 新人：01 → 02 → 03
2. 运维：04 → 05
3. IM 排查：03 → 04
4. SDK 排查：06 → 07 → 08 → 09 → 03

## 关键源码

| 模块 | 路径 |
|------|------|
| 调度 | `electron/session-dispatcher.ts`、`electron/agent-sdk.ts` |
| Cursor | `electron/agent-sdk.ts`、`electron/sdk-run-*.ts`、`electron/mcp-sdk-loader.ts`、`electron/session-mcp-sdk-path.ts` |
| Claude | `electron/agent-claude-sdk.ts`、`electron/agent-cc-*.ts` |
| Codex | `electron/agent-codex-sdk.ts`、`electron/agent-codex-*.ts`、`electron/codex-mcp-loader.ts` |
| OpenCode | `electron/agent-opencode-sdk.ts`、`electron/agent-opencode-*.ts`、`electron/opencode-mcp-loader.ts`、`electron/opencode-failure-messages.ts` |
| HTTP | `agent-cc-http.ts`（cc）、`agent-codex-http.ts`（codex）、`agent-opencode-http.ts`（opencode） |
| 配置 | `electron/config-store.ts`（`newOpencodeResourceId`/`isOpencodeResourceId`） |

## 变更记录

2026-07-02：关键源码补 sdk-run-* 事件流/续接模块（archive 20260701212827）。
2026-07-02：关键源码补 Cursor SDK 配置加载模块（archive 20260701212732）。
2026-06-30：新增 09 OpenCode SDK；四引擎 `agent-opencode-*`（archive 20260630105159）。
2026-06-30：07 §二/§五/§七/§九 补 project scope 审批门控与启用展示（archive 20260630140113）。
2026-06-30：新增 08 Codex SDK；三引擎 `agent-codex-*`（archive 20260630104714）。
2026-06-30：新增 06/07 执行引擎文档（kb-sync）。
2026-06-29：扩展 Claude Code SDK（archive 20260629164130）。
