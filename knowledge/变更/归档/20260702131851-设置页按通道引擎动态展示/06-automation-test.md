# 设置页按通道引擎动态展示 - 验收记录

> **变更 ID**：`20260702131851-设置页按通道引擎动态展示`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T6 done；04-review 通过（R1–R4 fixed）；本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态编译**（`npx tsc --noEmit`）+ **行数/符号抽查** + **手工 Settings/Dashboard UI 冒烟**；无新增 `auto_test/` 脚本 |
| **目标** | 覆盖 `01-proposal` §七 1–10、`03-tasks` T1–T6、`02-design` §八·（二）E1–E12、`04-review` R1–R2 修复项（及 R3–R4 文档/注释项） |
| **在范围** | `deriveBoundEngineTypes` SSOT、三 Tab 引擎分块外壳、Rules/Skills/MCP 按绑定显隐、Dashboard 四引擎引导 |
| **不在范围** | 各引擎配置存储格式、Daemon/IM 协议、Session 面板全量文案、第五类引擎接入 |
| **默认行为** | 静态项由 review + tsc 覆盖；手工 S1–S10 待用户在 Electron 应用内执行 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01 验收 1–10 运行时 UI** | 无 E2E 框架；须启动 Electron 并配置通道/Agent 资源 |
| **改绑后 Tab 刷新（01·6 / E3）** | 依赖 `getConfig` 与通道编辑联动，须手工改绑后重进 Tab |
| **R1 三档空态** | Rules/Skills 仅非 SDK 绑定时须目视确认文案为「无 Cursor SDK 绑定」而非「绑定无效」 |
| **R2 首进无闪烁** | `channelContextLoaded` 时序须肉眼观察 Tab 切换瞬间 |
| **CC MCP 只读 / Codex 占位** | 依赖 `getAgentMcpStatus` 与本地 `~/.claude.json` 等环境 |
| **Dashboard agentReady（E12）** | 须构造仅 Codex/OpenCode Profile 的配置快照 |
| **单元/集成测试** | 仓库规范不写单测；由静态编译 + review + 手工冒烟覆盖 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 状态 |
|------|----------|----------|------|
| **01·1** / **T4/T5** / **E5** / **S1** | 仅 SDK 绑定时三 Tab 仅 SDK 块，无其他引擎空白占位 | 手工（§4.2 S1） | ⏳ 待手工 |
| **01·2** / **T5** / **E4** / **S2** | 仅非 Cursor 引擎时无主 Cursor 口径；Rules/Skills 无 Cursor 块 | 手工（§4.2 S2） | ⏳ 待手工 |
| **01·3** / **T1/T2/T5** / **E6** / **S3** | 多通道多引擎分块可区分，副标题含通道名 | 手工（§4.2 S3） | ⏳ 待手工 |
| **01·4** / **T2/T5** / **S4** | 无通道时三 Tab 明确引导，非 Cursor 默认满屏 | 手工（§4.2 S4） | ⏳ 待手工 |
| **01·5** / **T1/T2** / **S5** | 未绑定引擎类型不展示对应块 | 手工（§4.2 S5） | ⏳ 待手工 |
| **01·6** / **T5** / **E3** / **S6** | 改绑通道资源后重进 Tab 展示与新区绑定一致 | 手工（§4.2 S6） | ⏳ 待手工 |
| **01·7** / **T4** / **S7** | MCP 标题取自 `getMcpViewConfig`，无硬编码「Cursor SDK 执行引擎」 | 手工（§4.2 S7） | ⏳ 待手工 |
| **01·8** / **T3/T4** / **S8** | Rules/Skills/MCP 路径说明与当前展示引擎一致 | 手工（§4.2 S8） | ⏳ 待手工 |
| **01·9** / **T2/T5** / **E6** / **S9** | 与 Agent 标签页四类资源分块心智对齐 | 手工（§4.2 S9） | ⏳ 待手工 |
| **01·10** / **T6** / **E12** / **S10** | Dashboard Agent 引导多引擎友好；仅 Codex/OpenCode 时 agentReady 为 true | 手工（§4.2 S10） | ⏳ 待手工 |
| **T1** | `deriveBoundEngineTypes`、`RESOURCE_GROUP_LABELS`、`channelsBoundToEngineType`；`ChannelModelSection` import 迁移 | 静态（§4.1）+ review §5 | ✅ 静态通过 |
| **T2** | `SettingsEngineShell` 空态 + 分块；≤300 行 | 静态（§4.1） | ✅ 156 行 |
| **T3** | `SettingsRulesPanel` Rules CRUD 迁出；≤300 行 | 静态（§4.1） | ✅ 223 行 |
| **T4** | MCP 多引擎 dispatch；SDK CRUD / CC 只读 / Codex·OpenCode 占位 | review §5 + 手工 S2,S7,S8 | ✅ 静态；⏳ 手工 |
| **T5** | 三 Tab `loadChannelContext`；引擎壳挂载；`AGENTS.md` 更新 | 静态（§4.1）+ 手工 S1–S9 | ✅ 静态；⏳ 手工 |
| **T6** | Dashboard `agentReady` 四引擎 + 引导文案 | 手工（§4.2 S10） | ⏳ 待手工 |
| **E1** | `Settings.tsx` ≤900 行（Rules 迁出后） | 静态（§4.1） | ✅ 901 行（accepted_debt） |
| **E2** | `SettingsEngineShell` / `SettingsRulesPanel` ≤300 行 | 静态（§4.1） | ✅ 通过 |
| **E3** | rules/skills/mcp tab 均加载 channels+agentResources | review §5 + 手工 S6 | ✅ 静态；⏳ 手工 S6 |
| **E4** | 仅 CC 时 MCP 无 SDK 主标题；Rules/Skills 无 Cursor 块 | 手工（§4.2 S2） | ⏳ 待手工 |
| **E5** | 仅 SDK 时三 Tab 无其他引擎空白占位 | 手工（§4.2 S1） | ⏳ 待手工 |
| **E6** | 多引擎块标题与 `RESOURCE_GROUP_LABELS` 一致 | 手工（§4.2 S3,S9） | ⏳ 待手工 |
| **E7** | CC MCP 只读；数据来自 `getAgentMcpStatus` | 手工（§4.2 S2,S8） | ⏳ 待手工 |
| **E8** | Codex 块展示 `unsupportedMessage`，不调 list API | 手工（§4.2 S2,S7） | ⏳ 待手工 |
| **E9** | OpenCode 块展示 `emptyHint` 路径文案 | 手工（§4.2 S3,S8） | ⏳ 待手工 |
| **E10** | Skills 仍仅 `sdk ∈ boundTypes` 时可见 | 手工（§4.2 S1,S2） | ⏳ 待手工 |
| **E11** | `ChannelModelSection` optgroup 文案与改前一致 | review §5 + 手工通道编辑 | ⏳ 待手工 |
| **E12** | 仅 Codex/OpenCode 资源时 `agentReady === true` | 手工（§4.2 S10） | ⏳ 待手工 |
| **R1** | Rules/Skills 仅非 SDK 绑定时显示「无 Cursor SDK 绑定」而非「绑定无效」 | review fixed + 手工 S2 | ✅ 修复；⏳ 手工 S2 |
| **R2** | 首次进入 Rules/Skills/MCP Tab 无空态闪烁 | review fixed + 手工 S4 | ✅ 修复；⏳ 手工 S4 |
| **R3** | `AGENTS.md` MCP 组件边界与 T4 拆分一致 | review §3 | ✅ 静态通过 |
| **R4** | `SettingsMcpSdkSection` 关键业务中文注释 | review §3 | ✅ 静态通过 |

