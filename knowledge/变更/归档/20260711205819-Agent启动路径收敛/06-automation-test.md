# Agent 启动路径收敛 - 验收记录

> **变更 ID**：`20260711205819-Agent启动路径收敛`
> **来源**：`/kb-test`（清债后重验收；基于 `01-proposal.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1/T2/T-DEBT-1/T3/T4/T5 done；R-DEBT-01 resolved；`stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（grep/行数/源码路径）+ **`npm run build`** + **发布 checklist 手工冒烟**（S1–S5）；无新增 `auto_test/` 脚本 |
| **目标** | 覆盖 `01-proposal` 验收 1–4、`03-tasks` T1–T5 与 T-DEBT-1 全部可静态项；清债后清零原「手动 E2E S1–S5」债务标注 |
| **与验收关系** | 本轮**已执行**构建与 grep 门禁；仅 SDK 冷启动实例数、四引擎行为回归归入**发布 checklist**，**不**标为 `accepted_debt` |
| **默认行为** | 静态/构建项由 kb-test 执行并记入 §7；手工项仅文档化步骤，发布前由维护者点验 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 归类 |
|----------|------|------|
| **01·1** / **S1** 仅 SDK Profile 冷启动后 `userData` 仅 `agent-api-port.json` | 须清空 `userData` 后冷启动 Electron 并枚举端口 json；headless 无法稳定观测 | **发布 checklist** |
| **01·2** / **S2–S5** 四引擎 × IM/任务/工作流/chat new 不回归 | 依赖真实 IM 凭据、四引擎 Profile 与 Daemon 运行时；无低成本自动化脚手架 | **发布 checklist**（无凭据 IM 用例） |
| **T1** launch 日志可见 `launchSdkAgentFromHttp` 路由 | 须应用内触发并查看 UI 日志 | 发布 checklist 辅助观测 |
| **单元/集成测试** | 仓库规范不写单测 | review 静态 + 发布 checklist |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** / **T2** / **S1** | 仅 SDK Profile 冷启动 Agent HTTP 实例数 = 1 | 代码路径（§4.3）+ 发布 checklist S1 | init 链 + `agent-api-port.json` | ✅ 静态；📋 发布 checklist |
| **01·2** / **T1/T2/T3** / **S2–S5** | 四引擎 IM+任务+工作流+chat new 不回归 | 发布 checklist（§4.1） | UI 日志/IM 回复 | 📋 发布 checklist |
| **01·3** / **T4** | `03-启动与自动重连.md` §二 全路径统一网关 | 读文件确认 | §二/§四/§十 | ✅ 静态通过 |
| **01·4** / **T1/T2/T3/T-DEBT-1** | `npm run build` 通过 | 命令执行 | exit 0 | ✅ 本轮已执行 |
| **T1** | `launchAgent` 无 per-engine 端口 getter | grep | `session-dispatcher*` 零命中 | ✅ 静态通过 |
| **T1** | 统一 `launchSdkAgentFromHttp` | grep | `session-dispatcher-launch.ts` L106 | ✅ 静态通过 |
| **T1** | IM `forwardElectronAgentApi` 路径未改 | 04-review | Daemon 源码无 diff | ✅ 静态通过 |
| **T2** | `initSessionDispatcher` 无三引擎 `ensure*HttpServer` | grep | `session-dispatcher-lifecycle.ts` 零命中 | ✅ 静态通过 |
| **T2** | `initDaemonManager` 仍 `ensureAgentSdkHttpServer` | grep | `daemon-manager.ts:1243` | ✅ 静态通过 |
| **T-DEBT-1** / **R-DEBT-01** | 拆分后各 `session-dispatcher*.ts` ≤300 行 | `wc -l` | 主入口 46 行，子文件 ≤212 行 | ✅ resolved |
| **T3** | `launch-request-resolve` 为四入口解析 SSOT | grep | 五处引用（§4.2） | ✅ 静态通过 |
| **T3** | `launch-request-resolve.ts` ≤300 行 | `wc -l` | 234 行 | ✅ 静态通过 |
| **T4** | §二 不再描述任务/工作流双轨直 POST | 读文件 | §二 无「直 POST 各 agent-api」 | ✅ 静态通过 |
| **T5** | AGENTS 统一网关口径 | grep | `electron/*/AGENTS.md` 含 `launchSdkAgentFromHttp` | ✅ 静态通过 |

## 4、场景摘要

### 4.1 发布 checklist 手工冒烟（不标为 accepted_debt）

**前置（共用）**：Electron 已构建；Daemon 运行；按场景配置对应引擎 Profile；开发者工具可查看 `[SDK]`/`[CC]` 等 UI 日志。**勿写入 apiKey/token 至知识库**。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 | 归类 |
|---------|------|------|------|----------|------|
| **S1** 仅 SDK 冷启动实例数 | Profile 仅 Cursor SDK；清空或隔离 `userData` | 冷启动应用 | `userData` 仅写入 `agent-api-port.json`；无 `cc-`/`codex-`/`opencode-` 端口 json | Profile 配置 → 环境；多 json → init 懒加载 | 发布 checklist |
| **S2** IM 四引擎 | 飞书/微信已连接；各引擎 Profile 各一 | 私聊/群聊发消息 | 各引擎正常启动/回复；失败文案与现网一致 | 通道配置 → 环境；路由错误 → 实现 | 发布 checklist（需 IM 凭据） |
| **S3** 定时任务 | 任务面板配置各引擎 | 到期触发任务 | 经统一网关 launch；任务状态/通知与现网一致 | 任务配置 → 环境；漏触发 → 实现 | 发布 checklist |
| **S4** 工作流 | 工作流节点配置各引擎 | 执行至 Agent 节点 | 经 `launchWorkflowAgent`→`launchSdkAgentFromHttp`；继续/失败语义不变 | 工作流配置 → 环境 | 发布 checklist |
| **S5** chat new | 多引擎 Profile | `/chat new` 或等价指令 | 临时会话正常创建与运行；回退栈与现网一致 | 指令/Profile → 环境 | 发布 checklist |

