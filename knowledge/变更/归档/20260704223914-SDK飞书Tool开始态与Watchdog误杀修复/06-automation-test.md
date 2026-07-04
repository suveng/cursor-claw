# SDK 飞书 Tool 开始态与 Watchdog 误杀修复 - 验收记录

> **变更 ID**：`20260704223914-SDK飞书Tool开始态与Watchdog误杀修复`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T5 done；本文产出后 `stage=tested`
> **结论**：静态+编译通过；E2E 待手工；不阻断 archive

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（tsx 冒烟 + grep 门控路径）+ **编译门禁**（`npm run build:mcp`）+ **手工 E2E**（飞书私聊 + Cursor SDK + 长 idle 竞态）；无新增单测 |
| **目标** | 覆盖 `01-proposal` 验收 1–10、`02-design` §八·（二）工程补充 4 项、`03-tasks` T1–T5 全部验收条 |
| **MVP 范围** | Cursor SDK 路径；Task 工具 tool_call 开始态、shell 命令摘要、飞书 thinking 零出站、watchdog 竞态门控 |
| **排除范围** | Claude/Codex/OpenCode；`sdk-run-presentation.ts` Rev2 defer/release 链（本变更未改） |
| **与 review 分工** | 04 已静态确认门控落点与 Presentation SSOT；飞书 IM 文案、时序与竞态日志须 **应用内手工** |
| **本轮执行** | 2026-07-04 静态冒烟 + `npm run build:mcp` 通过；01 验收 1–10 飞书 E2E 待维护者本地执行 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01·1–2** Task 工具开始态带描述、与 task 事件并存 | 须真实 SDK Task tool_call + 飞书 IM 投递 |
| **01·3–4** shell 开始态无裸占位、文本里程碑路径 | 须 SDK 产生 ≥3 条 shell started + 飞书目检 |
| **01·5** thinking 零飞书消息 + 10s 内仍有反馈 | 须含 thinking 的 Run + 飞书会话目检 |
| **01·6** 长 idle + CANCELLED 无 resume、单次 archive | 须可控 idle 阈值或 staging 长 Run + UI/SDK 日志 |
| **01·7** 非竞态 hung run 仍 timeout | 须无平台 CANCELLED 干扰的长无响应 Run |
| **01·8** read/glob 等 silent 工具无开始态 | 须飞书 IM 目检 |
| **01·9–10** 完成/失败不退化、桌面 thinking 日志 | 须完整 Run 生命周期 + UI 日志 |
| **单元测试** | 仓库规范本变更不新增单测 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **T1** | Task started 含 `tool_task_description` → `正在执行：{描述}` | tsx 契约冒烟 | `formatToolMilestoneText("task","started",…)` | ✅ 已执行 |
| **T1** | shell started 含命令摘要 | tsx 契约冒烟 | `执行命令：npm test` | ✅ 已执行 |
| **T1** | shell 无命令时明确降级 | tsx 契约冒烟 | `命令执行已开始（具体命令暂不可展示）` | ✅ 已执行 |
| **T1** | 飞书 thinking 零 `sendMilestoneText` | grep | `daemon.ts` L1593–1596 `return { ok: true }` | ✅ 静态通过 |
| **T2** | `watchdogTimedOut` 字段 + reset 清零 | grep | `sdk-session-types.ts`、`resetSdkRunPresentationState` | ✅ 静态通过 |
| **T3** | `onTimeout` 置闩 + `markSessionActivity` cancelling/闩门控 | grep | `sdk-run-watchdog.ts`、`sdk-session-registry.ts` | ✅ 静态通过 |
| **T4** | status/stream/complete 门控 + `isRunTimeoutFailure` 早退 | grep | `sdk-run-stream.ts`、`sdk-run-lifecycle.ts`、`finalize-sdk-run.ts` | ✅ 静态通过 |
| **T5** | 三份 `AGENTS.md` 与代码一致 | 04-review + 源码 | cursor-sdk/shared/daemon AGENTS | ✅ 静态通过 |
| **§八·（二）** | cancelling+CANCELLED 无 resume；单次 sdk_timeout | grep + 手工 E-WD | 门控源码 ✅；日志 ⏳ | ⏳ 半自动 |
| **编译** | TypeScript | `npm run build:mcp` | exit 0 | ✅ 已执行 |
| **01·1–10** | PRD 全量 E2E | 手工（§4.2） | 飞书 IM + SDK 日志 | ⏳ 待手工 |

