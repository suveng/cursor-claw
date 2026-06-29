# 完全移除 Cursor CLI 依赖产品需求文档

> **变更 ID**：`20260629232914-完全移除Cursor CLI依赖`
> **来源**：kb-propose
> **类型**：重构
> **优先级**：P2
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无

## 背景

cursor-claw 的 IM 消息、定时任务与工作流已可通过 Cursor SDK 与 Claude Code 执行，核心链路不再依赖本机 Cursor CLI（`agent` 二进制）。

产品仍多处假定 CLI 存在：MCP 开关/状态/登录运维、部分模型列表、Dashboard/设置中的 CLI 安装登录引导、Agent 资源「CLI」类型、飞书与 CLI 绑定的 `/mcp` 与 `/model` 等。已全面使用 SDK 或 Claude Code 的用户仍可能被要求安装 CLI，或遇到无效入口与误导说明。

用户期望彻底移除 CLI 依赖，使产品仅依赖 SDK / Claude Code，且 IM 与任务执行体验不受影响。

## 目标

1. 不安装、不登录 Cursor CLI 即可完成 MCP 运维与 Agent 资源配置。
2. 移除「Cursor CLI」资源类型；onboarding 统一引导 SDK 与 Claude Code。
3. 清理 CLI 遗留配置、会话状态、无效入口与误导文案。
4. **IM 收发、定时任务、工作流及 SDK/Claude Code 通道行为不因本变更退化。**

## 非目标

- 不改变 SDK、Claude Code 的鉴权与执行语义。
- 不重构 IM 通道连接层。
- 不新增 MCP 协议能力；仅替换「经 CLI 运维 MCP」的体验。
- 不强制改写用户已有 SDK/CC 配置；历史 CLI 数据以提示与迁移/清理处理。

## 用户故事

- **管理员**：设置页管理 MCP 无需 CLI，仍能查看状态并在需 OAuth 时获得明确引导。
- **管理员**：新建 Agent 资源时仅见 SDK 与 Claude Code，不再误选 CLI。
- **管理员**：Dashboard/onboarding 指向 SDK API Key 与 Claude Code Profile，而非 CLI 安装登录。
- **IM 用户**：SDK/CC 绑定通道下，消息、任务、工作流与变更前一致；`/mcp`、`/model` 不因未装 CLI 而阻塞。
- **升级用户**：历史 CLI 配置有迁移或清理提示，不安装 CLI 亦可继续使用。

## 功能需求

### 阶段 1：MCP 运维不依赖 CLI

**F1.1** 设置页展示 MCP 列表并支持启用/停用，基于用户配置文件，不依赖 CLI 命令。

**F1.2** 各 MCP 可查看连接/健康状态（可连接、不可达、需登录、配置错误等）；需授权时提供等价引导（链接或配置说明），而非「请安装 CLI」。

**F1.3** SDK/CC 绑定通道下，飞书 `/mcp` 等指令按当前可用 MCP 响应；不可用时返回可理解说明。

### 阶段 2：移除 CLI 类型，统一 SDK / Claude Code

**F2.1** Agent 资源、通道、任务编辑中不再提供「Cursor CLI」类型及依赖 CLI 的模型获取路径。

**F2.2** Dashboard、设置与首次引导以 SDK 与 Claude Code 为主路径；移除 CLI 安装/登录专属 UI。

**F2.3** 模型体验与「仅 SDK + Claude Code」一致：SDK 保留通道级模型；Claude Code 以 Profile 为准。

### 阶段 3：清理遗留状态与文档

**F3.1** 历史 CLI 资源与通道绑定有提示及改绑/删除路径，不导致启动或核心页崩溃。

**F3.2** 隐藏或移除 CLI 专属会话与无效入口；文案不再将 CLI 描述为必需组件。

**F3.3** 应用内 README/帮助反映「无需 Cursor CLI」，修正仍要求安装 `agent` 的说明。

## 验收标准

1. 未安装 CLI、仅配置 SDK 或 Claude Code 时，IM Run、定时任务、工作流执行正常（回归通过）。
2. 设置页可完成 MCP 列表与开关；stdio 与 remote 类 MCP 状态展示合理；需登录 MCP 有引导而非 CLI 提示。
3. SDK/CC 通道下飞书 `/mcp` 等有合理响应，无「需要 CLI」阻塞。
4. 界面无 CLI 资源选项与 CLI 安装/登录主流程。
5. 新用户仅配置 SDK 或 Claude Code 即可使用通道与任务。
6. 存在历史 CLI 数据时，有迁移/清理提示，应用可正常使用。
7. 关键文案无「必须安装 Cursor CLI」类表述。
