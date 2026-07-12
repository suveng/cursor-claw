# 非Cursor引擎主进程续接 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` 验收 1–5、`02-design.md` §8.2 工程补充项、`03-tasks.md` T1–T13、`04-review.md`（通过，无阻断项）
> **评审结论**：focused-review 无严重项；Codex CLI 早退与三引擎异步 resumed 计数为已知警告，不阻断 `tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 轻量静态（`tsc`、行数、调用链）+ 四引擎主进程重启手工冒烟；**不**跑全量单测/集成测 |
| **目标** | 验证 `recoverAllActiveRuns` 编排、三引擎持久化/续接/失败通知、Cursor S7 零回归及 Port 终态契约 |
| **与验收关系** | 每条场景对应 `01` 验收或 `03` 任务验收；`02` §8.2 工程项单独标 **工程** |
| **本期执行** | `npx tsc --noEmit`；`04` 静态核对（orchestrator、skip/guard/notify 链）；四引擎重启续接实机待用户补测 |
| **轻量静态** | 新增/改动单文件 ≤300 行（最大 `opencode-run-recover.ts` 194 行）；`daemon-manager` 单行替换 ✅ |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 四引擎重启续接端到端（01 验收 1） | 需 Electron 主进程启停 + 各引擎真实 Run + IM 通道 | 续接粒度依赖各 SDK `resume` 语义（02 §8.1） |
| OpenCode embedded 冷启动续接 | 需 embedded server 参数与 `opencodeSessionId` 探活 | 中风险；`probeOpencodeRecoverTarget` 已接线，运行时待证 |
| Codex CLI 不可用 + 盘有记录 | 边角场景；`checkCodexCliAvailable` 早退不遍历（04 §3-1） | 无 IM 通知；有 WARN 日志；可选 T-FIX-01 |
| recover 与 dispatch 并发双跑 | 需 IM 发消息同时主进程重启 | skip `session_exists` 已静态对称 S7 |
| 续接后秒级 stream 失败 | 三引擎 `resumed++` 在 fire-and-forget 后同步计 | 走 `complete*Run` 链而非 `notifyResumeFailure`（04 §3-2） |
| `userStopped` 不续接 | 需 stop 后重启 | `listRecoverable*` 过滤已静态 ✅ |

## 3、验收追溯表

| ID | 验收摘要（01/03/02·八·二） | 验证方式 | 证据类型 | 状态 |
|----|---------------------------|----------|----------|------|
| T1 | `active-run-store` 读容错/写 WARN/`userStopped` 过滤 | 静态读源码 | 源码 | ✅ 静态 |
| T2 | `notifyResumeFailure` 抽取；Cursor import 迁移 | 静态 + Cursor recover 对照 | 源码 | ✅ 静态 |
| T3–T5 | 三引擎 `*-run-persistence` Record 字段 | 静态 | 源码 | ✅ 静态 |
| T6–T8 | launch/stream/stop persist 挂接；终态 clear | 静态 grep 挂接点 | 源码 | ✅ 静态 |
| T9 | CC recover：skip/guard/resume/notify/clear | 手工 H2 | IM + 日志 | ⚠️ 待实机 |
| T10 | Codex recover 对称（CLI 早退见局限） | 手工 H3 | IM + 日志 | ⚠️ 待实机 |
| T11 | OpenCode 探活 + recover | 手工 H4 | IM + 日志 | ⚠️ 待实机 |
| T12 | 四引擎顺序 recover、单引擎 catch、汇总日志 | 静态 + 手工 H1–H4 日志行 | 日志 `[recover]` | ✅ 静态；汇总待实机 |
| T13 | `initDaemonManager` → `recoverAllActiveRuns` | 静态 + 重启日志 | 源码 + 日志 | ✅ 静态；触发待实机 |
| 01-1 | 三引擎各一条：重启→续接成功或明确失败 | 手工 H2–H4 | IM + `*-active-runs.json` | ⚠️ 待实机 |
| 01-2 | 成功路径无需手动重发 IM | 手工 H2–H4 成功路径 | IM 无重复用户消息 | ⚠️ 待实机 |
| 01-3 | 失败仅通知一次 | 手工 H5 + 静态 | IM `stop_progress: true` | ✅ 静态；失败路径待实机 |
| 01-4 | Cursor S7 无回归 | 手工 H1 | IM + 日志 | ⚠️ 待实机 |
| 01-5 | 四引擎终态 IM 符合 Port 契约 | 手工各引擎完成 Run | 终态通知格式 | ⚠️ 待实机 |
| 02§8.2 | init 后四引擎 `[recover]` 汇总行 | 重启后主进程日志 | 日志 | ⚠️ 待实机 |
| 02§8.2 | recover∥dispatch `session_exists` skip | 手工 H6 | 日志 skip reason | ⚠️ 待实机 |
| 02§8.2 | `userStopped=true` 不续接 | 手工 H7 | 盘文件 + 日志 resumed=0 | ⚠️ 待实机 |
| 02§8.2 | persist 写盘失败仅 WARN | 静态 | 源码 `pushUiLog` WARN | ✅ 静态 |
| 02§8.2 | 单文件 ≤300 行 | `wc -l` 抽样 | 行数 | ✅ 静态 |
| R1 | `channelSource` 类债务 | — | — | N/A |
| 04§3-1 | Codex CLI 不可用早退 | 手工（可选） | 日志无遍历 | ⚠️ 已知债务 |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| Electron | 可独立重启主进程；Daemon **保持运行**（01 §四 场景前提） |
| 通道 | 至少一条已配置 IM 通道（飞书等）；可收发消息 |
| 引擎 | 四引擎各能发起一次长任务 Run（Cursor / Claude Code / Codex / OpenCode） |
| 工作目录 | 有效 workspace；各引擎 API Key / 资源配置可用 |
| 盘快照 | `{userData}/sdk-active-runs.json`、`cc-active-runs.json`、`codex-active-runs.json`、`opencode-active-runs.json` 可观察（**勿**粘贴凭据） |
| OpenCode | 若测 embedded 模式，须与 Run 时相同的 deploy/hostname/port 配置 |

### 4.2 四引擎主进程重启续接手工清单

| # | 场景 | 前置 | 操作 | 期望 | 关联 | 本期 |
|---|------|------|------|------|------|------|
| H1 | **Cursor** 续接（S7 回归） | Cursor 引擎 Run **进行中**；`sdk-active-runs.json` 有 sessionKey | 仅重启 Electron 主进程（不停 Daemon） | 任务继续或一条失败 IM（`未能自动续接`）；无需用户重发；日志含 `[recover]` | 01-1/2/4；T12/T13 | ⚠️ 待实机 |
| H2 | **Claude Code** 续接 | CC Run 进行中；`cc-active-runs.json` 含 `ccSessionId` | 同上重启 | 续跑或明确失败 IM 一次；`stop_progress: true` | 01-1/2/3；T9 | ⚠️ 待实机 |
| H3 | **Codex** 续接 | Codex Run 进行中；`codex-active-runs.json` 含 `codexSessionId` | 同上重启 | 续跑或明确失败 IM；CLI 可用 | 01-1/2/3；T10 | ⚠️ 待实机 |
| H4 | **OpenCode** 续接 | OpenCode Run 进行中；盘含 `opencodeSessionId` 与 server 参数 | 同上重启 | 探活通过后续跑；session 失效则失败 IM + 清快照 | 01-1/2/3；T11 | ⚠️ 待实机 |
| H5 | 续接失败单次通知 | 人为制造无效快照（如清空 `ccSessionId` 后重启） | 重启主进程 | 每条失败 session **仅一条** IM；无重复 `notifyResumeFailure` | 01-3；T2 | ⚠️ 待实机 |
| H6 | recover 与 dispatch 防双跑 | Run 进行中；IM **同时**再发一条同 session 消息 | 重启或并发 dispatch | 第二条路径 `skipped reason=session_exists`；无重复 Run | 02§8.2；S4 | ⚠️ 待实机 |
| H7 | userStopped 不续接 | Run 进行中点 stop/停止会话 | 确认盘记录 `userStopped=true` 后重启 | recover 跳过该条；`listRecoverable*` 不含 | 02§8.2；T6–T8 | ⚠️ 待实机 |
| H8 | 四引擎汇总日志 | 任意盘上有待续接记录 | 重启后查主进程日志 | 一行 `[recover] recoverAllActiveRuns 完成 sdk=… cc=… codex=… opencode=…` | 02§8.2；T12 | ⚠️ 待实机 |
| H9 | Port 终态契约 | 各引擎 Run 正常完成 | 观察终态 IM | 与改前一致；dispatch 成功路径无变化 | 01-5；R5 | ⚠️ 待实机 |

**H1–H4 成功判据**：IM 侧任务继续推进（流式/进度更新），用户**不必**重发触发消息。

**H1–H4 失败判据**：一条中文 IM 含「未能自动续接」与 reason；`stop_progress: true`；盘快照清除或标记不再续接。

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| 重启后完全无续接、无 IM | 盘无快照 / `userStopped` / init 未调 orchestrator |
| 有快照但 resumed=0 且无 IM | guard `busy`/`stale_aborted` skip（正常）或 Codex CLI 早退（04 §3-1） |
| 双条相同 Run 输出 | recover 与 dispatch 双跑；查 `session_exists` skip |
| Cursor 行为变化 | `recoverSdkActiveRuns` 逻辑应未改；仅 notify import |
| OpenCode 续接即失败 | embedded server 未起 / `opencodeSessionId` 失效 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| 自动化 | `npx tsc --noEmit`（全仓类型检查） |
| 可选静态 | `wc -l electron/agent/**/*-run-*.ts electron/agent/shared/agent-run-recover-orchestrator.ts` |
| 日志关键字 | `[recover]`、`recoverAllActiveRuns`、`notifyResumeFailure`、`session_exists` |
| 盘路径 | Electron `userData` 下四份 `*-active-runs.json` |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端日志；§7 备注列仅用结论性短语（如「tsc 通过」「H2 待实机」）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地 | `npx tsc --noEmit` | 通过 | exit 0；无类型错误 |
| 2026-07-12 | 本地静态 | `04-review` 任务 T1–T13 核对 | 通过 | 无阻断项；T10 CLI 早退为警告 |
| 2026-07-12 | 本地静态 | 单文件 ≤300 行（`04` 抽样） | 通过 | 最大 194 行 |
| 2026-07-12 | 本地静态 | orchestrator 四引擎顺序 + catch | 通过 | `agent-run-recover-orchestrator.ts` |
| 2026-07-12 | 本地静态 | `notifyResumeFailure` shared + Cursor import | 通过 | T2 行为不变 |
| 2026-07-12 | 本地静态 | `daemon-manager` `recoverAllActiveRuns` 挂接 | 通过 | T13 单行替换 |
| 2026-07-12 | 待用户 | H1 Cursor 重启续接 | 待实机 | S7 回归 |
| 2026-07-12 | 待用户 | H2 Claude Code 重启续接 | 待实机 | 01 验收 1 |
| 2026-07-12 | 待用户 | H3 Codex 重启续接 | 待实机 | 01 验收 1 |
| 2026-07-12 | 待用户 | H4 OpenCode 重启续接 | 待实机 | embedded 优先 |
| 2026-07-12 | 待用户 | H5–H9 失败/并发/终态 | 待实机 | archive 前建议补一轮 |
