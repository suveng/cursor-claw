# SDK think与task事件实时通知 - 验收记录

> **变更 ID**：`20260704174846-SDK think与task事件实时通知`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T6 done；04-review R1/R2 fixed；本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（T6 grep/类型 + 04-review §5 代码路径）+ **编译门禁**（`npm run build:mcp`）+ **手工 E2E**（飞书/微信/任务面板 + Cursor SDK 运行时）；无新增 `auto_test/` 脚本 |
| **目标** | 覆盖 `01-proposal` 验收 1–7、`02-design` §8.2 工程补充 1–6、`03-tasks` T1–T6 全部验收条 |
| **MVP 范围** | Cursor SDK 路径；飞书私聊 thinking/task 里程碑降级、微信 CardKit/文本、任务面板同链路 presentation |
| **排除范围** | Claude/Codex/OpenCode 引擎（T6 确认无 diff）；Electron 设置 UI；群聊深度抽检（01·6 可降级为飞书私聊 + 微信 + 任务面板） |
| **与 review 分工** | 04 已静态确认出站/defer/里程碑模块与 R1/R2 修复；运行时 10s 可见性、短问答时延、停止清理须 **应用内手工** |
| **本轮执行** | 2026-07-04 静态冒烟全通过；E2E 待维护者本地执行 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01·1** think 10s 内可见 | 依赖 `@cursor/sdk` 真实 Run、Daemon presentation-event 与飞书/微信 IM 投递；headless 无法稳定断言用户侧首条里程碑时延 |
| **01·2** task 里程碑可见 | 须 SDK 产生 ≥2 个子任务事件且 daemon 出站；无稳定 mock stream 契约 |
| **01·3** 短任务首包不退化 | 用户感知级对比须与变更前基线人工对照；无自动化基线 |
| **01·4** 长任务 ≥2 次过程更新 | 须 >30s 稀疏正文 Run；墙钟与通道投递不可脚本化低成本复现 |
| **01·5** 停止/失败与三态协调 | 须运行中 stop 或失败触发；过程通知与结束态时序仅 E2E 可证 |
| **01·6** 多通道抽检 | 飞书/微信凭据与任务面板入口须已配置；CI 无通道 sandbox |
| **01·7** 同文案不刷屏 | 里程碑去重/节流逻辑可静态证明，连续 5 条同文案边界须真实 Run 目检 |
| **§8.2·5** 微信 task HTTP 200 | 须微信通道已配置并触发 `kind=task` presentation-event |
| **§8.2·6** 无残留 milestone 定时器 | `clearMilestoneState` 路径已静态挂接；残留定时器仅 stop/final 后 E2E 可证 |
| **单元/集成测试** | 仓库规范不写单测；由 review 静态 + 手工冒烟覆盖 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **T1** | `PresentationKind` 含 `task`；gate feishu+task 抑制 | grep + 04 §5 | 三端类型一致 | ✅ 静态通过 |
| **T1** | 微信 + task 不抑制 | `feishu-presentation-gate.ts` | gate 逻辑 | ✅ 静态通过 |
| **T2** | `postPresentationEvent` 无飞书 early return | grep | `sdk-run-presentation.ts` | ✅ 静态通过 |
| **T2** | `markProcessEventSeen(session, kind)` 门控；task 不置 defer | 04 §5 + grep | feishuSuppress 仅 mark 路径 | ✅ 静态通过 |
| **T2** | R2：`maybeReleaseDeferredAssistant` 对齐 `presentationDeferStream` | 04 R2 fixed | 代码复核 | ✅ 静态通过 |
| **T3** | 独立 `case "task"` + `postPresentationEvent` | grep | `sdk-run-stream.ts` | ✅ 静态通过 |
| **T3** | task 不调用 `markProcessEventSeen` | 04 §5 | 代码复核 | ✅ 静态通过 |
| **T4** | `daemon-presentation-milestone.ts` ≤300 行；节流/去重 | 行数 + 04 §5 | 125 行 | ✅ 静态通过 |
| **T5** | `handlePresentationEvent` case `task` | grep | `daemon.ts` | ✅ 静态通过 |
| **T5** | thinking/tool 飞书抑制 → `sendMilestoneText` | grep L1417/1546/1705 | 非裸 return | ✅ 静态通过 |
| **T5** | R1：飞书抑制不置 ordering 闩 | 04 R1 fixed | CardKit 路径专属 | ✅ 静态通过 |
| **T5** | `stopSessionProgress` → `clearMilestoneState` | 04 §5 | 代码挂接 | ✅ 静态通过 |
| **T6** | 非 Cursor SDK 引擎无 diff | git diff 口径 | Claude/Codex/OpenCode | ✅ 静态通过 |
| **T6** | `STREAM_POST_INTERVAL_MS=400` 未变 | grep | 常量 | ✅ 静态通过 |
| **编译** | TypeScript 编译 | `npm run build:mcp` | exit 0 | ✅ 已执行 |
| **01·1** / **§8.2·1** | think 10s 内可见（CardKit 或降级文本） | 手工 E2E（§4.2 E1） | IM 里程碑/CardKit | ⏳ 待手工 |
| **01·2** / **§8.2·2** | 含 ≥2 task 里程碑；首个 task 10s 内可见 | 手工 E2E（§4.2 E2） | `[task]` 日志 + IM | ⏳ 待手工 |
| **01·3** / **§8.2·3** | 短问答首包无明显劣化 | 手工对比（§4.2 E3） | 首 token 间隔 | ⏳ 待手工 |
| **01·4** | 长任务等待 ≥2 次过程更新 | 手工 E2E（§4.2 E2/E4） | think/task/tool 合计 | ⏳ 待手工 |
| **01·5** / **§8.2·6** | 停止后过程停止；失败不掩盖 | 手工（§4.2 E4） | 无残留推送 | ⏳ 待手工 |
| **01·6** | 飞书私聊、微信、任务面板各 1 场景 | 手工多入口（§4.2） | 过程可感知 | ⏳ 待手工 |
| **01·7** / **§8.2·4** | 同文案里程碑 ≤4 条/Run | 静态 `MILESTONE_MAX_PER_RUN` + 手工 | 代码 + 目检 | ✅ 静态；⏳ 手工 |
| **§8.2·5** | 微信 `kind=task` 不 500 | 手工（§4.2 E2，微信已配置时） | HTTP 200 | ⏳ 待手工 |

