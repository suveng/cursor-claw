# Cursor SDK 本地配置来源对齐 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`、`07-prd-revisions.md` Rev1）

## 1、执行计划

### （一）依赖图

```
T1 ──────────────→ T2 ──────────────→ T3
（mcp-sdk-loader）  （agent-sdk）       （SessionMcp 面板）

T-Rev1-01 → T-Rev1-02 → T-Rev1-03 → T-Rev1-04 ──→ T3
（Rules）    （Skills）   （MCP Tab）   （Plugin）    （mcp-view-strategy 串行）
```

- **T1 / T2**：执行引擎 MCP 分层与 `settingSources` 对齐（S4–S7、S13）。
- **T-Rev1-01～04**：Rev1 设置界面四类能力对齐（S8–S11）；`Settings.tsx` 与 `mcp-view-strategy.ts` 须串行。
- **T3**：Dashboard 运行时 MCP 展示与 SDK 加载口径一致（S12）；依赖 T2 快照语义与 T-Rev1-04 文案基线。

### （二）分组调度

| 轮次 | 并行任务 | 说明 |
|------|----------|------|
| **第一轮** | `T1`、`T-Rev1-01` | loader 层与 Rules IPC 无文件冲突 |
| **第二轮** | `T2`、`T-Rev1-02` | agent-sdk 与 Skills Tab 可并行 |
| **第三轮** | `T-Rev1-03` | 新建 `SettingsMcpPanel.tsx`，独占 Settings 串行链 |
| **第四轮** | `T-Rev1-04` | Plugin 说明 + `mcp-view-strategy` 首改 |
| **第五轮** | `T3` | SessionMcp 面板收尾 `mcp-view-strategy` 与 runtime source |

## 2、任务清单

## T1: MCP SDK Loader 分层合并与 inline 筛选

### 背景

现网 `loadInlineMcpServers` 将 `mcp.json` **全量** inline 注入 SDK，与 `settingSources: ["project","user"]` 并存，存在同名 MCP 双份注册风险（01 验收 7）。本任务在数据/loader 层拆分「全量合并」与「仅需 inline 的条目」（HTTP/sse/OAuth 或 settingSources 实测缺失项），stdio/command 类默认依赖 settingSources，为 T2 三处注入点提供新契约。

### 上下文文件

- CodeGraph: `loadInlineMcpServers`、`mergeMcpJsonEntries`、`mcp-sdk-loader` — 定位合并与 inline 调用链
- 必读: `electron/mcp-sdk-loader.ts` — 当前全量 inline 实现与 OAuth 解析
- 必读: `electron/mcp-manager.ts` — `getMcpServerListForWorkspace` 与 `source: global|project` 语义
- 必读: `electron/mcp-project-dir.ts` — `readMcpAuthStore`、`findCursorProjectDir`
- 参考: `electron/AGENTS.md` §「SDK MCP 内联」— 注入与快照约定

### 实现范围

- 修改: `electron/mcp-sdk-loader.ts` — 保留内部 `mergeMcpJsonEntries(workspaceDir)` 全量合并（project 覆盖 global，与 `mcp-manager` 一致）；新增或重命名导出函数（如 `loadInlineMcpServersForSdk`）仅返回需 inline 的条目：HTTP/sse/url 类、含 OAuth/`mcp-auth.json` 依赖项；stdio/command 默认**不** inline（由 settingSources 加载）；保留环境变量或注释级开关便于 stdio 回滚 inline
- 修改: `electron/mcp-sdk-loader.ts` — `appendInlineMcpToSendOptions` 改调新筛选函数；同名 server 若 settingSources 与 inline 均存在，inline 覆盖、send 级不重复合并
- 不改: `electron/cc-mcp-loader.ts`、`electron/codex-mcp-loader.ts`（01 非目标）

### 接口契约

