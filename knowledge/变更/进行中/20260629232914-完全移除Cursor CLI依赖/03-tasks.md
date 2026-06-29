# 完全移除 Cursor CLI 依赖 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### 1.1 依赖图

```
T1（阶段1·MCP 核心）
T3（阶段2·类型/配置）    T4（阶段2·IPC 删除）
         │                      │
         └──────────┬───────────┘
                    ▼
T1 ──→ T2（阶段1/2·指令与 Settings MCP Tab）
T3 ──→ T5（阶段2·Renderer 去 CLI）
T3 ──→ T6（阶段3·历史迁移 Banner）
T2,T4,T5,T6 ──→ T7（阶段3·删除 spawn/CLI 模块）
T7 ──→ T8（阶段3·文案扫尾）
```

### 1.2 分组调度

- **第一轮（并行）**: T1, T3, T4
- **第二轮（并行）**: T2（依赖 T1+T3）, T5（依赖 T3+T4）
- **第三轮**: T6（依赖 T3+T5）
- **第四轮**: T7（依赖 T2+T4+T5+T6）
- **第五轮**: T8（依赖 T7）

## 2、任务清单

<!-- 以下每条任务自包含；子 agent 执行时只读单条 T{n} + 上下文文件 -->

---

## T1: MCP 管理器去 CLI 化

### 背景

阶段 1 核心：`mcp-manager.ts` 当前通过 `fetchMcpList` 调用 `agent mcp list` 获取启用/状态，`toggleMcpServer`/`loginMcpServer`/`getMcpServerTools` 亦依赖 CLI spawn。本任务改为直接读写 `mcp.json` 的 `disabled` 字段，并用已有 `queryToolsViaProtocol` / `queryToolsViaHttp` 做健康探测，为 Settings MCP Tab 与飞书 `/mcp` 提供无 CLI 的后端契约。

### 上下文文件

- CodeGraph: `getMcpServerList` `toggleMcpServer` `getMcpStatusMap` `queryToolsViaProtocol` — 定位 MCP 读写与探测链
- 必读: `electron/mcp-manager.ts` — 全部 MCP 导出函数；重点 L101-147（fetchMcpList）、L177-224（getMcpServerList/buildEntry）、L365-523（探测与 queryToolsViaCli）
- 必读: `electron/mcp-project-dir.ts` — `readMcpJson`/`saveMcpServer`、`mcp-auth.json` 路径
- 参考: `electron/mcp-sdk-loader.ts` — SDK 运行时读 `disabled` 逻辑（本任务不改，验收需一致）

### 实现范围

- 修改: `electron/mcp-manager.ts`
  - `getMcpEnabledMap`：同步返回 `getMcpServerList()` 各 entry 的 `enabled`（`disabled !== true`），删除 `fetchMcpList`/`spawnAsync` 的 `mcp list` 路径
  - `toggleMcpServer(name, enabled)`：定位 global/project entry，`saveMcpServer(name, { ...raw, disabled: !enabled })`
  - `getMcpStatusMap`：disabled→`"disabled"`；command 型→`queryToolsViaProtocol`；url 型→`queryToolsViaHttp`，结合 `readApprovedServers` 标 `"needs_login"`/`"ready"`/错误摘要
  - `loginMcpServer`：删除 CLI spawn；返回 OAuth 手动配置说明，若 entry 含 `url` 则 `shell.openExternal` 文档链接
  - `getMcpServerTools`：删除 `queryToolsViaCli` 优先路径，直接 HTTP/stdio
  - 删除未再使用的 `fetchMcpList`、`queryToolsViaCli` 及相关 cache（若已无引用）

### 接口契约

- `getMcpEnabledMap(force?: boolean): Promise<Record<string, boolean>>` — enabled 来自 json，不 spawn CLI
- `getMcpStatusMap(force?: boolean): Promise<Record<string, McpStatus>>` — 状态来自探测，保留 30s/15s 超时上限
- `toggleMcpServer(name: string, enabled: boolean): Promise<void>` — 写 `mcp.json` `disabled`
- `loginMcpServer(name: string): Promise<{ ok: boolean; message?: string }>` — 无 `agent mcp login`
- `getMcpServerTools(serverName: string): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }>` — 无 CLI fallback

### 验收标准

