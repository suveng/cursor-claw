# MCP 展示迁移至 Agent 详情 · 变更摘要

> **变更 ID**：`20260630104251-MCP展示迁移至Agent详情`  
> **归档前知识同步**：kb-librarian · 2026-06-30

## 结论

MCP 服务器列表、状态探测、OAuth 授权与工具预览已从 **Settings MCP Tab** 迁至 **Dashboard 活跃会话展开区**，按会话 `workspaceDir` + `engineType` 绑定展示；Settings 移除 MCP 管理 UI，配置改 `mcp.json`。

## 主要改动

| 区域 | 变更 |
|---|---|
| Settings | 删除 MCP Tab 及 CRUD/toggle UI；保留 10 Tab |
| Dashboard | 活跃会话行始终可展开；上方 `SessionMcpPanel`，下方排队消息 |
| 主进程 IPC | 新增 `mcp:list-for-workspace`；`status-map`/`tools`/`login` 增 `workspaceDir?` |
| 会话列表 | `agent:sessions` 增 `workspaceDir?`、`engineType: sdk \| claude-code` |
| 策略 | `mcp-view-strategy.ts` 区分 SDK/CC 文案；`codex` 占位未支持 |

## 未改

- MCP 运行时注入（`mcp-sdk-loader` / `cc-mcp-loader`）
- Daemon MCP HTTP、IM `/mcp` CRUD IPC
- MCP 配置文件读写语义

## 知识库已更新

- `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md`
- `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md`
- `knowledge/工程平台/Electron桌面应用/01-概览.md`（MCP 入口描述）
- `knowledge/业务域/Agent调度/02-多会话模型.md`（会话列表字段与 MCP 绑定）

## 待 archive 后

- 台架验收见 `06-automation-test.md`（`/kb-test`）
