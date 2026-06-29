# 完全移除 Cursor CLI 依赖 - 验收记录

> **变更 ID**：`20260629232914-完全移除Cursor CLI依赖`  
> **阶段**：`/kb-test`（build 冒烟 + 静态 grep + Settings/IM 手工；无 `04-review`）  
> **设计来源**：`01-proposal.md`、`02-design.md`、`03-tasks.md` T1–T8

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **build 冒烟**（`npm run build`）+ **静态契约**（grep / 删文件 / IPC 面）+ **Settings / IM 手工**（MCP 开关、资源类型、迁移 Banner）；**不新增**单元测试 / `auto_test/` |
| **目标** | 覆盖 `01` 验收 1–7、`03` T1–T8、`02` §八·（二）工程补充验收项 |
| **通过口径** | TypeScript 编译 exit 0；业务代码无 `agent mcp` / `queryToolsViaCli` / `cli:*` / `models:list` 残留；`agent-cli.ts` 已删；Settings 可运维 MCP 且不提示安装 CLI |
| **与 review 分工** | 本期无 `04-review`；本文负责追溯、静态证据与手工占位 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·1** IM Run / 定时任务 / 工作流回归 | 依赖真实通道、SDK/CC 凭据与 Daemon 联调 |
| **01·2–3** Settings MCP 开关与飞书 `/mcp` | 依赖 Electron UI、本机 `mcp.json` 与 stdio/remote MCP 子进程 |
| **01·4–5** 界面无 CLI 选项、新用户 onboarding | 须人工浏览 Dashboard / AgentPanel / ChannelPanel |
| **01·6** 历史 CLI 数据迁移 Banner | 须预制含 `type:"cli"` 或 `agentResourceId==="cli"` 的配置 |
| **OAuth MCP 手动引导** | 无 CLI 时仅能文档 + `mcp-auth.json` 路径，无法脚本化 OAuth |
| **`auto_test/`** | 本期未新增；以 §4.2 静态 + §4.1 手工为主 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** | 未装 CLI，SDK/CC 下 IM Run、定时任务、工作流正常 | IM/staging 联调 K1 | 联调 | ⏳ 待用户验收 |
| **01·2** | Settings MCP 列表/开关；stdio/remote 状态合理 | Settings 手工 K2 | UI / json | ⏳ 待用户验收 |
| **01·3** | 飞书 `/mcp`、`/model` 无「需要 CLI」阻塞 | 通道指令 K3 | IM | ⏳ 待用户验收 |
| **01·4** | 无 CLI 资源选项与 CLI 安装/登录主流程 | UI 巡检 K4 | UI | ⏳ 待用户验收 |
| **01·5** | 新用户仅 SDK/CC 即可用通道与任务 | onboarding K5 | UI | ⏳ 待用户验收 |
| **01·6** | 历史 CLI 数据有迁移提示，应用不崩溃 | 预制配置 K6 | UI / config | ⏳ 待用户验收 |
| **01·7** | 文案无「必须安装 Cursor CLI」 | grep + UI K7 | 代码 / UI | ✅ 静态；⏳ UI |
| **T1** | MCP 去 CLI 化；toggle 写 `disabled` | 静态 + K2 | 代码 / json | ✅ 静态；⏳ K2 |
| **T2** | Settings MCP Tab；飞书 MCP/Model 指令 | 静态 + K2/K3 | 代码 / 联调 | ✅ 静态；⏳ 联调 |
| **T3** | 移除 CLI 资源类型与默认绑定 | 静态 + K4 | 代码 / UI | ✅ 静态；⏳ K4 |
| **T4** | 删除 CLI IPC 与 `models:list` | 静态 §4.2 | 代码 | ✅ |
| **T5** | Renderer 去 CLI UI；统一 SDK/CC 模型路径 | 静态 + K4/K5 | 代码 / UI | ✅ 静态；⏳ UI |
| **T6** | `migrateCliBindings` + Dashboard Banner | 静态 + K6 | 代码 / UI | ✅ 静态；⏳ K6 |
| **T7** | 删 `agent-cli` spawn；`agent-launcher` 仅共享符号 | 静态 §4.2 | 代码 | ✅ |
| **T8** | README / Setup 文案扫尾 | 静态 + K7 | 代码 | ✅ 静态 |
| **§8.2·1** | 未装 CLI 时 MCP toggle → `mcp.json` `disabled` | K2 | json | ⏳ 待用户验收 |
| **§8.2·2** | SDK Run 仍走 `mcp-sdk-loader` 读 `disabled` | K1 延伸 | 联调 | ⏳ 待用户验收 |
| **§8.2·3** | 删 `agent-launcher.launchAgent` 后编译通过 | `npm run build` | 构建 | ✅ |
| **§8.2·4** | grep 无 MCP/模型业务 `agent mcp` 残留 | §4.2 grep | 代码 | ✅（仅注释） |
| **build** | TypeScript 编译通过 | `npm run build` | 构建摘要 | ✅ |

