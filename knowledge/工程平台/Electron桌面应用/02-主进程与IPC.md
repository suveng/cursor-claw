# 主进程与 IPC

## 一、能力范围

Electron 主进程：窗口/托盘（`main-window.ts` `createWindow`）、IPC、Daemon spawn/轮询、MCP/Rules/Skills、飞书/微信绑定、Agent 失败日志归档（`crash-log-archiver.ts`）；不负责 Daemon HTTP 路由。

## 二、设计决策与取舍

- **contextIsolation + preload 白名单**：`preload.ts` `electronAPI`。
- **Daemon 子进程**：`ELECTRON_RUN_AS_NODE` spawn（`daemon-manager.ts`）。
- **profile 隔离 userData**：`--profile=`。
- **IPC 分文件注册**：`main.ts` 基础 handler；模块按需 `ipcMain.handle`。
- **CC SDK hooks**：`buildQueryOptions` 注入 `buildCcSdkHooks`+`includeHookEvents`（`cc-sdk-hooks.ts`）。

## 三、服务端规则

无独立服务端；主进程 HTTP 调本机 Daemon（`daemon-client.ts`）。

## 四、客户端流程

Renderer → preload IPC → 主进程 spawn Daemon → `daemon:status-update` 回推。关闭窗口：ask/minimize/quit（`window:close-confirm`）。

**Renderer 加载**（`main-window.ts`）：`app.isPackaged === true` 时始终 `loadFile` 本地 `renderer/index.html`，忽略 shell 残留 `ELECTRON_RENDERER_URL`；仅 dev 且存在 `ELECTRON_RENDERER_URL` 时 `loadURL`，`did-fail-load` 时 fallback `loadFile`。

**CC Run**：Daemon→`cc-agent-api`→`query()`；`startCcQuery` 并行 hooks/watchdog/stream，超时经 `cc-watchdog-finalize` IM。

## 五、接口

### IPC（节选）

`config:*`/`daemon:*`/`window:*`/`mcp:*`/`rules:*`/`skills:*`/`sdk:*`/`cc:*`；已删 `cli:*`/`models:list`，见 `preload.ts`。

**Claude Agent IPC**：`cc:check-api-key`/`cc:list-models`；Run 经 `cc-agent-api`→`query()`。

**MCP IPC**：`mcp:list-for-workspace(ws)` 合并 mcp.json；`status-map(force?,ws?)`/`tools(name,ws?)`/`login(name,ws?)` 绑定 ws；`list-all`/`toggle`/`save`/`delete` 供 IM。

**agent:sessions**：每项含 `workspaceDir?`、`engineType: sdk|claude-code`。

**agent:mcp-status**：`main.ts` `ipcMain.handle("agent:mcp-status", (_e, sessionKey, force?, engineType?, workspaceDir?) => getSessionMcpStatus(...))`（`./session-mcp-status`）；preload `getAgentMcpStatus`/`env.d.ts` `ElectronAPI.getAgentMcpStatus(): Promise<AgentMcpStatusResult>`，`AgentMcpStatusResult`/`McpServerEntry` 抽到 `src/renderer/types/mcp.d.ts`（`/// <reference>` 引入）。返回 `{ servers; statusMap; source: "runtime"|"snapshot"|"disk" }`；`force` 跳 SDK 30s 缓存，`engineType`/`workspaceDir` 供 CC 无 session 读盘 fallback；走此 IPC，不直调 `mcp:list-for-workspace`/`mcp:status-map`（后者供 IM CRUD/Settings）。

### Daemon HTTP

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/shutdown` | 停止 |
| POST | `/enqueue` | 主会话入队 |
| GET | `/api/active-sessions` | 会话映射 |

## 六、数据

`electron-store` `cursor-claw-config`；Lock：`userData/daemon.lock.json`。

## 七、非功能与可观测

`broadcastLog`/`daemon:log` 推 Dashboard；Daemon 运行期 `powerSaveBlocker`；MCP 探测 stdio 15s/HTTP。

**失败归档**：`archiveAgentFailureLogs` 挂接 notify/finalizer；`crashAnalysisDir` 配置时写 logBuffer±30→`electron-log.txt`+`meta.json`，不阻断 notify。

**CC 模块**：`cc-sdk-hooks.ts` hooks 工厂；`cc-watchdog-finalize.ts` 超时 IM；`agent-cc-events.ts` hook 流+`armCcWatchdog`；env `CC_IDLE/ABSOLUTE_TIMEOUT_MS`/`NEVER_CANCEL_ON_DURATION`；UI `hook_event=` 必有、禁 hook 原文。

## 八、推送

`webContents.send`：`daemon:status-update`/`bind:result`/`feishu:setup-qrcode` 等。

## 九、已知限制与 TODO

开发模式 Tray/Updater 与打包版不同。

## 十、变更记录

2026-06-30：§四 补 renderer 加载策略（`main-window.ts`：打包 loadFile、dev loadURL+fallback）。
2026-06-30：§五 IPC 增 `agent:mcp-status`（CC/SDK 展示统一入口，类型抽 `types/mcp.d.ts`）；MCP IPC 增 `mcp:list-for-workspace`+`workspaceDir`、`agent:sessions` 增 `engineType`/`workspaceDir`；CC Run 解耦、补 `cc:*` IPC；MCP 改 mcp.json、删 `cli:*`/`models:list`。
2026-06-28：§七 补 `archiveAgentFailureLogs` 挂接与产物约定；2026-06-27 kb-sync 初始建立。
