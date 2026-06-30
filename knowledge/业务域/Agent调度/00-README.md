# Agent 调度

> 多会话并行、启动/重连、远程指令与定时任务调度。

## 职责边界

**负责**：五类会话、Cursor/Claude/Codex **三引擎** IM/任务/工作流、续接、Daemon 调度、远程指令、Cron。

**不负责**：消息通道连接、MCP 工具实现、工作流 YAML（见工作流域）。

## 文件清单

| 编号 | 文件 | 内容 |
|------|------|------|
| 01 | [01-概览.md](./01-概览.md) | 总图、架构、术语 |
| 02 | [02-多会话模型.md](./02-多会话模型.md) | ChatType、sessionKey |
| 03 | [03-启动与自动重连.md](./03-启动与自动重连.md) | 三引擎启动、resume |
| 04 | [04-远程指令.md](./04-远程指令.md) | 远程指令 |
| 05 | [05-定时任务.md](./05-定时任务.md) | Cron |
| 06 | [06-CursorSDK执行引擎.md](./06-CursorSDK执行引擎.md) | Cursor SDK |
| 07 | [07-ClaudeCodeSDK执行引擎.md](./07-ClaudeCodeSDK执行引擎.md) | Claude Agent SDK |
| 08 | [08-CodexSDK执行引擎.md](./08-CodexSDK执行引擎.md) | Codex SDK |

## 推荐阅读路径

1. 新人：01 → 02 → 03
2. 运维：04 → 05
3. IM 排查：03 → 04
4. SDK 排查：06 → 07 → 08 → 03

## 关键源码

| 模块 | 路径 |
|------|------|
| 调度 | `electron/session-dispatcher.ts`、`electron/agent-sdk.ts` |
| Cursor | `electron/agent-sdk.ts` |
| Claude | `electron/agent-claude-sdk.ts`、`electron/agent-cc-*.ts` |
| Codex | `electron/agent-codex-sdk.ts`、`electron/agent-codex-*.ts`、`electron/codex-mcp-loader.ts` |
| HTTP | `agent-cc-http.ts`（cc 端口）、`agent-codex-http.ts`（codex 端口） |
| 配置 | `electron/config-store.ts` |

## 变更记录

2026-06-30：新增 08 Codex SDK；三引擎 `agent-codex-*`（archive 20260630104714）。
2026-06-30：新增 06/07 执行引擎文档（kb-sync）。
2026-06-29：扩展 Claude Code SDK（archive 20260629164130）。
