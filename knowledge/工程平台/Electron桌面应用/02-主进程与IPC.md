# 主进程与 IPC

## 一、能力范围

Electron 主进程：窗口/托盘、IPC、Daemon spawn、MCP/Rules/Skills、飞书/微信绑定、Agent 失败归档；不负责 Daemon HTTP 路由。

## 二、设计决策与取舍

- **目录**：`electron/` 按 `app/`、`config/`、`daemon/`、`session/`、`scheduling/`、`agent/{shared,cursor-sdk,claude-code,codex,opencode}/`、`mcp/loaders/`、`workflow/`；根仅 `main.ts`、`preload.ts`（见 `electron/AGENTS.md`）。
- contextIsolation + preload `electronAPI`；Daemon `ELECTRON_RUN_AS_NODE` spawn；`--profile=` 隔离 userData。
- IPC 分文件注册；Rules/Skills/MCP 经 IPC 读写 `.cursor/`。
- **斜杠 handler**：`scheduling/command-handler.ts` 薄 re-export；实现 `command-handler-{model,task,mcp,workflow,shared}.ts`（均 ≤300）。

## 三、服务端规则

无；主进程 HTTP 调本机 Daemon（`daemon-client.ts`）。

## 四、客户端流程

Renderer→preload→主进程→Daemon；`daemon:status-update` 回推。关闭：ask/minimize/quit。打包 `loadFile`；dev `loadURL`+fallback（`main-window.ts`）。

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

## 八、推送

`daemon:status-update`/`bind:result` 等。

## 九、已知限制与 TODO

开发模式 Tray/Updater 异于打包版。

## 十、变更记录

2026-07-12：§二 `command-handler` 按族拆分（archive 20260712170649）。
2026-07-04～06-27：`formatUnknownError`、Skills IPC、目录语义、mcp-status、kb-sync。