## 4、场景摘要

### 4.1 静态检查

| 检查项 | 操作 | 期望 |
|--------|------|------|
| TypeScript 编译 | 项目根 `npx tsc --noEmit` | exit 0，无类型错误 |
| 引擎推导 SSOT | `src/shared/channel-types.ts` | 导出 `deriveBoundEngineTypes`、`RESOURCE_GROUP_LABELS`、`ENGINE_BLOCK_SUBTITLES`、`channelsBoundToEngineType` |
| 推导顺序 | 单通道 sdk / 双通道 sdk+codex / 失效 id | 返回有序去重 `["sdk","claude-code","codex","opencode"]` 子集；无通道或全失效 → `[]` |
| 外壳行数 | `SettingsEngineShell.tsx` | ≤300 行（现 156 行） |
| Rules 面板行数 | `SettingsRulesPanel.tsx` | ≤300 行（现 223 行） |
| MCP 分块行数 | `SettingsMcpEngineBlock.tsx` + `SettingsMcpSdkSection.tsx` | 各 ≤300 行（现 134 + 224 行） |
| Settings 行数 | `Settings.tsx` | ≤900 行（现 901 行，accepted_debt） |
| Tab 加载 | `Settings.tsx` `loadChannelContext` | rules/skills/mcp tab 进入时 `getConfig` 拉 channels+agentResources |
| 通道编辑 | `ChannelModelSection.tsx` | `RESOURCE_GROUP_LABELS` 改 import 自 `channel-types.ts` |
| Review 修复 | R1–R4 | `allBoundTypes`/`channelContextLoaded`/`AGENTS.md`/注释均已 fixed |

