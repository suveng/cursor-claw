# Claude Code 飞书通知对齐 Cursor SDK - 验收记录

> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **范围**：`tsc` + shared 层冒烟（E6）+ CC 静态核对；E1–E5 / 01·1–5 真机由用户指令跳过；T7 archive 不在本阶段
> **归档说明**：用户 2026-07-05 明确要求 archive+push；自动化与静态已 PASS，E1–E5 飞书 E2E 未阻断 `/kb-archive`（留待后续补证）

## 1、测试策略与范围

| 层级 | 覆盖 | 说明 |
|------|------|------|
| **编译** | 全仓 `npx tsc --noEmit` | 阻断项；证明 T1–T6 类型与 import 无回归 |
| **冒烟** | `normalizePresentationToolName` / `resolveSdkToolPresentationTier` / `extract*` | E6；`npx tsx -e` inline，无 `auto_test/` |
| **静态核对** | CC 无飞书早退；silent 跳过 mark+POST；dedup/reset 字段 | grep + 源码精读，替代部分 E1/E3 代码路径证据 |
| **手工 E2E** | E1–E5 飞书私聊 CC vs SDK 并排 | 01 验收 1–5；须本地 Electron + 飞书凭据 |
| **不测** | daemon 改动、Codex/OpenCode、T7 知识库/changelog | 02/03 明确范围外 |

**目标**：证明 shared 契约与 CC 出站门控代码正确；IM 过程条数、里程碑文案、ordering 时序原须真机补证，现按用户指令跳过、不阻断 archive。

## 2、局限与未自动化原因

**归档推进**：用户 2026-07-05 指令「做完后提交归档, push」；`tsc`、E6 冒烟、静态核对均已 PASS，E1–E5 / 01·1–5 记为「用户指令跳过真机」，不阻断 `/kb-archive`；飞书 E2E 留待后续补证。

| 未覆盖项 | 原因 |
|----------|------|
| E1 HTTP POST 可见性 | 需 Daemon 锁文件 + 飞书通道运行时；Network 观察不可 headless |
| E2 thinking 零飞书里程碑 | daemon 侧 gate，须 IM 真机感知 |
| E3 Read/Glob 无 tool 里程碑 | 多步 CC Run + 飞书过程流对比 |
| E4 Bash/Task started 摘要 | 须飞书里程碑文案目视 |
| E5 相邻 Bash 不双推 | 须同参连续 running 真机；W1 `tool_progress` args 边界待观察 |
| 01 验收 3 ordering 时序 | PRESENTATION_ORDERING + p2p；02 R4 已知不对称（W5） |
| 01 验收 5 多引擎并排 | CC vs SDK 同任务飞书对照 |
| 01 验收 6 / T7 | 归 `/kb-archive` |

**残留风险**：代码层与评审一致；E1–E5 真机未执行（用户指令跳过）；W1 若后续 E5 复现需 T-FIX。

## 3、验收追溯表

| 来源 | 验收项 | 验证方式 | 证据类型 | 状态 | 备注 |
|------|--------|----------|----------|------|------|
| — | `tsc --noEmit` | 自动化 | exit 0 | **PASS** | |
| E6 / T2 | `Bash→shell→notify`；`Read→read→silent` | S-A 冒烟 | tsx inline 7/7 | **PASS** | |
| E6 / T2 | `extractShell`/`extractTask` 字段 | S-A 冒烟 | tsx inline | **PASS** | |
| T1 | shared dedup + SDK re-export | 04-review + 静态 | 评审表 | **PASS** | |
| T3 | `resetCcRunPresentationState` 清零 | grep `agent-cc-utils.ts` | 静态 | **PASS** | |
| T4 | 无 `feishuSuppressesProcessKind` 早退 | grep CC 目录零命中 | 静态 | **PASS** | |
| T4 | `markProcessEventSeen(session, kind)` | grep 调用点 | 静态 | **PASS** | |
| T5 | silent 跳过 mark+POST | `agent-cc-presentation-tool.ts` L51–67 | 静态 | **PASS** | |
| T5 | notify 透传 shell/task 字段 | 同上 + extract | 静态 | **PASS** | |
| T6 | CC AGENTS §Presentation | 04-review | 评审表 | **PASS** | |
| E1 | CC Run 仍 HTTP POST | S-B 手测 | Network/日志 | **用户指令跳过真机** | 用户 2026-07-05 archive+push；自动化+静态 PASS；E2E 留待后续补证 |
| E2 | thinking 零飞书里程碑 | S-C 手测 | IM 观察 | **用户指令跳过真机** | 同上 |
| E3 | Read/Glob 无里程碑 | S-D 手测 | IM 过程流 | **用户指令跳过真机** | 同上 |
| E4 | Bash/Task started 摘要 | S-E 手测 | 里程碑文案 | **用户指令跳过真机** | 同上 |
| E5 | 相邻 Bash 不双推 | S-F 手测 | IM 条数 | **用户指令跳过真机** | 同上（W1 边界未观测） |
| 01·1 | 分级一致 CC vs SDK | S-D + S-E | 并排对照 | **用户指令跳过真机** | 同上 |
| 01·2 | 开始态文案对称 | S-E | 里程碑 | **用户指令跳过真机** | 同上 |
| 01·3 | thinking 静默 + 编排 | S-C | IM 时序 | **用户指令跳过真机** | 同上 |
| 01·4 | 去重有效 | S-F | IM 条数 | **用户指令跳过真机** | 同上 |
| 01·5 | 多引擎用户预期 | S-G | CC/SDK 切换 | **用户指令跳过真机** | 同上 |
| 01·6 / T7 | 知识库契约 | archive | — | **待 archive** | |
| 04·W1 | tool_progress dedup args | S-F 顺带 | 真机 | **用户指令跳过真机** | 随 E5/S-F 跳过 |
| 04·W5 | CC mid-run release | S-C ordering | 时序 | **用户指令跳过真机** | 随 E2/S-C 跳过 |

