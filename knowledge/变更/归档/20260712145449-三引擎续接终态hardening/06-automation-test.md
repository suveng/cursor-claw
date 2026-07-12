# 三引擎续接终态hardening - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` §6.1–6.3、`02-design.md` §八·（二）、`03-tasks.md` T6（ST-R1～ST-R6）、`04-review.md`（通过）
> **父变更**：`20260712113332-非Cursor引擎主进程续接`（Codex CLI 早退父债已清偿）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | `tsc --noEmit` + 源码静态契约 + `classifyResumeFailure`/`notifyResumeFailure` mock IM；四引擎重启续接端到端为可选补证 |
| **目标** | 验证三引擎 guard 前探活、Codex CLI 缺失可感知、失败分类 IM、成功续接主路径、Cursor 无回归、范围未扩大 |
| **与验收关系** | ST-R* 对应 `03` T6 与 `01` §6；T1–T5 以契约为辅证 |
| **本期执行** | `auto_test/run-recover-hardening-contract.sh`（含 `tsc`）；**ALL PASS** |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 四引擎重启后真实 Run 续接成功（01 §6.2.1） | 需 Electron 启停 + 各引擎 SDK + IM 通道 | 探活过严误杀可续接 Run（02 §八·（一）已偏 retryable 缓解） |
| Codex 空 prompt 探活运行时副作用 | 契约仅静态挂接；无 live thread | ponytail 已注释升级路径（04 §4） |
| CC `getSessionInfo` 非 Run 运行时态 | 引擎能力边界；优于无探测 | ST-R1 手工补证仍建议 archive 前覆盖 |
| Cursor IM 尾句「新任务」vs 改前「继续」 | 共享 notify 默认 category 对齐 R3；`getRun` 未改 | 产品口径变更非功能回归（04 §4-3） |

## 3、验收追溯表

| ID | 验收摘要（01/02/03） | 验证方式 | 证据类型 | 状态 |
|----|---------------------|----------|----------|------|
| ST-R1 | 三引擎「已结束+有快照」probe + 终态分类 | 静态 probe 顺序 + classify 映射 | 契约脚本 | ✅ |
| ST-R2 | Codex CLI 缺失逐条 IM + 清盘 | 静态 `failAllCodexRunsOnCliMissing` | 契约脚本 | ✅ |
| ST-R3 | retryable vs unrecoverable 文案可辨 | classify + notify mock | 契约脚本 | ✅ |
| ST-R4 | 成功续接主路径 `start*Run` 保留 | 静态 grep + orchestrator | 契约脚本 | ✅ |
| ST-R5 | Cursor `getRun` 无业务回归 | 静态 + `git diff` 空 | 契约脚本 | ✅ |
| ST-R6 | 未改 IM 入队/队列/Gateway | 静态 `file-queue`/`daemon`/`orchestrator` | 契约脚本 | ✅ |
| T1 | `ResumeFailureCategory` + notify 扩展 | 合成 ST-R3 | — | ✅ |
| T2 | Codex CLI + probe | 合成 ST-R1/ST-R2 | — | ✅ |
| T3 | CC probe 挂接 | 合成 ST-R1 | — | ✅ |
| T4 | OpenCode 分类对齐 | 合成 ST-R1/ST-R3 | — | ✅ |
| T5 | 四份 AGENTS hardening | `04-review` 已勾选 | review | ✅ |
| T6 | ST-R 全清单 + `tsc` | 本脚本 + §7 | 契约 | ✅ |
| 01§6.1.1 | 终态可观测 R1 | ST-R1 | 契约 | ✅ |
| 01§6.1.2 | 依赖缺失通知 R2 | ST-R2 | 契约 | ✅ |
| 01§6.1.3 | 失败可区分 R3 | ST-R3 | 契约 | ✅ |
| 01§6.2.1 | 续接主路径不冲突 R4 | ST-R4；实机待补 | 契约+手工 | ⚠️ 实机待补 |
| 01§6.2.2 | Cursor 无回归 R5 | ST-R5 | 契约 | ✅ |
| 01§6.2.3 | 非目标未扩大 R6 | ST-R6 | 契约 | ✅ |
| 02§八·二 | 单文件 ≤300 行 | 契约行数扫描 | 契约 | ✅ |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| 构建 | `npx tsc --noEmit -p tsconfig.json`（脚本自动执行） |
| 契约 | `bash auto_test/run-recover-hardening-contract.sh` |
| Electron 实机（可选） | 主进程可重启；Daemon 保持运行；至少一条 IM 通道 |
| 盘快照 | `{userData}/*-active-runs.json` 可观察（勿粘贴凭据） |

