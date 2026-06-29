# Claude Agent SDK 落地产品需求文档

> **变更 ID**：`20260630002838-ClaudeAgentSDK落地`
> **来源**：kb-propose
> **类型**：refactor
> **优先级**：P1
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无

## 背景

Cursor Claw 已支持双执行引擎：Cursor 路径通过官方 Cursor SDK 库调用实现；Claude 路径通过启动外部 Claude 命令行进程并自行解析流式输出实现，维护成本较高，且与 Cursor 路径的集成方式不对称。

Anthropic 已提供官方 **Claude Agent SDK**，支持以库方式发起 Agent 会话、管理长驻实例、注入 MCP 服务与恢复历史会话。团队希望将 Claude 执行引擎迁移至该官方 SDK，使两条引擎路径在架构与可维护性上对齐，同时保留现有 IM 通道、任务与工作流上的全部用户能力。

**关联变更（说明关系，非本变更范围）**：

| 变更 | 关系 |
|------|------|
| 执行引擎扩展接入 ClaudeCode（已归档） | 当前 Claude 路径的能力与 Profile 绑定模型来源于该变更；本变更在其之上替换底层执行方式 |
| 完全移除 Cursor CLI 依赖（进行中） | 针对 Cursor 路径的 CLI 移除，与本变更独立；设计阶段需说明两变更的边界，避免相互阻塞 |

## 目标

1. Claude 执行引擎从「外部命令行进程 + 自研流式解析」迁移为「官方 Claude Agent SDK 库调用」
2. 与 Cursor 路径形成对称的 SDK 集成模式，降低双轨维护成本
3. 迁移后，用户在 IM、任务、工作流等全部现有入口上的体验与能力不退化
4. 产品界面与对外文档统一使用 **「Claude Agent」** 称谓，符合 Anthropic 品牌规范（避免使用「Claude Code Agent」等易混淆表述）

## 非目标

- **不修改** IM 通道与 Claude Profile 的绑定模型（通道仍绑定既有 Profile，配置项语义不变）
- **不保留** 旧命令行 spawn 与 SDK 库调用的双轨并行；迁移完成后仅保留 SDK 路径
- **不改动** IM 连接层（飞书/微信 WebSocket 等）
- **不改动** 工作流 YAML 定义格式
- **不涉及** 新增用户可见界面或视觉改版（本变更为执行引擎层 refactor）

## 用户故事

**管理员视角**：

- 作为管理员，我希望 Claude 引擎与 Cursor 引擎一样通过官方 SDK 稳定运行，以便减少因 CLI 版本变更导致的突发故障
- 作为管理员，迁移后现有 Claude Profile（API 地址、密钥、模型）配置仍可直接使用，无需重新录入

**用户视角**：

- 作为 IM 用户，绑定 Claude Profile 的通道在迁移后仍能正常发起对话、收到流式回复，thinking、工具调用与正文展示与迁移前一致
- 作为任务/工作流用户，Claude 引擎下的 Run 启动、多轮调度、会话恢复与 MCP 工具能力不受影响
- 作为桌面应用用户，安装打包版 Electron 后 Claude 引擎可正常启动与执行，无需额外手动安装命令行工具

## 功能需求

### F1：执行引擎迁移

- Claude 路径的全部 Agent Run（launch、dispatch、续跑）改由官方 Claude Agent SDK 驱动
- 移除对 Claude 命令行可执行文件的 spawn 依赖及与之配套的流式 JSON 自研解析链路
- 支持 SDK 提供的长驻预暖能力，与 Cursor 路径的长驻 Agent 模式在行为上对等

### F2：能力与路径覆盖

- **IM 消息路径**：飞书/微信 IM 触发的 Agent Run 在 Claude 引擎下正常执行
- **任务触发路径**：任务面板或指令触发的 Agent 正常完成
- **工作流节点**：YAML 工作流各节点的 Agent 执行正常，节点间上下文与 reject/重跑逻辑不变

### F3：呈现与交互一致性

- 流式输出中的 thinking、tool 调用卡片、stream-text 正文在 Presentation 层（飞书消息、进度推送等）的展示时序与粒度不退化
- Run 生命周期事件（启动、进行中、完成、失败、取消）与现有 UI/通道反馈一致

### F4：MCP 与扩展能力

- 系统已配置的 MCP 服务可通过 SDK 标准方式注入 Claude Agent Run
- MCP 授权状态与工具调用结果在通道侧可正常呈现

### F5：会话与上下文

- 支持在同一 Claude Profile 下通过会话标识恢复历史 Run（与现有 session 语义一致）
- 上下文超限时的压缩/轮转机制在 Claude SDK 路径下等价可用

### F6：打包与分发

- macOS（含 Apple Silicon）打包版 Electron 应用内 Claude 引擎可正常运行，不依赖用户本机预装 Claude 命令行
- 开发与生产环境行为一致，无「仅开发态可用」的隐性依赖

### F7：品牌与文案

- 设置页、Agent 面板、日志与知识库文档中涉及 Claude 引擎的展示文案统一为「Claude Agent」或「Claude Agent SDK」
- 清理或替换历史遗留的「Claude Code Agent」等不符合品牌规范的表述

## 验收标准

1. **IM 通道 launch/dispatch**：已绑定 Claude Profile 的 IM 通道可成功发起 Agent Run 并收到完整回复
2. **流式呈现不退化**：thinking、tool 调用、stream-text 三类流式内容在通道与桌面 UI 中均可正常展示，无明显丢事件或乱序
3. **任务与工作流**：任务触发与含 3 个以上节点的工作流在 Claude 引擎下可完整执行并输出预期结果
4. **MCP 注入**：至少一个已配置 MCP 服务可在 Claude Run 中被调用，工具结果正确回传至 Presentation
5. **会话恢复**：同一 Profile 下中断后可基于 session 标识续跑，上下文连贯
6. **打包版可用**：macOS 打包产物安装后，无需用户手动安装 Claude CLI，Claude 引擎路径可完成一次完整 IM 触发的 Run
7. **无双轨残留**：迁移完成后不存在「SDK 路径 + 命令行 spawn 路径」并行；旧 spawn 相关入口已移除
8. **品牌文案**：设置与文档抽查无「Claude Code Agent」类禁用表述，已统一为「Claude Agent」
9. **Cursor 路径回归**：Cursor SDK 引擎路径行为不受影响（与本变更独立，作为回归项）

## 风险与待设计确认（留待 /kb-design）

- 官方 SDK 事件模型与现有 Presentation 适配层的映射细节
- Electron 打包环境下 SDK 对平台二进制/可选依赖的要求
- 与「完全移除 Cursor CLI 依赖」变更的发布顺序与合并策略