- `loadInlineMcpServersForSdk(workspaceDir: string): Record<string, McpServerConfig>` — T2 三处注入点唯一读盘入口（可保留 `loadInlineMcpServers` 为 deprecated 别名转发，避免外部误用）
- `appendInlineMcpToSendOptions(sendOptions, workspaceDir?)` — 行为不变，内部改用筛选后 inline 集
- 合并优先级不变：**project > global**（对齐 01 验收 9）

### 验收标准

- [ ] 项目级与用户级 `.cursor/mcp.json` 合并后，project 同名 server 覆盖 global（01 验收 1、2、9；E3）
- [ ] HTTP/sse/OAuth MCP 仍可通过 inline 在 SDK 会话中可用（01 验收 1、2、10）
- [ ] stdio/command MCP 默认不经 inline 重复注册；手工对照 tool 列表同名仅一条（01 验收 7；E2）
- [ ] `mcp-manager.getMcpServerListForWorkspace` 列表与 loader 合并结果 source 字段一致（01 验收 13 前置）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: Agent SDK 注入点、settingSources 与配置可观测日志

### 背景

`agent-sdk.ts` 在 `launchSdkAgent`、`buildSendOptions`、`maybeRotateSessionForPressure` 三处注入 inline MCP 并设 `settingSources`。本任务切换为 T1 筛选后的 inline 集，核实 rules/hooks/plugins/agents 经 `local.settingSources` + 正确 `cwd` 加载，并补充启动/send 可观测日志（S13），满足非 MCP 配置与性能不退化要求。

### 上下文文件

- CodeGraph: `launchSdkAgent`、`buildSendOptions`、`maybeRotateSessionForPressure` — 三处注入与 `Agent.create` 调用链
- 必读: `electron/agent-sdk.ts` — 注入点（约 L701–744、L1228–1240）与 `lastInjectedMcpServers` 回写
- 必读: `electron/mcp-sdk-loader.ts` — T1 导出的 `loadInlineMcpServersForSdk`、`appendInlineMcpToSendOptions`
- 参考: `electron/config-store.ts` — `effectiveWorkspaceDir` 与会话 `workspaceDir` 来源
- 参考: `@cursor/sdk` 类型 — `local.settingSources` 枚举是否需扩展 plugins（S6 步骤 3）

### 实现范围

- 修改: `electron/agent-sdk.ts` — 三处注入点统一调用 T1 `loadInlineMcpServersForSdk`；`Agent.create` / `send` 保持 `local.cwd = workspaceDir`、`settingSources: ["project","user"]`（若 SDK 类型支持 plugins 枚举且官方文档要求，仅增枚举项）
- 修改: `electron/agent-sdk.ts` — `launchSdkAgent` 创建前、`buildSendOptions` 每次 send 前 `pushUiLog` 输出 `[config] settingSources=project,user cwd=… inlineMcp=[name,...]`（S13）
- 修改: `electron/agent-sdk.ts` — `lastInjectedMcpServers` 仍在三处注入后回写，快照仅含实际 inline 条目
- 不改: `electron/session-dispatcher.ts`、`electron/workspace-injector.ts`（no-op）

### 接口契约

- 三处注入均使用: `loadInlineMcpServersForSdk(workspaceDir)` + `appendInlineMcpToSendOptions(...)`
- 日志格式: `[config] settingSources=project,user cwd={abs} inlineMcp={comma-separated names}`（E1）
- `SdkSessionAgent.lastInjectedMcpServers` 与当次 inline 集一致，供 `session-mcp-status` 读取

### 验收标准

- [ ] SDK 会话启动日志含 `cwd`、`settingSources`、inline MCP 名称列表，可与磁盘配置对照（E1；01 验收 4 可观测边界）
- [ ] 项目级 rules（`.cursor/rules`）、hooks、agents、插件层配置经 settingSources 在会话中生效（01 验收 3、4、5、6）
- [ ] 同一 MCP 名称在 tool 列表仅出现一次（01 验收 7；E2）
- [ ] resident 模式每次 send 重传 inline MCP，`lastInjectedMcpServers` 与当次 send 一致（01 验收 1、2、7、8）
- [ ] `launchSdkAgent` 短任务路径耗时不劣于变更前基线：对比 `[SDK] 正在创建` 至首 token UI 日志间隔（01 验收 8；E8）
- [ ] HTTP 与 stdio 类 MCP 回归仍可用（01 验收 10）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: T3

