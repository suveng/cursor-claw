# 主进程与 IPC

## 一、能力范围

Electron 主进程：窗口/托盘、IPC、Daemon spawn/轮询、MCP/Rules/Skills、飞书/微信绑定、Agent 失败日志归档（`crash-log-archiver.ts`）。不负责 Daemon HTTP 路由。

## 二、设计决策与取舍

- **contextIsolation + preload 白名单**：`preload.ts` `electronAPI`。
- **Daemon 子进程**：`ELECTRON_RUN_AS_NODE` spawn（`daemon-manager.ts`）。
- **profile 隔离 userData**：`--profile=`。
- **IPC 分文件注册**：`main.ts` 基础 handler；模块按需 `ipcMain.handle`。
- **CC SDK hooks（Electron 内）**：`buildQueryOptions` 注入 `buildCcSdkHooks` + `includeHookEvents: true`；逻辑在 `cc-sdk-hooks.ts`（`CcSdkHooksDeps` 防循环 import）。shell settings hooks 非主路径。

## 三、服务端规则

无独立服务端；主进程 HTTP 调本机 Daemon（`daemon-client.ts`）。

## 四、客户端流程

Renderer → preload IPC → 主进程 spawn Daemon → `daemon:status-update` 回推。关闭窗口：ask/minimize/quit（`window:close-confirm`）。

**CC Run**（Daemon→`cc-agent-api`→`query()`）：`startCcQuery` 并行 hooks/watchdog/stream；idle/absolute watchdog 在 `onTick` 判定，超时经 `cc-watchdog-finalize.ts` IM+`stop_progress`（详见 archive 20260630100827）。

## 五、接口

### IPC（节选）

`config:*`、`daemon:*`、`window:*`、`mcp:*`/`rules:*`/`skills:*`、`sdk:*`/`cc:*`；已删 `cli:*`、`models:list`（改 `sdk:list-models`/`cc:list-models`）。完整见 `preload.ts`。

**Claude Agent IPC**：`cc:check-api-key`、`cc:list-models`；Run 经 Daemon→`cc-agent-api`→`query()`，不经 IPC。

**MCP IPC**：`mcp:list-for-workspace(ws)` 合并 global+project mcp.json；`status-map(force?,ws?)`/`tools(name,ws?)`/`login(name,ws?)` 绑定 ws（省略回退 `config.workspaceDir`，30s 分桶 TTL）；`list-all`/`toggle`/`save`/`delete` 保留供 IM，Renderer 不调 toggle/save/delete。

**agent:sessions**：每项增 `workspaceDir?`、`engineType: sdk|claude-code`（`getSessionAgentList` 组装）。

### Daemon HTTP

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/shutdown` | 停止 |
| POST | `/enqueue` | 主会话入队 |
| GET | `/api/active-sessions` | 会话映射 |

## 六、数据

`electron-store` `cursor-claw-config`；Lock：`userData/daemon.lock.json`。

## 七、非功能与可观测

`broadcastLog`/`daemon:log` 推 Dashboard；Daemon 运行期 `powerSaveBlocker`。MCP 探测 stdio 15s/HTTP 10s。

**失败归档**：`archiveAgentFailureLogs` best-effort 挂接 notify/finalizer；`crashAnalysisDir` 配置时写 logBuffer±30→`electron-log.txt`+`meta.json`；不阻断 notify。

**CC 模块**：`cc-sdk-hooks.ts` hooks 工厂+UI 日志；`cc-watchdog-finalize.ts` 超时 IM（对称 SDK finalizer，不写 cooldown）；`agent-cc-events.ts` hook 流+`armCcWatchdog`。env：`CC_IDLE_TIMEOUT_MS`（idle）、`CC_ABSOLUTE_TIMEOUT_MS` 等（absolute）；`NEVER_CANCEL_ON_DURATION` 与 SDK 共用。UI：`hook_event=` 必有；禁止 hook 原文 IM。

## 八、推送

`webContents.send`：`daemon:status-update`、`bind:result`、`feishu:setup-qrcode` 等。

## 九、已知限制与 TODO

开发模式 Tray/Updater 与打包版不同。

## 十、变更记录

2026-06-30：MCP IPC 增 `mcp:list-for-workspace` 与 `workspaceDir` 上下文；`agent:sessions` 增 `engineType`/`workspaceDir`（archive 20260630104251）。
2026-06-30：§二/§四/§七 CC Run hooks、watchdog idle/absolute 解耦与超时对称收尾（archive 20260630100827）。
2026-06-30：补充 `cc:*` IPC；Claude Agent Run 经 cc-agent-api（archive 20260630002838）。
2026-06-30：MCP 改 mcp.json 探测；删 `cli:*`/`models:list`（archive 20260629232914）。
2026-06-28：§七 补充 `archiveAgentFailureLogs` 挂接与产物约定。
2026-06-27：kb-sync 初始建立。