- [ ] 未安装 CLI 时 `getMcpEnabledMap`/`getMcpStatusMap` 正常返回，不 spawn `agent`
- [ ] toggle 后对应 scope 的 `mcp.json` 出现或清除 `disabled: true`（覆盖 01 验收 2、F1.1）
- [ ] stdio/url 型 MCP 状态展示合理；需 OAuth 时返回配置说明而非「请安装 CLI」（F1.2）
- [ ] SDK 通道 Run 仍通过 `mcp-sdk-loader` 读 json `disabled`（与 Settings 开关一致，八·（二）工程项）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: Settings MCP Tab 与飞书 MCP/Model 指令

### 背景

T1 完成后，Renderer Settings MCP Tab 与飞书 `/mcp`、`/model` 须对接新 MCP API 并移除 CLI 分支。`command-handler.ts` 中 `handleFeishuMcpCommand` 依赖 enabled/status API；`listCursorModelsForCommands` 仍可能走 CLI `--list-models`，须改为仅 SDK/CC 路径。

### 上下文文件

- CodeGraph: `handleFeishuMcpCommand` `listCursorModelsForCommands` — 飞书指令入口
- 必读: `electron/command-handler.ts` — L54-82（listCursorModelsForCommands）、L456+（handleFeishuMcpCommand）
- 必读: `src/renderer/pages/Settings.tsx` — `refreshMcpServers`、`handleMcpToggle`、MCP Tab 渲染（约 L165、L747 附近）
- 必读: `electron/mcp-manager.ts` — T1 完成后的 IPC 契约（只读确认签名）
- 参考: `src/shared/channel-types.ts` — T3 完成后无 `cli` type（本任务依赖 T3 类型收窄）

### 实现范围

- 修改: `electron/command-handler.ts`
  - `handleFeishuMcpCommand`：调用 T1 的 enabled/status/toggle API，错误文案改为「请检查 mcp.json / 配置 SDK 资源」，不出现「需要 CLI」（F1.3、01 验收 3）
  - `listCursorModelsForCommands`：删除 CLI `--list-models` 分支；sdk 通道走 `sdk:list-models`，claude-code 走 Profile 模型或 cc API；非 sdk/cc 返回「请绑定 SDK 或 Claude Code」（F2.3、P2-6）
- 修改: `src/renderer/pages/Settings.tsx`
  - `refreshMcpServers`/`handleMcpToggle`：确认调用 `mcp:enabled-map`/`mcp:status-map`/`mcp:toggle`（行为由 T1 保证，移除任何 CLI 安装提示分支）
  - MCP Tab 错误/空态文案不含「安装 Cursor CLI」

### 接口契约

- 飞书 `/mcp ls|info|enable|disable|...` 契约不变，内部数据源改为 json+探测
- 飞书 `/model` 对 sdk/cc 通道返回模型列表；其他返回可理解错误字符串
- Settings MCP Tab 仍通过现有 preload `mcp:*` 方法，无新增 IPC

### 验收标准

- [ ] SDK/CC 通道下飞书 `/mcp` 有合理响应，无「需要 CLI」阻塞（01 验收 3）
- [ ] 飞书 `/model` 在 sdk/cc 绑定下可用，无 CLI 分支（F2.3）
- [ ] Settings MCP 开关与状态刷新正常（01 验收 2；八·（二）工程项）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T1, T3
- 后续任务: T7

---

## T3: 移除 CLI Agent 资源类型与默认绑定

### 背景

阶段 2 数据层：`config-store.ts` 虚拟注入 `CLI_RESOURCE_ID="cli"`，`channel-types.ts` 的 `AgentResource.type` 含 `"cli"`。须删除 CLI 资源类型，默认绑定首个 sdk/cc，并为阶段 3 迁移扩展 `ensureSdkChannelBindings`。

### 上下文文件

- CodeGraph: `CLI_RESOURCE_ID` `getAgentResources` `ensureSdkChannelBindings` — CLI 资源注入与改绑
- 必读: `electron/config-store.ts` — L132（CLI_RESOURCE_ID）、L175-255（prepend cli）、L361-375（ensureSdkChannelBindings）
- 必读: `src/shared/channel-types.ts` — `AgentResource.type` union

### 实现范围

