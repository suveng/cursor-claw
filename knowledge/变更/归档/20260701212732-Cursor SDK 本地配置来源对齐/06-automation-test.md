# Cursor SDK 本地配置来源对齐 - 验收记录

> **变更 ID**：`20260701212732-Cursor SDK 本地配置来源对齐`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md` §5）
> **实现状态**：T1–T3、T-Rev1-01～04、T-FIX-01 done；本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（04-review §5 已覆盖）+ **手工冒烟/E2E**（SDK 会话、Settings 四 Tab、Dashboard MCP 面板）；无新增 `auto_test/` 脚本 |
| **目标** | 覆盖 `01-proposal` 验收 1–14、`02-design` §八·（二）E1–E8、`03-tasks` T1/T2/T3/T-Rev1-01～04 全部验收条 |
| **与验收关系** | review 静态已通过 loader 分层、`[config]` 日志、Settings UI、SessionMcp 来源标签；运行时配置生效、去重、优先级、性能须 **Electron 应用内手工** |
| **默认行为** | 本轮仅写策略与追溯；**不**默认执行 `npm run build`、不启动 Electron、不修改 `mcp.json` / rules / skills、无破坏性副作用 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01 验收 1–6** MCP/rules/hooks/plugins/agents 运行时生效 | 依赖 `@cursor/sdk` 运行时、真实 `.cursor/` 配置与可选插件层；headless 与 IDE 边界由官方 SDK 决定 |
| **01 验收 7–10** 去重、性能、优先级、HTTP/stdio 回归 | 须活跃 SDK 会话对照 tool 列表与 UI 日志；stdio 收敛后可能需 `SDK_MCP_STDIO_INLINE=1` 回滚 |
| **01 验收 11–14** Settings 保存后 IM 路径生效 | 须 Settings 操作 + 下轮 SDK 会话或 Dashboard 面板交叉验证 |
| **E1–E8** 工程补充项（除 E4/E5 可半静态读盘外） | E1/E2/E3/E6/E7/E8 须运行时观测；E4/E5 可 Settings 保存后 `ls` 对照 |
| **Rules 主工作区 vs 通道 cwd** | design 已知风险；UI 已明示，非主工作区通道 rules 不一致须手工确认边界 |
| **plugin 层识别** | `session-mcp-sdk-path` 基于 `plugin-*` 别名启发式；边界依赖 mcp-auth 形态 |
| **单元/集成测试** | 仓库规范不写单测；由 review 静态 + 手工冒烟覆盖 |
| **`daemon-manager` import 断裂** | `accepted_debt`（R3），归属并行变更 `20260701212827`，不阻断本变更 archive |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** / **T1/T2/T3** | 项目级 MCP SDK 会话可调用 | 手工冒烟（§4.1 S1） | tool 列表/调用 | ⏳ 待手工 |
| **01·2** / **T1/T2** | 用户级 MCP 无冲突时可用 | 手工冒烟（§4.1 S2） | tool 列表 | ⏳ 待手工 |
| **01·3** / **T2** | 项目级 rules 生效 | 手工冒烟（§4.1 S3） | 智能体行为 | ⏳ 待手工 |
| **01·4** / **T2** | 用户级与项目级 hooks 触发 | 手工冒烟（§4.1 S4） | hooks 日志/行为 | ⏳ 待手工 |
| **01·5** / **T2/T3** | 插件层 MCP 可用 | 手工冒烟（§4.1 S5） | plugin 工具 | ⏳ 待手工 |
| **01·6** / **T2** | 子智能体 agents 可被使用 | 手工冒烟（§4.1 S6） | agents 调度 | ⏳ 待手工 |
| **01·7** / **E2** | 同名 MCP 无重复注册 | 手工冒烟（§4.1 S7） | tool 列表唯一 | ⏳ 待手工 |
| **01·8** / **E8** | 短任务耗时不退化 | 手工冒烟（§4.1 S8） | UI 日志间隔 | ⏳ 待手工 |
| **01·9** / **E3** | 项目优先于用户覆盖 | 手工冒烟（§4.1 S9） | 对照实验 | ⏳ 待手工 |
| **01·10** / **T1/T2** | HTTP/stdio MCP 回归 | 手工冒烟（§4.1 S10） | 两类 MCP 可用 | ⏳ 待手工 |
| **01·11** / **E4** / **T-Rev1-01** | Settings Rules 与主工作区 `.cursor/rules` 一致 | 静态 UI + 手工（§4.1 S11） | 读盘/UI | ✅ 静态；⏳ 手工 |
| **01·12** / **E5** / **T-Rev1-02** | Settings Skills 与 `~/.cursor/skills` 一致 | 静态 UI + 手工（§4.1 S12） | 读盘/UI | ✅ 静态；⏳ 手工 |
| **01·13** / **E6** / **T-Rev1-03/T3** | MCP Tab global/project 区分与运行时一致 | 静态 + 手工（§4.1 S13） | IPC/面板 | ✅ 静态；⏳ 手工 |
| **01·14** / **E7** / **T-Rev1-04/T3** | Plugin 说明与「插件层」标识 | 静态 + 手工（§4.1 S14） | 文案/标签 | ✅ 静态；⏳ 手工 |
| **E1** / **T2** | `[config]` 含 cwd/settingSources/inlineMcp | 手工冒烟（§4.1 S15） | UI 日志 | ⏳ 待手工 |
| **T1** | project 覆盖 global 合并 | 04-review §5 静态 | `mergeMcpJsonEntries` | ✅ 静态通过 |
| **T1** | HTTP/sse/OAuth inline | 04-review §5 静态 | `needsInlineInjection` | ✅ 静态通过 |
| **T1** | stdio 默认不 inline、`SDK_MCP_STDIO_INLINE` | 04-review §5 静态 | loader 开关 | ✅ 静态通过 |
| **T2** | 三处注入统一 `loadInlineMcpServersForSdk` | 04-review §5 静态 | launch/send/rotate | ✅ 静态通过 |
| **T2** | resident send 快照回写 | 04-review §5 静态 | `buildSendOptions` | ✅ 静态通过 |
| **T-Rev1-01** | 主工作区明示、无 workspaceDir 禁用 | 04-review §5 静态 | Settings Rules Tab | ✅ 静态通过 |
| **T-Rev1-02** | Skills 用户级说明 | 04-review §5 静态 | Settings Skills Tab | ✅ 静态通过 |
| **T-Rev1-03** | MCP Tab CRUD、≤300 行 | 04-review §5 静态 | `SettingsMcpPanel` 218 行 | ✅ 静态通过 |
| **T-Rev1-04** | Plugin 说明 + `getMcpPluginNotice` | 04-review §5 静态 | Settings/策略 | ✅ 静态通过 |
| **T3** | `buildSdkRuntimeEntries` + 插件层标签 | 04-review §5 静态 | session-mcp-sdk-path | ✅ 静态通过 |
| **T-FIX-01** | agent-sdk 无 persistence 越界 | 04-review §9 | R1/R2 closed | ✅ 静态通过 |

## 4、场景摘要

### 4.1 手工冒烟清单

**前置（共用）**：Electron 应用已构建并启动；Daemon 运行；`config.workspaceDir` 已配置为主工作区；可选 IM 通道触发 SDK 会话。测试数据使用本地 `.cursor/` 文件，**勿提交密钥/token**。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 |
|---------|------|------|------|----------|
| **S1** 项目级 MCP | `{ws}/.cursor/mcp.json` 至少 1 条 MCP | 发起 SDK 会话，展开 Dashboard MCP 面板并调用工具 | 工具可列出且调用成功；与 IDE 同工作区一致（SDK 能力边界内） | MCP 配置错误 → 环境；面板与 tool 列表矛盾 → 实现 |
| **S2** 用户级 MCP | `~/.cursor/mcp.json` 有 MCP；project 无同名 | 同上 | 用户级 MCP 可用 | 被 project 覆盖 → 预期行为（见 S9） |
| **S3** 项目级 rules | 主工作区 `.cursor/rules/` 有规则约束 | SDK 会话中触发应受规则约束的行为 | 行为体现规则（与 IDE 对照） | 规则语法错误 → 配置；主工作区≠通道 cwd → design 已知边界 |
| **S4** hooks | 项目或用户 `hooks.json` 已配置官方支持事件 | 会话生命周期内观察 hooks 触发 | 项目级与用户级均可触发（官方语义） | hooks 配置错误 → 环境；完全不触发 → SDK/实现 |
| **S5** 插件层 MCP | IDE 已启用官方插件 MCP | SDK 会话调用插件工具 | 插件工具可用（官方 headless 边界内） | 仅 IDE 可用 → 预期边界；说明区应已提示 |
| **S6** 子智能体 | `{ws}/.cursor/agents/` 有定义 | 会话中调度子智能体 | 可被识别与调度 | 定义错误 → 配置 |
| **S7** MCP 去重 E2 | global+project 含 HTTP 与 stdio 同名风险项 | 查看会话 tool 列表 | 同名 MCP/工具仅一条；无冲突异常 | 双份注册 → loader/注入问题 |
| **S8** 短任务性能 E8 | 无重负载配置 | 触发 `launchSdkAgent` 短任务 | UI 日志 `[SDK] 正在创建` 至首 token 间隔不劣于变更前基线 | 明显变慢 → 注入/读盘回归（见 W1） |
| **S9** 优先级 E3 | global 与 project 同名 server 不同配置 | 改 project 条目后新会话 | IM 工具行为跟随 project 配置 | 仍用 global → 合并优先级问题 |
| **S10** HTTP/stdio 回归 | 各保留至少 1 条已用 MCP | Settings 列表 + SDK 会话各测 | 与变更前均可用；stdio 失败可试 `SDK_MCP_STDIO_INLINE=1` | HTTP 分支被改 → 实现；stdio 仅 settingSources 失败 → 环境/SDK |
| **S11** Rules E4 | Settings Rules Tab | 增删改规则并保存 | 主工作区 `.cursor/rules/` 与 UI 一致；顶栏明示主工作区路径 | 落盘路径错 → IPC；通道未生效 → cwd 边界 |
| **S12** Skills E5 | Settings Skills Tab | 保存 skill | `~/.cursor/skills/` 与 UI 一致；文案含「用户级」 | 落盘错 → IPC |
| **S13** MCP Tab E6 | Settings MCP Tab | global/project 各增删改 toggle | `mcp:list-for-workspace` 与磁盘一致；下轮 SDK `lastInjectedMcpServers`/面板一致 | 列表与磁盘矛盾 → mcp-manager；运行时与 inline 矛盾 → loader |
| **S14** Plugin E7 | Settings Plugin 说明区 | 阅读说明；Dashboard 查看 plugin server | 说明含 IM 验证步骤；plugin 行标「插件层」非 inline | 误导文案 → 实现 |
| **S15** 配置日志 E1 | 任意 SDK 会话 | 查看 UI 日志 | 含 `[config] settingSources=project,user cwd=… inlineMcp=…` 可与磁盘对照 | 缺字段 → sdk-run-dispatch |

### 4.2 静态契约核对（04-review §5 已覆盖）

| 检查项 | 操作指针 | 期望 |
|--------|----------|------|
| inline 筛选 | `electron/mcp-sdk-loader.ts` `loadInlineMcpServersForSdk`、`needsInlineInjection` | HTTP/sse/OAuth inline；stdio 默认不 inline |
| 三处注入 | `electron/sdk-run-dispatch.ts`、`launchSdkAgent` | 统一 loader + `settingSources` + `[config]` 日志 |
| Settings 四 Tab | `Settings.tsx`、`SettingsMcpPanel.tsx`、`getMcpPluginNotice` | Rules/Skills/MCP/Plugin 口径对齐 |
| 运行时来源 | `electron/session-mcp-sdk-path.ts` `buildSdkRuntimeEntries` | inline/插件层/settingSources 标签 |
| 范围修复 | `electron/agent-sdk.ts` 无 `sdk-run-persistence` | T-FIX-01 closed |
| 行数 | `SettingsMcpPanel.tsx` ≤300 | 218 行 |

可选轻量编译：项目根 `npm run build`（exit 0），非本变更阻断项。

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无新增（仓库规范不写单测/E2E 脚手架） |
| **运行依赖** | Electron 桌面应用 + Daemon；Dashboard 活跃 SDK 会话；可选 IM 通道 |
| **测试数据** | `{workspaceDir}/.cursor/` 与 `~/.cursor/` 下 mcp.json、rules、skills、hooks、agents；勿写入真实凭据 |
| **环境变量** | `SDK_MCP_STDIO_INLINE`（可选，`1` 时 stdio 回滚 inline）；构建使用默认 `npm run build` |

## 6、输出与记录规范

会话与本文**禁止**粘贴完整终端日志、含 token 的 mcp.json 或 OAuth 凭据。执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。失败时区分 **环境/配置** vs **主进程/Renderer 实现**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-02 | kb-test 轮 | 04-review §5 静态项（T1–T3、Rev1、T-FIX-01） | 通过 | review 已覆盖 |
| 2026-07-02 | — | S1 项目级 MCP | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S2 用户级 MCP | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S3 项目级 rules | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S4 hooks | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S5 插件层 MCP | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S6 子智能体 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S7 MCP 去重 E2 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S8 短任务性能 E8 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S9 优先级 E3 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S10 HTTP/stdio 回归 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S11 Rules E4 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S12 Skills E5 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S13 MCP Tab E6 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S14 Plugin E7 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | S15 配置日志 E1 | 待用户验收 | 手工冒烟 |
| 2026-07-02 | — | `npm run build`（可选） | 未执行 | 默认不重验证 |
