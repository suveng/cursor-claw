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
- `SettingsMcpEngineBlock.tsx`：按 `engineType` switch 渲染各引擎 MCP 块（SDK CRUD / CC·Codex·OpenCode 只读 `SettingsMcpDiskReadonly`）；Codex 文案标明「设置页不提供 TOML 编辑」。
- `SettingsMcpDaemonGuide.tsx`：MCP Tab 顶部可复制 `cursor-claw`→`/mcp` 片段；脚注指向 IM `/mcp` 或 `POST /api/mcp`（不含 `/mcp-admin`）。
- `SettingsMcpSdkSection.tsx`：SDK MCP CRUD 实现细节；由 `SettingsMcpEngineBlock` 在 `engineType === "sdk"` 时调用；`SettingsMcpPanel.tsx` 仅为过渡 re-export，Settings 页应经 Shell 直挂 `SettingsMcpEngineBlock`。
- `Settings.tsx`（路径在 `pages/`）：Tab 壳与共享 load（`getConfig` / `loadChannelContext`）；`rules`/`skills`/`mcp`/`tasks` 共用 channel context；Rules/Skills 传 `allBoundTypes` + `boundTypes`；`channelContextLoaded` 防首次空态闪烁；壳 ≤300。

## 设置页内联 Tab（`pages/Settings*Tab.tsx`）

- 路径在 `src/renderer/pages/`，非本目录；由 `Settings.tsx` 按 `tab` 挂载，props 传入 state / setter / save 回调。
- `SettingsGeneralTab.tsx` / `SettingsProxyTab.tsx` / `SettingsTasksTab.tsx` / `SettingsSetupTab.tsx` / `SettingsAboutTab.tsx`：各 Tab 字段与保存语义落在对应文件；新增字段优先扩现有 Tab，勿把 JSX 再塞回壳。
- `SettingsSetupTab` 能力对照等静态说明：同文件内 section 即可，**禁止**新建「帮助中心」服务或跨文件文案抽象（仅重复句时才抽同文件常量）。
- 通道 / Agent / Rules / Skills / MCP / Workflows Tab 仍挂本目录既有面板（`ChannelPanel`、`AgentPanel`、Shell 系、`WorkflowPanel`）。

## 通道面板与编辑弹窗

- `ChannelPanel.tsx`：通道列表壳（打开/关闭编辑）；≤300；勿把表单再内联回列表。
- `ChannelEditModal.tsx`：编辑弹窗主表单；具名导出 `ChannelEditModal`。
- `ChannelEditWechat.tsx` / `ChannelEditAccess.tsx`：微信扫码/凭据块、访问控制与高级项；由 Modal 组合。
- 微信群策略/显示名辅助说明：写在对应控件下方 inline（`text-[11px]`），**禁止**另建帮助框架组件；文案与 gate 语义对齐即可。
- `channel-panel-helpers.ts`：`emptyChannel` / `newLocalChannelId` / `isDefaultChannelName` 等纯辅助；禁止塞 React 组件。

## Dashboard 主页拆分（`pages/Dashboard*.tsx`）

- 路径在 `src/renderer/pages/`；`Dashboard.tsx` 为组装壳（订阅 / IPC），签名 `Dashboard({ onSettings, active })` 不变，壳 ≤300。
- `DashboardOnboard.tsx`：引导三步 UI。
- `DashboardStatusCards.tsx`：状态卡与文案常量。
- `DashboardDetailPanels.tsx`：详情侧栏/展开面板。
- `DashboardLogPanel.tsx`：`LogLine`、日志正则与配色；勿改日志解析格式除非行为等价搬迁。

## 工作流 UI 拆分

- `WorkflowPanel.tsx`：定义/实例列表与启动弹窗（≤300 行）。
- `WorkflowDefEditor.tsx`：工作流定义编辑弹窗；`emptyWorkflowDef()` 供新建入口。
- `WorkflowGatewayFields.tsx`：Gateway kind/routes/defaultNext 字段编辑（从 DefEditor 拆出守行数）。
- `WorkflowInstanceDetail.tsx`：实例详情弹窗；导出 `STATUS_STYLE`/`STATUS_LABEL`；paused 态「恢复」经 `resumeWorkflowInstance` IPC。

## 通用

- 单文件不超过 300 行；新增引擎 Profile 时优先扩展现有文件或按上列拆分，不引入新抽象层。
- 代码须含中文注释（业务逻辑说明）。

## MCP 展示 enable/disable 标签（SessionMcpPanel.tsx）

- 取数经 `agent:mcp-status` IPC；主进程实现 `electron/session/session-mcp-status.ts`（`getSessionMcpStatus`）。
- 来源标签经 `mcp-view-strategy.formatMcpScopeLabel` 渲染（SDK 区分用户级/项目级/inline/settingSources/插件层）；runtime/snapshot/disk 三态经 `formatMcpStatusSourceLabel`。
- 审批未启用（`s.enabled === false`）渲染规矩：容器加 `opacity-60` 整体灰化；名字色阶从 `text-gray-300` 降为 `text-gray-500`；补「未启用」标签（`bg-gray-800/80` + `text-gray-500`）。
- 与 `statusLabel` 协同去重：`showApprovalDisabledTag = approvalDisabled && statusLabel !== "disabled"`——runtime status 已标 disabled 时不重复加「未启用」标签，由 statusLabel 表达；其余情况（审批未启用但 runtime 无条目/ready）补「未启用」标签。
- 不新增枚举字段表达 disabled；用现有 `statusLabel`/`statusColor` 体系扩展，不抽展示策略类。
