# Agent 启动路径收敛 - 验收记录

> **变更 ID**：`20260711205819-Agent启动路径收敛`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1/T2/T4/T5 done；T3 deferred；04-review 通过（严重 0）；本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（grep/源码路径核对）+ **`npm run build`** + **手工/E2E 冒烟**（四引擎 × 四入口）；无新增 `auto_test/` 脚本 |
| **目标** | 覆盖 `01-proposal` 验收 1–4、`03-tasks` T1–T5 全部可静态项；T3 deferred 仅确认无 launch-request 文件 |
| **与验收关系** | review 已静态确认 `launchAgent` 统一网关、init 懒加载、知识库/AGENTS 同步；仅 SDK 冷启动实例数、四引擎行为回归须 **Electron 应用内手工** |
| **默认行为** | 本轮执行 `npm run build` 与 grep 静态核对；**不**默认启动 Electron、不冷启动观测 `userData/*-agent-api-port.json` |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01·1** 仅 SDK Profile 冷启动后进程内 HTTP 实例数 = 1 | 须清空 `userData` 后冷启动 Electron，枚举 `*-agent-api-port.json`；headless 无法稳定观测监听进程 |
| **01·2** / **T1/T2** 四引擎 × IM/任务/工作流/chat new 行为不回归 | 依赖真实 IM 通道、四引擎 Profile 配置与 Daemon 运行时；无低成本自动化脚手架 |
| **T1** 定时任务/工作流/CC 引擎 launch 日志可见 `launchSdkAgentFromHttp` | 须应用内触发并查看 UI 日志；静态仅确认调用链存在 |
| **T2** 多引擎 Profile 首次非 SDK launch 懒加载 | 须首次触发 CC/Codex/OpenCode 后观察长驻语义；E2E |
| **单元/集成测试** | 仓库规范不写单测；由 review 静态 + 手工冒烟覆盖 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** / **T2** | 仅 SDK Profile 冷启动 Agent HTTP 服务实例数 = 1 | 代码路径（§4.2）+ 手工（§4.1 S1） | init 链 + `agent-api-port.json` | ✅ 静态；⏳ 手工 |
| **01·2** / **T1/T2** | 四引擎 IM+任务+工作流+chat new 不回归 | 手工 E2E（§4.1 S2–S5） | UI 日志/IM 回复 | ⏳ 待手工（不阻断） |
| **01·3** / **T4** | `03-启动与自动重连.md` §二 全路径统一网关 | 读文件确认 | §二 L9、§四 L28、§十 L56 | ✅ 静态通过 |
| **01·4** / **T1/T2** | `npm run build` 通过 | 命令执行 | exit 0 | ✅ 已执行 |
| **T1** | `launchAgent` 无 per-engine 端口 getter | grep | `session-dispatcher.ts` 零命中 | ✅ 静态通过 |
| **T1** | 统一 `launchSdkAgentFromHttp` + 中文注释 | 源码读 | L362–363 | ✅ 静态通过 |
| **T1** | IM `forwardElectronAgentApi` 路径未改 | 04-review | Daemon 源码无 diff | ✅ 静态通过 |
| **T2** | `initSessionDispatcher` 无三引擎 `ensure*HttpServer` | grep | 零命中 | ✅ 静态通过 |
| **T2** | `initDaemonManager` 仍 `ensureAgentSdkHttpServer` | grep | `daemon-manager.ts:1243` | ✅ 静态通过 |
| **T3** | manifest deferred、无 launch-request 文件 | grep + manifest | T3.status=deferred | ✅ 静态通过 |
| **T4** | §二 不再描述任务/工作流双轨直 POST | 读文件 | §二 无「直 POST 各 agent-api」 | ✅ 静态通过 |
| **T5** | AGENTS 统一网关口径 | grep | `electron/*/AGENTS.md` 含 `launchSdkAgentFromHttp` | ✅ 静态通过 |
| **R-DEBT-01** | `session-dispatcher.ts` ≤300 行 | 行数 | 637 行，accepted_debt | ⚠️ 已知债务 |

## 4、场景摘要

### 4.1 手工/E2E 冒烟清单（不阻断 archive）