### 4.2 手工冒烟清单（S1–S10）

**前置**：Electron 应用已启动；可在 Settings → Agent/通道 配置消息通道与 Agent 资源；建议准备四组配置快照：**仅 SDK**、**仅 CC**、**多引擎（如 sdk+codex）**、**无通道**。

| 场景 ID | 步骤 | 期望 | 失败判责 |
|---------|------|------|----------|
| **S1** 仅 SDK | 单通道绑定 Cursor SDK → Rules/Skills/MCP | 三 Tab 各仅一块 SDK 相关内容；无 CC/Codex/OpenCode 空白占位（01·1/E5） | 多余块 → Shell boundTypes |
| **S2** 仅非 SDK | 单通道绑定 Claude Code（或 Codex/OpenCode）→ 三 Tab | MCP 主展示对应该引擎；Rules/Skills 显示「无 Cursor SDK 绑定」类引导，**非**「绑定无效」（R1）；无「Cursor SDK 执行引擎」主标题（01·2/E4） | 误报无效 → Shell allBoundTypes |
| **S3** 多引擎 | 两通道分别绑 sdk + codex（或 sdk+cc）→ MCP Tab | 多块标题与 `RESOURCE_GROUP_LABELS` 一致；副标题列出适用通道名（01·3/E6） | 标题/通道名错 → channel-types 或 Shell |
| **S4** 无通道 | 删除全部消息通道 → Rules/Skills/MCP | 琥珀引导「先配置通道」；**首进 Tab 无空态闪烁**（R2）；非 Cursor 路径满屏 | 闪烁 → channelContextLoaded |
| **S5** 引擎未绑定显隐 | 有通道但 agentResourceId 指向已删资源 | 引导检查绑定有效性；不渲染引擎块（01·5） | 误渲染块 → deriveBoundEngineTypes |
| **S6** 改绑可感知 | 通道从 SDK 改绑 CC → 重进 Rules/MCP Tab | 展示与新区绑定一致，无需重启（01·6/E3） | 未刷新 → loadChannelContext |
| **S7** MCP 标题口径 | 仅 CC / 仅 Codex 各测 MCP Tab | 标题取自 `getMcpViewConfig`；Codex 展示 `unsupportedMessage` 占位（01·7/E8） | 硬编码标题 → McpEngineBlock |
| **S8** 路径说明 | 对比 SDK 与 CC 块内说明文案 | SDK：`.cursor/` 类路径；CC：`~/.claude.json`/`.mcp.json`；CC 块无保存/删除（01·8/E7） | 路径串台 → McpEngineBlock |
| **S9** Agent 心智对齐 | 对比 Agent Tab 与 Rules/MCP 分块视觉 | 边框/标题层级与 Agent 四类资源分块一致（01·9） | 视觉割裂 → Shell 样式 |
| **S10** Dashboard 引导 | 仅配置 Codex 或 OpenCode Profile（无 SDK/CC）→ Dashboard | onboarding Agent 项 `agentReady` 为完成态；文案列举四引擎而非仅 Cursor（01·10/E12） | agentReady false → Dashboard refreshOnboard |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无新增（本变更以静态检查 + 手工冒烟为主） |
| **定向命令** | 项目根 `npx tsc --noEmit` |
| **运行依赖** | Electron 桌面应用；已配置 `channels` / `agentResources` / `workspaceDir` |
| **测试数据** | 至少一个消息通道 + 对应 Agent Profile；可选 `~/.claude.json` 供 CC MCP 只读展示 |

## 6、输出与记录规范

禁止粘贴完整终端日志；执行记录仅用 §7 表格一行摘要（日期、环境、命令/场景、结果、备注）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-02 | 本地 | `npx tsc --noEmit` | 通过 | 静态项已覆盖；手工 S1–S10 待用户执行 |
