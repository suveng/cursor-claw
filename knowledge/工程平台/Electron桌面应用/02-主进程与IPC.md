# 主进程与 IPC

## 一、能力范围

Electron 主进程：窗口/托盘、IPC、Daemon spawn/**生命周期清理**、MCP/Rules/Skills、飞书/微信绑定、Agent 失败归档；不负责 Daemon HTTP 路由。

## 二、设计决策与取舍

- **目录**：`electron/` 语义子目录见 `electron/AGENTS.md`；根仅 `main.ts`、`preload.ts`。
- contextIsolation + preload `electronAPI`；Daemon `ELECTRON_RUN_AS_NODE` spawn；`--profile=` 隔离 userData。
- IPC 分文件注册；Rules/Skills/MCP 经 IPC 读写 `.cursor/`。
- **斜杠 handler**：`command-handler.ts` re-export；实现按族拆分（均 ≤300）。
- **完全退出 vs 托盘常驻**：`isQuitting=false` 时关窗/最小化到托盘 Daemon 继续；`isQuitting=true`（Cmd+Q、托盘「退出」、`before-quit`）→ `will-quit` → `cleanupDaemonManager`。
- **统一杀进程 SSOT**：`daemon/daemon-process-kill.ts` 供 `stopDaemon`（异步）与 `cleanupDaemonManager`（同步）复用，避免两套实现漂移。

## 三、服务端规则

无；主进程 HTTP 调本机 Daemon（`daemon-client.ts`）。

## 四、客户端流程

Renderer→preload→主进程→Daemon；`daemon:status-update` 回推。关闭：ask/minimize/quit。打包 `loadFile`；dev `loadURL`+fallback（`main-window.ts`）。

**Daemon 退出**：关窗/托盘不杀；`will-quit` → `cleanupDaemonManager`（含接管模式 lock.pid）。spawn stdin `pipe` 供 parent watch。

| Tab | IPC | 落盘 |
|-----|-----|------|
| Rules | `rules:*` | `{workspaceDir}/.cursor/rules/` |
| Skills | `skills:*` | user `~/.cursor/skills/` + project |
| MCP | `mcp:*` | global/project `mcp.json` |
| Plugin | — | 只读 notice |

## 五、接口

节选：`config:*`/`daemon:*`/`window:*`/`mcp:*`/`rules:*`/`skills:*`/`sdk:*`/`cc:*`。

- Rules/Skills/MCP 经 IPC 读写 `.cursor/`；`agent:sessions` 含 `workspaceDir?`、`engineType`。

Daemon HTTP：`POST /shutdown`、`POST /enqueue`、`GET /api/active-sessions`。

## 六、数据

`electron-store` `cursor-claw-config`；Lock：`userData/daemon.lock.json`。

## 七、非功能与可观测

`broadcastLog`/`daemon:log`；MCP 缓存 15s/30s。异常经 `formatUnknownError`。失败归档 `crash-log-archiver`。Electron 重启时 Daemon stderr 管道断开，由 Daemon `daemon-logging` 静默处理。

`cleanupDaemonManager`：`killDaemonByLockOrProcessSync`（lock→`/shutdown`→SIGTERM→SIGKILL→删 lock），不依赖 spawn 句柄。`stopDaemon` 走异步 kill。

## 八、推送

`daemon:status-update`/`bind:result` 等。

## 九、已知限制与 TODO

开发模式 Tray/Updater 异于打包版。

## 十、变更记录

2026-07-12：stderr 断管约定（变更 20260712215746）；`daemon-process-kill` SSOT、接管模式 kill、will-quit vs 托盘（变更 20260712221030）。
2026-07-12：`command-handler` 按族拆分（archive 20260712170649）。
2026-06-27：kb-sync 初始建立。
