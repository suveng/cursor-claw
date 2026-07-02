# workflow/ — 工作流定义与执行

## 模块边界

- `workflow-file.ts`：定义/实例 CRUD；builtin 种子；`userData/workflows/` 落盘。
- `workflow-runner.ts`：经 `session/session-dispatcher` 启动工作流 Agent；读 `config-store` 启用通道。

## 编码规矩

- 共享类型从 `../../src/shared/workflow-types` import。
- **禁止**直接调用四引擎 SDK；统一走 `../session/session-dispatcher`。
