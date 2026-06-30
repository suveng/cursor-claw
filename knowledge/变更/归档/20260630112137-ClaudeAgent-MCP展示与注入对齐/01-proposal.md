# ClaudeAgent MCP 展示与注入对齐产品需求文档

> **变更 ID**：`20260630112137-ClaudeAgent-MCP展示与注入对齐`
> **来源**：kb-propose　**类型**：缺陷修复 + 展示升级　**优先级**：P1
> **外部 PRD**：无　**Figma**：无　**任务记录**：无
> **原名**：`ClaudeAgent-MCP配置源修正`（方案升级为「注入层 + 展示层双层对齐」，改名）

## 背景

Agent MCP 面板展示当前会话注入的 MCP server 配置。当前 CC 引擎读取的配置源与 Claude Code 实际使用的不一致，导致展示与运行时脱节。

### 用户复现

工作区 `/Users/suwenguang/work/code`：

- `.mcp.json` 内 `codegraph` = `command: "codegraph", args: ["serve","--mcp"]`
- `.cursor/mcp.json` 内 `codegraph` = `command: "codegraph", args: ["serve","--mcp","--path","${workspaceFolder}"]`，带 `type: "stdio", enabled: true`

Dashboard 点击该工作区绑定的 Claude Agent 会话展开 MCP 面板，显示 `.cursor/mcp.json` 版本（带 `--path`），而 Claude Code 实际加载 `.mcp.json`（不带 `--path`），二者不符。

### 现状根因（已核实代码事实）

1. `electron/cc-mcp-loader.ts` `mergeMcpJsonEntries` 读 `~/.cursor/mcp.json` + `{ws}/.cursor/mcp.json`（从 `mcp-sdk-loader` 复制），**实现错误**：CC 原生源应是 `{ws}/.mcp.json` + `~/.claude.json`（user/local scope 的 `mcpServers`）。
2. `electron/mcp-manager.McpServerListForWorkspace(ws)` 同样只读 Cursor 路径；`mcp:list-for-workspace` IPC 仅按 `workspaceDir` 取列表，**不区分 engineType，也不绑 sessionKey**。
3. `src/renderer/components/SessionMcpPanel.tsx` 对所有 engineType 调 `listMcpForWorkspace(effectiveWs)`，未传 sessionKey。
4. `electron/agent-claude-sdk.ts` `buildQueryOptions` 经 `appendInlineMcpToCcOptions` 注入，**未设 `strictMcpConfig: true`**；SDK 仍原生加载 `.mcp.json`，与 inline 双重加载。
5. `electron/agent-cc-events.ts` 处理 `system/init` 只取 `session_id`/`model`，**未缓存 `mcp_servers`**（`SDKSystemMessage.mcp_servers: {name, status}[]`）。
6. 归档设计偏差：`20260630002838-ClaudeAgentSDK落地/02-design.md` P-9 标注「读 .mcp.json」但实现抄了 Cursor；`20260630104251-MCP展示迁移至Agent详情/02-design.md` §SDK 展示策略写 CC「同上 .cursor/mcp.json」，与官方不符。

### 依据

- Claude Code MCP 官方 scope 表：project = `.mcp.json`、user/local = `~/.claude.json`；URL: https://code.claude.com/docs/en/mcp
- `@anthropic-ai/claude-agent-sdk` 0.3.195 `sdk.d.ts`：`Query.mcpServerStatus(): Promise<McpServerStatus[]>`（L2330）返回 `{name, status, serverInfo?, error?, config?, scope?, tools?}`；`setMcpServers`/`reconnectMcpServer`/`toggleMcpServer`；`SDKSystemMessage`（L4080）subtype `init` 含 `mcp_servers`；`Options.strictMcpConfig`（L1877）= 仅用 `options.mcpServers`，忽略 `.mcp.json`/settings/plugins；control 方法注明需 streaming input/output 模式（实测必要性写入风险）。
- `@cursor/sdk` 1.0.22 `agent.d.ts`：`SDKAgent` 仅 `send/close/reload/listArtifacts`，**无** MCP list/status API；只能展示「注入的 mcpServers 快照」+ 现有 probe。

## 目标

### 目标方案（两层修复，展示层绑定运行时实例）

**注入层**（cc-mcp-loader + agent-claude-sdk）：

