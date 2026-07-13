---
type: ChangeProposal
title: SDK新特性落地-Claude预热与生命周期观测
description: 在已完成的 Claude Agent SDK 依赖升级之上，接入预热与首条冷路径消费，缩短 Claude 新会话首包/进入 processing 延迟；可选只读生命周期观测；不升依赖、不改 stop/权限与其它引擎。
timestamp: 2026-07-14T00:01:28+0800
---

# SDK新特性落地-Claude预热与生命周期观测产品需求文档

> **变更 ID**：`20260714000128-SDK新特性落地-Claude预热与生命周期观测`
> **来源**：kb-propose
> **类型**：性能优化 + 能力接入
> **优先级**：P2
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无

## 一、背景与问题

1.15.1 已完成 Claude / Codex / OpenCode 依赖升级（含 `claude-agent-sdk` 0.3.207）。升级后 SDK 已具备进程预热与 WarmQuery 等能力，但产品侧 Claude 通道仍主要走冷启动查询路径：新会话首包与进入 processing 的体感延迟偏长；文档侧仍残留「当前 SDK 无预热能力」类过时表述，易误导后续排期。

与归档变更「SDK首条冷启动优化」（Cursor 通道）边界清晰：该归档只覆盖 Cursor 冷启动与预热挂点；**本变更只覆盖 Claude 通道能力接入**，不重做 Cursor 预热实现。

**依赖边界（硬约束）**：依赖升级已完成；**本变更只做能力接入，不再升依赖**。

## 二、目标与非目标

### （一）本期必做

1. **Claude 预热接入**：对齐 Cursor 侧已验证的预热**挂点模式**（应用 init / 通道 bind 成功后后台触发、失败仅告警不阻断会话）。实现上使用 Claude SDK 自有预热能力，**不复用** Cursor 预热模块内容。
2. **首条/冷路径优先消费预热结果**：有可用预热结果时优先使用；失败或未命中时自动降级为普通冷启动查询，会话仍可正常启动。
3. **修正过时注释/文档表述**：清理现网误写「0.3.207 无 startup()/预热」等过时说明，避免与已升级能力矛盾。
4. **用户可见效果**：Claude 通道新会话在预热命中时，首包或进入 processing 的延迟相对「无预热冷启动」基线有可感知改善；预热失败不得导致 bind/launch 硬失败。

### （二）本期可选（小项）

- 增加 `command_lifecycle` 一类**只读**生命周期观测（内部 UI / 日志可检索即可）。
- capabilities 探测相关打点（便于确认当前运行时实际能力面）。
- **不**新增飞书 Presentation 新 kind；**不**承诺 IM 侧展示 cancelled / discarded 等终态文案。

### （三）本期明确不做

| 项 | 说明 |
|----|------|
| `/stop` 改走 Query 中断 API | 现网为 abort + close；中断 API 依赖 streaming input，本期不绑 |
| 用 `still_queued` 驱动 Daemon/IM 排队文案 | 与 Daemon 文件队列语义分层，避免两套排队话术耦合 |
| `bypassPermissions` / `canUseTool` 改动 | 权限与工具策略本轮不动 |
| Codex 能力扩展 | outputSchema、local_image、webSearchMode、modelReasoningEffort、additionalDirectories、todo_list 呈现等 → **另开变更** |
| OpenCode 迁移与中断 | `/v2` 迁移、`session.abort` 对齐 → **另开变更** |
| 重做 Cursor 冷启动归档 | 不重做 `20260711211323-SDK首条冷启动优化` |

### （四）建议另开变更名（后续）

- `Codex ThreadOptions与Turn能力扩展`
- `Codex todo_list与web_search呈现`
- `OpenCode session.abort中断对齐`

## 三、方案说明（产品口径）

### 与 1.15.1 的关系