## 4、场景摘要

### 4.1 手工验收清单（优先）

| 场景 ID | 前置 | 步骤摘要 | 期望 | 关联 |
|---------|------|----------|------|------|
| **K1 IM 执行回归** | 未安装 `agent` CLI；通道绑 SDK 或 CC | 飞书/微信发消息；触发定时任务与工作流各 1 次 | Run 正常；无 dispatch 因 CLI 缺失失败 | 01·1、§8.2·2 |
| **K2 Settings MCP** | 已配置 stdio 或 url MCP | **设置 → MCP** 刷新列表 → 开关某一 server | 列表/状态正常；toggle 后对应 `mcp.json` 出现或清除 `disabled: true`；**无**「请安装 CLI」 | 01·2、T1、§8.2·1 |
| **K3 飞书指令** | SDK/CC 通道已连 | 发送 `/mcp ls`、`/model ls`（或等价） | 返回当前 MCP/模型摘要；**无** CLI 阻塞文案 | 01·3、T2 |
| **K4 无 CLI UI** | 应用已启动 | 检查 Dashboard、AgentPanel、ChannelPanel、WorkflowPanel | 无 CLI 安装/登录；新建资源仅 SDK / Claude Code | 01·4、T3/T5 |
| **K5 新用户路径** | 空配置或仅 SDK/CC | 按 Dashboard onboarding 完成配置并启用通道 | 可不装 CLI 完成首条 IM | 01·5 |
| **K6 历史迁移** | 预制含 CLI 资源或 `agentResourceId:"cli"` 的配置 | 启动应用 | Dashboard Banner 提示迁移；通道已改绑 sdk/cc；应用不崩溃 | 01·6、T6 |
| **K7 文案扫尾** | — | 浏览 Settings Setup、About、README | 无「必须安装 Cursor CLI」类表述 | 01·7、T8 |

### 4.2 静态契约（kb-recorder 已执行）

| 检查 | 落点 / 命令指针 | 期望 | 结果 |
|------|-----------------|------|------|
| 构建 | 项目根 `npm run build` | exit 0 | ✅ 2026-06-30 |
| 删 CLI 模块 | `electron/agent-cli.ts` | 文件不存在 | ✅ DELETED |
| CLI IPC | `rg 'models:list\|cli:check\|cli:login' electron src --glob '*.ts'` | 无匹配 | ✅ |
| agent mcp 业务 | `rg 'agent mcp' electron src --glob '*.ts'` | 仅注释（manager/project-dir） | ✅ |
| CLI 探测路径 | `rg 'queryToolsViaCli\|execAgentSync\|fetchMcpList' electron` | 无匹配 | ✅ |
| Agent 类型 | `src/shared/channel-types.ts` `AgentResource.type` | 仅 `sdk \| claude-code` | ✅ |
| launcher 瘦身 | `electron/agent-launcher.ts` | 无 CLI spawn；保留 buildPrompt | ✅ ~59 行 |
| 提交 | `be3cdf7` | T1–T8 已 push | ✅ |

**静态验证命令指针**（仅摘要，不贴长输出）：

```bash
npm run build
test ! -f electron/agent-cli.ts
rg "models:list|cli:check|cli:login|queryToolsViaCli|execAgentSync" electron src --glob '*.ts'
rg "agent mcp" electron src --glob '*.ts'
```

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **脚本目录** | 本期无 `auto_test/` 新增 |
| **运行依赖** | Electron + Daemon；SDK 或 Claude Code 凭据；可选 stdio/url MCP 配置 |
| **环境变量** | 通道 `LARK_*` / `WECHAT_*`；SDK `apiKey`、CC Profile 在应用内配置 |
| **负向前提** | 验收 MCP/IM 场景时**不应**依赖本机 `agent` CLI 在 PATH 中 |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 失败时区分：**本地配置** vs **SDK/MCP 服务** vs **预期手工未跑**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-06-30 | 本地 dev | `npm run build` | 通过 | main/preload/renderer exit 0 |
| 2026-06-30 | 本地 dev | §4.2 静态 grep + 删文件复核 | 通过 | 无 CLI IPC/业务残留 |
| 2026-06-30 | 本地 dev | `be3cdf7` 已 push | 通过 | T1–T8 合入 |
| 2026-06-30 | — | K1 IM 执行回归 | 待执行 | 需通道联调 |
| 2026-06-30 | — | K2 Settings MCP | 待执行 | 手工 |
| 2026-06-30 | — | K3 飞书 `/mcp` `/model` | 待执行 | 手工 |
| 2026-06-30 | — | K4 无 CLI UI | 待执行 | 手工 |
| 2026-06-30 | — | K5 新用户 onboarding | 待执行 | 手工 |
| 2026-06-30 | — | K6 历史迁移 Banner | 待执行 | 需预制配置 |
| 2026-06-30 | — | K7 文案扫尾 UI | 待执行 | 手工 |
