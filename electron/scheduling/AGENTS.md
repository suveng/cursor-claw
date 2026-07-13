# scheduling/ — 定时任务与远程指令

## 模块边界

- `cron-scheduler.ts`：cron 校验、任务文件读写、`previewCronNextRuns`。
- `command-handler.ts`：飞书斜杠指令**对外入口**（薄 re-export）；实现按指令族拆到 `command-handler-*.ts`。
- `command-executor.ts`：斜杠指令执行 SSOT（`executeFileCommand`）；poll 与 HTTP 路径共用；主进程能力经 `CommandExecutorContext` 注入，**禁止**反向 import `daemon-manager`。
- **`/restart` vs `/restart daemon`**：
  - 默认 `/restart`：仅 `resolveCommandSessionKey` 后 `restartCurrentSessionAgent` 重建**当前**会话；**禁止** `stopAllSessionAgents` / 清全局队列 / `restartDaemon`。
  - `/restart daemon`：停全部 Agent + 清队列 + `restartDaemon()`；终态文案须含「Daemon 重启」。
- **`/restart daemon` IM 回报**：`restartDaemon` 会 `stopDaemon` 杀掉发起 `forwardElectronCommandApi` 的旧 Daemon；**daemon 稳态**下终态群消息须由 `agent-command-http.ts` 在 **仅** `daemon` 子命令完成后经 `reportCommandResult` 直发**新** Daemon `/cmd/result`（普通 `/restart` 走 HTTP reply，勿假定 Daemon 被杀）。poll 路径在 `daemon-manager` reply 回调内刷新 `readLockFile()?.port`。

### command-handler 子文件

| 文件 | 职责 |
|------|------|
| `command-handler.ts` | 稳定入口；re-export 公开符号 |
| `command-handler-shared.ts` | `reportCommandResult` / `runWithHttpCommandResultSink` / `ListedModel` / `parseListModelsStdout` |
| `command-handler-model.ts` | `/model` |
| `command-handler-task.ts` | `/task`；导出 `TaskRunFn` / `TaskEnqueueFn` |
| `command-handler-mcp.ts` | `/mcp` |
| `command-handler-workflow.ts` | `/workflow` 路由分发 |
| `command-handler-workflow-crud.ts` | `/workflow create|update` 定义 CRUD |

域外 / 调度侧仍 `import … from "./command-handler"`（或 `../scheduling/command-handler`），**禁止**新建 barrel `index.ts`。

## 编码规矩

- 配置读 `../config/config-store`；MCP CRUD 走 `../mcp/mcp-manager`。
- **禁止**在本目录 spawn Agent 或写 workspace 注入。
- 单文件 ≤300 行；新增斜杠分支：产品路由改 `command-executor.ts`，handler 实现落入对应 `command-handler-*.ts`。
- `/restart daemon`：停止全部 Agent + 清队列后 `restartDaemon()`，**仅完成后** `reply` 一条终态文案；poll 路径 `reply` 上报前须 `readLockFile()?.port` 刷新端口。
- 默认 `/restart`：仅当前会话；成功文案区分「已重建当前会话」与「Daemon 重启」。
