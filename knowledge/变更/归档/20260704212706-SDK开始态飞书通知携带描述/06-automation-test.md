# SDK 开始态飞书通知携带描述 - 验收记录

> **变更 ID**：`20260704212706-SDK开始态飞书通知携带描述`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T5 done；04-review S1 须在 archive commit 剥离混入；本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（T1–T5 grep/类型 + 04-review §5）+ **编译门禁**（`npm run build:mcp`）+ **手工 E2E**（飞书私聊/群聊 + Cursor SDK）；无新增单测 |
| **目标** | 覆盖 `01-proposal` 验收 1–10、`02-design` §8.2 工程补充 1–6、`03-tasks` T1–T5 全部验收条 |
| **MVP 范围** | Cursor SDK 路径；飞书 tool/task 里程碑降级、thinking 零出站 |
| **排除范围** | Claude/Codex/OpenCode；`format-unknown-error` 变更（`20260704214025`，非本变更） |
| **与 review 分工** | 04 已静态确认文案 SSOT、thinking 静默、Rev2 未改；飞书 IM 文案与时序须 **应用内手工** |
| **本轮执行** | 2026-07-04 静态冒烟 + `npm run build:mcp` 通过；E2E 待维护者本地执行 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01·1–2** shell 里程碑含命令 | 须真实 SDK shell 事件 + 飞书 IM 投递 |
| **01·3** 多 task 可区分 | 须 SDK 产生 ≥2 个 task started |
| **01·5** thinking 零飞书消息 | 须含 thinking delta 的 Run + 飞书会话目检 |
| **01·7** 群聊触发者可见 | 须群聊 @ Agent 场景 |
| **01·8** 时序无倒置 | 用户感知级；无自动化基线 |
| **§8.2·6** 微信 thinking 不变 | 须微信通道已配置 |
| **单元测试** | 仓库规范本变更不新增单测 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **T1** | `formatToolMilestoneText` shell started 含命令/降级 | 04 §5 + 源码 | `tool-presentation.ts` L140–178 | ✅ 静态通过 |
| **T1** | ≤300 行 | wc | 191 行 | ✅ |
| **T2** | 飞书抑制 tool 用新文案 | grep | `daemon.ts` L1458–1470 | ✅ 静态通过 |
| **T2** | 未改 `sdk-run-presentation.ts` | git diff | 无该文件 | ✅ |
| **T3** | `taskSeq` + `mapTaskMilestoneText` | grep | `sdk-run-stream.ts` | ✅ 静态通过 |
| **T3** | `buildTaskFallbackText` 对齐 | 源码 | 「子任务已开始」 | ✅ |
| **T4** | 飞书 thinking `return { ok: true }` | grep | `daemon.ts` L1592–1594 | ✅ 静态通过 |
| **T4** | 桌面 `[thinking]` 仍 POST | `case "thinking"` 未删 | stream 无删减 | ✅ |
| **T5** | 三份必更文档 | 04 §5 | AGENTS + `06` 引擎 | ✅ 静态通过 |
| **编译** | TypeScript | `npm run build:mcp` | exit 0 | ✅ 已执行 |
| **S1** | 无 `formatUnknownError` 混入本 archive | 剥离后 grep | daemon 全局 handler | ⏳ archive 前剥离 |
| **01·1–10** | PRD 全量 E2E | 手工（§4.2） | 飞书 IM + UI 日志 | ⏳ 待手工 |

## 4、场景摘要

### 4.1 静态冒烟清单

| 检查项 | 操作指针 | 期望 | 结果 |
|--------|----------|------|------|
| shell 里程碑 SSOT | `formatToolMilestoneText("shell","started",{tool_shell_command:"npm test"})` | 含 `npm test`，非 `shell: started` | ✅ 契约 |
| thinking 飞书静默 | `handleThinkingPresentationEvent` 抑制分支 | 无 `sendMilestoneText` | ✅ |
| task 序号 | `case "task"` started | `taskSeq` 递增 | ✅ |
| Rev2 边界 | `sdk-run-presentation.ts` | diff 为空 | ✅ |
| 节流模块 | `daemon-presentation-milestone.ts` | diff 为空 | ✅ |
| TypeScript | `npm run build:mcp` | exit 0 | ✅ |

### 4.2 手工 E2E 场景

**前置**：Electron + Daemon 运行；飞书 SDK 通道已配置；UI 日志可见 `[thinking]`、`[task]`、`milestone_fallback`。

| 场景 ID | 触发 | 期望 | 失败判责 |
|---------|------|------|----------|
| **E1** shell started | 触发含 shell 命令的 Run（≥3 条不同命令） | 飞书里程碑含「执行命令：…」摘要 | T1/T2 |
| **E2** task 多步 | Run 含 ≥2 个 task started | 各 started 含描述或 `#N 已开始` | T3 |
| **E3** thinking 静默 | 含 thinking 的 Run | 飞书 **0** 条 thinking 类里程碑；10s 内仍有处理中/正文/工具反馈 | T4 |
| **E4** 桌面 thinking | 同 E3 | UI `[thinking]` 仍有输出 | T4 |
| **E5** 群聊 | 群聊 @ Agent + shell | 触发者可见命令摘要 | T2/门控 |
| **E6** 微信 thinking（可选） | 微信已配置 | thinking 行为与变更前一致 | T4 非飞书分支 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| 编译 | 仓库根目录 `npm run build:mcp` |
| 运行 | Electron 桌面应用 + Daemon（`daemon-entry`） |
| 日志 | UI SDK 日志、`daemon.log` 中 `milestone_fallback` / `presentation_failed` |

## 6、结论

- **静态验收**：T1–T5 代码路径与 04-review 一致；`npm run build:mcp` 通过。
- **E2E**：01 验收 1–10 待维护者按 §4.2 手工执行；不阻断 archive（体验优化，静态契约已覆盖核心路径）。
- **archive 注意**：commit 前须剥离 S1（`formatUnknownError` 混入），仅提交本变更 manifest 白名单文件。
