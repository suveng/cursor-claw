# scheduling/ — 定时任务与远程指令

## 模块边界

- `cron-scheduler.ts`：cron 校验、任务文件读写、`previewCronNextRuns`。
- `command-handler.ts`：飞书 `/model` `/mcp` `/task` `/workflow` 远程指令；`TaskRunFn` 类型供 daemon 注入；`runWithHttpCommandResultSink` 供 HTTP 同步路径捕获 `reportCommandResult` 文案。
- `command-executor.ts`：斜杠指令执行 SSOT（`executeFileCommand`）；poll 与 HTTP 路径共用；主进程能力经 `CommandExecutorContext` 注入，**禁止**反向 import `daemon-manager`。

## 编码规矩

- 配置读 `../config/config-store`；MCP CRUD 走 `../mcp/mcp-manager`。
- **禁止**在本目录 spawn Agent 或写 workspace 注入。
- 单文件 ≤300 行；新增斜杠分支只改 `command-executor.ts`。
