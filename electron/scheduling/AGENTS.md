# scheduling/ — 定时任务与远程指令

## 模块边界

- `cron-scheduler.ts`：cron 校验、任务文件读写、`previewCronNextRuns`。
- `command-handler.ts`：飞书斜杠指令**对外入口**（薄 re-export）；实现按指令族拆到 `command-handler-*.ts`。
- `command-executor.ts`：斜杠指令执行 SSOT（`executeFileCommand`）；poll 与 HTTP 路径共用；主进程能力经 `CommandExecutorContext` 注入，**禁止**反向 import `daemon-manager`。

### command-handler 子文件

| 文件 | 职责 |
|------|------|
| `command-handler.ts` | 稳定入口；re-export 公开符号 |
| `command-handler-shared.ts` | `reportCommandResult` / `runWithHttpCommandResultSink` / `ListedModel` / `parseListModelsStdout` |
| `command-handler-model.ts` | `/model` |
| `command-handler-task.ts` | `/task`；导出 `TaskRunFn` / `TaskEnqueueFn` |
| `command-handler-mcp.ts` | `/mcp` |
| `command-handler-workflow.ts` | `/workflow` |

域外 / 调度侧仍 `import … from "./command-handler"`（或 `../scheduling/command-handler`），**禁止**新建 barrel `index.ts`。

## 编码规矩

- 配置读 `../config/config-store`；MCP CRUD 走 `../mcp/mcp-manager`。
- **禁止**在本目录 spawn Agent 或写 workspace 注入。
- 单文件 ≤300 行；新增斜杠分支：产品路由改 `command-executor.ts`，handler 实现落入对应 `command-handler-*.ts`。
