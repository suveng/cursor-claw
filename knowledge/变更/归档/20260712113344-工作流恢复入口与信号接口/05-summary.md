# 工作流恢复入口与信号接口 - 变更总结

## 1、实际变更

### 新增代码

| 文件 | 关键改动 |
|------|----------|
| `electron/workflow/workflow-runner.ts` | `resumeWorkflowInstance` — Electron 恢复 SSOT（引擎 `resumeWorkflow` + `launchWorkflowAgent` + `workflow:instance-updated`） |
| `src/workflow/server-workflow.ts` | `resumeWorkflowAndEmit` — Daemon 恢复 SSOT（`emitInstanceUpdate` / `emitLaunch` / `emitNotify`） |
| `src/daemon/daemon-http-workflow-signal.ts` | `tryHandleWorkflowSignalRoute` — `POST /api/workflow-signal`，`action=resume` |
| `src/renderer/components/WorkflowInstanceDetail.tsx` | paused 实例详情「恢复」按钮 |
| `src/renderer/components/WorkflowDefEditor.tsx` | `WorkflowPanel` 拆分（行数约束） |

### 修改代码

| 文件 | 关键改动 |
|------|----------|
| `electron/scheduling/command-handler.ts` | `/workflow resume` 子命令 + `WORKFLOW_SUBCMD_HELP` |
| `electron/daemon/daemon-manager.ts` | IPC `workflow:resume` handler |
| `electron/preload.ts` / `src/renderer/env.d.ts` | `resumeWorkflowInstance` 暴露 |
| `src/renderer/components/WorkflowPanel.tsx` | 引用 `WorkflowInstanceDetail` |
| `src/daemon/daemon-http-routes.ts` | 注册 workflow-signal 路由 |
| `src/daemon/daemon.ts` | `COMMANDS["/workflow"]` 补 resume |
| 各 `AGENTS.md` | 模块边界与拆分说明 |

## 2、与设计的差异

| 项 | 设计预期 | 实际 | 影响 |
|----|----------|------|------|
| 斜杠实例未命中文案 | `❌ 实例不存在` | `❌ 找不到该实例` | 仅文案；引擎路径仍为「实例不存在」 |
| `feishu-help-text.ts` resume 行 | 与 `WORKFLOW_SUBCMD_HELP` 同步 | 未改顶层 help | 子命令详情由无参 `/workflow` 返回 `WORKFLOW_SUBCMD_HELP` |
| MCP `manage_workflows` action=resume | 可选 | 未实现 | HTTP 直连 `resumeWorkflowAndEmit`；符合 01 验收 |
| `resumeWorkflowAndEmit` 入口日志 | — | 函数开头 `logWorkflowResume(id, false)` | 成功路径多一条失败态 stderr 日志；不阻断归档 |

主路径（双端 SSOT、三入口语义、T10 斜杠链、HTTP 400/404/409、loopback 信任域）与设计一致。

## 3、影响范围

- **模块**：工作流引擎接线（`workflow-runner`、`server-workflow`）、设置页 UI、飞书 `/workflow`、Daemon HTTP。
- **接口**：新增 IPC `workflow:resume`；新增 `POST /api/workflow-signal`；斜杠 `/workflow resume`。
- **数据**：无；仅实例 JSON `status` paused→running（既有字段）。
- **授权**：UI=本地 Electron 用户；斜杠=通道准入；HTTP=127.0.0.1 loopback（同 `/api/mcp`）。

### 3.1 技术债（accepted_debt 候选）

| 项 | 说明 |
|----|------|
| 日志格式双轨 | Electron/斜杠 JSON `workflow_resume`；Daemon/HTTP stderr 前缀（避免污染 stdout 信号行） |
| Daemon/Electron 工作流存储双路径 | HTTP 读 `APP_DATA_DIR/workflows`，UI 读 `userData/workflows`；与 MCP `run` 一致，非本变更引入 | **closed_by: `20260712145628`** — SSOT `APP_DATA_DIR/workflows` + `workflow-file` 委托 `workflow-store` |

## 4、知识库影响清单

- [x] `knowledge/业务域/工作流/04-触发与管理入口.md` — resume 三入口、双端 SSOT、IPC/HTTP 契约
- [x] `knowledge/业务域/工作流/01-概览.md` — §三恢复入口标注；§九 关闭入口/HTTP 缺失限制
- [x] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — §五 `POST /api/workflow-signal`
- [x] `knowledge/业务域/工作流/03-节点执行与流转.md` — §九 resume 产品入口
- [x] `knowledge/业务域/Agent调度/04-远程指令.md` — `/workflow resume` 子命令
- [ ] `knowledge/知识地图.md` — 入口未变，无需更新
- [x] `knowledge/业务域/工作流/00-README.md` — 源码锚点补 `WorkflowInstanceDetail`、HTTP 信号路径
