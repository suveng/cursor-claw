# scheduling/ — 定时任务与远程指令

## 模块边界

- `cron-scheduler.ts`：cron 校验、任务文件读写、`previewCronNextRuns`。
- `command-handler.ts`：飞书 `/model` `/mcp` `/task` `/workflow` 远程指令；`TaskRunFn` 类型供 daemon 注入。

## 编码规矩

- 配置读 `../config/config-store`；MCP CRUD 走 `../mcp/mcp-manager`。
- **禁止**在本目录 spawn Agent 或写 workspace 注入。
