# 消息队列模块拆分 - 验收记录

> **口径**：`01` §六、`02` §八·（二）ST-Q1～ST-Q7、`03` T9  
> **策略**：**临时目录磁盘行为冒烟 + 静态接线 + 行数 + `tsc --noEmit`**（已执行）；**可选 Daemon E2E**（实机 IM 入队补强，非 archive 阻断）

## 1、测试策略与范围

| 维度 | 说明 |
|---|---|
| 验收目标 | 拆分后入队/claim/ack/release 语义与现契约一致；对外 `file-queue.js` import 零变更；单文件 ≤300 行 |
| 层级 | **契约脚本**（进程内临时 `APP_DATA_DIR` 磁盘操作 + 源码静态）+ **构建冒烟**（`tsc`）+ **可选 Daemon E2E** |
| 主证据 | `run-file-queue-split-contract.sh` 全绿；`tsc --noEmit` exit 0 |
| 与 01 关系 | ST-Q* 逐条对应 §6.1.1～6.3 与 §6.2 结构合规 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 | 残留风险 |
|---|---|---|
| E2E 飞书/微信实机入队 | 需通道凭据与 Daemon 长驻 | 契约已证核心 rename/ack/release 原语；通道层仍经 `daemon.ts` 同一 import |
| 并发双进程 claim 竞态 | 需多进程压测 | rename 原子性为既有语义；本变更纯搬移 |
| orchestrator-retry 重试窗口 | 归父债 #1，本变更零改 | release/ack 接线经 deps 注入，路径未变 |
| 知识库 `04-消息队列与路由.md` | `02` §十 归 `/kb-archive` | archive 前文档与代码短暂不一致 |

## 3、验收追溯表

| 验收点（01/02/03） | 方式 | 自动化/手工 | 证据类型 |
|---|---|---|---|
| 01 §6.1.1 行为回归 / S1 / ST-Q1 | 契约磁盘 | **自动化** | push→claim→ack；unclaimed 计数一致 |
| 01 §6.1.1 失败 release / S2 / ST-Q2 | 契约磁盘 | **自动化** | release 后 `.qmsg` 恢复并可再 claim |
| 01 §6.1.2 ack 不退化 / S3 / ST-Q3 | 契约磁盘 | **自动化** | cutoff 删 claimed；未 claim `.qmsg` 保留；重复 ack `[]` |
| 01 §6.1.3 格式兼容 / R4 / ST-Q4 | 契约磁盘 | **自动化** | 遗留旧 JSON + `.claimed` 无迁移可读 |
| 01 §6.2 结构合规 / S4 / ST-Q5 | 契约脚本 | **自动化** | 8 个 `file-queue*.ts` 均 ≤300；入口无函数体 |
| 01 §6.3 工程规范 / ST-Q6 | 契约脚本 | **自动化** | lifecycle 中文划界注释；AGENTS 子模块表；`tsc` 绿 |
| 对外 import 不变 / R2 / ST-Q7 | 契约静态 | **自动化** | `daemon.ts` 等仍 `../bridge/file-queue.js`；claim↔lifecycle 无环引 |
| T1～T8 实现 | `04-review.md` | **评审已通过** | 静态核对 ✅ |
| T9 ST-Q 回归 | 本文件 §7 | **已执行** | 契约全绿 |

## 4、场景摘要

### 4.1 可选手工 E2E（Daemon 实机）

| ID | 场景 | 前置 | 触发 | 期望 | 失败判责 |
|---|---|---|---|---|---|
| E2E-Q1 | IM 入队→调度→回复 ack | Daemon + 通道 | 发一条 IM 消息并等 Agent 回复 | F1 排队归零；`.claimed` 清除 | 仍卡 claimed→查 orchestrator ack 路径 |
| E2E-Q2 | dispatch 失败 release | 父债 retry 已接线 | HTTP dispatch 可恢复失败 | `.claimed→.qmsg`；窗口内再调度 | 查 `releaseClaimedMessages` deps 注入 |
| E2E-Q3 | 冷启动 orphan 回收 | 杀进程留 `.claimed` | 重启 Daemon | `cleanupOrphanClaimedOnColdStart` 还原 | 查 `initQueue` 调用 |

### 4.2 契约冒烟（已执行）

| ID | 核对点 | 命令 | 期望 | 结果 |
|---|---|---|---|---|
| CT-1 | ST-Q1～Q4 磁盘行为 | `run-file-queue-split-contract.sh` | 主路径/release/ack/遗留格式 | **通过** |
| CT-2 | ST-Q5 行数 + 组装瘦身 | 同上 | 各子模块 ≤300；`file-queue.ts` 仅 re-export | **通过** |
| CT-3 | ST-Q6 工程规范 | 同上（含 `tsc`） | 中文注释 + `tsc --noEmit` exit 0 | **通过** |
| CT-4 | ST-Q7 import 静态 | 同上 | daemon 不直引 `file-queue-*`；无环引 | **通过** |

### 4.3 ST-Q 结果一览

| ID | 对齐 | 摘要 | 结果 |
|---|---|---|---|
| ST-Q1 | 01 §6.1.1 / S1 | 入队→claim→ack 全链路 | **通过** |
| ST-Q2 | 01 §6.1.1 / S2 | release 后再 claim 同 id | **通过** |
| ST-Q3 | 01 §6.1.2 / S3 | ack cutoff；不误删 `.qmsg`；重复 ack `[]` | **通过** |
| ST-Q4 | 01 §6.1.3 / R4 | 遗留 `.qmsg`/旧 JSON 无迁移 | **通过** |
| ST-Q5 | 01 §6.2 / S4 | 最大 196 行（query）；入口 40 行 | **通过** |
| ST-Q6 | 01 §6.3 | 中文注释 + `tsc` | **通过** |
| ST-Q7 | R2 | `daemon.ts` 等 5 处仍 `file-queue.js` | **通过** |

## 5、脚本位置与环境

| 项目 | 说明 |
|---|---|
| 入口 | `auto_test/run-file-queue-split-contract.sh` |
| 实现 | `auto_test/run-file-queue-split-contract.mts` |
| 运行 | 仓库根目录执行上述 `.sh`；依赖 `tsx` + 归档 `electron-import-hook.mjs` |
| 环境变量 | 脚本内临时设置 `APP_DATA_DIR`；**不写密钥** |
| 副作用 | 临时目录自动删除；**不写现网队列** |
| 可选 E2E | Daemon 端口、`CLAW_*` 按现网；见 §4.1 |

## 6、输出与记录规范

执行记录仅表格一行一次（命令/结果/结论短语）；**禁止**粘贴完整终端或含 token 日志。

## 7、执行记录

| 日期 | 环境 | 命令/动作 | 结果 | 备注 |
|---|---|---|---|---|
| 2026-07-12 | 本地（kb-test） | `run-file-queue-split-contract.sh` | 通过 | ST-Q1～Q7 契约全绿 |
| 2026-07-12 | 本地（kb-test） | `npx tsc --noEmit`（脚本内复跑） | 通过 | ST-Q6 |
| 2026-07-12 | — | E2E-Q1～Q3（可选） | 未执行 | 不阻断 tested；上线前可补强 |
