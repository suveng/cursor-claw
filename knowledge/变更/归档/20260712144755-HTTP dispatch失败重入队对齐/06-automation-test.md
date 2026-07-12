# HTTP dispatch失败重入队对齐 - 验收记录

> **口径**：`01` §六、`02` §八·（二）ST-H1～ST-H7、`03` T6  
> **策略**：**静态契约 + retry 模块 mock 冒烟 + `tsc --noEmit`**（已执行）；**可选手工 E2E**（Daemon 实机补强，非 archive 阻断）

## 1、测试策略与范围

| 维度 | 说明 |
|---|---|
| 验收目标 | HTTP `POST /api/agent/dispatch` 失败/busy 与 IM launch **共用** `handleLaunchFailure`：release + 有限重试 + 耗尽停试 ack；成功不提前 ack |
| 层级 | **契约脚本**（源码接线 + mock retry）+ **构建冒烟**（`tsc`）+ **可选 Daemon E2E**（E2E-H*） |
| 主证据 | `run-http-dispatch-retry-contract.sh` 全绿；`tsc --noEmit` exit 0；父债 D1 HTTP 内联 ack 已删除 |
| 与 01 关系 | ST-H* 逐条对应 §6.1.1～6.3；清偿父债 `20260711232817` D1 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 | 残留风险 |
|---|---|---|
| E2E-H1～H4 磁盘 `.claimed→.qmsg` | 需 Daemon + Electron + 可写队列目录 | 契约已证 HTTP 接线与 retry SSOT；磁盘 rename 由父债 `releaseClaimedMessages` 原语保证 |
| E2E-H5 同 session 先 HTTP 后 IM 共用 attempt | 需双入口实机交错失败 | 静态证同一 `dispatchRetry` 实例；mock 证计数/退避常量一致 |
| E2E-H3 成功无重复执行 | 需一次完整 dispatch + stream final | 静态证成功分支仅 `clearDispatchRetryAttempt`、路由无 ack |
| `daemon.ts` 行数 | 批2 组装文件约 1888 行（既有） | 本变更仅增 deps 接线两行，不扩 scope 拆分 |
| 知识库 R3 正文 | `02` §十 归 `/kb-archive` | archive 前文档与代码短暂不一致 |

## 3、验收追溯表

| 验收点（01/02/03） | 方式 | 自动化/手工 | 证据类型 |
|---|---|---|---|
| 01 §6.1.1 失败可重试 / ST-H1 | 契约静态 + mock | **自动化** | 路由调 `handleLaunchFailure`；mock `retried` + `dispatch_retry_scheduled` + release |
| 01 §6.1.2 耗尽可感知 / ST-H2 | 契约 mock | **自动化** | `dispatch_retry_exhausted` + 停试通知 + ack |
| 01 §6.1.3 成功最终 ack / ST-H3 | 契约静态 + mock | **自动化** | 成功 `clearDispatchRetryAttempt`；路由无 ack；`clearAttempt` 后仍可重试 |
| 01 §6.1.4 busy 可再调度 / ST-H4 | 契约静态 + mock | **自动化** | 无独立 `scheduleBusyRetry`；`agent_busy_requeue` + release |
| 01 §6.2.1 IM/HTTP 语义一致 / ST-H5 | 契约静态 + mock | **自动化** | 同一 `dispatchRetry.handleLaunchFailure`；`MAX_DISPATCH_RETRIES=3`；退避 600/1200/2400 |
| 01 §6.2.2 契约形状不变 / ST-H6 | 契约静态 | **自动化** | `deps.json(res, result, result.ok ? 200 : 400)` |
| 01 §6.3 工程规范 / ST-H7 | 契约脚本 | **自动化** | orchestrator 294 / routes 148 / types 66 行；`tsc` 绿 |
| T1～T5 实现 | `04-review.md` | **评审已通过** | 静态核对 ✅ |
| 父债 D1 HTTP 旁路 | 本变更 | **已清偿** | 删除内联 ack；改调 `handleLaunchFailure` |
| E2E-H1～H5（可选） | 手工 | **可选补强** | 见 §4.1；不阻断 archive |