## 4、场景摘要

### 4.1 静态冒烟清单（T6 项）

| 检查项 | 操作指针 | 期望 | 结果 |
|--------|----------|------|------|
| 飞书仍 POST | `sdk-run-presentation.ts` `postPresentationEvent` | 无 `isFeishuProcessPresentationSuppressed` early return | ✅ |
| defer 门控 | `markProcessEventSeen` | `feishuSuppress` 仅用于 mark；task 不 defer | ✅ |
| task 出站 | `sdk-run-stream.ts` | 独立 `case "task"` + `postPresentationEvent` | ✅ |
| daemon 路由 | `daemon.ts` `handlePresentationEvent` | `case "task"` → handler | ✅ |
| 飞书里程碑降级 | `daemon.ts` thinking/tool 抑制分支 | `sendMilestoneText`（L1417/1546/1705） | ✅ |
| 里程碑模块 | `daemon-presentation-milestone.ts` | ≤300 行；`MILESTONE_THROTTLE_MS=3000` | ✅ 125 行 |
| 非 SDK 引擎 | git diff | Claude/Codex/OpenCode 无变更 | ✅ |
| 流式间隔 | `STREAM_POST_INTERVAL_MS` | 仍为 400 | ✅ |
| TypeScript | `npm run build:mcp` | exit 0 | ✅ |
| Review 关闭 | `04-review.md` | R1/R2 fixed | ✅ |

### 4.2 手工 E2E 场景（飞书私聊 thinking、含 task Run、短问答时延对比、停止清理）

