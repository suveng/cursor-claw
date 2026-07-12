/** 飞书斜杠指令 handler 入口：对外稳定 re-export，实现见 command-handler-*.ts */
export {
  type FileCommand,
  type ListedModel,
  runWithHttpCommandResultSink,
  reportCommandResult,
  parseListModelsStdout,
} from "./command-handler-shared"
export { handleFeishuModelCommand } from "./command-handler-model"
export {
  type TaskRunFn,
  type TaskEnqueueFn,
  handleFeishuTaskCommand,
} from "./command-handler-task"
export { handleFeishuMcpCommand } from "./command-handler-mcp"
export { handleFeishuWorkflowCommand } from "./command-handler-workflow"
