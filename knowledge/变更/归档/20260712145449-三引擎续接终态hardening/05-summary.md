# 三引擎续接终态hardening - 变更总结

> **变更 ID**：`20260712145449-三引擎续接终态hardening`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（archive 步骤 5 完成；知识库正文待 librarian；迁移前 **勿** 标 `archived`）  
> **依赖**：`20260712113332-非Cursor引擎主进程续接`（已归档）  
> **用户可见性**：是 — 三引擎主进程重启续接具备 guard 前探活、依赖缺失 IM、可重试/不可恢复失败分类；Cursor `getRun` 终态路径未改

---

## 1、实际变更

### 1.1 共享层（T1）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/shared/run-resume-notify.ts`（91 行） | 新增 `ResumeFailureCategory`（`retryable` \| `unrecoverable`）、`classifyResumeFailure(engine, detail)`；`notifyResumeFailure(sessionKey, reason, category?)` 第三参默认 `unrecoverable`；IM 尾句区分「重试」/「新任务」 |

**未改（显式）**：`electron/agent/cursor-sdk/sdk-run-recover.ts` — `Agent.getRun` 终态分支与 recover 主路径无 diff；经 shared 默认 category 仅尾句与 R3 对齐。

### 1.2 三引擎 recover + 探活（T2–T4）

| 引擎 | recover | probe（新建） | 关键行为 |
|------|---------|---------------|----------|
| Codex | `codex-run-recover.ts`（166 行） | `codex-run-probe.ts`（72 行） | 移除 CLI 不可用整函数早退；`failAllCodexRunsOnCliMissing` 逐条 notify+clear；guard 前 `probeCodexRecoverTarget` |
| Claude Code | `cc-run-recover.ts`（134 行） | `cc-run-probe.ts`（21 行） | guard 前 `probeCcRecoverTarget`；失败 `classifyResumeFailure` + notify |
| OpenCode | `opencode-run-recover.ts`（209 行） | —（沿用 `probeOpencodeRecoverTarget`） | catch/probe 统一 `classifyResumeFailure`；server 瞬时不可达 → `retryable` |

### 1.3 AGENTS.md（T5）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/shared/AGENTS.md` | 新增「续接失败分类（recover hardening）」：`ResumeFailureCategory` / classify / notify 契约 |
| `electron/agent/claude-code/AGENTS.md` | `cc-run-probe` 挂接、`classifyResumeFailure` 消费约定 |
| `electron/agent/codex/AGENTS.md` | CLI 缺失禁止静默早退、`codex-run-probe`、失败分类 |
| `electron/agent/opencode/AGENTS.md` | 探活与 `classifyResumeFailure` 对齐 |

**未纳入（显式）**：`agent-run-recover-orchestrator.ts` 编排、`daemon-manager.ts` init、`src/bridge/file-queue*`、IM 入队、工作流 Gateway、四引擎 Port 总线。

### 1.4 验收与契约（T6）

| 产物 | 说明 |
|------|------|
| `06-automation-test.md` | ST-R1～ST-R6 追溯与执行记录 |
| `auto_test/run-recover-hardening-contract.sh` / `.mts` | `tsc --noEmit` + 静态契约 + classify/notify mock；**ALL PASS** |

**统计**：2 新建 + 5 修改代码文件 + 4 份 AGENTS；最大单文件 `opencode-run-recover.ts` 209 行（≤300）。

### 1.5 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`、`05-summary.md`（本文件）

---

## 2、与设计差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **Codex 探活手段** | `02` §二禁止为探测单独 `runStreamed` 全量任务 | `codex-run-probe.ts` 空 prompt `runStreamed`，`turn.started`/`thread.started` 后 `abort` | **可接受 ponytail** — SDK 无只读 API；§3.1 已登记升级路径 |
| **CC 探活粒度** | 轻量 resume/只读探活 | `getSessionInfo` 仅校验会话文件存在，非 Run 运行时态 | **可接受** — 引擎能力边界；优于无探测；§3.1 已登记升级路径 |
| **Cursor IM 尾句** | R5 不改 Cursor 业务分支 | 共享 notify 默认 `unrecoverable` 尾句由「继续」→「新任务」 | **轻微可接受** — `sdk-run-recover` 无 diff；R3 产品口径对齐（04 §4-3） |
| **父债 Codex CLI 早退** | 逐条 IM + 清盘 | `failAllCodexRunsOnCliMissing` 实现 | **已清偿** — 禁止再标 `accepted_debt` |
| **其余主路径** | S7/S8a/S9 guard 前 probe、S10 分类 notify、orchestrator/入队不改 | 与 `02` 流程图及对照表一致 | **无功能偏差** |

---

## 3、影响范围

- **模块**：`electron/agent/shared/run-resume-notify.ts`；`claude-code/cc-run-{recover,probe}.ts`；`codex/codex-run-{recover,probe}.ts`；`opencode/opencode-run-recover.ts`；四份引擎/shared `AGENTS.md`。
- **接口**：无新增 HTTP/IPC；进程内扩展 `ResumeFailureCategory`、`classifyResumeFailure`、`probeCcRecoverTarget`、`probeCodexRecoverTarget`；`notifyResumeFailure` 可选第三参。
- **数据**：无 schema 变更；探测/依赖失败加速 `clear*ActiveRun`，减少快照滞留。
- **用户可见**：主进程重启后三引擎续接失败可感知（依赖缺失、终态、可重试/不可恢复）；成功续接主路径 `start*Run` 保留；Cursor `getRun` 终态观感不变。
- **测试**：`tsc --noEmit` + ST-R1～ST-R6 契约 **ALL PASS**（见 `06` §7）；四引擎重启续接实机（01 §6.2.1）建议 archive 前用户补一轮，**非** open 债务。

