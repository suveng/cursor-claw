# Cursor SDK 执行引擎事件流消费 - 验收记录

> **变更 ID**：`20260701212827-CursorSDK执行引擎事件流消费`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T6 done；04-review 通过（open 0）；本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（04-review §5 全量 + `npx tsc --noEmit`）+ **手工/E2E 冒烟**（IM/任务/工作流、kill-restart、长工具 watchdog、短任务首包）；无新增 `auto_test/` 脚本 |
| **目标** | 覆盖 `01-proposal` 验收 1–7、`02-design` §八·（二）7 项工程补充验收、`03-tasks` T1–T6 全部验收条 |
| **与验收关系** | review 已静态确认事件流 SSOT、watchdog 豁免、持久化/续接挂接、模块拆分与行数；运行时 kill-restart、10min+ 长工具、首包时延对比须 **Electron 应用内手工** |
| **默认行为** | 本轮执行 `tsc` 静态编译；**不**默认启动 Electron、不 kill 主进程、不修改 `userData/sdk-active-runs.json` |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01·1/2** 三路径运行期流式/过程事件 | 依赖 `@cursor/sdk` 本地运行时、Daemon 与 IM/任务/工作流真实触发；headless 无法稳定观测 stream-text 出站时序 |
| **01·3** 长工具/等待用户不误杀（10min+） | 墙钟 idle 与 SDK 事件稀疏窗口须真实或 mock 长时 Run；脚本无法低成本模拟 10min+ 且断言 watchdog 日志 |
| **01·4** kill-restart 续接 | 须进行中 Run + 主进程 kill/restart；涉及 `Agent.resume`/`getRun` 与磁盘快照，仅 E2E 可证 |
| **01·5** 续接失败一次提示 | 依赖 Run 已终态或 resume 失败时机；须手工构造或等待自然失败 |
| **01·6** 短任务首包时延对比 | 用户感知级对比须与改造前基线人工对照；无自动化基线 |
| **01·7** 主动停止后重启不续接 | 须 `stopSdkSession` + 重启 + 观察无续接推送（04 注：实现为 mark 后 clear，功能等价） |
| **八·（二）** kill-restart、长工具 10min+、短问答对比 | 04 §5 已标注 ⚠️ 需人工/集成验证；代码路径已挂接 |
| **单元/集成测试** | 仓库规范不写单测；由 review 静态 + 手工冒烟覆盖 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** / **八·（二）·1** / **T3/T6** | IM/任务/工作流运行中持续事件驱动输出，非仅终态一条 | 手工冒烟（§4.1 S1–S3） | UI 日志 `[stream]`/`[tool]`/`[status]` | ⏳ 待手工 |
| **01·2** / **T3** | 多步工具 thinking/tool/assistant 与事件时序一致 | 手工冒烟（§4.1 S4） | 过程日志时序 | ⏳ 待手工 |
| **01·3** / **八·（二）·5** / **T4** | 长工具/等待用户 10min+ 不误杀 idle cancelling | 手工（§4.1 S5） | watchdog 日志无 `cancelling` | ⏳ 待手工 |
| **01·4** / **八·（二）·3** / **T5/T6** | kill 主进程重启后续接，原会话收后续 stream-text | 手工 E2E（§4.1 S6） | 续接日志 + IM 消息 | ⏳ 待手工 |
| **01·5** / **八·（二）·2/3** / **T5** | 续接失败一次明确提示，非静默 | 手工（§4.1 S7） | IM 单次提示 + `failed` 日志 | ⏳ 待手工 |
| **01·6** / **八·（二）·6** / **T3/T6** | 短问答首包时延无明显退化、无重复三态 | 手工对比（§4.1 S8） | 首 token 间隔/通知条数 | ⏳ 待手工 |
| **01·7** / **八·（二）·4** / **T5** | `stopSdkSession` 后重启不续接 | 手工（§4.1 S9） | 无续接推送；`listRecoverable` 为空 | ⏳ 待手工 |
| **T1** | persist/list/clear/mark 读写 `sdk-active-runs.json` | 04-review §5 静态 | `sdk-run-persistence.ts` | ✅ 静态通过 |
| **T1** | 写盘失败 WARN 不 throw | 04-review §5 静态 | L69–81 | ✅ 静态通过 |
| **T1** | 文件 ≤300 行、中文注释 | 04-review §5 静态 | 112 行 | ✅ 静态通过 |
| **T2** | `createAgentSendOptions` 向后兼容 + `onActivity` | 04-review §5 静态 | `context-usage.ts` | ✅ 静态通过 |
| **T3** | `streamRunEvents` SSOT、`for await (run.stream())` | 04-review §5 静态 | `sdk-run-stream.ts` | ✅ 静态通过 |
| **T3** | `handleSdkEvent` 全分支 `markSessionActivity` | 04-review §5 静态 | 代码复核 | ✅ 静态通过 |
| **T3** | 运行期 consumer 无阻塞 `run.wait()` | 04-review §5 静态 | grep 复核 | ✅ 静态通过 |
| **T4** | idle 豁免 tool_running/awaiting_user/lastTool.running | 04-review §5 静态 | `sdk-run-watchdog.ts` | ✅ 静态通过 |
| **T5** | 持久化挂接 + `recoverSdkActiveRuns` + 一次失败提示 | 04-review §5 静态 | `sdk-run-recover.ts` 等 | ✅ 静态通过 |
| **T5** | 启动日志 `resumed\|failed\|skipped` 可检索 | 04-review §5 静态 | recover 日志格式 | ✅ 静态通过 |
| **T6** | `initDaemonManager` 在 HTTP server 后 recover | 04-review §5 静态 | `daemon-manager.ts` L1263–1267 | ✅ 静态通过 |
| **T6** | 拆分模块 ≤300 行、`agent-sdk.ts` 272 行 | 04-review §5 静态 | 行数复核 | ✅ 静态通过 |
| **八·（二）·7** | 持久化写入失败不阻断 Run | 04-review §5 静态 | WARN 路径 | ✅ 静态通过 |
| **八·（二）·2** | recover 日志 + 失败会话一次 IM 提示 | 04 静态 + 手工 S7 | 日志/IM | ✅ 静态；⏳ 手工 |
| **编译** | TypeScript 全量类型检查 | `npx tsc --noEmit` | exit 0 | ✅ 已执行 |