- `cc-mcp-loader.mergeMcpJsonEntries` 改读 `{ws}/.mcp.json` + `~/.claude.json`（user scope `mcpServers` + local scope `projects[ws].mcpServers`）；project 覆盖 user/local。
- `agent-claude-sdk.buildQueryOptions` 设 `strictMcpConfig: true`，inline 为唯一真相。
- OAuth：Claude HTTP MCP 授权可能在 `~/.claude.json`；首版 schema 不确定时**只支持 stdio**（用户 codegraph 场景），HTTP OAuth 标 known limitation（见非目标）。

**展示层**（session 级 MCP 快照 IPC）：

- 新增 IPC `agent:mcp-status(sessionKey)`（或扩展 `mcp:list-for-workspace` 带 sessionKey + engineType）。
- **claude-code**：有 `activeQuery` 时调 `query.mcpServerStatus()` 取运行时列表（含 `config`/`tools`/`status`/`scope`）；idle 用 session 缓存的「最后一次 init/activeQuery 的 mcp_servers」；无 session 时 fallback 到 `cc-mcp-loader` 读盘。
- **sdk**：session 缓存「最后一次 `agent.send` 注入的 `mcpServers`」（`agent-sdk.ts` 注入点回写 `session.lastInjectedMcpServers`）；状态用现有 `mcp-status-map` probe，配置源对齐 `.cursor/mcp.json`（保持现网）。
- `SessionMcpPanel` 入参增 `sessionKey`，按 engineType dispatch 到新 IPC。
- `mcp-view-strategy` emptyHint：CC → `~/.claude.json` 与 `{ws}/.mcp.json`；SDK 保持 `.cursor/mcp.json`。

### 目标条目

1. 修正 CC 引擎 MCP 配置源读取路径，与 Claude Code 官方 scope 表一致
2. 启用 `strictMcpConfig: true`，inline 注入成为 CC 引擎 MCP 唯一真相，消除双重加载
3. MCP 面板绑定运行时实例（sessionKey + engineType），CC 优先 `query.mcpServerStatus()`，idle 用 session 缓存
4. SDK 引擎展示对齐注入快照，CC 与 SDK emptyHint 分别指向各自配置源
5. 不引入 Cursor SDK 引擎与 IM `/mcp` CRUD 回归

## 验收标准

1. `/Users/suwenguang/work/code` 绑定的 Claude Agent 会话 MCP 面板，`codegraph` 显示 `args = ["serve","--mcp"]`（来自 `.mcp.json`），**不**出现 `--path ${workspaceFolder}`。
2. 同工作区 Cursor SDK 会话 MCP 面板仍显示 `.cursor/mcp.json` 版本（带 `--path`），无回归。
3. CC 运行时面板 server 列表与 `query.mcpServerStatus()` 返回一致（status：connected/failed/needs-auth/pending/disabled）。
4. CC idle 会话（无 activeQuery）展开面板仍可见上次 MCP 列表（session 缓存），不报错。
5. `agent-claude-sdk.ts` 启动 Run 时 `strictMcpConfig: true` 生效；UI 日志可见 inline MCP 数量。
6. `engineType=codex` 占位文案不变，不 crash。
7. IM `/mcp`、SDK/CC Run 内 MCP 工具调用无回归。

## 非目标

- 不改 Daemon MCP HTTP 服务。
- 不改 IM `/mcp` CRUD（仍 `mcp-manager` 全局 API）。
- 不实现 Claude HTTP MCP OAuth 双栈合并（首版 stdio-only；HTTP OAuth 标 known limitation）。
- 不改 Cursor SDK 注入源（仍 `.cursor/mcp.json`）。
- 不拆分 `Settings.tsx`（已 >300 行，独立 refactor）。

## 风险

- `Query.mcpServerStatus()` 注明需 streaming input/output 模式；当前 `query({prompt: string})` 是否稳定调用需 builder 实测，若不可用则 fallback 到 init 快照 + 读盘。
- `~/.claude.json` schema 可能随版本变化；需 builder 对照 d.ts L1877-1883 与官方 scope 表定唯一解析函数。
- idle 会话无 live Query，缓存可能过期；UI 应提示「上次活跃时快照」。
- 多会话并行展开时 status 探测次数增加 — 保留 30s TTL + per-workspace 缓存。