### 3.1 Ponytail 技术债

本变更 diff 内 `ponytail:` 注释（须含升级路径表）：

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `electron/agent/claude-code/cc-run-probe.ts:15-16` | `getSessionInfo` 仅校验会话文件存在性，非 Run 运行时态 | 若 Claude SDK 暴露等价 `getRun` 只读 API，可替换当前读盘探活 |
| `electron/agent/codex/codex-run-probe.ts:45-46` | Codex SDK 无只读 thread 状态 API，用空 prompt 首事件探活 | 若 SDK 暴露 `getThread` / resume 校验 API，可替换 `runStreamed` 探针 |

**非本表（父变更既有，04 评分不阻断）**：

| 位置 | 摘要 | 升级路径 |
|------|------|----------|
| 四份 `parseRecordChatType` | `sdk-run-recover` + 三引擎 `*-run-recover` 各一份 | 抽到 `agent-launcher` 或 shared 小函数 |
| OpenCode recover | `probeOpencodeRecoverTarget` 与 `startOpencodeRun` 双连 `resolveOpencodeClient` | 探活成功后复用 client bundle 传入 session |

04-review Ponytail 轴：**Lean already. Ship.**

---

## 4、知识库影响清单

> 来源：`02-design.md` §九、§十；由 **kb-librarian** 在 archive 步骤 6 落盘（本步骤 **不写** 业务域正文）。下列「建议落点」供 builder/reviewer 与 librarian 对齐。

### （一）必须更新

- [ ] `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md`
  - **建议落点**：§二 recover 主路径 — guard 前 `probeCcRecoverTarget`（`cc-run-probe.ts`）；§七 非功能 — `classifyResumeFailure` / IM 尾句；§十 变更记录（2026-07-12 hardening）
- [ ] `knowledge/业务域/Agent调度/08-CodexSDK执行引擎.md`
  - **建议落点**：§二 recover — CLI 缺失 `failAllCodexRunsOnCliMissing`（**不再**静默早退）；§二 probe — `codex-run-probe.ts`；§七 / §十 同步父债清偿与 ponytail
- [ ] `knowledge/业务域/Agent调度/03-启动与自动重连.md`
  - **建议落点**：§二 S7 `recoverAllActiveRuns` — 补一句三引擎 guard 前探活 + 失败分类 IM；链至 07–09

### （二）可能更新（视 librarian 合并结果）

- [ ] `knowledge/业务域/Agent调度/09-OpenCodeSDK执行引擎.md`
  - **建议落点**：§二 `probeOpencodeRecoverTarget` + `classifyResumeFailure` 对齐表；server 瞬时 → `retryable`
- [ ] `knowledge/业务域/Agent调度/10-SDK上下文保护与失败归因.md`
  - **建议落点**：§二 `notifyResumeFailure` 四引擎对称 — `ResumeFailureCategory` 与尾句表；Cursor 默认 `unrecoverable` 说明
- [ ] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md`
  - **建议落点**：§二 注明 Cursor `getRun` 终态未改；shared notify 尾句随 R3 对齐一句
- [ ] `knowledge/业务域/Agent调度/01-概览.md`
  - **建议落点**：§五 关键约束 — 三引擎续接终态可观测口径（若与现网表述不一致）

### （三）不需要更新

- [x] `knowledge/业务域/Agent调度/02-多会话模型.md`、`04-远程指令.md`、`05-定时任务.md` — 01 R6 明确不在范围
- [x] `knowledge/工程平台/**` — 无 Daemon HTTP/客户端结构变更
- [x] IM 入队 / 消息队列相关文档 — ST-R6 确认未改 `file-queue` / dispatch 主路径
- [x] `knowledge/知识索引.md` — 入口结构无变化（archive 后由 librarian 核实 §五约束再决定是否同步 Agent 调度入口描述）

### （四）代码侧 AGENTS（已随 apply）

- [x] `electron/agent/shared/AGENTS.md`、`claude-code/AGENTS.md`、`codex/AGENTS.md`、`opencode/AGENTS.md` — 已更新；librarian 写知识正文时须与代码约定对齐

---

## 5、验收与遗留债务

| 维度 | 状态 |
|------|------|
| **T1–T5** | done（manifest `tasks[]`；04-review 通过） |
| **T6 / ST-R1～ST-R6** | done — 契约脚本 ALL PASS（`06` §7） |
| **04-review** | ✅ 通过；严重 0、警告 0、open 0、`accepted_debt` 0 |
| **父债清偿** | ✅ `20260712113332` Codex CLI 静默早退（T-FIX-01）— `reviews[].parent_debt_closed` |
| **01 §6.2.1 实机续接** | ⚠️ 建议用户 archive 前补一轮；契约已覆盖主路径静态挂接，**非** blocking 债务 |
| **知识库 R1–R3** | ⏳ 待 librarian 步骤 6（非代码债） |

### 遗留债务

**无** — 禁止将父债 Codex CLI 早退再登记为 `accepted_debt`。

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并同步 `manifest.files`；**保持 `stage=tested`**。
- **暂勿** `mv` 至归档、**暂勿** commit/push、**暂勿** 标 `archived`（迁移与 stage 收尾归 release/librarian）。
- 下一步：kb-librarian 按 §4 更新 Agent 调度知识正文 → archive 步骤 7+ 迁移与提交。
