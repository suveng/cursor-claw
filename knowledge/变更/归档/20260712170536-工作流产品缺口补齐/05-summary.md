# 工作流产品缺口补齐 - 变更总结

## 1、实际变更

- **引擎拆分**：`workflow-engine.ts` facade；`workflow-engine-prompt|advance|reject|lifecycle`；`workflow-gateway.ts`
- **Gateway**：`kind: gateway` + `routes`/`defaultNext`；`resolveGatewayNext` / `enterFromNode` 穿越不 spawn
- **reject**：`resolveRejectTarget` 默认跳过 gateway；显式 gateway→中文失败（REV-01 / T-FIX-01）
- **Prompt**：`applyConfigPlaceholders`（`{{config.key}}`）；驳回注入 `LAST_NODE_OUTPUT`
- **recover**：`workflowAutoPauseStale`（默认 true）→ Electron `seedBuiltins` + Daemon bootstrap 调 `recoverStaleInstances`
- **MCP**：`manage_workflows` 增 `resume`；create 缺参文案「YAML 或 JSON」
- **斜杠**：`/workflow create|update`（`command-handler-workflow-crud.ts`）
- **UI**：Gateway 字段、自动 paused 开关/说明、驳回辅助文案

代码/agents 清单与 `00-manifest.json` `files`（impl/agents）一致。

## 2、与设计的差异

1. `resolveGatewayNext` 四参（增 `prevOutput`），供 `contains` 作用上一节点 output——正向增强。
2. reject 以「回退跳过 gateway」对齐「不 spawn」，与前进 `enterFromNode` 方向不同、契约等价（T-FIX-01）。

其余 R1–R9 与 02 一致；无债务入库。

## 3、影响范围

工作流域引擎/MCP/斜杠/设置页；配置字段 `workflowAutoPauseStale`；IM 主路径未改。

### 3.1 Ponytail 技术债

无（本变更 diff 无新增 `ponytail:`；引擎拆分/极简 when/复用 parse 已落地）。

## 4、知识库影响清单

- [x] `knowledge/业务域/工作流/01-概览.md` — Gateway 状态机；关闭无 Gateway/config/MCP resume 限制；recover 开关
- [x] `knowledge/业务域/工作流/02-定义与实例.md` — Node `kind`/`routes`/`defaultNext`；config 二次替换语义
- [x] `knowledge/业务域/工作流/03-节点执行与流转.md` — Gateway 穿越、reject 跳过 gateway、config、上次 output、recover 接线/开关
- [x] `knowledge/业务域/工作流/04-触发与管理入口.md` — MCP resume、斜杠 create/update、文案
- [x] `knowledge/业务域/工作流/00-README.md` — 引擎拆分/gateway/crud 锚点
- [x] `knowledge/知识地图.md` — 工作流域摘要补 Gateway（轻量）
- [x] 领域 README 阅读路径未失真；总索引无新领域 → **不更新** `knowledge/知识索引.md`
- [x] 工程平台 Electron 叶子 — 开关落业务域 UI，**不更新**平台文档

## 相关

- [[00-manifest]]
- [[02-design]]
- [[04-review]]
