# 设置页按通道引擎动态展示 - 变更总结

> **变更 ID**：`20260702131851-设置页按通道引擎动态展示`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（待 `/kb-archive`）  
> **用户可见性**：是 — 设置页 Rules/Skills/MCP 与 Dashboard 引导随通道绑定引擎动态展示（archive 阶段 bump 版本与 changelog）

---

## 1、实际变更

### 代码

| 文件 | 关键改动 |
|------|----------|
| `src/shared/channel-types.ts` | **新增** `deriveBoundEngineTypes`、`channelsBoundToEngineType`；上移 `RESOURCE_GROUP_LABELS`；**新增** `ENGINE_BLOCK_SUBTITLES` 作为 Settings 引擎块副标题 SSOT |
| `src/renderer/components/ChannelModelSection.tsx` | `RESOURCE_GROUP_LABELS` import 改从 `channel-types.ts` 引入；optgroup 文案与改前一致 |
| `src/renderer/components/SettingsEngineShell.tsx` | **新增**（156 行）：Rules/Skills/MCP 三 Tab 共用分块外壳；三档空态（无通道 / 绑定失效 / 无适用引擎）；`allBoundTypes` 区分全量绑定与 Tab 子集；`channelContextLoaded` 防首进闪烁 |
| `src/renderer/components/SettingsRulesPanel.tsx` | **新增**（223 行）：自 `Settings.tsx` 迁出 Rules CRUD；经 Shell 仅在 `sdk ∈ boundTypes` 时挂载 |
| `src/renderer/components/SettingsMcpEngineBlock.tsx` | **新增**（134 行）：MCP Tab 按引擎 dispatch（sdk CRUD / CC 只读 / Codex·OpenCode 占位） |
| `src/renderer/components/SettingsMcpSdkSection.tsx` | **新增**（224 行）：自 `SettingsMcpPanel` 拆出 SDK 段 CRUD；复用 `getMcpViewConfig("sdk")` 动态标题与 `listMcpForWorkspace`/`mcp:*` IPC |
| `src/renderer/components/SettingsMcpPanel.tsx` | **瘦身**：保留为 SDK 包装入口，多引擎逻辑迁至 `SettingsMcpEngineBlock` + `SettingsMcpSdkSection` |
| `src/renderer/pages/Settings.tsx` | Rules/Skills/MCP 三 Tab 接入 `loadChannelContext`；计算 `boundTypes`/`allBoundTypes`；挂载 `SettingsEngineShell`；引入 `channelContextLoaded`（901 行，见 §2 DEBT-01） |
| `src/renderer/pages/Dashboard.tsx` | `agentReady` 纳入四引擎 Profile 存在性；onboarding 文案去「仅 Cursor SDK」假设 |
| `src/renderer/components/AGENTS.md` | 补充 `SettingsEngineShell`、`SettingsRulesPanel`、`SettingsMcpEngineBlock`/`SettingsMcpSdkSection` 边界与 `RESOURCE_GROUP_LABELS` SSOT 位置 |

**不变**：`rules:*`/`skills:*`/`mcp:*` IPC 语义与存储路径；`listMcpForWorkspace` 仍仅 `.cursor/mcp.json`；不为非 SDK 新增 electron IPC（CC 只读复用 `agent:mcp-status`）。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`（T1–T6 `done`；R1–R4 `fixed`）
- `05-summary.md`（本文件）

---

## 2、与设计的差异

1. **MCP 组件拆分（Ponytail 行数）**：`02-design` §1.3 预期 `SettingsMcpPanel.tsx` 承载多引擎分块；实现另拆 `SettingsMcpEngineBlock.tsx`（dispatch）与 `SettingsMcpSdkSection.tsx`（SDK CRUD），`SettingsMcpPanel` 瘦身为 SDK 包装。行为与 S9–S12 一致，属行数治理而非功能偏差。
2. **评审增强（非原 design）**：
   - **R1**：`SettingsEngineShell` 新增 `allBoundTypes` prop，区分 Tab 可见子集与全量绑定，修复 Rules/Skills 仅非 SDK 绑定时误报「绑定无效」。
   - **R2**：`Settings.tsx` 引入 `channelContextLoaded`；Shell 在 channels 加载完成前不渲染空态，修复首进 Tab 闪烁。
3. **DEBT-01（accepted_debt）**：`Settings.tsx` 当前 **901 行**，超出根 `AGENTS.md` 单文件 ≤300 行规范；`02-design` E1 目标 ≤900 已达成（901 行记为 accepted_debt）。建议 archive 后持续拆分（tasks tab、setup 引导、modal 等可独立面板）。
4. **其余与 design S1–S13、E1–E12 一致**：`deriveBoundEngineTypes` SSOT、三 Tab 引擎分块、Dashboard 四引擎引导、CC 只读 / Codex·OpenCode 占位均已落地；04-review 结论为通过。

---

## 3、影响范围

- **Settings Rules/Skills/MCP Tab**：根据已配置通道及其绑定的 Agent 资源类型，运行时推导应展示的引擎集合；多引擎并存时按引擎分块；未绑定引擎类型不展示对应块；无通道时琥珀引导空态。
- **Rules/Skills**：仅 `sdk ∈ boundTypes` 时展示 Cursor SDK CRUD 块（Skills 本体由并行变更 `20260702120631` 负责双来源，本变更仅外壳显隐）。
- **MCP**：SDK 段动态标题/路径（`getMcpViewConfig`）；Claude Code 只读（`getAgentMcpStatus`）；Codex 占位（`unsupportedMessage`）；OpenCode 首版 `emptyHint` 文案，无读盘列表。
- **Dashboard**：`agentReady` 在仅配置 Codex/OpenCode 资源时为 true；引导文案多引擎友好。
- **非目标**：各引擎配置存储格式与 loader 实现、Daemon/IM 协议、Session 面板全量文案、第五类引擎接入。

### 3.1 Ponytail 技术债

无。

---

## 4、知识库影响清单

与 `02-design.md` §十 一致；archive 阶段由 **kb-librarian** 落盘必须项。

### （一）必须更新

- [ ] `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md` — Settings Rules/Skills/MCP 按 `deriveBoundEngineTypes` 分块；SDK CRUD vs CC 只读 vs Codex/OpenCode 占位；与 Agent Tab 分块对齐；`channelContextLoaded` / 三档空态

### （二）已在本变更完成

- [x] `src/renderer/components/AGENTS.md` — `SettingsEngineShell`/`SettingsRulesPanel`/`SettingsMcpEngineBlock`/`SettingsMcpSdkSection` 边界；`RESOURCE_GROUP_LABELS` SSOT；Skills 须 `sdk` 绑定才挂载

### （三）不需要更新

- [x] `knowledge/知识索引.md` — 总入口未变化
- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — 不涉及引擎配置存储语义变更，仅 Settings 展示口径
- [x] 各引擎 loader / Daemon / IM 协议文档 — 01 非目标

---

## 5、验收状态

| 维度 | 状态 |
|------|------|
| **T1–T6** | done（manifest `tasks[]`） |
| **04-review** | ✅ 通过；R1–R4 均已内联修复；blocking 0 |
| **静态项（tsc、行数 E1–E2、符号抽查）** | ✅ 见 `06-automation-test.md` §4.1 |
| **01 验收 1–10、E3–E12 运行时 UI** | ⏳ 手工 S1–S10 待用户在 Electron 内执行（`06-automation-test.md` §4.2，不阻断 archive） |
| **DEBT-01** | ⏳ accepted_debt — `Settings.tsx` 901 行，不阻断归档 |
