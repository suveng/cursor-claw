# 执行引擎扩展接入ClaudeCode产品需求文档

> **变更 ID**：`20260629164130-执行引擎扩展接入ClaudeCode`
> **来源**：kb-propose
> **类型**：（待补全）
> **优先级**：（待补全）
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无

## 背景

cursor-claw 当前 Agent 执行引擎唯一依赖 Cursor SDK（@cursor/sdk），所有执行路径（IM 消息驱动、任务面板触发、工作流节点）均通过 Cursor SDK 发起 Agent Run。

随着 Claude Code SDK 的正式推出，团队希望将其作为第二执行引擎接入，使用户可在 Cursor SDK 与 Claude Code SDK 之间按需切换，降低对单一 SDK 的依赖，同时获得 Claude 模型的原生能力。

## 目标

1. 支持通过配置项将 Agent 执行引擎切换为 Claude Code SDK
2. 覆盖全部现有执行路径：IM 消息路径、任务触发路径、工作流节点执行
3. 两种引擎在功能上对等：消息处理、工具调用、流式呈现、上下文管理行为一致
4. 切换后现有 Presentation（飞书消息、进度推送）无感知变化

## 非目标

- 不同时运行两个引擎（非并行/A-B 分流）
- 不修改 IM 通道连接层（飞书/微信 WebSocket 不受影响）
- 不变更工作流 YAML 定义格式

## 用户故事

**管理员视角**：
- 作为管理员，我希望在配置面板或配置文件中选择执行引擎（Cursor SDK / Claude Code SDK），以便在不同场景下灵活使用不同 AI 服务
- 作为管理员，切换引擎后无需重启所有服务即可生效（或至少仅需轻量重启）

**用户视角**：
- 作为最终用户，切换执行引擎后，飞书/微信 IM 消息响应、任务执行结果、工作流节点行为与切换前保持一致，无感知差异
- 作为最终用户，当配置 Claude Code SDK 时，Agent 使用 Claude 模型执行，模型选择与 API 鉴权由配置项管理

## 功能需求

### F1：引擎配置项

- 新增配置字段，支持选择执行引擎：`cursor-sdk`（默认）或 `claude-code-sdk`
- 配置变更后，新发起的 Agent Run 使用新引擎；已在执行中的 Run 不受影响
- Claude Code SDK 引擎须支持以下三项独立配置：
  - **API Base URL**：自定义 Anthropic 协议端点（支持代理或私有部署，留空时使用默认地址）
  - **API Key**：Anthropic API 密钥
  - **模型**：使用的 Claude 模型名称（如 claude-sonnet-4-6、claude-opus-4-8 等）
- 三项配置均可在引擎配置处独立设置，可参考现有通道模型配置方式管理
- 支持配置多个 Claude Code SDK 账号 Profile，每个 Profile 包含：名称、API Base URL、API Key、默认模型
- 管理方式与现有 Cursor SDK 资源配置对等：可新建、编辑、删除多个 Profile
- 每个 IM 通道（飞书/微信）可独立绑定到某一个 Claude Code SDK Profile

### F2：IM 消息路径支持

- 飞书/微信 IM 消息触发的 Agent Run（当前 SDK-only 路径）须支持使用 Claude Code SDK 执行
- 流式呈现（stream-text、process events）行为与 Cursor SDK 路径一致

### F3：任务触发路径支持

- 从任务面板或 /task 指令触发的 Agent 须支持 Claude Code SDK 引擎

### F4：工作流节点支持

- YAML 工作流各节点的 Agent 执行须支持 Claude Code SDK
- 节点间上下文传递、reject/重跑逻辑不变

### F5：上下文与生命周期一致性

- 长驻 Agent 模式（resident）、上下文压缩、Run 超时处理等现有机制须在 Claude Code SDK 路径下等价实现

### F6：IM 通道绑定 Claude Code SDK Profile

- 在 IM 通道（飞书/微信）的配置界面中，当执行引擎选择 Claude Code SDK 时，可从已配置的 Profile 列表中选择绑定一个
- 不同 IM 通道可绑定不同的 Claude Code SDK Profile（如主飞书通道绑定 Profile-A，微信通道绑定 Profile-B）
- 若绑定的 Profile 被删除，通道应提示重新选择，不自动降级执行

## 验收标准

1. 配置切换为 Claude Code SDK 后，IM 消息触发的 Agent Run 使用 Claude 模型执行并正常回复飞书消息
2. 任务面板触发的 Agent 在 Claude Code SDK 引擎下可正常完成并输出结果
3. 包含 3 个以上节点的工作流在 Claude Code SDK 引擎下可完整流转
4. 切换回 Cursor SDK 引擎后，全部路径恢复正常，无需额外操作
5. Claude Code SDK 路径下，流式进度推送（thinking/tool/text）正常展示
6. 上下文超限时，压缩/轮转机制正常触发（Claude Code SDK 路径）
7. Claude Code SDK 配置界面支持独立设置 API Base URL、API Key 与模型名称，三项均有效生效
8. 配置界面支持新建多个 Claude Code SDK Profile，各 Profile 的 API Base URL、API Key、模型独立保存互不干扰
9. 同一系统中两个 IM 通道绑定不同 Claude Code SDK Profile 时，各自触发的 Agent Run 使用对应 Profile 的配置