## 4、场景摘要

### 4.1 S-A：normalize/tier/extract 冒烟（已执行）

| 项 | 内容 |
|----|------|
| **前置** | 仓库根；Node + tsx |
| **触发** | §5 inline 命令 |
| **期望** | Bash/Shell→shell notify；Read/Glob→silent；extractShell `ls`；extractTask `修复测试`；exit 0 |
| **判责** | 断言失败 → `tool-presentation.ts` / `sdk-tool-presentation-tier.ts` |

### 4.2 S-B：E1 presentation-event POST（待手工）

| 项 | 内容 |
|----|------|
| **前置** | Electron + Daemon 运行；飞书私聊 CC 引擎 |
| **触发** | 含 notify 工具（Bash/Write）的短任务 |
| **期望** | Network/日志可见 `POST /api/presentation-event`；**无** Electron 层 channel 早退 |
| **静态替代** | `postPresentationEvent` 仅 `readLockFile` 缺 port 早退，无飞书 gate |

### 4.3 S-C：E2 thinking 零里程碑 + 编排（待手工）

| 项 | 内容 |
|----|------|
| **前置** | 飞书私聊；`PRESENTATION_ORDERING` 开启（p2p） |
| **期望** | 飞书**无** thinking 里程碑；task/notify 工具与 assistant 顺序符合 ordering 目标 |
| **静态替代** | thinking 路径仍 `markProcessEventSeen("thinking")` + POST；daemon 抑制出站 |

### 4.4 S-D：E3 只读探查静默（待手工）

| 项 | 内容 |
|----|------|
| **前置** | 任务含多次 Read/Glob |
| **期望** | 飞书无 read/glob 过程里程碑；Electron UI 仍有 `[tool] read: running` |
| **静态替代** | `tier === "silent"` 分支不调用 mark+POST（`agent-cc-presentation-tool.ts` L51–67） |

### 4.5 S-E：E4 开始态文案（待手工）

| 项 | 内容 |
|----|------|
| **前置** | Bash `command` + Task `description`（或无描述 Task） |
| **期望** | 里程碑含命令摘要/任务描述或 `#N` 序号降级；与 SDK 同场景对称 |

### 4.6 S-F：E5 去重（待手工）

| 项 | 内容 |
|----|------|
| **前置** | 连续两次相同参数 Bash running |
| **期望** | 相邻同参不重复 IM 推送；留意 W1 `tool_progress` 二次 running |
| **静态替代** | `isDuplicateToolCallRunning` 在 tier 判断前短路日志与 POST |

### 4.7 S-G：多引擎并排（待手工）

| 项 | 内容 |
|----|------|
| **前置** | 同任务分别用 Cursor SDK 与 Claude Code |
| **期望** | 分级、开始态、条数原则一致；无引擎切换反差 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **位置** | 无 `auto_test/`；inline 冒烟 + 编译 |
| **编译** | `npx tsc --noEmit` |
| **冒烟** | `npx tsx -e` 导入 `./src/shared/tool-presentation.ts` 与 `sdk-tool-presentation-tier.ts`，断言 Bash/Read/Shell/Task/Glob tier 与 extract 字段（见 §7 执行记录） |
| **静态** | `rg 'feishuSuppressesProcessKind|isFeishuProcessPresentationSuppressed' electron/agent/claude-code` → 零命中 |
| **环境变量** | 冒烟无；E2E 需本地 IM 凭据（不可写入 KB） |
| **副作用** | 无 |

## 6、输出与记录规范

**原则**：会话与本文档均禁止粘贴完整终端日志；执行记录仅用表格概括（日期、环境、命令、结果、备注）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-05 | 本地 dev / 仓库根 | `npx tsc --noEmit` | **PASS** | exit 0 |
| 2026-07-05 | 本地 dev / 仓库根 | S-A normalize/tier/extract 冒烟 | **PASS** | 7/7 断言；exit 0 |
| 2026-07-05 | 本地 dev | 静态：CC 无飞书早退 grep | **PASS** | CC 目录零命中 |
| 2026-07-05 | 本地 dev | 静态：silent 跳过 mark+POST | **PASS** | `agent-cc-presentation-tool.ts` L51–67 |
| 2026-07-05 | 本地 dev | 静态：reset 清零 taskSeq/dedupKey | **PASS** | `agent-cc-utils.ts` L121–122 |
| 2026-07-05 | — | S-B～S-G 飞书 E2E（E1–E5、01·1–5） | **用户指令跳过真机** | 用户 2026-07-05 archive+push；自动化+静态 PASS；E2E 留待后续补证 |
| 2026-07-05 | — | T7 知识库/changelog | **跳过** | 归 `/kb-archive` |
