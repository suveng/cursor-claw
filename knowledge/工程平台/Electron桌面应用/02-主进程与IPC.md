# 主进程与 IPC

## 一、能力范围

负责 Electron 主进程：窗口/托盘、IPC 注册、Daemon spawn 与状态轮询、MCP/Rules/Skills 文件操作、飞书/微信绑定辅助、**Agent 失败日志归档**（`crash-log-archiver.ts`）。不负责 Daemon 内 HTTP 路由实现。

## 二、设计决策与取舍

- **contextIsolation + preload 白名单**：API 在 `preload.ts` `electronAPI`（`main.ts` webPreferences）。
- **Daemon 独立子进程**：`ELECTRON_RUN_AS_NODE` spawn（`daemon-manager.ts`）。
- **profile 隔离 userData**：`--profile=`（`main.ts`）。
- **IPC 分文件注册**：`main.ts` 基础 handler；各模块按需 `ipcMain.handle`。

## 三、服务端规则

无独立服务端；Daemon 规则见 Daemon 分区。主进程通过 HTTP 调用本机 Daemon（`electron/daemon-client.ts`）。

## 四、客户端流程

Renderer 经 preload 调 `daemon:start` 等 IPC，主进程 spawn Daemon 并 `daemon:status-update` 回推（`daemon-manager.ts`）。

关闭窗口：`closeWindowAction` 为 ask/minimize/quit；ask 时 `window:close-confirm` → `CloseWindowModal`（`main.ts`）。

## 五、接口

### IPC（节选）

`config:get/save`、`daemon:*`、`window:*`、`mcp:*`/`rules:*`/`skills:*`、`sdk:*`/`cc:*`；**已删除** `cli:*`、`models:list`（模型列表改走 `sdk:list-models` / `cc:list-models`）。完整列表见 `preload.ts`，扩展 handler 在 daemon-manager。

### MCP IPC（文件 + 探测，非 CLI）

| IPC | 说明 |
|---|---|
| `mcp:list-all` | 合并 global/project `mcp.json` 条目 |
| `mcp:toggle` | 写 `disabled: true/false` |
| `mcp:enabled-map` | 读 json `disabled !== true` |
| `mcp:status-map` | HTTP/stdio 探测（`mcp-tools-probe`） |
| `mcp:tools` | 单服工具列表（HTTP/stdio） |
| `mcp:login` | OAuth 手动引导 + 打开文档（无 `agent mcp login`） |

### Daemon HTTP

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/shutdown` | 停止 Daemon |
| POST | `/enqueue` | 主会话入队 |
| GET | `/api/active-sessions` | 会话映射 |

## 六、数据

配置：`electron-store` `cursor-claw-config`（见 config-store）；Lock：`userData/daemon.lock.json`（pid/port/version/workspaceDir）。

## 七、非功能与可观测

- `broadcastLog` / `daemon:log` 推送 Daemon 与主进程日志到 Dashboard。
- `powerSaveBlocker` 在 Daemon 运行期阻止系统休眠（daemon-manager）。
- MCP 健康探测：stdio 15s、HTTP 10s 超时（`mcp-tools-probe.ts`）；`mcp:status-map` 结果 30s TTL 缓存（`mcp-status-map.ts`）。

### Agent 失败日志归档

`archiveAgentFailureLogs`（`crash-log-archiver.ts`）：best-effort、不 throw、不阻断 notify。挂接 `notifySdkFailure`/`notifyDispatchFailure`/`finalizeSdkRunOnTimeout`（finalizer 先于 notify）；`failureArchiveDone` 幂等闩。已配置 `crashAnalysisDir`：触发行 → logBuffer 锚点 ±30 → `{dir}/{ts[-NNN]}/electron-log.txt` + `meta.json`；未配置 WARN 节流跳过。不归档 daemon.log。

## 八、推送

主进程 `webContents.send`：`daemon:status-update`、`bind:result`、`feishu:setup-qrcode` 等。

## 九、已知限制与 TODO

- 开发模式 Tray/Updater 行为与打包版不同。

## 十、变更记录

2026-06-30：MCP 改 mcp.json + HTTP/stdio 探测；删除 `cli:*`、`models:list` IPC（archive 20260629232914）。
2026-06-28：§七 补充 Agent 失败时 `archiveAgentFailureLogs` 挂接、产物目录与 notify 不阻断约定。
2026-06-27：kb-sync 初始建立
