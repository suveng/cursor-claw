# session/ — 多会话调度与 Session MCP

## 模块边界

- `session-dispatcher.ts`：任务/工作流/`/chat` 经 Daemon `POST /api/agent/launch` 启动；**不**扫描 IM 队列（已迁入 Daemon）；**launch 前不得**调用 `agent/shared/workspace-injector` 写盘。
- `session-mcp-status.ts`：展示层按 sessionKey 取运行时 MCP 状态的唯一入口。
- `session-mcp-sdk-path.ts`：SDK 路径磁盘列表与 `lastInjectedMcpServers` 合并。

## Session MCP 取数器

- **入口**：`session-mcp-status.getSessionMcpStatus(sessionKey): Promise<AgentMcpStatusResult>` — 展示层按 sessionKey 取运行时 MCP 状态的唯一入口；返回 `{ servers: McpServerEntry[]; statusMap: Record<string,string>; source }`，`source ∈ "runtime" | "snapshot" | "disk"`。聚合 `mcp/loaders/cc-mcp-loader` / `agent/claude-code/agent-claude-sdk` / `agent/cursor-sdk/agent-sdk` / `mcp/mcp-status-map` 能力，**不**自建抽象层、**不**重复读盘/probe 逻辑。
- **dispatch 规则**（按序短路）：(1) `getCcSession` 命中 → CC 路径三态：`getCcActiveQuery` 非空则 `await query.mcpServerStatus()`（`source:"runtime"`；抛错 `catch` 降级 snapshot，**不 crash**）→ 否则 `lastMcpServersSnapshot` 非空走 `source:"snapshot"` → 否则 `loadInlineCcMcpServers(workspaceDir)` 读盘 `source:"disk"`；(2) `getSdkSession` 命中 → `session-mcp-sdk-path.buildSdkRuntimeEntries` 合并磁盘列表与 `lastInjectedMcpServers`，标注 `rawConfig.__sdkLoadVia`（inline/settingSources/plugin），再 `fetchMcpStatusMap` probe，`source:"runtime"`；(3) 无任何 session → 空态 `{ servers: [], statusMap: {}, source: "disk" }`（不抛错，让 UI 显示空列表）。
- **source 三态语义**：`runtime` = 运行时探测/SDK 上报（CC `mcpServerStatus()` 或 SDK `fetchMcpStatusMap` probe）；`snapshot` = session 缓存（CC idle 会话的 `lastMcpServersSnapshot`，含上次 init 上报的 status）；`disk` = 读盘（CC session 缺 query/snapshot 时 `loadInlineCcMcpServers`，或无 session 空态）。展示层可按 source 区分"实时/缓存/降级"渲染与刷新策略。
- **helper 映射约定**：私有 `toEntry(name, cfgLike, source)` 统一字段提取（`type = cfg.url ? "url" : "command"`，`source` 标 `"project"`，`authenticated: false` 首版不处理 OAuth，`enabled: true`，`rawConfig: cfg`；`command/args/url` 仅 cfg 有值时写入，避免 UI `"undefined"`）——兼容 CC `McpServerStatus.config`、CC snapshot `config?: unknown`、SDK/CC inline `McpServerConfig`（stdio `command/args/env` 与 http/sse `url/headers`）。`mapSnapshotToEntries` 在 snapshot 缺 config 时按 name 合并 `loadInlineCcMcpServers` 读盘结果（try/catch 不抛错）。`mapStatusToEntries`/`mapSnapshotToEntries`/`mapInjectedToEntries` 三 helper 均委托 `toEntry`；CC runtime/snapshot 的 `statusMap` 由 `buildStatusMap` + 私有 `mapCcStatusToUi` 将 CC 枚举（`connected`→`ready`、`needs-auth`→`needs_login` 等）映射为 UI 词汇；SDK `fetchMcpStatusMap` probe 结果不经 `buildStatusMap`，勿二次映射。**禁止**在取数器内重建 `mcp-manager.buildEntry` 审批/scope 逻辑——首版简化，展示用配置源统一标 project。

## Session MCP 端点契约（agent:mcp-status IPC）

- **IPC handler**：`registerIpcHandlers` 内 `mcp:*` handler 之后 `ipcMain.handle("agent:mcp-status", (_e, sessionKey, force?, engineType?, workspaceDir?) => getSessionMcpStatus(sessionKey, force, engineType, workspaceDir))`；`force` 透传 SDK `fetchMcpStatusMap` 跳过 30s 缓存；`engineType`/`workspaceDir` 供 CC 无 session 读盘 fallback。顶部 `import { getSessionMcpStatus } from "./session/session-mcp-status"`（`main.ts`）。
- **preload 暴露**：`contextBridge` 的 `api` 对象内 `getMcpStatusMap` 之后 `getAgentMcpStatus: (sessionKey, force?, engineType?, workspaceDir?) => ipcRenderer.invoke("agent:mcp-status", sessionKey, force, engineType, workspaceDir)`；返回 `Promise<AgentMcpStatusResult>`，`AgentMcpStatusResult` 在 preload 内 `export interface` 本地声明（与 `McpServerEntry` 同模式），字段与 `session/session-mcp-status` 对齐（`servers`/`statusMap`/`source`）。
- **env.d.ts 签名**：`ElectronAPI.getAgentMcpStatus(sessionKey, force?, engineType?, workspaceDir?): Promise<AgentMcpStatusResult>`；`AgentMcpStatusResult` 经 `/// <reference path="./types/mcp.d.ts" />` 引入。
- **保留项**：`mcp:list-for-workspace` / `mcp:status-map` IPC 与 preload `listMcpForWorkspace` / `getMcpStatusMap` **保留不动**——IM `/mcp` CRUD 与 Settings 仍用；仅 `SessionMcpPanel` CC/SDK 路径不再直调（见 `src/renderer/components/AGENTS.md` SessionMcpPanel dispatch）。

## 编码规矩

- 四引擎 HTTP 路由 import 自 `../agent/{cursor-sdk,claude-code,codex,opencode}/`；**禁止**旧扁平路径。
- **禁止**在本目录 spawn Agent。