## 4、场景摘要

### 4.1 可选手工 E2E（Daemon 实机）

| ID | 场景 | 前置 | 触发 | 期望 | 失败判责 |
|---|---|---|---|---|---|
| E2E-H1 | HTTP 瞬时失败可恢复 | Daemon + Agent；队列可写 | `POST /api/agent/dispatch` 制造可恢复失败 | `.claimed→.qmsg`；日志 `dispatch_retry_scheduled`；窗口内再调度 | 仍 ack→查路由是否误走旧路径 |
| E2E-H2 | HTTP 耗尽停试 | 可持续失败 | 同 session 连续失败至上限 | `dispatch_retry_exhausted`；停试通知；无轰炸 | 无限重试→attempt 未共享 |
| E2E-H3 | HTTP 成功不双跑 | 正常可 dispatch | 一次成功 + stream final | 无提前 ack；无重复 claim | 误 release→查成功分支 |
| E2E-H4 | HTTP busy 释放 | Agent 返回 busy | dispatch busy | `agent_busy_requeue`；`.claimed→.qmsg` | 卡 claimed→未 release |
| E2E-H5 | 跨入口 attempt 共享 | 同 session | HTTP 失败后 IM launch 再失败 | 共用计数/退避日志一致 | 第二套计数器→接线错误 |

### 4.2 契约冒烟（已执行）

| ID | 核对点 | 命令 | 期望 | 结果 |
|---|---|---|---|---|
| CT-1 | ST-H1～H6 源码接线 | `run-http-dispatch-retry-contract.sh` | 路由/类型/orchestrator/AGENTS 符合 `02` | **通过** |
| CT-2 | ST-H1/H2/H3/H4 retry 行为 | 同上（mock `createDispatchRetry`） | release/日志/耗尽/ busy 与 IM SSOT 一致 | **通过** |
| CT-3 | ST-H7 行数 + tsc | 同上 | 改动文件 ≤300；`tsc --noEmit` exit 0 | **通过** |

### 4.3 删除项确认（父债 D1）

| 项 | 期望 | 结果 |
|---|---|---|
| HTTP dispatch 内联 `ackMessages` | 不存在于 dispatch 路由块 | **通过** |
| HTTP busy 仅 `scheduleBusyRetry` 无 release | 不存在于 dispatch 路由块 | **通过** |

## 5、脚本位置与环境

| 项目 | 说明 |
|---|---|
| 入口 | `auto_test/run-http-dispatch-retry-contract.sh` |
| 实现 | `auto_test/run-http-dispatch-retry-contract.mts` |
| 运行 | 仓库根目录执行上述 `.sh`；依赖 `tsx` + 归档/进行中 `electron-import-hook.mjs` |
| 环境变量 | 无新增必填；**不写密钥** |
| 副作用 | 只读源码 + 进程内 mock；**不写队列目录** |
| 可选 E2E | Daemon 端口、`CLAW_*` 通道配置按现网；见 §4.1 |

## 6、输出与记录规范

执行记录仅表格一行一次（命令/结果/结论短语）；**禁止**粘贴完整终端或含 token 日志。

## 7、执行记录

| 日期 | 环境 | 命令/动作 | 结果 | 备注 |
|---|---|---|---|---|
| 2026-07-12 | 本地（kb-test） | `run-http-dispatch-retry-contract.sh` | 通过 | ST-H1～H7 契约全绿 |
| 2026-07-12 | 本地（kb-test） | `npx tsc --noEmit`（脚本内复跑） | 通过 | ST-H7 |
| 2026-07-12 | 本地（kb-test） | ST-H1～H6 静态源码核对 | 通过 | CT-1 |
| 2026-07-12 | 本地（kb-test） | ST-H1/H2/H3/H4 mock retry | 通过 | CT-2 |
| 2026-07-12 | — | E2E-H1～H5（可选） | 未执行 | 不阻断 archive；上线前可补强 |
