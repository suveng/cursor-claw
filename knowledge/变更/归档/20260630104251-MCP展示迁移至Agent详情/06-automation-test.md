# MCP 展示迁移至 Agent 详情 - 验收记录

> **变更 ID**：`20260630104251-MCP展示迁移至Agent详情`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`；无 `04-review.md`，静态契约以 design + 源码核对）
> **实现状态**：T1–T6 done → 本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **编译冒烟**（`npm run build`）+ **静态契约**（IPC/组件/Settings 清理）+ **手工 E2E**（Dashboard MCP 面板、Settings 无 MCP Tab、SDK/CC 策略差异） |
| **目标** | 覆盖 `01-proposal` 验收 1–7、`02-design` §八·（二）工程补充 8 条、`03-tasks` T1–T6 全部验收条 |
| **通过口径** | 构建 exit 0 + 静态契约可 grep/读码确认；用户可见 MCP 列表/状态/刷新/授权/工具折叠及 IM Run 回归须 **Electron 应用内手工** |
| **默认行为** | 本轮已执行 `npm run build`；不启动 Electron、不修改 mcp.json、不触发真实 OAuth |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·2/3/4/5** Dashboard 展开 MCP 列表与状态一致性 | 依赖 Daemon 运行、活跃 SDK/CC 会话及真实 `mcp.json`；状态探测含 stdio spawn / URL OAuth |
| **01·6** IM Run、MCP 工具调用、排队消息回归 | 需 IM 通道或 CLI 触发完整 Run；本变更未改 daemon 调度链，仍须 smoke |
| **§8.2·4** 30s TTL 内不重复全量探测 | 须 DevTools 计时或 IPC 调用计数 |
| **§8.2·5/6** needs_login 授权、`mcp:tools` cwd | 需配置 URL MCP 或 stdio MCP 实测 |
| **§8.2·7** `engineType=codex` 占位 | 当前 IPC 仅产出 sdk/claude-code；codex 占位须 mock 或后续引擎接入后复测 |
| **§8.2·8** IM `/mcp` CRUD | 后端 IPC 保留但未改；须 IM 指令 smoke |
| **`auto_test/` 脚本** | 仓库规范不写单测/E2E 脚手架 |
| **`Settings.tsx` 存量行数** | 删 MCP 后仍 >300 行；design 已声明本变更不强制拆分 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** / **F1** / **T5** | Settings 无 MCP Tab 及管理 UI | 静态 grep + 手工 E2E（§4.1 S1） | 代码/截图 | ✅ 静态；⏳ E2E |
| **01·2** / **F2** / **T4** | SDK 活跃会话展开可见 MCP 区块，绑定工作区 | 手工 E2E（§4.1 S2） | 列表摘要 | ⏳ 待用户 |
| **01·3** / **F3** / **T3** | CC 会话 MCP 标题与 SDK 区分，无错绑 | 静态读 `mcp-view-strategy.ts` + E2E（§4.1 S3） | 标题文案 | ✅ 静态；⏳ E2E |
| **01·4** | 无 MCP 时空态，非全局 Settings 列表 | 手工 E2E（§4.1 S4） | 空态文案 | ⏳ 待用户 |
| **01·5** / **F4** | MCP 与 Run 实际能力一致；刷新可更新 | 手工 E2E（§4.1 S5） | 刷新前后状态 | ⏳ 待用户 |
| **01·6** | IM Run、排队、工具调用无回归 | 手工 smoke（§4.1 S6） | 主流程摘要 | ⏳ 待用户 |
| **01·7** | Codex 等引擎扩展占位 | 静态读 `getMcpViewConfig('codex')` | 策略表 | ✅ 静态 |
| **§8.2·1** | Settings 无 `tab === "mcp"`、无 CRUD | 静态 grep | grep 零命中 | ✅ |
| **§8.2·2** | SDK 列表与 `{ws}` mcp.json 合并一致 | 手工 E2E（§4.1 S2） | 条目数对比 | ⏳ 待用户 |
| **§8.2·3** | CC 标题 Claude Agent 文案 | 静态 + E2E（§4.1 S3） | 标题 | ✅ 静态 |
| **§8.2·4** | 30s TTL 缓存 | 手工（§4.1 S7） | IPC 行为 | ⏳ 待用户 |
| **§8.2·5** | needs_login 授权按钮 | 手工（§4.1 S8） | 授权 output | ⏳ 待用户 |
| **§8.2·6** | 工具折叠 `mcp:tools` + workspace cwd | 手工（§4.1 S9） | 工具列表 | ⏳ 待用户 |
| **§8.2·7** | codex 仅占位不 crash | 静态读策略 | `supported: false` | ✅ 静态 |
| **§8.2·8** | IM `/mcp`、Run 内 MCP 无回归 | 手工 smoke（§4.1 S6） | IM/Run | ⏳ 待用户 |
| **T1** | `engineType` / `workspaceDir` IPC 出参 | 静态读 `session-dispatcher.ts`、`agent-claude-sdk.ts` | 代码 | ✅ |
| **T2** | `mcp:list-for-workspace` 等 workspace API | 静态读 `mcp-manager.ts`、`main.ts` | 代码 | ✅ |
| **T3** | SessionMcpPanel ≤300 行、策略分离 | `wc -l` + 读码 | 行数 | ✅ 210+46 行 |
| **T4** | Dashboard 集成、始终可展开 | 静态读 `Dashboard.tsx` L547–554 | 代码 | ✅ |
| **T5** | Settings MCP 清理 | grep 零 MCP 引用 | grep | ✅ |
| **T6** | preload/env.d.ts 与 IPC 对齐 | 静态读类型声明 | 代码 | ✅ |
| **构建** | TypeScript 全量编译 | `npm run build` | exit 0 | ✅ |

## 4、场景摘要

### 4.1 手工验收清单（Dashboard / Settings）

**前置（共用）**：Electron 应用已构建并启动；Daemon 运行；`config.workspaceDir` 已配置；global `~/.cursor/mcp.json` 至少 1 条 MCP；可选 project 级 `{ws}/.cursor/mcp.json` 用于覆盖验证。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 |
|---------|------|------|------|----------|
| **S1** Settings 无 MCP | 打开设置页 | 浏览全部 Tab | **无**「MCP 服务器」Tab；**无** MCP 列表/增删改/工具预览/登录管理 UI | 仍见 MCP Tab → 实现问题 |
| **S2** SDK 会话 MCP | 至少 1 条 `engineType=sdk` 活跃会话 | Dashboard 展开该会话行 | 可见「Cursor SDK 内联 MCP」区块；列表条目与 `{ws}` 下 global+project 合并一致；有刷新按钮 | 列表为空但 mcp.json 有配置 → workspace 解析或 IPC；标题错误 → 策略问题 |
| **S3** CC 会话 MCP | 至少 1 条 `engineType=claude-code` 活跃会话 | 展开会话行 | 标题为「Claude Agent 内联 MCP」；**非** SDK 标题；`engineType` 未错绑为 sdk | 标题与 SDK 相同 → 实现问题 |
| **S4** 空态 | 工作区无 MCP 配置的会话 | 展开会话行 | 明确空态 + `~/.cursor/mcp.json` / `{ws}/.cursor/mcp.json` 引导；**不**出现 Settings 时代全局管理列表 | 误导性全局列表 → 实现问题 |
| **S5** 刷新与一致性 | 会话已加载 MCP | 点刷新；可选重启会话 | 状态更新；详情可见 MCP 与会话实际可用工具一致（允许短暂延迟） | 长期矛盾 → status-map 或 workspace 绑定 |
| **S6** 主流程回归 | 应用正常运行 | IM/CLI 触发 Run；查看排队消息；可选 MCP 工具调用 | 与迁移前一致；Rules/Skills 等 Settings Tab 可用 | 仅 MCP 入口异常 → 实现；多域异常 → 环境 |
| **S7** 状态 TTL | 已展开 MCP 且探测完成 | 30s 内收起再展开（不点刷新） | 不触发明显全量重探测（缓存命中） | 每次全量 probe → 缓存键/workspace 问题 |
| **S8** OAuth 授权 | 存在 `needs_login` 的 URL MCP | 点授权按钮 | 走 `mcp:login`；output 含 auth 路径提示 | IPC/配置问题 vs 实现 |
| **S9** 工具折叠 | stdio MCP 已配置 | 展开某 MCP 工具列表 | 调用 `mcp:tools`；stdio 使用会话 `workspaceDir` 作 cwd | 工具列表失败 → mcp.json 或 cwd |

### 4.2 静态契约核对（已执行）

| 检查项 | 操作指针 | 期望 | 结果 |
|--------|----------|------|------|
| Settings 无 MCP | `Settings.tsx` grep `mcp`/`toggleMcp`/`tab === "mcp"` | 零命中 | ✅ |
| 会话元数据 | `session-dispatcher.ts` SDK→`engineType: "sdk"`；CC→`"claude-code"` | 字段存在 | ✅ |
| CC workspaceDir | `getClaudeCodeSessionList()` 返回 `workspaceDir` | 字段透出 | ✅ |
| IPC 新增/扩展 | `main.ts` `mcp:list-for-workspace`；`getMcpStatusMap(force, ws?)` 等 | handler 注册 | ✅ |
| preload/env 对齐 | `listMcpForWorkspace`、`engineType` 等于 env.d.ts | 签名一致 | ✅ |
| Dashboard 集成 | `Dashboard.tsx` 展开区 `<SessionMcpPanel …/>` | 每条会话独立 | ✅ |
| 策略文案 | `mcp-view-strategy.ts` SDK/CC 标题；codex `supported: false` | 与设计 §七 一致 | ✅ |
| 行数合规 | `SessionMcpPanel.tsx` 210 行；`mcp-view-strategy.ts` 46 行 | ≤300 | ✅ |
| 全量构建 | 项目根 `npm run build` | exit 0 | ✅ |

环境变量与凭据：**不写密钥**；MCP OAuth 以本地 `mcp-auth.json` / IDE 为准。

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无新增（仓库规范不写单测/E2E 脚手架） |
| **运行依赖** | Electron 桌面应用 + Daemon；Dashboard 活跃会话区；可选 IM 通道 |
| **测试数据** | global/project `mcp.json`；至少各 1 条 SDK 与 CC 活跃会话；可选 `needs_login` URL MCP |
| **环境变量** | 无专用变量；构建使用默认 `npm run build` |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 mcp.json。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- E2E 失败时区分：**环境/配置** vs **Renderer/主进程实现**（记备注列）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-06-30 | 本地 dev | `npm run build` | 通过 | exit 0 |
| 2026-06-30 | 本地 dev | `SessionMcpPanel.tsx` 行数 | 通过 | 210 行 |
| 2026-06-30 | 本地 dev | `mcp-view-strategy.ts` 行数 | 通过 | 46 行 |
| 2026-06-30 | 本地 dev | Settings MCP 残留 grep | 通过 | 零命中 |
| 2026-06-30 | 本地 dev | T1/T2/T6 IPC 静态契约 | 通过 | 对齐 design §四 |
| 2026-06-30 | 本地 dev | T3/T4 组件与 Dashboard 集成 | 通过 | 读码确认 |
| 2026-06-30 | — | S1 Settings 无 MCP Tab | 待用户验收 | E2E |
| 2026-06-30 | — | S2 SDK 会话 MCP 区块 | 待用户验收 | E2E |
| 2026-06-30 | — | S3 CC 会话差异化标题 | 待用户验收 | E2E |
| 2026-06-30 | — | S4 空态文案 | 待用户验收 | E2E |
| 2026-06-30 | — | S5 刷新与 Run 一致性 | 待用户验收 | E2E |
| 2026-06-30 | — | S6 IM Run / 排队回归 | 待用户验收 | smoke |
| 2026-06-30 | — | S7 30s TTL 缓存 | 待用户验收 | 可选 |
| 2026-06-30 | — | S8 needs_login 授权 | 待用户验收 | 需 URL MCP |
| 2026-06-30 | — | S9 工具折叠 | 待用户验收 | 需 stdio MCP |
