# 主进程与 IPC

## 一、能力范围

Electron 主进程：窗口/托盘、IPC、Daemon spawn/**生命周期清理**、MCP/Rules/Skills、飞书/微信绑定、Agent 失败归档；不负责 Daemon HTTP 路由。

## 二、设计决策与取舍

- **目录**：`electron/` 按 `app/`、`config/`、`daemon/`、`session/`、`scheduling/`、`agent/{shared,cursor-sdk,claude-code,codex,opencode}/`、`mcp/loaders/`、`workflow/`；根仅 `main.ts`、`preload.ts`（见 `electron/AGENTS.md`）。
- contextIsolation + preload `electronAPI`；Daemon `ELECTRON_RUN_AS_NODE` spawn；`--profile=` 隔离 userData。
- IPC 分文件注册；Rules/Skills/MCP 经 IPC 读写 `.cursor/`。
- **斜杠 handler**：`scheduling/command-handler.ts` 薄 re-export；实现 `command-handler-{model,task,mcp,workflow,shared}.ts`（均 ≤300）。
- **完全退出 vs 托盘常驻**：`isQuitting=false` 时关窗/最小化到托盘 Daemon 继续；`isQuitting=true`（Cmd+Q、托盘「退出」、`before-quit`）→ `will-quit` → `cleanupDaemonManager`。
- **统一杀进程 SSOT**：`daemon/daemon-process-kill.ts` 供 `stopDaemon`（异步）与 `cleanupDaemonManager`（同步）复用，避免两套实现漂移。

## 三、服务端规则

无；主进程 HTTP 调本机 Daemon（`daemon-client.ts`）。

## 四、客户端流程

Renderer→preload→主进程→Daemon；`daemon:status-update` 回推。关闭：ask/minimize/quit。打包 `loadFile`；dev `loadURL`+fallback（`main-window.ts`）。

**Daemon 退出语义**：关窗 hide/minimize 不杀 Daemon；完全退出 `app.on("will-quit")` 调 `cleanupDaemonManager`。接管模式（`daemonProcess=null`）记 `managedExternalDaemonPid`，退出时仍读 lock.pid 杀进程。spawn `stdio` 含 stdin `pipe` 供 Daemon parent watch。

| Tab | IPC | 落盘 |
|-----|-----|------|
| Rules | `rules:*` | `{workspaceDir}/.cursor/rules/` |
| Skills | `skills:*` | user `~/.cursor/skills/` + project |
| MCP | `mcp:*` | global/project `mcp.json` |
| Plugin | — | 只读 `getMcpPluginNotice()` |

CC Run：Daemon→`cc-agent-api`→`query()`；超时经 `cc-watchdog-finalize` IM。

## 五、接口

节选：`config:*`/`daemon:*`/`window:*`/`mcp:*`/`rules:*`/`skills:*`/`sdk:*`/`cc:*`。

- Rules 固定主工作区；会话 `cwd` 不一致时 UI 已提示。
- Skills：`skills-ipc.ts`；`SkillScope` 默认 `user`；project 无工作区写失败、读 `[]`。
- MCP：`list-for-workspace` 合并 mcp.json；`agent:mcp-status` 含 SDK runtime/disk。
- `agent:sessions`：`workspaceDir?`、`engineType`。

Daemon HTTP：`POST /shutdown`、`POST /enqueue`、`GET /api/active-sessions`。

## 六、数据

`electron-store` `cursor-claw-config`；Lock：`userData/daemon.lock.json`。

## 七、非功能与可观测

`broadcastLog`/`daemon:log`；MCP 探测缓存 15s/30s。全局异常经 `formatUnknownError`（禁内联 `instanceof Error`）。失败归档 `crash-log-archiver`（`crashAnalysisDir` 时写 logBuffer±30）。

`cleanupDaemonManager`：`daemonShouldRun=false`、停轮询与 Agent 后调 `killDaemonByLockOrProcessSync`（读 lock → `POST /shutdown` → SIGTERM 1s → SIGKILL → `removeLockFile`），不依赖 `daemonProcess` 非空。`stopDaemon` IPC/Dashboard/`/restart` 走异步 `killDaemonByLockOrProcess`，行为与现网一致。

## 八、推送

`daemon:status-update`/`bind:result` 等。

## 九、已知限制与 TODO

开发模式 Tray/Updater 异于打包版。

## 十、变更记录

2026-07-12：`daemon-process-kill` SSOT；`cleanupDaemonManager` 覆盖接管模式；will-quit vs 托盘常驻语义（变更 20260712221030）。
2026-07-12：§二 `command-handler` 按族拆分（archive 20260712170649）。
2026-07-04～06-27：`formatUnknownError`、Skills IPC、目录语义、mcp-status、kb-sync。