- 修改: `src/shared/channel-types.ts` — 从 `AgentResource.type` 删除 `"cli"` union 成员
- 修改: `electron/config-store.ts`
  - 删除 `CLI_RESOURCE_ID` 常量及 `getAgentResources`/`getAgentResource` 中对虚拟 cli 的 prepend
  - `getAgentResource` 默认返回首个 `type: "sdk"` 或 `"claude-code"` 资源
  - 扩展 `ensureSdkChannelBindings`：通道 `agentResourceId === "cli"` 或指向已删 cli 资源时，改绑首个 sdk/cc（为 T6 迁移打基础，不新增独立 migrate 函数）

### 接口契约

- `AgentResource.type: "sdk" | "claude-code"` — 全库类型基准
- `getAgentResources(): AgentResource[]` — 不再 prepend 虚拟 cli
- `getAgentResource(id?: string): AgentResource | undefined` — 无 id 时默认首个 sdk/cc
- `ensureSdkChannelBindings(): void` — 启动时 cli 绑定自动改绑 sdk/cc

### 验收标准

- [ ] TypeScript 编译：`type: "cli"` 赋值处报错并被本变更链后续任务清掉
- [ ] 新建/列表 Agent 资源不再出现 CLI 项（01 验收 4、5；F2.1）
- [ ] `ensureSdkChannelBindings` 将 `agentResourceId==="cli"` 改绑首个 sdk/cc
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: 无
- 后续任务: T2, T5, T6

---

## T4: 删除 CLI 相关 IPC 与 models:list

### 背景

阶段 2 端点层：`main.ts` 注册 `cli:check/login/install/login-status` 等 handler；`preload.ts` 暴露对应 API；`models:list` 走 CLI。Renderer 改走 `sdk:list-models`/`cc:list-models` 后，本任务删除 CLI IPC 与 `models:list`，并同步 `env.d.ts` 类型。

### 上下文文件

- CodeGraph: `cli:check` `models:list` — IPC 注册点
- 必读: `electron/main.ts` — 搜索 `cli:`、`models:list` handler 块（约 L206 附近）
- 必读: `electron/preload.ts` — `checkCli`、`loginCli`、`installCli` 等暴露
- 必读: `src/env.d.ts`（或项目内 Electron API 类型声明文件）— `window.electron` CLI 方法类型

### 实现范围

- 修改: `electron/main.ts` — 删除 `cli:*` handler；删除或改为明确错误的 `models:list`（若 Renderer 已无调用则直接删除）
- 修改: `electron/preload.ts` — 删除 CLI 相关 `ipcRenderer.invoke` 暴露
- 修改: `src/env.d.ts`（或等价类型文件）— 删除 CLI API 与 `models:list` 类型声明
- 删除: `main.ts` 中对 `agent-cli` install/login/check 的 import（若 T7 前仅此处引用，可先删 import，函数体留 T7 删文件）

### 接口契约

- 不再存在 `cli:check` / `cli:login` / `cli:install` / `cli:login-status` IPC
- 不再存在 `models:list` IPC（或返回固定错误「请使用 SDK/CC 模型 API」）
- preload 无 `checkCli`/`loginCli`/`installCli` 等方法

### 验收标准

- [ ] grep `cli:check`/`cli:login` 在 main/preload 无注册与暴露（01 验收 4）
- [ ] Renderer 编译不依赖已删 preload 方法（与 T5 联调）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: 无
- 后续任务: T5, T7

---

## T5: Renderer 移除 CLI UI 与统一 SDK/CC 模型路径

### 背景

阶段 2 界面层：Dashboard onboarding、AgentPanel CLI 区块、ChannelPanel cli 默认、Settings/WorkflowPanel 模型获取仍假定 CLI。本任务移除 CLI 安装/登录 UI，资源下拉仅 sdk/cc，模型列表走 SDK API 与 Claude Code Profile。

### 上下文文件

- CodeGraph: `AgentPanel` `ChannelPanel` `Dashboard` CLI 安装 — Renderer CLI 入口
- 必读: `src/renderer/components/AgentPanel.tsx` — CLI 资源区块与新建类型
- 必读: `src/renderer/components/ChannelPanel.tsx` — 通道资源选择与默认
- 必读: `src/renderer/pages/Dashboard.tsx` — onboarding、CLI 安装/登录引导
- 必读: `src/renderer/pages/Settings.tsx` — `fetchTaskModels`、Setup Tab CLI 控件
- 必读: `src/renderer/components/WorkflowPanel.tsx` — 工作流模型选择
- 参考: `electron/preload.ts` — T4 完成后 `sdk:list-models`/`cc:list-models` API