---

## T-Rev1-01: Settings Rules Tab 与主工作区 IPC 对齐

### 背景

`rules:*` IPC 固定读写 `getConfig().workspaceDir`，而 SDK 会话 `cwd` 来自通道/任务 `effectiveWorkspaceDir`，非主工作区通道会出现「设置已改、IM 未生效」（02 §二 根因 2）。Rev1 要求 Rules 维护与项目 `.cursor/rules` 一致并明示主工作区边界（S8，01 验收 11）。

### 上下文文件

- CodeGraph: `rules:list`、`Settings` Rules Tab — IPC 与 UI 落点
- 必读: `electron/main.ts` — `rules:list/save/delete` handler（约 L146–174）
- 必读: `src/renderer/pages/Settings.tsx` — Rules Tab 渲染与保存逻辑
- 必读: `electron/config-store.ts` — `getConfig().workspaceDir` 与主工作区含义
- 参考: `02-design.md` S8 — 无 `workspaceDir` 时禁用编辑

### 实现范围

- 修改: `src/renderer/pages/Settings.tsx` — Rules Tab 顶部展示当前主工作区绝对路径；`workspaceDir` 为空时禁用增删改并提示配置主工作区
- 修改: `electron/main.ts` — `rules:*` 错误/响应文案补充「当前维护主工作区：{path}」；**首版不强制**新增 `workspaceDir?` 参数（若实现更简单可增可选参数，须在接口契约写明）
- 不改: Skills/MCP/Plugin Tab（后续 Rev1 任务）

### 接口契约

- `rules:list/save/delete` — 行为仍读写 `{getConfig().workspaceDir}/.cursor/rules/`；响应或错误含主工作区路径提示
- UI 展示: 「项目级规则 · 主工作区 `{workspaceDir}`」

### 验收标准

- [ ] Settings Rules 增删改后，主工作区 `.cursor/rules/` 文件内容与 UI 一致（01 验收 11；E4）
- [ ] 界面明示规则维护绑定主工作区，与 SDK `cwd`（通道工作区）差异有说明，避免误判（01 验收 11、Rev1 风险）
- [ ] 无 `workspaceDir` 时 Rules 编辑禁用且提示清晰
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T-Rev1-02

---

## T-Rev1-02: Settings Skills Tab 用户级来源对齐

### 背景

Skills 为用户级配置（`~/.cursor/skills/`），须在设置界面明示「用户级、全工作区生效」，保存口径与 SDK settingSources 加载一致（S9，01 验收 12）。与 T-Rev1-01 同改 `Settings.tsx`，须串行执行。

### 上下文文件

- CodeGraph: `skills:list`、`Settings` Skills Tab — IPC 与树形编辑器
- 必读: `src/renderer/pages/Settings.tsx` — Skills Tab（`skills:*` 调用）
- 必读: `electron/main.ts` — `skills:*` handler（约 L176–273）
- 参考: `01-proposal.md` 用户故事 4.6 用户级维护场景

### 实现范围

- 修改: `src/renderer/pages/Settings.tsx` — Skills Tab 补充说明文案：「用户级 · `~/.cursor/skills` · 全工作区 Cursor 执行引擎路径生效」；保存/删除成功后 toast 或内联提示「下轮 SDK 会话自动加载」
- 修改: `electron/main.ts`（可选）— `skills:*` 错误文案对齐用户目录路径
- 不改: Skills 文件形态与 IPC 签名（无破坏性变更）

### 接口契约

- `skills:*` IPC 签名不变；落盘路径仍为 `~/.cursor/skills/<name>/`
- UI 文案 SSOT: 用户级 / 官方 skills 目录 / 无需重启

### 验收标准

