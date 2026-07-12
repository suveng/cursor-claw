# workflow 域编码规矩

## 目录与迁移

- 工作流专属源码统一放在 `src/workflow/`；跨域引用用 `../workflow/<file>.js`。
- 域内文件调整路径须用 `git mv`，保留 Git 历史；禁止在旧路径留 re-export shim 或 barrel `index.ts`。

## import 约定

- 域内模块互引用用**同目录相对路径** + **`.js` 后缀**（Node16 ESM），例如：
  - `./workflow-types.js`
  - `./workflow-store.js`
  - `./workflow-path.js`
  - `./workflow-session-key.js`
  - `./template-utils.js`
- 禁止域内再写 `./shared/workflow-*` 或 `../shared/template-utils` 等工作流专属路径。

## 职责边界

- 本目录含类型、解析、定义存储、模板工具、引擎、实例存储、MCP 服务与内置工作流。
- 编排入口（daemon）、Electron 运行器、渲染端 UI 的跨域 import 由对应任务更新，不在此目录内硬编码旧扁平路径。

---

## 模块分工

| 文件 | 职责 |
|------|------|
| `workflow-types.ts` | `WorkflowDefinition`、`WorkflowInstance` 等类型 SSOT |
| `workflow-parse.ts` | 定义文本解析 |
| `workflow-definition-store.ts` | 定义持久化 |
| `workflow-path.ts` | 运行时 `APP_DATA_DIR/workflows` 路径 SSOT、存储根日志、遗留目录迁移 |
| `workflow-session-key.ts` | `buildWorkflowSessionKey` / `assignInstanceSessionKey` |
| `workflow-store.ts` | 实例与定义运行时存储（每次 IO 经 `workflow-path` 懒解析） |
| `workflow-engine.ts` | `createInstance`、`startWorkflow`、`handleNext`/`handleReject` |
| `server-workflow.ts` | Daemon MCP 工具注册、`resumeWorkflowAndEmit` stdout 信号 SSOT |
| `builtin-workflows.ts` | 内置工作流加载 |
| `template-utils.ts` | 模板变量与占位符工具 |

## 引擎与 Daemon 协作

- **MCP 注册**：`registerWorkflowAgentTools` 由 `daemon/daemon.ts` 的 `daemonMain` 在 MCP 初始化时调用；`registerAdminTools` 在同处由 `daemon/server-admin.ts` 注册；工具 handler 读写 `workflow-store`，不直接 spawn Agent。
- **启动信号**：需启动 Agent 节点时 `server-workflow` 经 stdout 写 `__WF_LAUNCH__:` JSON 行；恢复暂停实例经 `resumeWorkflowAndEmit` 同步写 `__WF_INSTANCE__` / `__WF_LAUNCH__` / `__WF_NOTIFY__`；结构化日志写 **stderr**（`workflow_resume`，`source: "daemon"`），避免污染 stdout 信号行。Electron `daemon-manager` 解析后走 `session-dispatcher`，**不**在 workflow 域内 HTTP 调 Electron。
- **导出符号稳定**：`WorkflowDefinition`、`createInstance`、`startWorkflow`、`loadBuiltinWorkflows` 等对外 API 不因目录迁移而更名。

## 存储与解析约定

- 路径 SSOT：`workflow-path.ts`（`resolveWorkflowRoot` 等）；`workflow-store` **禁止**模块顶固化 `WORKFLOW_DIR`。
- 遗留迁移：`migrateLegacyWorkflowDirIfNeeded` 在 store 首次 IO 与 Electron `workflow-file.seedBuiltins` 触发（幂等）。
- 定义与实例字段须同步 `workflow-types.ts` 与 `normalizeWorkflowDefinition`。
- 解析失败应返回可读错误，不抛未捕获异常至 MCP 层；`parseWorkflowDefinitionText` 为唯一文本入口。

## 禁止

- 禁止 barrel `index.ts` 聚合导出
- 禁止在 workflow 域 import `daemon/` 或 `electron/`（单向：daemon → workflow）
- 单文件 ≤300 行；新增能力优先扩展现有文件按上表分工拆分