### 实现范围

- 修改: `src/renderer/components/AgentPanel.tsx` — 删除 CLI 资源类型 UI；新建/编辑仅 sdk、claude-code
- 修改: `src/renderer/components/ChannelPanel.tsx` — 资源下拉过滤掉 cli；默认首个 sdk/cc
- 修改: `src/renderer/pages/Dashboard.tsx` — onboarding 指向 SDK API Key 与 Claude Code Profile；移除 CLI 安装/登录主流程（F2.2）
- 修改: `src/renderer/pages/Settings.tsx` — `fetchTaskModels` 仅调用 sdk/cc 模型 API；移除 CLI Setup 控件（详细文案留 T8）
- 修改: `src/renderer/components/WorkflowPanel.tsx` — 模型列表仅 sdk/cc 路径

### 接口契约

- UI 不再渲染 `type === "cli"` 或 `agentResourceId === "cli"` 选项
- 任务/工作流模型数据源：`sdk:list-models` / CC Profile `model` 字段
- Dashboard 首屏引导文案以 SDK + Claude Code 为主路径

### 验收标准

- [ ] 界面无 CLI 资源选项与 CLI 安装/登录主流程（01 验收 4、5；F2.1、F2.2）
- [ ] 新用户仅配置 SDK 或 Claude Code 可选通道与任务（F2.3）
- [ ] 无对已删 preload CLI 方法的调用
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T3, T4
- 后续任务: T6, T7

---

## T6: 历史 CLI 绑定迁移与 Dashboard 提示 Banner

### 背景

阶段 3：升级用户可能仍有 `type:"cli"` 资源或通道绑 `cli`。在 T3 自动改绑基础上，新增一次性 `migrateCliBindings`（或等价逻辑）与 Dashboard Banner，提示用户检查改绑结果，避免启动或核心页崩溃（F3.1、01 验收 6）。

### 上下文文件

- CodeGraph: `ensureSdkChannelBindings` `migrateCliBindings` — 迁移与启动钩子
- 必读: `electron/config-store.ts` — T3 后的 `ensureSdkChannelBindings`；daemon/启动调用链
- 必读: `electron/daemon-manager.ts` — L1240 `ensureSdkChannelBindings()` 调用时机
- 必读: `src/renderer/pages/Dashboard.tsx` — Banner 展示位

### 实现范围

- 修改: `electron/config-store.ts`
  - 新增 `migrateCliBindings()`：检测 `agentResources` 含 `type:"cli"` 或无效 cli id，移除 cli 资源条目、改绑通道，写入 `cliMigrationNotified`（或 electron-store 等价标志）
  - 在现有启动路径（与 `ensureSdkChannelBindings` 同序或其后）调用
- 修改: `src/renderer/pages/Dashboard.tsx`
  - 读取迁移标志，展示一次性 Banner：「已自动将 CLI 绑定迁移至 SDK/Claude Code，请检查通道设置」及关闭/跳转设置操作

### 接口契约

- `migrateCliBindings(): { migrated: boolean; details?: string }` — 主进程导出，启动时调用
- `getCliMigrationPending(): boolean` — 或通过现有 config 字段供 Renderer 读 Banner 状态
- `markCliMigrationNotified(): void` — 用户关闭 Banner 后不再展示

### 验收标准

- [ ] 存在历史 cli 资源/绑定时，启动不崩溃，通道改绑首个 sdk/cc（01 验收 6；F3.1）
- [ ] Dashboard 展示一次性迁移 Banner，关闭后不再出现
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T3, T5
- 后续任务: T7

---

## T7: 删除 agent-cli spawn 与 agent-launcher CLI 路径

### 背景

阶段 3 核心删除：`agent-cli.ts` 的 install/login/spawn/list-models 及 `agent-launcher.launchAgent` CLI 会话 spawn 已无调用方（执行主路径在 `session-dispatcher` → SDK/CC）。须删除 dead code，将 `applyProxyEnv` 迁至 `proxy-env.ts` 供 SDK/CC 继续使用，避免误删 `buildPrompt` 等共享符号（F3.2；八·（二）编译与 grep 验收）。