### 4.2 静态契约核对（本轮已执行）

| 检查项 | 操作指针 | 期望 | 结果 |
|--------|----------|------|------|
| `npm run build` | 仓库根目录 | exit 0 | ✅ |
| launchAgent 统一网关 | `session-dispatcher-launch.ts` L106 | `return launchSdkAgentFromHttp(launchBody)` | ✅ |
| 无 per-engine 端口直连 | grep `getCc/Codex/OpencodeAgentApiPort` @ `session-dispatcher*` | 零命中 | ✅ |
| init 懒加载 | `session-dispatcher-lifecycle.ts` `initSessionDispatcher` | 无 `ensureClaudeCode/Codex/OpencodeHttpServer` | ✅ |
| 网关常驻 SSOT | `daemon-manager.ts` L1242–1243 | `initSessionDispatcher()` 后 `ensureAgentSdkHttpServer()` | ✅ |
| launch-request SSOT 五处引用 | grep `launch-request-resolve` | sdk-http + 3 engine-http + launch 模块 | ✅ |
| 拆分文件行数 | `wc -l` session-dispatcher*.ts + launch-request-resolve.ts | 均 ≤300 | ✅（最大 234） |
| 知识库 §二 | `03-启动与自动重连.md` §二 | 四入口汇入 `launchSdkAgentFromHttp`；init 仅网关常驻 | ✅ |

**T3 五处 launch-request-resolve 引用**：

| # | 文件 |
|---|------|
| 1 | `electron/session/session-dispatcher-launch.ts` |
| 2 | `electron/agent/cursor-sdk/agent-sdk-http.ts` |
| 3 | `electron/agent/claude-code/agent-cc-http.ts` |
| 4 | `electron/agent/codex/agent-codex-http.ts` |
| 5 | `electron/agent/opencode/agent-opencode-http.ts` |

### 4.3 01·1 代码路径依据（仅 SDK Profile 实例数 = 1）

| 步骤 | 符号/文件 | 行为 |
|------|-----------|------|
| 1 | `initDaemonManager`（`daemon-manager.ts:1237–1243`） | 先 `initSessionDispatcher()`，再 `ensureAgentSdkHttpServer()` |
| 2 | `initSessionDispatcher`（`session-dispatcher-lifecycle.ts`） | 仅注册 resolver/observability；**不**调用三引擎 `ensure*HttpServer` |
| 3 | `ensureAgentSdkHttpServer`（`agent-sdk-http.ts`） | 单例监听 `127.0.0.1:0`，写 `agent-api-port.json` |
| 4 | 非 SDK 首次 launch | `launchSdkAgentFromHttp` → `resolveBoundAgentResourceType` → 各 handler 进程内委托 |

### 4.4 关键可观测日志（摘要）

| 阶段 | 日志关键词（示例） | 用途 |
|------|-------------------|------|
| 网关启动 | `Agent API 监听 127.0.0.1:` | S1 确认仅网关 HTTP |
| 统一 launch | `launchSdkAgentFromHttp` 路由日志 | S2–S5 确认非独立端口 POST |
| 端口文件 | `agent-api-port.json` / `cc-agent-api-port.json` 等 | S1 冷启动枚举 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无（仓库规范不写单测/E2E 脚手架） |
| **运行依赖** | Electron 桌面应用 + Daemon；四引擎通道资源（发布 checklist 按需） |
| **测试数据** | `userData/agent-api-port.json` 及 per-engine 端口 json（仅本地 userData） |
| **环境变量** | 无本变更专属开关 |

## 6、输出与记录规范

会话与本文**禁止**粘贴完整终端日志、端口 json 原文或 apiKey。执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。失败时区分 **环境/配置** vs **主进程实现**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-11 | 本地 dev | `npm run build` | 通过 | exit 0 |
| 2026-07-11 | 本地 dev | grep `launchSdkAgentFromHttp` @ session-dispatcher-launch.ts | 通过 | L106 统一委托 |
| 2026-07-11 | 本地 dev | grep `ensureClaudeCode/Codex/OpencodeHttpServer` @ session-dispatcher-lifecycle.ts | 通过 | 零命中 |
| 2026-07-11 | 本地 dev | grep `ensureAgentSdkHttpServer` @ daemon-manager.ts | 通过 | L1243 |
| 2026-07-11 | 本地 dev | grep `getCc/Codex/OpencodeAgentApiPort` @ session-dispatcher* | 通过 | 零命中 |
| 2026-07-11 | 本地 dev | grep `launch-request-resolve` 五处引用 | 通过 | T3 SSOT |
| 2026-07-11 | 本地 dev | `wc -l` session-dispatcher*.ts + launch-request-resolve.ts | 通过 | 均≤300 |
| 2026-07-11 | 本地 dev | 读 `03-启动与自动重连.md` §二 | 通过 | 全路径统一网关 |
| 2026-07-11 | — | S1 仅 SDK 冷启动实例数 | 发布 checklist | 待发布点验 |
| 2026-07-11 | — | S2–S5 四引擎四入口回归 | 发布 checklist | 待发布点验；无 IM 凭据 |
