# 控制层HTTP化与斜杠去Electron依赖 - 变更总结

## 1、实际变更

### 新增代码

| 文件 | 关键改动 |
|------|----------|
| `src/daemon/daemon-slash-executor.ts` | `executeSlashCommand` — IM 斜杠 SSOT；本地 help/status/list/clean；其余 `forwardElectronCommandApi` |
| `src/daemon/daemon-slash-mcp.ts` | `/mcp` 斜杠子命令，对齐 `POST /api/mcp` |
| `src/daemon/daemon-http-mcp-admin.ts` | MCP 配置读写、enable/disable、健康探测转发客户端 |
| `electron/scheduling/command-executor.ts` | `executeFileCommand` — poll 与 HTTP 共用 |
| `electron/agent/cursor-sdk/agent-command-http.ts` | `POST /api/command/execute` 处理 |

### 修改代码

| 文件 | 关键改动 |
|------|----------|
| `src/daemon/daemon.ts` | `handleCommand` → `executeSlashCommand`；`SLASH_EXEC_MODE` 三态；dual 双写 `.fcmd` |
| `src/daemon/daemon-orchestrator.ts` | `forwardElectronCommandApi` 扩展 command 路径 |
| `src/daemon/daemon-http-admin-content.ts` | `/api/mcp` 增 enable/disable/info |
| `src/daemon/daemon-http-admin-crud.ts` | stop/restart/reset 同步 POST command API |
| `src/daemon/feishu-event-handlers.ts` | 菜单 `menu_v6` → `handleSlashCommand`（同斜杠路径） |
| `src/daemon/server-admin.ts` | `manage_mcp` 改调 Daemon `/api/mcp` |
| `electron/agent/cursor-sdk/agent-sdk-http.ts` | 注册 `POST /api/command/execute` |
| `electron/daemon/daemon-manager.ts` | poll 注入 skip-checker；`syncDaemonSlashExecutedIds` |
| `electron/scheduling/command-handler.ts` | HTTP sink 作用域执行 |
| `src/daemon/AGENTS.md` 等 AGENTS | 模块边界说明 |

## 2、与设计的差异

| 项 | 设计预期 | 实际 | 原因 |
|----|----------|------|------|
| M3 健康转发 | Electron `POST /api/mcp/status-map` | **已注册**（T-FIX-02）；委托 `getMcpStatusMap` | agent-api 未监听时仍降级「未知」+ `healthError` |
| `slash_exec` 日志 `source` | `source=im\|menu` + 执行路径字段 | **已对齐**（T-FIX-01）：`source` 为通道来源，`exec_path` 为 `skip\|local\|mcp\|electron` | — |
| 默认 `SLASH_EXEC_MODE` | 设计步骤 9 稳态为 `daemon` | **`daemon`**（开箱默认） | **closed_by: `20260712144931`** — 双侧 `getSlashExecMode`/`resolveSlashExecMode` 默认与非法回退均为 `daemon`；poll 仅 `dual\|electron` 兼容 |
| `GET /commands/skip-check` | claim 前实时去重 | **已接线**（T-FIX-03）；poll claim 前查询，保留 `executed-ids` 批量缓存 | skip-check 失败保守跳过 |

其余主路径（Daemon SSOT、`/api/command/execute`、`/api/mcp` enable/disable/info、菜单与 admin stop 去 fcmd）与设计一致。

## 3、影响范围

- **模块**：Daemon 控制层（斜杠、MCP admin HTTP）、Electron command 执行后端（`command-executor` + agent-api）。
- **接口**：新增 Electron `POST /api/command/execute`；扩展 Daemon `POST /api/mcp`（enable/disable/info）；遗留 `/commands*` 仅 dual/electron 模式。
- **环境变量**：`SLASH_EXEC_MODE=daemon|dual|electron`（**默认 `daemon`**；`closed_by: 20260712144931`）。
- **数据**：无持久化变更；dual 期内存 `slashExecutedMessageIds` + `.fcmd` 双写去重。

### 3.1 Ponytail 技术债

无（本次 diff 无 `ponytail:` 注释）。

评审 Ponytail 精简建议（非代码注释，记入 manifest `reviews`）：

| 位置 | 摘要 | 升级路径 |
|------|------|----------|
| `daemon-slash-mcp.ts` vs `command-handler` | `/mcp` 子命令解析重复 | 斜杠内循环 `POST /api/mcp` 合并 |
| `daemon-http-mcp-admin` vs `daemon-orchestrator` | HTTP 客户端重复 | 注入 orchestrator 转发 |
| `GET /commands/skip-check` | claim 前实时查询 + `executed-ids` 批量缓存并存 | 稳定后 `daemon` 模式可整段废弃 poll |

### 3.2 开放评审（accepted_debt 候选）

**无开放项** — R1/R2/R3 已由 T-FIX-01～03 清偿（manifest `reviews.status=fixed`）：

| ID | 状态 | 清偿摘要 | 任务 |
|----|------|----------|------|
| R1 | fixed | `slash_exec` 输出 `source=im\|menu` 与 `exec_path` | T-FIX-01 |
| R2 | fixed | Electron agent-api 注册 `POST /api/mcp/status-map` | T-FIX-02 |
| R3 | fixed | dual poll claim 前 `GET /commands/skip-check` 实时去重 | T-FIX-03 |

## 4、知识库影响清单

- [x] `knowledge/工程平台/Daemon守护进程/01-概览.md` — §五/§六/§九：`executeSlashCommand`、`SLASH_EXEC_MODE`；移除 Electron claim 硬依赖
- [x] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — §三/§五/§九：`/api/mcp` 全 action；command API 划界；T10 进展
- [x] `knowledge/业务域/Agent调度/04-远程指令.md` — §一～§五/§九：Daemon 即时执行主流程；接口表；`/mcp` HTTP 化
- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — §三：菜单走 `handleSlashCommand` 执行器
- [x] `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` — §九：admin 控制层 HTTP 化进度
- [x] `knowledge/知识地图.md` — 入口未变，无需更新
