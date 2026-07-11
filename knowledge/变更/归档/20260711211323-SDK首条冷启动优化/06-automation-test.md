# SDK 首条冷启动优化 - 验收记录

> **变更 ID**：`20260711211323-SDK首条冷启动优化`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T7 done；`stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（源码路径/grep/行数）+ **`npm run build`** + **生产/本地 `daemon.log` 手工观测**（冷启动耗时、预热日志、B2 文案） |
| **目标** | 覆盖 `01-proposal` §四 验收 1–7 与 `03-tasks` T1–T7；构建与可静态证项本轮执行；耗时定性对比与 IM 可见文案归入发布 checklist |
| **与验收关系** | A1–A3/B1/B2 核心路径经代码审查对齐 02-design；**01·1** 冷启动 ≥8s 须对照基线 `daemon.log` 时间戳，无法 headless 自动化 |
| **默认行为** | 静态/构建由 kb-test 执行；日志对比与飞书 UI 点验由维护者本地或发布前执行 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 归类 |
|----------|------|------|
| **01·1** 入队→RUNNING 较基线减少 ≥8s | 依赖真实 Cursor SDK、`agent.send` ~12s 外部下限与生产时间戳；无稳定 headless 夹具 | **发布 checklist**（§4.1 E1） |
| **01·2** `models.list` 与 `create` 时间戳重叠/后置 | 须运行态 `daemon.log` 或 UI `[SDK]` 日志逐条比对 | **发布 checklist**（§4.1 E2） |
| **01·4** bind 后下次首条定性缩短 | 须 bind→等待→首条消息完整链路；预热窗口不确定 | **发布 checklist**（§4.1 E4） |
| **01·5** 飞书用户可见两阶段文案 | 依赖 IM 通道与 Presentation 推送 | **发布 checklist**（§4.1 E5） |
| **01·6** 热 session / `context_blocked` / footer E2E | pre-send 逻辑未改但须 spot check 二次发信 | **发布 checklist**（§4.1 E6） |
| **单元/集成测试** | 仓库规范不写单测 | review 静态 + 发布 checklist |
| **R1** `daemon-presentation-handlers.ts` 338 行 | 巨型单体遗留债务 | `accepted_debt`（不阻断 archive） |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** / **T3/T4** | composer 首条冷启动较基线 ≥8s（C1 send ~12s 下限） | 日志时间戳对比（§4.1 E1） | `daemon.log` 入队→RUNNING | 📋 待发布点验 |
| **01·2** / **T1** | `models.list` 不阻塞 send 前路径 | 源码 + 日志指引（§4.2、§4.4） | `context-usage-model-limit.ts` L97–101 | ✅ 静态通过 |
| **01·3** / **T4** | 同次 launch 无二次 detailed bootstrap | 源码 `canReuseBootstrapSnapshot`（§4.2） | `sdk-run-dispatch.ts` L40–53 | ✅ 静态通过 |
| **01·4** / **T5/T6** | bind 预热可观测；失败不阻断 | 源码三挂点 + `sdk_warmup` 关键字（§4.2） | grep + WARN catch | ✅ 静态；📋 运行日志 |
| **01·5** / **T3/T7** | B2 ≥2 可区分阶段文案 | 源码文案 + IM 点验（§4.1 E5） | orchestrator + agent-sdk notify | ✅ 静态；📋 IM 可见性 |
| **01·6** / **T3** | 热 session / footer / pre-send 无回归 | `dispatchToSdkAgent` 串行 + 注释（§4.2） | `agent-sdk.ts` L263–265 | ✅ 静态；📋 E2E spot check |
| **01·7** / **T1–T7** | `tsc` / `npm run build` 通过 | 命令执行 | exit 0 | ✅ 本轮已执行 |
| **T1** | composer 启发式同步返回 + 后台 `refreshModelLimitFromList` | 读 `context-usage-model-limit.ts` | `refreshInflight` | ✅ 静态通过 |
| **T2** | `launchBootstrapDone?: boolean` | grep | `sdk-session-types.ts` | ✅ 静态通过 |
| **T3** | `Promise.all` 后才 `sdkSessions.set` / send | 读 `agent-sdk.ts` L152–202 | 并行边界 | ✅ 静态通过 |
| **T4** | `buildSendOptions` 复用 `lastInjectedMcpServers` | 读 `sdk-run-dispatch.ts` | A3 快照 | ✅ 静态通过 |
| **T5** | `sdk-warmup.ts` ≤300 行、fire-and-forget | `wc -l` | 50 行 | ✅ 静态通过 |
| **T6** | 三挂点 `init`/`bind-electron`/`bind-daemon` | grep（§4.2） | 含 HTTP 代理 B1c | ✅ 静态通过 |
| **T7** | 「正在连接 Agent…」入队/orchestrator | grep 文案 | `daemon-orchestrator.ts` L197 | ✅ 静态通过 |
| **02·八·（二）** | 改动文件 ≤300 行（除历史债务） | `wc -l` | 见 §4.2；presentation-handlers 338 行例外 | ✅ 除 R1 |

## 4、场景摘要

### 4.1 发布 checklist 手工冒烟

**前置（共用）**：Electron + Daemon 运行；飞书私聊通道已 bind；`composer-2` 或默认 composer 模型；可访问 `daemon/daemon.log` 或应用 UI `[SDK]` 日志。**勿写入 apiKey/token**。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 | 归类 |
|---------|------|------|------|----------|------|
| **E1** 冷启动耗时 | 新 session（`/chat new` 或首条私聊）；基线日志可参考 01 §一 19:58 段 | 发首条消息 | 入队→RUNNING 较基线 ~25s 减少 ≥8s（仍可能含 send ~12s） | SDK 后端慢 → 外部 C1；create 后仍阻塞 list → A1 实现 | 发布 checklist |
| **E2** models.list 非阻塞 | composer 模型；清空 `modelLimitCache`（冷启动） | 首条 launch | `Agent.create` 与 limit 解析并行；`model_limit_refresh` 出现在 send 前后均可，**不出现** create 完成后同步阻塞 ~5s 再 send | 仍串行 await list → A1/A2 | 发布 checklist |
| **E3** bootstrap 单次 | 新 session 首条 | 观察 UI `[config]` 日志 | 同次 launch 仅 **一条** `bootstrapSdkPluginWorkspace` detailed config | 二次 detailed → A3 | 发布 checklist |
| **E4** bind 预热 | 通道 bind 成功 | 查日志 `sdk_warmup` | 出现 `source=bind-electron` 或 `bind-daemon` 或 `init`；失败仅 WARN，bind 仍成功 | 预热 throw 阻断 bind → B1 实现 | 发布 checklist |
| **E5** B2 两阶段 | 飞书私聊首条 | 观察 IM 进度文案 | 先后可见「正在连接 Agent…」「正在准备模型…」；send 后仍为「Agent 处理中…」 | 文案缺失/重复 → B2/T3/T7 | 发布 checklist |
| **E6** 热 session 回归 | 同 session 二次发信 | 连发两条 | 第二条正常 dispatch；context footer 格式不变；极高占用仍 `context_blocked` | pre-send 阈值变更 → 实现回归 | 发布 checklist |

### 4.2 静态契约核对（本轮已执行）

| 检查项 | 操作指针 | 期望 | 结果 |
|--------|----------|------|------|
| `npm run build` | 仓库根目录 | exit 0 | ✅ |
| A1 启发式优先 | `context-usage-model-limit.ts` L97–101 | 同步 `modelLimitCache.set` + `void refreshModelLimitFromList` | ✅ |
| A2 并行边界 | `agent-sdk.ts` L137–152 | `Promise.all([createPromise, limitPromise])` 在 `sdkSessions.set` 之前 | ✅ |
| A3 bootstrap 复用 | `sdk-run-dispatch.ts` L40–53 | `canReuseBootstrapSnapshot` → 跳过 `logSdkConfigSources` | ✅ |
| B2 阶段一 | `daemon-orchestrator.ts` L197 | 「正在连接 Agent…」 | ✅ |
| B2 阶段二 | `agent-sdk.ts` L191–192 | send 前「正在准备模型…」 | ✅ |
| B2 入队文案 | `daemon-presentation-handlers.ts` L120 | 「已收到。正在连接 Agent，你的消息已排队」 | ✅ |
| B1 预热模块 | `sdk-warmup.ts` | `warmupSdkAfterBind`；catch WARN | ✅ 50 行 |
| B1 三挂点 | `daemon-manager.ts` L212；`daemon.ts` L210 `postSdkWarmupRequest`；`agent-sdk-http.ts` `/api/sdk-warmup` | fire-and-forget | ✅ |
| 热路径串行 | `agent-sdk.ts` L263–265 | `dispatchToSdkAgent` 注释 + 串行 limit | ✅ |
| 文件行数 | `wc -l` 变更 SDK 文件 | ≤300（presentation-handlers 338 为 R1 债务） | ✅ |

### 4.3 01·2 代码路径依据（models.list 不阻塞 send）

| 步骤 | 符号/文件 | 行为 |
|------|-----------|------|
| 1 | `resolveModelContextLimit`（`context-usage-model-limit.ts:97–101`） | composer 命中启发式 → 同步写 cache 并 **return**，`refreshModelLimitFromList` fire-and-forget |
| 2 | `launchSdkAgent`（`agent-sdk.ts:139`） | `limitPromise` 与 `createPromise` **并行**，limit 不 await `models.list`（composer） |
| 3 | `refreshModelLimitFromList`（L50–74） | 后台 IIFE；失败仅 `[model_limit_refresh]` WARN |

### 4.4 关键可观测日志（摘要）

| 阶段 | 日志关键词 | 用途 |
|------|-----------|------|
| 预热 | `[sdk_warmup] source=init\|bind-electron\|bind-daemon` | E4 bind 后预热 |
| limit 后台 | `[model_limit_refresh]` | E2 确认 list 非 send 前阻塞 |
| bootstrap | `bootstrapSdkPluginWorkspace` + `detailed` | E3 仅 launch 一次 detailed |
| 冷启动 | `正在创建 SDK Agent` → `正在准备模型…` → `dispatch_retry` | E1/E5 阶段与时间戳 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无（仓库规范不写单测/E2E 脚手架） |
| **运行依赖** | Electron 桌面 + Daemon；飞书私聊通道 bind；Cursor SDK apiKey（环境已配置） |
| **测试数据** | 基线 `daemon.log`（01 §一 2026-07-11 19:58 段）；新 session 首条私聊 |
| **环境变量** | 无本变更专属开关；`SDK_RESIDENT_AGENT` 等现网默认保持 |

## 6、输出与记录规范

会话与本文**禁止**粘贴完整终端日志、含 token 的日志或长段 JSON。执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。失败时区分 **环境/SDK 外部** vs **实现回归**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-11 | 本地 dev | `npm run build` | 通过 | exit 0；~4.8s |
| 2026-07-11 | 本地 dev | 读 `context-usage-model-limit.ts` A1 路径 | 通过 | 启发式+后台 list |
| 2026-07-11 | 本地 dev | 读 `agent-sdk.ts` `Promise.all` 边界 | 通过 | A2+B2 阶段二 |
| 2026-07-11 | 本地 dev | 读 `sdk-run-dispatch.ts` `canReuseBootstrapSnapshot` | 通过 | A3 |
| 2026-07-11 | 本地 dev | grep `sdk_warmup` / `warmupSdkAfterBind` 三挂点 | 通过 | 含 HTTP B1c |
| 2026-07-11 | 本地 dev | grep「正在连接 Agent」「正在准备模型」 | 通过 | B2 两阶段 |
| 2026-07-11 | 本地 dev | `wc -l` SDK 变更文件 | 通过 | ≤300；warmup 50 行 |
| 2026-07-11 | 本地 dev | 读 `dispatchToSdkAgent` 热路径注释 | 通过 | S13 串行 |
| 2026-07-11 | — | E1 冷启动 ≥8s 定性对比 | 待点验 | 需生产/本地 daemon.log |
| 2026-07-11 | — | E2–E6 运行态冒烟 | 待点验 | 发布 checklist |
