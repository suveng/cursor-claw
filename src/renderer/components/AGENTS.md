# renderer/components 编码规矩

## Agent 资源 UI 拆分

- `AgentPanel.tsx`：仅 Cursor SDK Key 列表与弹窗（<300 行）。
- `SettingsMcpPanel.tsx`：Settings MCP Tab（global/project CRUD、OAuth、插件说明区）；单文件 ≤300 行。
- `SettingsSkillsPanel.tsx`：Settings Skills Tab（上项目级、下用户级双区块）；props `{ workspaceDir }`；CRUD 末位传 `scope`；expand key 前缀 `${scope}/`；无工作区时项目级 `disabled`；拆分为 `SkillTreeBlock.tsx`（树列表）与 `SkillEditModals.tsx`（弹窗）；主面板 ≤300 行。
- `AgentProfilePanels.tsx`：Claude Code / Codex Profile 列表与弹窗；OpenCode 区块见 `AgentOpencodeProfileSection.tsx`；持久化时保留既有 SDK 资源。
- `AgentResourceModals.tsx`：`SdkEditModal` / `CcEditModal` / `CodexEditModal` / `OpenCodeEditModal` 弹窗组件。

## 通道模型区块

- `ChannelModelSection.tsx`：`RESOURCE_GROUP_LABELS` 与 `groupedTypes` 须覆盖全部 `AgentResource.type`；并列 OpenCodeSDK 变更 rebase 时按同模式扩展。
- Profile 型资源（`claude-code` / `codex` / `opencode`）：通道层不拉模型列表；绑定资源已删除时提示重选，勿 fallback 到其他资源。

## 通用

- 单文件不超过 300 行；新增引擎 Profile 时优先扩展现有文件或按上列拆分，不引入新抽象层。
- 代码须含中文注释（业务逻辑说明）。

## MCP 展示 enable/disable 标签（SessionMcpPanel.tsx）

- 取数经 `agent:mcp-status` IPC；主进程实现 `electron/session/session-mcp-status.ts`（`getSessionMcpStatus`）。
- 来源标签经 `mcp-view-strategy.formatMcpScopeLabel` 渲染（SDK 区分用户级/项目级/inline/settingSources/插件层）；runtime/snapshot/disk 三态经 `formatMcpStatusSourceLabel`。
- 审批未启用（`s.enabled === false`）渲染规矩：容器加 `opacity-60` 整体灰化；名字色阶从 `text-gray-300` 降为 `text-gray-500`；补「未启用」标签（`bg-gray-800/80` + `text-gray-500`）。
- 与 `statusLabel` 协同去重：`showApprovalDisabledTag = approvalDisabled && statusLabel !== "disabled"`——runtime status 已标 disabled 时不重复加「未启用」标签，由 statusLabel 表达；其余情况（审批未启用但 runtime 无条目/ready）补「未启用」标签。
- 不新增枚举字段表达 disabled；用现有 `statusLabel`/`statusColor` 体系扩展，不抽展示策略类。