| 已完成（1.15.1） | 本变更 |
|------------------|--------|
| 升级 claude-agent-sdk / Codex / OpenCode 依赖与 changelog | **不再升依赖** |
| 二进制与包版本到位 | **只做 Claude 预热与冷路径消费等能力接入** |

### 预热与首条体验

- **何时预热**：通道就绪后的后台预热（init / bind 后触发），不阻塞用户绑定与发信。
- **失败策略**：预热失败仅内部告警；会话创建、发信、冷启动查询路径保持可用。
- **首条消费**：新会话冷路径优先使用预热结果；未命中或失效则降级冷查询，用户无「必须预热成功才能聊」的门槛。
- **与 Cursor 预热的关系**：挂点模式可对齐（后台、不阻断）；能力实现与模块边界保持 Claude 自有，避免跨引擎复用 Cursor 预热内容。

### 可选观测

- 生命周期事件以内部可观测为主，不改变对外 IM 展示契约。
- 不把本轮观测做成新的用户可见 Presentation 类型。

### 研究结论摘要（范围裁剪依据）

- 现网 Claude 主路径仍以冷查询为主；升级后 SDK 已导出预热相关能力；长驻会话 ≠ 进程预热，二者勿混为一谈。
- stop 现网语义为关闭/中止，本期不改为 interrupt；生命周期类型若滞后可防御解析，观测保持只读。
- Codex / OpenCode 与本议题耦合低，排除出本期范围。

## 四、用户故事与验收标准

### 用户故事

- **Claude 通道新会话用户**：发首条任务后，在预热命中时更快看到回复首包或进入 processing，减少「卡住」感。
- **预热失败场景用户**：即使后台预热未成功，仍能正常冷启动会话，不会因预热报错无法 bind / launch。
- **热路径 / resume / stop 用户**：二次发信、续接与停止体验不回归；stop 仍即时反馈「已停止」。
- **（可选）研发/排障**：可通过内部日志观察到 lifecycle / capabilities 相关只读信息。

### 验收标准（用户可见）

1. **预热命中首包改善**：Claude 新会话在预热命中时，首包或进入 processing 的延迟相对**同环境无预热冷启动基线**有可说明的改善（design/测试阶段固定对比方法与基线口径；propose 不锁死具体毫秒数）。
2. **预热失败不阻断**：人为或自然预热失败时，会话仍可冷启动；bind / launch 无硬失败。
3. **行为不回归**：热路径、resume、stop 行为与现网一致；stop 仍即时「已停止」。
4. **（可选）lifecycle 可观测**：仅内部日志/UI log 可检索即可，不要求 IM 新展示。

## 五、影响范围（产品/知识）

- **用户可见**：Claude 通道新会话首包/processing 时延；预热失败时的可用性（应无感知失败）。
- **知识域**：Agent 调度域中 Claude 执行引擎相关说明（过时「无预热」表述、预热与冷路径语义）；具体知识库正文更新在后续 design/archive 由知识库流程处理。
- **不在本期**：Codex / OpenCode 产品能力面、飞书新 Presentation kind、权限策略、stop 语义改造。

## 六、类型、优先级与设计图

| 项 | 结论 |
|----|------|
| 类型 | 性能优化 + 能力接入 |
| 优先级 | P2 |
| Figma | **不需要**（无界面/视觉改版；已自动确认 `auto-none`） |
| 外部登记 | `kb.project.json` 未配置 `integrations.registry` / `integrations.notifications` → **SKIP**，不阻断 |

## 七、风险与待确认

1. **基线对比口径**：验收需约定「相对基线」的测量方式（同机、同模型、新会话冷路径）；具体数值在 design/测试阶段落盘。
2. **预热命中率**：init/bind 后到首条消息的时间窗口过短时，可能经常未命中而走降级；产品仍要求降级可用，改善为「命中时」条件验收。
3. **观测可选是否本期做**：lifecycle / capabilities 打点为可选小项，可在 design 时按工期取舍，不影响必做验收 1～3。