**前置（共用）**：Electron 应用已构建并启动；Daemon 运行；Cursor SDK API Key 与通道（飞书/微信）已配置；UI 日志可查看 `[SDK]`、`[thinking]`、`[task]`、`milestone_fallback`。**勿将 apiKey/token 写入知识库**。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 |
|---------|------|------|------|----------|
| **E1** 飞书 thinking 首包 | 飞书私聊 SDK 通道 | 发送需多步推理的消息（正文尚未产出） | **10s 内**收到「正在思考…」或等价降级里程碑文本；非直至结束仍沉默 | 通道凭据 → 环境；无里程碑 → daemon 降级 |
| **E2** 含 task Run | 同上或微信（若已配置） | 触发含子任务拆分的 Run（如显式 `/Task` 或多步 agent） | UI 日志 `[task]`；IM **10s 内**首个「正在执行：…」类通知；≥2 个里程碑可读 | SDK 无 task 事件 → 用例；无出站 → T3/T5 |
| **E3** 短问答时延对比 | 飞书私聊；`PRESENTATION_ORDERING` 默认开 | 单轮轻量问答 × ≥3，对比变更前主观基线 | 首条可见 assistant 或合规过程+正文组合**无明显变慢**；无长时间双空白 | 明显变慢 → defer/里程碑回归 |
| **E4** 停止与长任务过程 | 进行中 Run | （a）长任务 >30s 观察过程更新；（b）用户停止 | （a）等待期 ≥2 次 think/task/tool 里程碑；（b）停止后无新里程碑；`clearMilestoneState` 生效 | 停止仍推送 → T5 清理；刷屏 → T4 节流 |
| **E5** 任务面板入口 | 任务面板触发 Cursor SDK | 同 E1/E2 轻量变体 | 过程信号与 IM 同原则可见 | 路由 → 环境 |
| **E6** 微信 task（可选） | 微信已配置 | 含 task 的 Run | `presentation-event` kind=task 路径 HTTP 200，无 500 | 未配置 → 跳过；500 → T5 handler |

**关键可观测点**

| 阶段 | 日志/现象关键词 | 用途 |
|------|----------------|------|
| Electron 出站 | `presentation-event` 入站（daemon 日志） | T2 飞书仍 POST |
| task 映射 | `[task]` UI 日志 | T3/E2 |
| 飞书降级 | `milestone_fallback` WARN | T4 节流/发送 |
| 停止清理 | stop 后无新里程碑文本 | §8.2·6 / 01·5 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无（本变更未新增脚本；仓库规范不写单测/E2E 脚手架） |
| **运行依赖** | Electron 桌面应用 + Daemon；Cursor SDK 本地 runtime；飞书/微信通道资源已配置 |
| **环境变量** | `PRESENTATION_ORDERING`（默认开，影响 assistant defer 与 ordering 闩）；`DAEMON_PORT`；飞书 `LARK_*`、微信相关变量仅记名称，不写值 |
| **编译命令** | `npm run build:mcp`（tsc） |
| **测试数据** | 通道 workspaceDir；勿提交含凭据的配置至知识库 |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON 或通道凭据原文。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 失败时区分：**环境/通道/SDK 配置** vs **presentation/里程碑实现**。
- E2E 通过后维护者可在 §7 追加行并将对应追溯表项由 ⏳ 改为 ✅。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-04 | 本地 dev | T6 静态 grep/类型项（§4.1 全表） | 通过 | 主 Agent 执行 |
| 2026-07-04 | 本地 dev | `npm run build:mcp` | 通过 | tsc exit 0 |
| 2026-07-04 | 本地 dev | 04-review §5 代码路径 + R1/R2 fixed | 通过 | open 0 critical |
| 2026-07-04 | — | E1 飞书 thinking 首包 10s | 待维护者执行 | 需飞书已配置 |
| 2026-07-04 | — | E2 含 task Run 里程碑 | 待维护者执行 | 需 SDK API Key |
| 2026-07-04 | — | E3 短问答时延对比 | 待维护者执行 | 手工基线 |
| 2026-07-04 | — | E4 长任务过程 + 停止清理 | 待维护者执行 | E2E |
| 2026-07-04 | — | E5 任务面板入口 | 待维护者执行 | E2E |
| 2026-07-04 | — | E6 微信 task（可选） | 待维护者执行 | 微信已配置时 |