## 4、场景摘要

### 4.1 静态冒烟清单

| 检查项 | 操作指针 | 期望 | 结果 |
|--------|----------|------|------|
| Task 开始态契约 | `formatToolMilestoneText("task","started",{tool_task_description:"搜索相关代码"})` | `正在执行：搜索相关代码`，非裸 `task：已开始` | ✅ |
| shell 命令摘要 | `formatToolMilestoneText("shell","started",{tool_shell_command:"npm test"})` | `执行命令：npm test` | ✅ |
| shell 降级 | `formatToolMilestoneText("shell","started",{})` | `命令执行已开始（具体命令暂不可展示）` | ✅ |
| thinking 飞书静默 | `handleThinkingPresentationEvent` 抑制分支 | 无 `sendMilestoneText` | ✅ |
| watchdog 置闩 | `onTimeout` 内 `watchdogTimedOut = true` | cancel 前已置闩 | ✅ |
| activity 门控 | `markSessionActivity` cancelling/闩 | 不 `activity_resume` | ✅ |
| 收尾去重 | status/stream/complete + `isRunTimeoutFailure` | `watchdogTimedOut` 时跳过 finalize | ✅ |
| Rev2 边界 | `sdk-run-presentation.ts` | 本变更 diff 为空 | ✅ |
| TypeScript | `npm run build:mcp` | exit 0 | ✅ |

### 4.2 手工 E2E 场景

**前置**：Electron + Daemon 运行；飞书 SDK 通道已配置；UI 日志可见 `[thinking]`、`activity_resume`、`sdk_timeout`。

| 场景 ID | 触发 | 期望 | 失败判责 |
|---------|------|------|----------|
| **E1** Task 多步 | Run 含 ≥2 个 Task 工具 started（可区分 `description`） | 各开始态含 `正在执行：…` 描述摘要 | T1 |
| **E2** task 事件并存 | 同时有 task 事件与 Task tool_call | 两路径描述均可读、无退化 | T1 |
| **E3** shell started | ≥3 条不同 shell 命令 | 均含命令摘要或 §F2.3 降级句；无裸 `shell: started` | T1 |
| **E4** shell 文本里程碑 | 飞书走文本里程碑呈现 | 与卡片路径信息等价 | T1/T2 |
| **E5** thinking 静默 | 含 thinking 的 Run | 飞书 **0** 条思考类里程碑；10s 内仍有处理中/正文/工具反馈 | T1/T4 |
| **E6** 桌面 thinking | 同 E5 | UI `[thinking]` 仍有输出 | T1 |
| **E7** silent 工具 | read/glob 等只读探查 | 飞书无开始态过程通知 | T1/分级 |
| **E8** 完成/失败 | 同次 shell/Task 完成或失败 | 结果展示不退化 | T1 |
| **E-WD** watchdog 竞态 | 长 idle（draining+grace）→ watchdog 进入 cancelling → 随后 stream `CANCELLED` | 日志**无** `activity_resume:stream:status` / `activity_resume:status`；**无**二次超时失败通知；**单次** `sdk_timeout` archive | T3/T4 |
| **E-HUNG** 真实超时 | 非竞态 hung run（无平台 CANCELLED） | watchdog 仍合理收尾并通知用户 | T4 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| 编译 | 仓库根目录 `npm run build:mcp` |
| 契约冒烟 | 仓库根目录 `tsx` 调用 `formatToolMilestoneText`（`src/shared/tool-presentation.ts`） |
| 运行 | Electron 桌面应用 + Daemon（`daemon-entry`） |
| 日志 | UI SDK 日志、`daemon.log`；竞态场景关注 `activity_resume`、`sdk_timeout`、`watchdogTimedOut` |
| 重启 | 门控变更后须重启 Electron/Daemon 进程 |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志；执行记录仅用 §7 表格一行摘要（日期、环境、场景、结果、备注）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-04 | 本地 | `build:mcp` + tsx 契约 + watchdog 门控 grep + thinking 静默 grep | 通过 | 静态全绿；E2E 待手工 |
