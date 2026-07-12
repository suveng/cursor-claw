# workflow/ — 工作流定义与执行

## 模块边界

- `workflow-file.ts`：薄封装，委托 `../../src/workflow/workflow-store`；export 名保持稳定。
- `workflow-runner.ts`：`runWorkflowDefinition` / `resumeWorkflowInstance`；实例读写**仅**经 `workflow-file`。

## 编码规矩

- 共享类型从 `../../src/workflow/workflow-types` import。
- **禁止** Electron 侧直接 import `workflow-store`（经 `workflow-file` 统一）。
- **禁止**直接调用四引擎 SDK；统一走 `../session/session-dispatcher`。
- 恢复路径须调用 `resumeWorkflowInstance`，**禁止**在 IPC/斜杠 handler 内直调 `resumeWorkflow` 或 `launchWorkflowAgent`。
