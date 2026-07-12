# 工作流

> 多节点 Agent 流水线：YAML 定义有序节点链（含 Gateway 条件路由），MCP 工具驱动流转，支持驳回重跑与独立 Agent。

## 文件清单

| 编号 | 文件 | 职责 |
|------|------|------|
| 00 | [00-README.md](./00-README.md) | 领域局部索引（本文件） |
| 01 | [01-概览.md](./01-概览.md) | 模块总图、术语、依赖 |
| 02 | [02-定义与实例.md](./02-定义与实例.md) | YAML 结构、Definition/Instance 模型与存储 |
| 03 | [03-节点执行与流转.md](./03-节点执行与流转.md) | next/reject、Gateway、isolated、Prompt/config |
| 04 | [04-触发与管理入口.md](./04-触发与管理入口.md) | 设置页、/workflow、manage_workflows MCP |

## 职责边界

**负责**：工作流蓝图 CRUD、实例状态机、节点 Prompt 组装、Gateway 路由、MCP 流转/管理工具、Electron 启动与通知。

**不负责**：Agent 进程生命周期细节（见 [Agent调度](../Agent调度/00-README.md)）、消息通道连接（见 [消息桥接](../消息桥接/00-README.md)）。

## 源码锚点

| 模块 | 路径 |
|------|------|
| 引擎 facade | `src/workflow/workflow-engine.ts` |
| Prompt / config | `src/workflow/workflow-engine-prompt.ts` |
| 前进 / Gateway 穿越 | `src/workflow/workflow-engine-advance.ts`、`workflow-gateway.ts` |
| 驳回 | `src/workflow/workflow-engine-reject.ts` |
| 生命周期 / recover | `src/workflow/workflow-engine-lifecycle.ts` |
| Daemon / Electron 存储 | `src/workflow/workflow-store.ts`、`electron/workflow/workflow-file.ts` |
| 类型 / 解析 | `src/workflow/workflow-types.ts`、`workflow-parse.ts`、`workflow-definition-store.ts` |
| MCP | `src/workflow/server-workflow.ts` |
| 斜杠 CRUD | `electron/scheduling/command-handler-workflow-crud.ts` |
| UI | `WorkflowPanel`、`WorkflowDefEditor`、`WorkflowGatewayFields`、`WorkflowInstanceDetail` |
| HTTP 信号 | `src/daemon/daemon-http-workflow-signal.ts` |

## 推荐阅读路径

1. **01-概览** — 全局认知与状态机
2. **02-定义与实例** — 编写或导入 YAML（含 Gateway 字段）
3. **03-节点执行与流转** — Agent 侧 next/reject/Gateway
4. **04-触发与管理入口** — UI / 斜杠 / MCP

## 变更记录

2026-07-12：补齐 Gateway、config 替换、MCP resume、斜杠 CRUD、recover 开关；引擎拆分锚点（archive 20260712170536）。
2026-07-12：补 resume 锚点（archive 20260712113344）。
2026-07-02：源码锚点对齐 `src/workflow/*`（archive 20260702120154）。
2026-06-27：kb-sync 初始建立