- [ ] Settings Skills 保存后，`~/.cursor/skills/` 与 UI 一致（01 验收 12；E5）
- [ ] 界面区分 Skills（用户级）与 Rules（项目级主工作区），不产生来源混淆（01 验收 11–12）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T-Rev1-01
- 后续任务: T-Rev1-03

---

## T-Rev1-03: Settings MCP Tab（global/project 维护）

### 背景

历史变更将 MCP 维护迁至 Dashboard；Rev1 要求在 Settings 恢复 MCP Tab，区分 global（用户 `~/.cursor/mcp.json`）与 project（`{workspace}/.cursor/mcp.json`），复用既有 `mcp-manager` IPC（S10，01 验收 13）。`Settings.tsx` 已超 300 行，MCP Tab 须拆至独立面板组件。

### 上下文文件

- CodeGraph: `getMcpServerListForWorkspace`、`mcp:save`、`Settings` agent tab — MCP CRUD 与 UI 入口
- 必读: `electron/mcp-manager.ts` — `getMcpServerListForWorkspace`、`saveMcpServer`、`deleteMcpServer`、`toggleMcpServer`
- 必读: `electron/main.ts` — `mcp:list-for-workspace`、`mcp:save/delete/toggle/login` IPC
- 必读: `src/renderer/pages/Settings.tsx` — Tab 枚举与 Agent 区结构
- 参考: `src/renderer/components/SessionMcpPanel.tsx` — 列表/状态展示可复用交互模式（只读参考）

### 实现范围

- 新建: `src/renderer/components/SettingsMcpPanel.tsx` — MCP 列表（按 `source: global|project` 分组或标签）、增删改、toggle、OAuth login；消费 `listMcpForWorkspace(workspaceDir)` 与 `mcp:*` IPC
- 修改: `src/renderer/pages/Settings.tsx` — Agent 区或独立 Tab 挂载 `SettingsMcpPanel`；展示主工作区路径（project 级 MCP 绑定）；global 级说明 `~/.cursor/mcp.json`
- 不改: `mcp-manager` 合并逻辑（与 T1 同源）；CC/Codex 引擎 MCP 路径

### 接口契约

- UI 调用: `window.api.listMcpForWorkspace(workspaceDir)`、`saveMcpServer`、`deleteMcpServer`、`toggleMcpServer`、`loginMcpServer`（与 preload 现有暴露一致）
- `McpServerEntry.source`: `"global"` 展示为「用户级」，`"project"` 展示为「项目级」
- Plugin 来源 MCP **不在此 Tab CRUD**（仅展示说明或只读提示，完整说明见 T-Rev1-04）

### 验收标准

- [ ] Settings MCP Tab 可区分并维护 global/project 来源（01 验收 13）
- [ ] 增删改 toggle 后 `mcp:list-for-workspace` 与磁盘 `mcp.json` 一致（01 验收 13；E6 设置侧）
- [ ] 不把仅 IDE/插件层可用的 MCP 标示为已在 cursor-claw 执行引擎生效（01 验收 13、14）
- [ ] `SettingsMcpPanel.tsx` 单文件 ≤300 行；`Settings.tsx` 增量尽量小
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T-Rev1-02
- 后续任务: T-Rev1-04

---

## T-Rev1-04: Plugin 说明区与 mcp-view-strategy 插件文案

### 背景

插件层 MCP/工具在 headless SDK 场景有官方边界，用户易误判「IDE 可用 = IM 可用」（02 §二 根因 4）。须在 Settings 增加 Plugin 只读说明区，并在 `mcp-view-strategy.ts` 补充 plugin 来源文案与 IM 验证步骤（S11，01 验收 14、E7 设置侧）。

### 上下文文件

- CodeGraph: `mcp-view-strategy`、`Settings` agent tab — 空态与说明文案
- 必读: `src/renderer/lib/mcp-view-strategy.ts` — 按 `engineType` 的文案策略
- 必读: `src/renderer/pages/Settings.tsx` — Agent/MCP 区挂载点
- 参考: `electron/mcp-sdk-loader.ts` — `plugin-*` OAuth 别名处理
- 参考: `01-proposal.md` 用户故事 4.5、4.6 插件层说明场景

