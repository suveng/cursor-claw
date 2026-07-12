---
type: ChangeProposal
title: 工作流产品缺口补齐
description: 文案对齐、驳回上下文、自动 paused 产品化，并纳入 Gateway/config 二次替换/斜杠 CRUD
timestamp: 2026-07-12T19:05:00+0800
related: []
depends_on:
  - "[[20260712113344-工作流恢复入口与信号接口]]"
  - "[[20260712145628-工作流会话键与存储统一]]"
---

# 工作流产品缺口补齐产品需求文档

> **变更 ID**：`20260712170536-工作流产品缺口补齐`
> **来源**：kb-propose
> **类型**：功能
> **优先级**：P1
> **外部 PRD**：无
> **Figma 设计图**：无（`figma_decision=auto-none`；文案/设置辅助说明视为无新视觉，沿用 WorkflowPanel / InstanceDetail 既有区域）
> **任务记录**：无
> **依赖**：`20260712113344-工作流恢复入口与信号接口`（paused 恢复三入口已落地）、`20260712145628-工作流会话键与存储统一`（存储与会话键 SSOT 已落地）
> **范围裁定（2026-07-12）**：原「一期 + 二期」**全部纳入本变更必做**；禁止 defer、禁止把 Gateway / config 二次替换 / `/workflow` create/update 记成「后续」。

## 一、背景与问题陈述

工作流已具备多节点 YAML/JSON 定义、MCP 驱动流转、`isolated` 独立 Agent、实例 `sessionKey` 持久化，以及 **paused 恢复三入口**（设置页、飞书 `/workflow resume`、HTTP `POST /api/workflow-signal`）。但在产品体验与能力表述上仍存在多处缺口，用户与集成方容易误判能力边界，复杂审批场景也难以表达。

**现状摘要（以知识库与代码为准）**：

| 领域 | 已有能力 | 缺口 |
|------|----------|------|
| 流转模型 | 有序节点链；驳回可回退至当前节点之前 | **无分支 Gateway**（条件路由） |
| 配置变量 | 定义级 `config` 存在；模板有 CONFIG_VARS 列表 | 节点 prompt 内 `{{config.xxx}}` **引擎不二次替换** |
| 管理入口 | 设置页定义编辑；`/workflow` 查询/运行/恢复；MCP `manage_workflows` | MCP **无 resume** action；斜杠 **无 create/update**；create 错误文案仍写「JSON」 |
| 驳回重跑 | `buildRetryPrompt` 依赖 context 组装 | **未单独注入上次节点 output** |
| 异常恢复 | `recoverStaleInstances` 可将陈旧 `running` 标为 `paused` | **现网无调用方**；无产品开关与说明 |

**用户感知**：复杂审批难建模；`{{config.xxx}}` 写了不生效；管理入口文案与能力不一致；驳回后修正效率低；自动 paused 不可控/不透明。

## 二、用户可见症状

| 症状 | 典型表现 |
|------|----------|
| 创建定义被误导 | MCP create 缺参错误仍提示「JSON」，与 YAML 口径不一致 |
| resume 能力认知分裂 | MCP action 列表无 resume，集成方以为只能 HTTP/斜杠 |
| 驳回后上下文不足 | 重跑时看不到「上次本节点 output」独立块 |
| 自动 paused 不可控 | 策略对用户不透明；函数未接线则「应暂停」也可能未发生 |
| 复杂分支难建模 | 单定义内无法条件路由 |
| config 占位符无效 | prompt 中 `{{config.reviewer}}` 不替换 |
| 斜杠无定义 CRUD | 只能设置页/MCP 创建更新定义 |

## 三、目标与非目标

### 本变更必须达成

1. **文案与能力对齐**：MCP create/update 明确 YAML+JSON；斜杠/MCP/HTTP resume 表述一致；**补齐 MCP `resume` action**。
2. **驳回重跑上下文增强**：重跑 Prompt **单独呈现**该节点上次 output。
3. **自动 paused 产品化**：接线 `recoverStaleInstances` + **设置开关**（默认仍自动 paused）+ 面向用户说明。
4. **分支 Gateway**：条件路由节点，单定义内按条件选下一节点。
5. **config 二次替换**：引擎对节点 prompt 内 `{{config.xxx}}` 在组装 Prompt 时替换。
6. **斜杠定义 CRUD**：`/workflow create|update` 与 MCP 定义 CRUD 对齐（YAML/JSON）。

### 非目标（明确不做）

- **不重做**整套工作流引擎或状态机模型（在现有有序节点 + MCP 流转上增量）。
- **不改** IM 主路径（飞书/微信消息收发、入队、调度、展示）。
- **不做**新 Figma 视觉组件（开关/说明落既有设置区辅助文本）。
- **不在 propose 阶段**绑定实现细节（归属 `/kb-design`；本文件只定产品口径）。

## 四、用户与场景