### 上下文文件

- CodeGraph: `launchAgent` `applyProxyEnv` `agent-cli` — 区分 session-dispatcher 与 agent-launcher 两个 launchAgent
- 必读: `electron/agent-cli.ts` — 全文，确认 install/login/spawn/list-models
- 必读: `electron/agent-launcher.ts` — L265+ `launchAgent` CLI spawn；保留 `buildPrompt`/`ChatType`/`LaunchMeta`
- 必读: `electron/session-dispatcher.ts` — L249+ 本地 `launchAgent`（**不删**）
- 必读: `electron/agent-sdk.ts`、`electron/agent-claude-sdk.ts` — 对 `buildPrompt`/`applyProxyEnv` 的 import

### 实现范围

- 新建: `electron/proxy-env.ts` — 从 `agent-cli.ts` 抽出 `applyProxyEnv`（及 SDK/CC 仍需要的 proxy 辅助）
- 修改: `electron/agent-sdk.ts`、`electron/agent-claude-sdk.ts` — import 改指向 `proxy-env.ts`
- 修改: `electron/agent-launcher.ts` — 删除 `launchAgent` CLI spawn 及相关 CLI login/`sessionAgents`；**保留** `buildPrompt`、`resolveSessionChatName` 等
- 删除: `electron/agent-cli.ts` 中 install/login/spawn/list-models 实现；若文件仅剩 proxy 则整文件删除并在 T4 已清理的 main import 处确认无引用
- 修改: `electron/daemon-manager.ts`（若有）— 删除 `cliAvailable` 等 CLI 状态字段引用

### 接口契约

- `export function applyProxyEnv(...)` — 位于 `electron/proxy-env.ts`，签名与原 agent-cli 一致
- `agent-launcher.ts` 继续导出 `buildPrompt`、`ChatType`、`LaunchMeta`、`resolveSessionChatName`
- 不再导出 CLI `launchAgent`（agent-launcher 内）；session-dispatcher 内本地函数不受影响

### 验收标准

- [ ] `agent-launcher.launchAgent` 删除后 TypeScript 编译通过，无 dangling import（八·（二））
- [ ] 全库 grep `agent mcp` / `execAgentSync` 无 MCP/模型业务残留（proxy 相关除外）（八·（二））
- [ ] 未装 CLI 时 IM Run、定时任务、工作流执行正常（01 验收 1；EXEC 路径不改）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T2, T4, T5, T6
- 后续任务: T8

---

## T8: 帮助与 Setup 文案扫尾

### 背景

阶段 3 收尾：Settings Setup/About、应用内 README 等仍可能要求安装 `agent` CLI。统一为「无需 Cursor CLI，仅需 SDK 或 Claude Code」表述，并隐藏 CLI 专属会话入口残留（F3.2、F3.3、01 验收 7）。

### 上下文文件

- 必读: `src/renderer/pages/Settings.tsx` — Setup Tab、About 段落
- 必读: 项目根或应用内 `README.md`（及 `electron/`、`src/` 内帮助文案若存在）
- 参考: grep 结果 — `Cursor CLI`、`agent 二进制`、`安装 CLI` 等关键词

### 实现范围

- 修改: `src/renderer/pages/Settings.tsx` — Setup/About 文案：移除 CLI 安装步骤，改为 SDK API Key + Claude Code Profile 引导
- 修改: 应用内 README/帮助文档（设计 P3-3 落点）— 修正仍要求安装 `agent` 的说明
- 修改: 其他 Renderer/主进程用户可见字符串 — 将「必须安装 Cursor CLI」改为 SDK/CC 等价说明（仅文案，不改逻辑）

### 接口契约

- 无新增 API；纯文案与可见性调整

### 验收标准

- [ ] 关键文案无「必须安装 Cursor CLI」类表述（01 验收 7；F3.3）
- [ ] Setup 主路径仅描述 SDK 与 Claude Code 配置
- [ ] grep `必须.*CLI` / `install.*agent` 在用户可见文案中无误导项
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T7
- 后续任务: 无