## 4、场景摘要

### 4.1 手工/E2E 冒烟清单

**前置（共用）**：Electron 应用已构建并启动；Daemon 运行；Cursor SDK 通道资源已配置；开发者工具/UI 日志可查看 `[SDK]`/`[stream]`/`[tool]`/`[status]`。**勿写入 apiKey/token 至知识库**。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 |
|---------|------|------|------|----------|
| **S1** IM 全路径消费 | 飞书/微信私聊已连接 | 发起多步 SDK 问答 | 运行中日志交替出现 stream/tool/status，非仅「运行结束」一条 | 通道配置 → 环境；无中间事件 → 实现 |
| **S2** 任务面板路径 | 任务面板 `launchIndependentAgent` | 触发一条 Cursor SDK 任务 | 同 S1 过程可观测 | 路由/Daemon → 环境；无 stream → 实现 |
| **S3** 工作流路径 | 工作流节点 `launchWorkflowAgent` | 触发 workflow chatType 运行 | 同 S1 过程可观测 | 工作流配置 → 环境 |
| **S4** 过程事件时序 | 含 ≥2 步 tool 的 Run | 观察 thinking/tool/assistant 到达顺序 | 与事件时序一致；Run 结束后无批量补发过程 | 呈现节流误判 → 实现；通道不支持流式 → 已知降级 |
| **S5** 长工具 watchdog | 触发长耗时 tool 或 mock `lastTool.running`/`runPhase=tool_running` | 等待 **≥10min**（或调试缩短阈值环境下等价窗口） | watchdog 日志**不出现** `cancelling`（除非真实 absolute timeout） | SDK 真卡死 → 预期边界；idle 误杀 → watchdog |
| **S6** kill-restart 续接 | 进行中 Run 尚未结束 | kill Electron 主进程 → 冷启动 | 原 IM/任务会话**无需重发**即收到后续 stream-text；`recoverSdkActiveRuns` 有 `resumed` | Run 已终态 → 走 S7；resume 失败 → 实现/SDK |
| **S7** 续接失败兜底 | Run 已结束或故意损坏快照 | 重启应用 | 用户收到**一次**可理解提示；日志 `failed`/`skipped`；非静默 | 无提示 → `notifyResumeFailure`；重复提示 → 实现 |
| **S8** 短任务首包 | 短问答（单轮、轻 tool） | 对比改造前基线（若无可记本轮主观） | 首段可见反馈时延无明显变慢；无重复「处理中/完成」矛盾 | 明显变慢 → stream/节流回归 |
| **S9** 主动停止不续接 | 运行中点击停止 | `stopSdkSession` → 重启应用 | 不向该 session 推送续接事件；`sdk-active-runs.json` 无该 session 可恢复项 | 仍续接 → persistence/clear 逻辑 |