**前置（共用）**：Electron 已构建；Daemon 运行；按场景配置对应引擎 Profile；开发者工具可查看 `[SDK]`/`[CC]` 等 UI 日志。**勿写入 apiKey/token 至知识库**。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 |
|---------|------|------|------|----------|
| **S1** 仅 SDK 冷启动实例数 | Profile 仅 Cursor SDK；清空或隔离 `userData` | 冷启动应用 | `userData` 仅写入 `agent-api-port.json`；无 `cc-`/`codex-`/`opencode-` 端口 json | Profile 配置 → 环境；多 json → init 懒加载 |
| **S2** IM 四引擎 | 飞书/微信已连接；各引擎 Profile 各一 | 私聊/群聊发消息 | 各引擎正常启动/回复；失败文案与现网一致 | 通道配置 → 环境；路由错误 → 实现 |
| **S3** 定时任务 | 任务面板配置各引擎 | 到期触发任务 | 经统一网关 launch；任务状态/通知与现网一致 | 任务配置 → 环境；漏触发 → 实现 |
| **S4** 工作流 | 工作流节点配置各引擎 | 执行至 Agent 节点 | 经 `launchWorkflowAgent`→`launchSdkAgentFromHttp`；继续/失败语义不变 | 工作流配置 → 环境 |
| **S5** chat new | 多引擎 Profile | `/chat new` 或等价指令 | 临时会话正常创建与运行；回退栈与现网一致 | 指令/Profile → 环境 |

### 4.2 静态契约核对（本轮已执行）

| 检查项 | 操作指针 | 期望 | 结果 |
|--------|----------|------|------|
| launchAgent 统一网关 | `session-dispatcher.ts` L362–363 | `return launchSdkAgentFromHttp(launchBody)` | ✅ |
| 无 per-engine 端口直连 | grep `getCc/Codex/OpencodeAgentApiPort` | 零命中 | ✅ |
| init 懒加载 | `initSessionDispatcher` L626–637 | 无 `ensureClaudeCode/Codex/OpencodeHttpServer` | ✅ |
| 网关常驻 SSOT | `daemon-manager.ts` L1242–1243 | `initSessionDispatcher()` 后 `ensureAgentSdkHttpServer()` | ✅ |
| 网关单实例写入 | `agent-sdk-http.ts` L194–231 | `ensureAgentSdkHttpServer` 写 `agent-api-port.json` | ✅ |
| T3 defer | grep `launch-request` | 仅变更文档提及，无源码文件 | ✅ |
| 知识库 §二 | `03-启动与自动重连.md` §二 L9 | 四入口汇入 `launchSdkAgentFromHttp`；init 仅网关常驻 | ✅ |

### 4.3 01·1 代码路径依据（仅 SDK Profile 实例数 = 1）

| 步骤 | 符号/文件 | 行为 |
|------|-----------|------|
| 1 | `initDaemonManager`（`daemon-manager.ts:1237–1243`） | 先 `initSessionDispatcher()`，再 `ensureAgentSdkHttpServer()` |
| 2 | `initSessionDispatcher`（`session-dispatcher.ts:626–637`） | 仅注册 resolver/observability；**不**调用三引擎 `ensure*HttpServer` |
| 3 | `ensureAgentSdkHttpServer`（`agent-sdk-http.ts:194–231`） | 单例 `agentApiServer` 监听 `127.0.0.1:0`，回调写 `writeAgentApiPortFile` → `agent-api-port.json` |
| 4 | 非 SDK 首次 launch | `launchSdkAgentFromHttp` → `resolveBoundAgentResourceType` → 各 handler 进程内委托；**不**依赖 init 阶段 per-engine HTTP server |

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
| **运行依赖** | Electron 桌面应用 + Daemon；四引擎通道资源（按需） |
| **测试数据** | `userData/agent-api-port.json` 及 per-engine 端口 json（仅本地 userData） |
| **环境变量** | 无本变更专属开关 |

## 6、输出与记录规范

会话与本文**禁止**粘贴完整终端日志、端口 json 原文或 apiKey。执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。失败时区分 **环境/配置** vs **主进程实现**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-11 | 本地 dev | `npm run build` | 通过 | exit 0 |
| 2026-07-11 | 本地 dev | grep `ensureClaudeCode/Codex/OpencodeHttpServer` @ session-dispatcher | 通过 | 零命中 |
| 2026-07-11 | 本地 dev | grep `launchSdkAgentFromHttp` @ launchAgent | 通过 | L363 统一委托 |
| 2026-07-11 | 本地 dev | grep `getCc/Codex/OpencodeAgentApiPort` @ session-dispatcher | 通过 | 零命中 |
| 2026-07-11 | 本地 dev | grep `ensureAgentSdkHttpServer` @ daemon-manager | 通过 | L1243 |
| 2026-07-11 | 本地 dev | 读 `03-启动与自动重连.md` §二 | 通过 | 全路径统一网关 |
| 2026-07-11 | 本地 dev | grep `launch-request` 源码 | 通过 | T3 deferred |
| 2026-07-11 | — | S1 仅 SDK 冷启动实例数 | 待用户验收 | E2E |
| 2026-07-11 | — | S2–S5 四引擎四入口回归 | 待用户验收 | E2E 不阻断 |