### 4.2 ST-R 冒烟清单

| # | 场景 | 前置 | 操作 | 期望 | 本期 |
|---|------|------|------|------|------|
| ST-R1 | 三引擎 guard 前 probe | 源码就绪 | 契约静态 + classify | probe 在 guard 前；失效→unrecoverable | ✅ |
| ST-R2 | Codex CLI 缺失 | 源码就绪 | 静态 `failAllCodexRunsOnCliMissing` | 逐条 notify+clear；无整函数早退 | ✅ |
| ST-R3 | 失败分类 IM | mock daemon-client | notify retryable/unrecoverable | 尾句含「重试」/「新任务」；`stop_progress: true` | ✅ |
| ST-R4 | 成功续接主路径 | 源码就绪 | grep `start*Run` | CC/Codex/OpenCode recover 仍调用 start | ✅ |
| ST-R5 | Cursor 回归 | 源码 + git | `Agent.getRun` 分支；sdk-run-recover 无 diff | 与父变更一致 | ✅ |
| ST-R6 | 范围克制 | 源码就绪 | orchestrator/入队无 probe | 编排与 IM 入队未改 | ✅ |

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| ST-R1 probe 在 guard 之后 | recover 挂接顺序回归 |
| CLI 缺失无 IM | `failAllCodexRunsOnCliMissing` 未遍历 |
| 可续接 Run 被判死 | `classifyResumeFailure` 过严；查是否应 retryable |
| Cursor 行为变化 | `sdk-run-recover.ts` 不应有 diff |
| 双条续接失败 IM | `notifyResumeFailure` 重复调用 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/run-recover-hardening-contract.sh` | 入口：`tsc --noEmit` → `.mts` |
| `auto_test/run-recover-hardening-contract.mts` | ST-R1～ST-R6 静态 + classify/notify mock |
| Hook | 复用 `knowledge/变更/归档/20260711232258-…/auto_test/electron-import-hook.mjs` |
| 环境变量 | `KB_CONTRACT_USER_DATA`（electron stub，可选） |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端日志；§7 备注列仅用结论性短语。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地 | `npx tsc --noEmit -p tsconfig.json` | 通过 | ST-R6 工程项 |
| 2026-07-12 | 契约脚本 | ST-R1 probe 挂接与终态分类 | 通过 | 三引擎 guard 前 |
| 2026-07-12 | 契约脚本 | ST-R2 Codex CLI 缺失路径 | 通过 | 父债清偿 |
| 2026-07-12 | 契约脚本 | ST-R3 失败分类 IM mock | 通过 | 重试/新任务尾句 |
| 2026-07-12 | 契约脚本 | ST-R4 成功续接主路径 | 通过 | start*Run 保留 |
| 2026-07-12 | 契约脚本 | ST-R5 Cursor 无回归 | 通过 | sdk-run-recover 无 diff |
| 2026-07-12 | 契约脚本 | ST-R6 范围克制 | 通过 | 入队/orchestrator 未改 |
| 2026-07-12 | 契约脚本 | 单文件 ≤300 行 | 通过 | 最大 opencode-recover 209 行 |
| 2026-07-12 | 契约脚本 | `run-recover-hardening-contract.sh` 全量 | 通过 | ALL PASS |
| 2026-07-12 | 待用户 | 四引擎重启续接实机（01§6.2.1） | 待实机 | archive 前建议补一轮 |
