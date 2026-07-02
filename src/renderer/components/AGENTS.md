# renderer/components 编码规矩

## Agent 资源 UI 拆分

- `AgentPanel.tsx`：仅 Cursor SDK Key 列表与弹窗（<300 行）。
- `SettingsMcpPanel.tsx`：仅为过渡 re-export 包装；Settings 页 MCP Tab 经 `SettingsEngineShell` 直挂 `SettingsMcpEngineBlock`，勿再扩展此文件。
- `SettingsSkillsPanel.tsx`：Settings Skills Tab（上项目级、下用户级双区块）；props `{ workspaceDir }`；CRUD 末位传 `scope`；expand key 前缀 `${scope}/`；无工作区时项目级 `disabled`；拆分为 `SkillTreeBlock.tsx`（树列表）与 `SkillEditModals.tsx`（弹窗）；主面板 ≤300 行。
- `AgentProfilePanels.tsx`：Claude Code / Codex Profile 列表与弹窗；OpenCode 区块见 `AgentOpencodeProfileSection.tsx`；持久化时保留既有 SDK 资源。
- `AgentResourceModals.tsx`：`SdkEditModal` / `CcEditModal` / `CodexEditModal` / `OpenCodeEditModal` 弹窗组件。

## 通道模型区块

- `ChannelModelSection.tsx`：`groupedTypes` 须覆盖全部 `AgentResource.type`；`RESOURCE_GROUP_LABELS` SSOT 在 `src/shared/channel-types.ts`，从此 import，禁止组件内重复定义。
- Profile 型资源（`claude-code` / `codex` / `opencode`）：通道层不拉模型列表；绑定资源已删除时提示重选，勿 fallback 到其他资源。

## 设置页引擎感知分块（Rules / Skills / MCP）

- `SettingsEngineShell.tsx`：三 Tab 共用外壳；`allBoundTypes` 为全量绑定、`boundTypes` 为 Tab 可见子集；`channelContextLoaded` 未完成前不渲染空态；无通道/绑定失效/无适用引擎时分档琥珀引导。
- `SettingsRulesPanel.tsx`：SDK 项目级 Rules CRUD（`.cursor/rules/`）；由 `Settings.tsx` 仅在 `sdk ∈ boundTypes` 时经 Shell 挂载。
- `SettingsSkillsPanel.tsx`：SDK 项目级 Skills 管理；挂载条件同 Rules，仅 `sdk ∈ boundTypes`。
- `SettingsMcpEngineBlock.tsx`：按 `engineType` switch 渲染各引擎 MCP 块（SDK CRUD / CC 只读 / Codex·OpenCode 占位）。
- `SettingsMcpSdkSection.tsx`：SDK MCP CRUD 实现细节；由 `SettingsMcpEngineBlock` 在 `engineType === "sdk"` 时调用；`SettingsMcpPanel.tsx` 仅为过渡 re-export，Settings 页应经 Shell 直挂 `SettingsMcpEngineBlock`。
- `Settings.tsx`：`rules`/`skills`/`mcp`/`tasks` tab 共用 `loadChannelContext()`；Rules/Skills 传 `allBoundTypes`（全量）+ `boundTypes`（SDK 子集）；`channelContextLoaded` 防首次空态闪烁。

## 通用

- 单文件不超过 300 行；新增引擎 Profile 时优先扩展现有文件或按上列拆分，不引入新抽象层。
- 代码须含中文注释（业务逻辑说明）。

## MCP 展示 enable/disable 标签（SessionMcpPanel.tsx）

- 取数经 `agent:mcp-status` IPC；主进程实现 `electron/session/session-mcp-status.ts`（`getSessionMcpStatus`）。
- 来源标签经 `mcp-view-strategy.formatMcpScopeLabel` 渲染（SDK 区分用户级/项目级/inline/settingSources/插件层）；runtime/snapshot/disk 三态经 `formatMcpStatusSourceLabel`。
- 审批未启用（`s.enabled === false`）渲染规矩：容器加 `opacity-60` 整体灰化；名字色阶从 `text-gray-300` 降为 `text-gray-500`；补「未启用」标签（`bg-gray-800/80` + `text-gray-500`）。
- 与 `statusLabel` 协同去重：`showApprovalDisabledTag = approvalDisabled && statusLabel !== "disabled"`——runtime status 已标 disabled 时不重复加「未启用」标签，由 statusLabel 表达；其余情况（审批未启用但 runtime 无条目/ready）补「未启用」标签。
- 不新增枚举字段表达 disabled；用现有 `statusLabel`/`statusColor` 体系扩展，不抽展示策略类。
