# 完全移除 Cursor CLI 依赖 - 变更总结

> **变更 ID**：`20260629232914-完全移除Cursor CLI依赖`  
> **提交**：`be3cdf7` — feat: 完全移除 Cursor CLI 依赖，统一 SDK/Claude Code 路径  
> **统计**：27 文件，+1021 / −1631 行

## 1、实际变更

**删除文件（1 个）**：

| 文件 | 职责（删除前） |
|------|----------------|
| `electron/agent-cli.ts` | CLI spawn、`execAgentSync`、`agent mcp *` / `--list-models` 封装 |

**新增文件（5 个）**：

| 文件 | 行数 | 职责 |
|------|------|------|
| `electron/mcp-tools-probe.ts` | 148 | MCP 工具列表 HTTP/stdio 探测（自 mcp-manager 拆出） |
| `electron/mcp-status-map.ts` | 90 | MCP 健康状态聚合（disabled / ready / needs_login 等） |
| `electron/mcp-types.ts` | 20 | MCP 共享类型 |
| `electron/proxy-env.ts` | 30 | `applyProxyEnv`（自 agent-cli 迁出，SDK/CC 共用） |
| `src/renderer/components/AgentResourceModals.tsx` | 113 | SDK / Claude Code 资源新建弹窗（替代 AgentPanel 内联 CLI 区块） |

**修改文件（21 个）**：

| 文件 | 改动要点 |
|------|----------|
| `electron/mcp-manager.ts` | 去 CLI 化：enabled/status 读 `mcp.json` + 探测；toggle 写 `disabled`；login 改 OAuth 说明；删 `fetchMcpList` / `queryToolsViaCli` |
| `electron/command-handler.ts` | 飞书 `/mcp`、`/model` 走新 MCP API 与 SDK/CC 模型列表；无 CLI 分支 |
| `electron/config-store.ts` | 移除虚拟 `cli` 资源；`migrateCliBindings` / `cliMigrationPending`；`ensureSdkChannelBindings` 改绑 |
| `electron/main.ts` | 删 `cli:*`、`models:list` IPC；保留 `mcp:*`、`sdk:*`、`cc:*` |
| `electron/preload.ts` | 同步删 CLI IPC bridge；`AgentResource.type` 仅 sdk / claude-code |
| `electron/agent-launcher.ts` | 删 CLI spawn / login / sessionAgents；保留 `buildPrompt` 等 SDK/CC 共享符号（59 行） |
| `electron/agent-sdk.ts` | 移除 CLI 相关 import；proxy 改 `proxy-env` |
| `electron/agent-cc-http.ts` | proxy 改 `proxy-env` |
| `electron/daemon-manager.ts` | 去 CLI 状态探测与 re-export |
| `electron/AGENTS.md` | 删除 CLI spawn / MCP CLI 约定句 |
| `src/shared/channel-types.ts` | `AgentResource.type` 删除 `"cli"` |
| `src/renderer/pages/Settings.tsx` | MCP Tab 无 CLI 依赖文案；Setup 引导 SDK/CC |
| `src/renderer/pages/Dashboard.tsx` | 去 CLI 安装/登录；历史迁移 Banner |
| `src/renderer/components/AgentPanel.tsx` | 仅 SDK/CC 资源管理 |
| `src/renderer/components/ChannelPanel.tsx` | 资源下拉无 CLI |
| `src/renderer/components/ChannelModelSection.tsx` | 模型路径统一 SDK API / CC Profile |
| `src/renderer/components/WorkflowPanel.tsx` | 任务模型列表无 CLI |
| `src/renderer/env.d.ts` | 删 CLI IPC 类型 |
| `README.md` | 强调无需 Cursor CLI |
| `src/daemon.ts` | 帮助文案扫尾 |

**未改（显式）**：`session-dispatcher.ts`、`agent-claude-sdk.ts`、`mcp-sdk-loader.ts`、Daemon IM 编排与飞书/微信连接层。

## 2、与设计的差异

1. **MCP 模块拆分**：设计 §三 预期改造集中 `mcp-manager.ts`；实际为遵守 300 行约束拆出 `mcp-tools-probe.ts`、`mcp-status-map.ts`、`mcp-types.ts`，行为与设计 §八·（二）一致。
2. **迁移标志命名**：设计 §五 写 `cliMigrationNotified`；实现为 `cliMigrationPending` + `config:mark-cli-migration-notified` IPC，语义等价（待展示 Banner → 用户确认后清除）。
3. **`DaemonStatus.cliAvailable`**：设计 §五 要求删除；`preload.ts` / `env.d.ts` 仍保留可选字段 `cliAvailable?` 以兼容旧 Renderer 类型，运行时不再赋值（无功能影响）。
4. **`AppConfig.agentMode`**：设计 §五 标记 deprecated；字段仍为 `"cli" \| "sdk"` 持久化兼容，UI 已不暴露 CLI 模式切换。
5. **`AgentResourceModals.tsx`**：设计未单列文件；T5 实施时从 AgentPanel 抽出弹窗组件，属 Renderer 结构优化，非行为变更。

## 3、影响范围

涉及模块：MCP 运维（`mcp-manager` 及拆分模块）、配置迁移（`config-store`）、IPC 面（`main`/`preload`）、Renderer  onboarding 与资源管理、飞书指令（`command-handler`）。

**执行主路径不变**：IM / 定时任务 / 工作流仍经 `session-dispatcher.launchAgent` → SDK（`agent-sdk`）或 Claude Code（`agent-claude-sdk`）。

**MCP 双路径**：

- **Settings / 飞书 `/mcp`**：读写 `~/.cursor/mcp.json`、项目 `.cursor/mcp.json`，健康探测走 HTTP/stdio（无 `agent mcp`）。
- **SDK Run 运行时**：仍由 `mcp-sdk-loader` 读 json `disabled` 注入 inline MCP（与 Settings 开关一致）。

### 3.1 遗留注释（非业务调用）

| 位置 | 说明 |
|------|------|
| `electron/mcp-manager.ts:189` | 注释说明不再 spawn `agent mcp login` |
| `electron/mcp-project-dir.ts:48` | 注释说明 OAuth token 来源（历史 CLI 写入路径） |
| `electron/preload.ts` / `ui-logger.ts` | 类型 union 仍含 `"cli"` 字面量，仅兼容旧日志分区 |

## 4、知识库影响清单

- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — 删 `models:list`/`cli:*`；MCP 改文件+探测；§七 MCP CLI 超时描述过时
- [x] `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` — `AgentResource` 无 cli 类型；`migrateCliBindings` / `cliMigrationPending`
- [x] `knowledge/业务域/Agent调度/00-README.md` — 关键源码删 `agent-cli.ts`；职责边界去「CLI/SDK 启动」并列表述
- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — CLI 启动/resume 段落改 SDK/CC-only
- [x] `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md` — Dashboard onboarding、AgentPanel 仅 SDK/CC（视截图级描述是否过时）
- [x] `electron/AGENTS.md` — 本变更已同步删除 CLI 约定句
- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — 会话模型与 CLI 无关，不需要更新
- [x] Daemon / IM 合并流式知识文件 — 执行路径未变，不需要更新