| 用户 | 诉求 |
|------|------|
| 工作流编排者 | YAML 定义正确；config 占位生效；条件分支可表达；驳回可基于上次产出修正 |
| 飞书/设置页操作者 | 理解/开关自动 paused；斜杠可 create/update |
| 集成方 / MCP | 文案与 action 与真实能力一致（含 resume） |
| Agent（执行侧） | 驳回重跑获足够上下文 |

| 场景 | 简述 |
|------|------|
| S1 | MCP/斜杠用 YAML 创建定义不被误导 |
| S2 | 斜杠/MCP/HTTP 对 resume 描述一致且 MCP 可 resume |
| S3 | 驳回重跑 Prompt 含上次本节点 output 独立块 |
| S4 | 自动 paused：可开关（默认开）、可说明、启动时实际接线 |
| S5 | Gateway：审批通过/驳回走不同后续节点 |
| S6 | prompt 内 `{{config.xxx}}` 被替换为定义 config 值 |
| S7 | `/workflow create|update` 写入/更新定义 |

## 五、功能需求

| 编号 | 需求描述 |
|------|----------|
| R1 | MCP create/update 帮助与错误提示明确 **YAML 与 JSON**，不再写「仅 JSON」。 |
| R2 | resume 描述一致；**补齐 MCP `manage_workflows` `resume` action**（复用 `resumeWorkflowAndEmit`）。 |
| R3 | `workflow_reject` 后重跑目标节点时，Prompt **单独呈现**该节点上次 `output`。 |
| R4 | 驳回上下文在设置页/工作流区有一句可理解说明。 |
| R5 | `recoverStaleInstances` **接线** + **设置开关**（默认 **true**=保持自动 paused）+ paused 态说明与恢复指引。 |
| R6 | **不改** IM 主路径；不整体重写引擎。 |
| R7 | 分支 **Gateway** 节点：按条件选择下一节点。 |
| R8 | 引擎对 prompt 内 `{{config.xxx}}` **二次替换**。 |
| R9 | `/workflow create|update` 与 MCP 定义 CRUD 对齐。 |

## 六、验收标准

1. YAML 创建不再误导：MCP/斜杠文档与错误文案支持 YAML；用 YAML 可成功 create。
2. resume 一致：斜杠帮助、MCP action（含 resume）、HTTP 路径表述一致；MCP resume 可恢复 paused 实例。
3. 驳回可见上次 output：重跑 Prompt 含独立块（契约可断言块存在）。
4. 自动 paused：开关默认开启时启动会将陈旧 running→paused；关闭后不再自动转换；UI/帮助可理解为何 paused、如何恢复。
5. Gateway：单定义内可按条件走到不同后续节点（含未命中 default / 失败可读）。
6. `{{config.xxx}}`：组装后的 Prompt 中占位符已替换为 config 值（缺失键行为可读、不静默留原样或产品约定降级）。
7. 斜杠 create/update：可用 YAML/JSON 创建与更新定义，与 MCP 解析口径一致。
8. 范围守卫：IM 主路径无行为回归；单文件实现遵守 ≤300 行（超限拆分）。

## 七、范围边界

| 在范围 | 不在范围 |
|--------|----------|
| MCP/斜杠文案与 resume action | 工作流引擎整体重写 |
| 驳回 Prompt 上下文增强 | IM 消息通道、队列、调度主路径 |
| recover 接线 + 开关 + 说明 | 新 Figma 视觉体系 |
| Gateway 条件路由 | 复杂表达式语言/可视化编排器 |
| `{{config.xxx}}` 引擎替换 | 任意模板语言（仅 config 点号占位） |
| `/workflow create/update` | 微信侧独立工作流指令 |

## 八、风险与依赖

| 项 | 说明 |
|----|------|
| 依赖 | resume 三入口、存储/sessionKey SSOT；R2 复用 `resumeWorkflowAndEmit` |
| Figma | 已关：`auto-none`；开关落既有工作流 Tab 辅助区 |
| 驳回注入 | 与 `node-prompt.md` `isRetry` 块协调，避免重复 |
| 默认策略 | 自动 paused 开关默认 **true**（保持安全策略） |
| 引擎超限 | `workflow-engine.ts` 已 >300 行；Gateway/config 必拆分 |
| recover 未接线 | 设计必须接线，禁止仅写开关假装完成 |
| 质量门 | **禁止** defer / 「下期再说」 |

## 九、能力对照（本变更全部必做）

| 能力 | 本变更 |
|------|--------|
| MCP create YAML 说明 | ✓ |
| resume 文案 + MCP resume action | ✓ |
| 驳回上次 output 注入 | ✓ |
| 自动 paused 接线/开关/说明 | ✓ |
| 分支 Gateway | ✓ |
| `{{config.xxx}}` 替换 | ✓ |
| `/workflow` create/update | ✓ |

## 相关

- [[02-design]]
- [[00-manifest]]
