# 主进程与 IPC

## 一、能力范围

Electron 主进程：窗口/托盘、IPC、Daemon spawn、MCP/Rules/Skills、飞书/微信绑定、Agent 失败日志归档；不负责 Daemon HTTP 路由。

## 二、设计决策与取舍

- **目录语义与 Agent 调度分区对齐**：`electron/` 业务模块按 `app/`、`config/`、`daemon/`、`session/`、`scheduling/`、`agent/{shared,cursor-sdk,claude-code,codex,opencode}/`、`mcp/loaders/`、`workflow/` 分子目录；根目录仅留 `main.ts`、`preload.ts`；子目录规矩见 `electron/AGENTS.md` 索引。
- **contextIsolation + preload 白名单**：`preload.ts` `electronAPI`。
- **Daemon 子进程**：`ELECTRON_RUN_AS_NODE` spawn（`electron/daemon/daemon-manager.ts`）。
- **profile 隔离 userData**：`--profile=`。
- **IPC 分文件注册**：`main.ts` 基础 handler；模块按需 `ipcMain.handle`。
- **Settings 配置维护**：Rules/Skills/MCP 经 IPC 读写本地 `.cursor/`；与 SDK `settingSources` 同源，Plugin 区只读说明。

## 三、服务端规则

无独立服务端；主进程 HTTP 调本机 Daemon（`electron/daemon/daemon-client.ts`）。

## 四、客户端流程

Renderer → preload IPC → 主进程 → Daemon；`daemon:status-update` 回推。关闭窗口：ask/minimize/quit。

**Renderer 加载**：打包 `loadFile`；dev `loadURL` + `did-fail-load` fallback（`electron/app/main-window.ts`）。

**Settings 四 Tab IPC 落盘**：

| Tab | IPC | 落盘路径 | 说明 |
|-----|-----|----------|------|
| Rules | `rules:list/save/delete` | `{config.workspaceDir}/.cursor/rules/` | 无主工作区时禁用并返回错误 |
| Skills | `skills:*` | `~/.cursor/skills/` | 用户级，全工作区经 SDK 加载 |
| MCP | `mcp:list-for-workspace/save/delete/toggle/login` | global/project `mcp.json` | `SettingsMcpPanel.tsx` |
| Plugin | — | 只读 | `getMcpPluginNotice()` |

**CC Run**：Daemon→`cc-agent-api`→`query()`；超时经 `electron/agent/claude-code/cc-watchdog-finalize.ts` IM。

## 五、接口

### IPC（节选）

`config:*`/`daemon:*`/`window:*`/`mcp:*`/`rules:*`/`skills:*`/`sdk:*`/`cc:*`。

**Rules IPC**：`rules:list/save/delete` 固定读写 `getConfig().workspaceDir`（主工作区）；SDK 会话 `cwd` 可能来自通道/任务绑定，与主工作区不一致时 Rules 维护不作用于该会话（Settings UI 已提示）。

**MCP IPC**：`mcp:list-for-workspace(ws)` 合并 mcp.json（project 覆盖 global）；`save/delete/toggle/login` 供 Settings MCP Tab 与 IM；`status-map`/`tools` 供探测。

**agent:mcp-status**：`getSessionMcpStatus(sessionKey, force?, engineType?, workspaceDir?)`；SDK 路径读 `lastInjectedMcpServers` + `buildSdkRuntimeEntries`；类型见 `src/renderer/types/mcp.d.ts`。

**agent:sessions**：含 `workspaceDir?`、`engineType: sdk|claude-code|…`。

### Daemon HTTP

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/shutdown` | 停止 |
| POST | `/enqueue` | 主会话入队 |
| GET | `/api/active-sessions` | 会话映射 |

## 六、数据

`electron-store` `cursor-claw-config`；Lock：`userData/daemon.lock.json`。

## 七、非功能与可观测

`broadcastLog`/`daemon:log` 推 Dashboard；MCP 探测 stdio 15s/HTTP 30s 缓存。

**失败归档**：`electron/agent/shared/crash-log-archiver.ts` 的 `archiveAgentFailureLogs` 挂接 notify/finalizer；`crashAnalysisDir` 配置时写 logBuffer±30。

## 八、推送

`webContents.send`：`daemon:status-update`/`bind:result` 等。

## 九、已知限制与 TODO

开发模式 Tray/Updater 与打包版不同。

## 十、变更记录

2026-07-02：§二 补目录语义与 Agent 调度对齐；正文路径改为 `electron/` 子目录形式（archive 20260702112559）。
2026-07-02：§四/§五 补 Settings Rules/MCP Tab 与主工作区口径；SDK `agent:mcp-status` 来源标注（archive 20260701212732）。
2026-06-30：§四 补 renderer 加载策略；§五 增 `agent:mcp-status`、MCP workspaceDir、CC Run 解耦。
2026-06-27：kb-sync 初始建立。