### 4.2 静态契约核对（04-review §5 已覆盖）

| 检查项 | 操作指针 | 期望 |
|--------|----------|------|
| 事件流 SSOT | `electron/sdk-run-stream.ts` `streamRunEvents` | `for await (run.stream())` 主路径 |
| 活跃刷新 | `handleSdkEvent`、`context-usage` `onActivity` | 全分支 + onDelta 刷新 `lastActivityAt` |
| Watchdog 豁免 | `electron/sdk-run-watchdog.ts` `onTick` | tool_running/awaiting_user/lastTool.running 豁免 idle |
| 持久化 | `electron/sdk-run-persistence.ts` | upsert/clear/list/mark；写失败 WARN |
| 续接 | `electron/sdk-run-recover.ts` | `Agent.resume` → `getRun` → `streamRunEvents`；失败一次提示 |
| 启动挂接 | `electron/daemon-manager.ts` | `ensureAgentSdkHttpServer` 后 `recoverSdkActiveRuns` |
| 行数治理 | `electron/agent-sdk.ts` 及各 `sdk-run-*` | 均 ≤300 行；无 persistence→agent-sdk 循环 import |
| 设计偏差 | 04 §4 | `getRun` 入参简化、`stop` 先 mark 后 clear — 功能等价，不阻断 |

### 4.3 关键可观测日志（摘要）

| 阶段 | 日志关键词（示例） | 用途 |
|------|-------------------|------|
| 事件消费 | `[stream:`、`[tool]`、`[status]` | 验收 1/2、八·（二）·1 |
| 续接 | `resumed`、`failed`、`skipped` | 验收 4/5、八·（二）·2 |
| Watchdog | `draining`、`cancelling` | 验收 3、八·（二）·5（长窗口应无 cancelling） |
| 持久化 | `sdk-active-runs.json` WARN | 八·（二）·7 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无（仓库规范不写单测/E2E 脚手架） |
| **运行依赖** | Electron 桌面应用 + Daemon；Cursor SDK 本地 runtime；可选 IM/任务/工作流入口 |
| **测试数据** | `userData/sdk-active-runs.json`（含 apiKey，仅本地 userData 权限）；通道 workspaceDir |
| **环境变量** | 无本变更专属开关；`NEVER_CANCEL_ON_DURATION` 等沿用既有 watchdog 配置 |

## 6、输出与记录规范

会话与本文**禁止**粘贴完整终端日志、`sdk-active-runs.json` 原文或 apiKey。执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。失败时区分 **环境/SDK** vs **主进程实现**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-02 | 本地 dev | 04-review §5 静态项（T1–T6、八·（二）可静态部分） | 通过 | review open 0 |
| 2026-07-02 | 本地 dev | `npx tsc --noEmit` | 通过 | exit 0 |
| 2026-07-02 | — | S1 IM 全路径消费 | 待用户验收 | E2E |
| 2026-07-02 | — | S2 任务面板路径 | 待用户验收 | E2E |
| 2026-07-02 | — | S3 工作流路径 | 待用户验收 | E2E |
| 2026-07-02 | — | S4 过程事件时序 | 待用户验收 | E2E |
| 2026-07-02 | — | S5 长工具 watchdog 10min+ | 待用户验收 | E2E |
| 2026-07-02 | — | S6 kill-restart 续接 | 待用户验收 | E2E |
| 2026-07-02 | — | S7 续接失败兜底 | 待用户验收 | E2E |
| 2026-07-02 | — | S8 短任务首包对比 | 待用户验收 | 手工 |
| 2026-07-02 | — | S9 主动停止不续接 | 待用户验收 | E2E |
