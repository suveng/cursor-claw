# mcp/ — MCP 管理与 loader

## MCP 文件拆分

- `mcp-types.ts`：共享类型（`McpServerEntry`、`McpToolInfo`）。
- `mcp-tools-probe.ts`：`queryToolsViaProtocol` / `queryToolsViaHttp` 直连探测。
- `mcp-status-map.ts`：状态 map 30s 缓存与单条探测编排。
- **mcp-status-map 缓存键**：`resolveWorkspaceKey(workspaceDir?, engineType?)` 返回 `wsKey::engineType`（`ws` 省略回退 `config.workspaceDir`，再省略为 `__default__`；`engineType` 省略默认 `sdk` 保持现网兼容）。`mcpStatusCacheByWs` / `mcpStatusInflightByWs` Map 键随之用组合键，防同 workspace 切 SDK/CC 会话时 idle fallback 读盘 probe 与 SDK 配置源串台。`probeCwd` 用原始 workspace 路径，**不含** engineType 后缀（探测 cwd 与引擎类型无关）。`fetchMcpStatusMap(force, servers, ws?, engineType?)` / `getMcpStatusMap(force, workspaceDir?, engineType?)` 透传 engineType；`invalidateMcpStatusCache()` 仍清空全部。新增参数均可选，`main.ts` `mcp:status-map` IPC 与飞书 `/mcp` 当前不传 engineType，默认 sdk 行为不变。
- `mcp-manager.ts`：CRUD、toggle、login 说明、对外导出；**不** spawn `agent mcp`。
- `mcp-project-dir.ts`：Cursor projects 目录与 `mcp-auth.json`。
- `loaders/`：`mcp-sdk-loader`、`cc-mcp-loader`、`codex-mcp-loader`、`opencode-mcp-loader`。

## MCP 启用状态类型语义（mcp-types.ts / mcp.d.ts）

- `McpServerEntry.enabled?: boolean` 字段须附中文注释明三态语义：`false`=审批未启用/被禁用（project scope 未在白名单或显式 disabled，未注入运行）；`true`=审批启用或 user/local scope（不经审批）；`undefined`=历史数据，向后兼容按 true 处理。
- `mcp/mcp-types.ts`（主进程侧）与 `src/renderer/types/mcp.d.ts`（渲染层 ambient）两处定义须保持注释与语义一致；不新增枚举字段表达 disabled，展示由 `enabled:false` + `statusMap["disabled"]` 双通道承担。

## 编码规矩

- 配置读 `../config/config-store`；loader 读 `../mcp-project-dir` 与 `../mcp-types`。
- **禁止**在本目录 spawn Agent 进程。