### 实现范围

- 修改: `src/renderer/pages/Settings.tsx` — MCP Tab 下或 Agent 区新增 **Plugin 说明** 小节（只读）：插件层 MCP 生效条件、依赖 `settingSources`、IM 路径验证步骤（如发起 SDK 会话后查看 Dashboard MCP 面板 / UI 日志 `[config]`）
- 修改: `src/renderer/lib/mcp-view-strategy.ts` — 为 SDK 引擎补充 plugin 相关空态/脚注文案；区分「插件层」「用户级」「项目级」「inline 注入」
- 不改: 插件安装/市场功能（超出范围）

### 接口契约

- `mcp-view-strategy` 导出函数（现有签名）增加 plugin 层说明字段或分支，供 Settings 与 SessionMcpPanel 复用
- Plugin 说明区纯展示，无新 IPC

### 验收标准

- [ ] Plugin 说明区可见且含 IM 路径验证步骤（01 验收 14；E7 设置侧）
- [ ] `mcp-view-strategy` 含插件层边界说明，不误导为「设置保存即 IM 生效」（01 验收 14）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T-Rev1-03
- 后续任务: T3

---

## T3: SessionMcpPanel 与 session-mcp-status 运行时对齐

### 背景

Dashboard `SessionMcpPanel` 展示 SDK 路径 MCP 须与 `lastInjectedMcpServers` + probe 一致，plugin 来源 server 标注「插件层」且不误标为 inline（S12）。`getSessionMcpStatus` 需反映 T2 快照语义与 T1 分层后的 inline 集（01 验收 1、2、5、13、14；E6、E7 面板侧）。

### 上下文文件

- CodeGraph: `getSessionMcpStatus`、`SessionMcpPanel` — 运行时 MCP 取数与展示
- 必读: `electron/session-mcp-status.ts` — SDK 分支 `mapInjectedToEntries`、`fetchMcpStatusMap`
- 必读: `src/renderer/components/SessionMcpPanel.tsx` — `getAgentMcpStatus` 消费与 source 渲染
- 必读: `src/renderer/lib/mcp-view-strategy.ts` — T-Rev1-04 已补充的 plugin 文案（本任务扩展 Session 侧）
- 必读: `electron/agent-sdk.ts` — `lastInjectedMcpServers` 字段语义（T2 产出）

### 实现范围

- 修改: `electron/session-mcp-status.ts` — SDK 路径：`lastInjectedMcpServers` 转 entries 时标注实际来源（inline vs settingSources-only）；plugin 别名 server 标 `source` 或 UI 层「插件层」
- 修改: `src/renderer/components/SessionMcpPanel.tsx` — 列表展示 global/project/插件层/inline 语义；`source: runtime|snapshot|disk` 三态文案与 T-Rev1-04 一致
- 修改: `src/renderer/lib/mcp-view-strategy.ts` — Session 面板空态、plugin server 行内标签（与 T-Rev1-04 串行，本任务为第二轮修改）
- 不改: CC 路径三态逻辑（除文案对齐外行为不变）

### 接口契约

- `getSessionMcpStatus(sessionKey, force?, engineType?, workspaceDir?)` 返回结构不变；`servers[].source` 或展示层映射支持「插件层」标识
- `AgentMcpStatusResult.source` 三态语义不变：`runtime` | `snapshot` | `disk`

### 验收标准

- [ ] SDK 会话 Dashboard MCP 列表与 `lastInjectedMcpServers` + probe 一致（01 验收 1、2、13；E6 运行时侧）
- [ ] plugin 来源 MCP 在 SessionMcpPanel 有「插件层」标识，不误标为已 inline（01 验收 5、14；E7 面板侧）
- [ ] 项目级 MCP 覆盖用户级后，面板展示与 IM 工具行为一致（01 验收 9）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T2、T-Rev1-04
- 后续任务: 无（实现完成后 `/kb-test` 对照 01 验收 1–14 与 E1–E8）
