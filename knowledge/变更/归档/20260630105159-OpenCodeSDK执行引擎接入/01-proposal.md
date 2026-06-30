# OpenCode SDK执行引擎接入产品需求文档

> **变更 ID**：`20260630105159-OpenCodeSDK执行引擎接入`
> **来源**：kb-propose
> **类型**：新功能
> **优先级**：P1
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无
> **参考文档**：[OpenCode SDK 官方文档](https://opencode.ai/docs/sdk/)

## 背景

cursor-claw 当前 Agent 执行层已支持双引擎：Cursor SDK 与 Claude Code SDK。管理员可在配置中选择引擎类型，系统按引擎类型将 IM 消息、任务触发、工作流节点等执行请求路由至对应引擎；各 IM 通道可独立绑定引擎 Profile。

OpenAI Codex SDK 作为可选第三执行引擎的接入提案已在进行中（变更 `20260630104714-CodexSDK执行引擎接入`）。OpenCode 提供官方 SDK（`@opencode-ai/sdk`），支持以程序化方式管理 Agent 会话、执行 prompt、订阅流式事件，并可通过配置管理 Provider 与模型。团队希望将 OpenCode SDK 作为**独立可选执行引擎**接入，与现有双引擎及进行中的 Codex 提案并列，使管理员可在 Cursor SDK、Claude Code SDK、Codex SDK（若已交付）、OpenCode SDK 之间按需切换，进一步降低对单一 AI 服务的依赖。

## 目标

1. 支持通过配置项将 Agent 执行引擎切换为 OpenCode SDK（与现有 Cursor SDK、Claude Code SDK 及 Codex SDK 选项并列）
2. 覆盖全部现有执行路径：IM 消息路径、任务触发路径、工作流节点执行
3. 各引擎在功能上对等：消息处理、工具调用、流式呈现、上下文管理行为一致
4. 切换后现有 Presentation（飞书消息、进度推送）无感知变化
5. OpenCode SDK Profile 管理与 IM 通道绑定能力，与 Claude Code SDK 路径对等

## 非目标

- 不同时运行多个引擎处理同一 Run（非并行/A-B 分流）
- 不修改 IM 通道连接层（飞书/微信 WebSocket 不受影响）
- 不变更工作流 YAML 定义格式
- 不替换或移除现有 Cursor SDK、Claude Code SDK 引擎
- 不在本变更中扩展 OpenCode SDK 官方能力边界之外的新 Agent 形态

## 用户故事

**管理员视角**：

- 作为管理员，我希望在配置面板或配置文件中选择执行引擎（含 OpenCode SDK），以便在不同场景下灵活使用不同 AI 服务
- 作为管理员，我希望为 OpenCode SDK 配置多个独立 Profile（含鉴权、Provider/模型及部署模式等），管理方式与现有 Claude Code SDK Profile 对等
- 作为管理员，我希望选择「内嵌启动 OpenCode 服务」或「连接外部 OpenCode 服务」之一，以适应本地开发与已有 OpenCode 实例共存的场景
- 作为管理员，切换引擎后无需重启所有服务即可生效（或至少仅需轻量重启）

**用户视角**：

- 作为最终用户，切换执行引擎后，飞书/微信 IM 消息响应、任务执行结果、工作流节点行为与切换前保持一致，无感知差异
- 作为最终用户，当配置 OpenCode SDK 时，Agent 使用 OpenCode 能力执行，鉴权与模型选择由管理员配置管理，我不需额外操作

## 功能需求

### F1：引擎配置项

- 执行引擎选择扩展为包含 OpenCode SDK 在内的多引擎选项（与 Cursor SDK、Claude Code SDK、Codex SDK 并列；Codex 未交付前 OpenCode 为第三引擎选项，Codex 交付后为第四引擎选项）
- 配置变更后，新发起的 Agent Run 使用新引擎；已在执行中的 Run 不受影响
- OpenCode SDK 引擎须支持两种部署模式：（1）内嵌启动 OpenCode 服务（本地默认地址，可配置主机与端口等）；（2）连接外部已运行的 OpenCode 服务（通过服务地址配置）
- Provider 与模型选择通过 OpenCode 的配置体系管理；须支持为 Profile 独立设置 Provider 凭证及默认模型
- 支持配置多个 OpenCode SDK 账号 Profile，每个 Profile 包含：名称、部署模式、服务连接信息（内嵌或外部）、Provider/模型配置及必要的环境选项
- 管理方式与现有 Claude Code SDK Profile 对等：可新建、编辑、删除多个 Profile
- 每个 IM 通道（飞书/微信）可独立绑定到某一个 OpenCode SDK Profile

### F2：IM 消息路径支持

- 飞书/微信 IM 消息触发的 Agent Run 须支持使用 OpenCode SDK 执行
- 流式呈现（文本进度、工具调用、思考过程等）通过 OpenCode 事件流驱动，行为与 Cursor SDK、Claude Code SDK 路径一致

### F3：任务触发路径支持

- 从任务面板或任务指令触发的 Agent 须支持 OpenCode SDK 引擎

### F4：工作流节点支持

- YAML 工作流各节点的 Agent 执行须支持 OpenCode SDK
- 节点间上下文传递、reject/重跑逻辑不变

### F5：上下文与生命周期一致性

- 长驻 Agent 模式、上下文压缩/轮转、Run 超时处理、失败冷却与用户通知等现有机制须在 OpenCode SDK 路径下等价实现
- 会话续接：同一 sessionKey 连发消息时，OpenCode SDK 路径应支持会话保持与续跑，行为与现有双引擎长驻体验一致

### F6：IM 通道绑定 OpenCode SDK Profile

- 在 IM 通道（飞书/微信）的配置界面中，当执行引擎选择 OpenCode SDK 时，可从已配置的 Profile 列表中选择绑定一个
- 不同 IM 通道可绑定不同的 OpenCode SDK Profile
- 若绑定的 Profile 被删除，通道应提示重新选择，不自动降级执行

## 验收标准

1. 配置切换为 OpenCode SDK 后，IM 消息触发的 Agent Run 使用 OpenCode 能力执行并正常回复飞书/微信消息
2. 任务面板触发的 Agent 在 OpenCode SDK 引擎下可正常完成并输出结果
3. 包含 3 个以上节点的工作流在 OpenCode SDK 引擎下可完整流转
4. 切换回 Cursor SDK、Claude Code SDK 或 Codex SDK 引擎后，全部路径恢复正常，无需额外操作
5. OpenCode SDK 路径下，基于事件流的进度推送（thinking/tool/text 等等价形态）正常展示
6. 上下文超限时，压缩/轮转机制正常触发（OpenCode SDK 路径）
7. 配置界面支持独立设置 OpenCode Provider 凭证、模型及部署模式（内嵌启动 vs 连接外部服务），配置有效生效
8. 配置界面支持新建多个 OpenCode SDK Profile，各 Profile 的部署模式、Provider/模型配置独立保存互不干扰
9. 同一系统中两个 IM 通道绑定不同 OpenCode SDK Profile 时，各自触发的 Agent Run 使用对应 Profile 的配置
10. OpenCode SDK 路径下 Run 超时、失败冷却与用户可见错误提示行为与现有双引擎一致

## 参考文档

| 名称 | 链接 | 说明 |
|---|---|---|
| OpenCode SDK 官方文档 | https://opencode.ai/docs/sdk/ | `@opencode-ai/sdk` 安装、Client/Server 模式、Sessions/Events/Auth 等 API 说明 |
