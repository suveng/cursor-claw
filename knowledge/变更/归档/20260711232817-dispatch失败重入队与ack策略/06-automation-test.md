# dispatch失败重入队与ack策略 - 验收记录

> **口径**：`01` §六·1～3、`02` §八·（二）、`03` T1/T2；`04` 结论「通过（有债）」  
> **策略**：**静态冒烟 + `tsc --noEmit` + 符号/日志关键字核对**（已执行）+ **手工 E2E**（主路径必须）；无本变更 `auto_test/`；不新增单测脚手架

## 1、测试策略与范围

| 维度 | 说明 |
|---|---|
| 验收目标 | launch 编排路径：调度失败不丢消息；busy/瞬时失败 release + 有限重试；耗尽停试可感知；成功路径不提前 ack |
| 层级 | **构建/类型冒烟** + **源码契约静态核对** + **T1 本地队列原语实测（apply 期）** + **手工 E2E**（E2E-1～4） |
| 主证据 | `tsc --noEmit` 通过；`releaseClaimedMessages` / retry 常量与日志关键字就位；`daemon.ts` 已注入 deps；T1 claim→release 磁盘实测 |
| 不覆盖 | HTTP `POST /api/agent/dispatch` 旁路旧逻辑（04 §7 D1，范围外）；知识库 R3 正文（归 archive）；飞书卡片 UI |

## 2、局限与未自动化原因

| 未自动化项 | 原因 | 残留风险 |
|---|---|---|
| 01 §6.1.1 瞬时失败可恢复（E2E-1） | 需 Daemon + Agent API 可制造失败/恢复 | 仅静态无法证「窗口内再入 dispatch」 |
| 01 §6.1.3 / 02 busy+耗尽（E2E-2/3） | 需 busy 态或连续非 busy 失败 + 日志检索 | 退避/耗尽停轰炸须实机观察 |
| 01 §6.1.4 成功不双跑（E2E-4） | 需一次成功 launch + 确认无二次 claim | 误 release 风险依赖代码路径审阅 |
| HTTP dispatch 同策略 | 04/T2 明确划出；路由仍失败即 ack | 旁路入口仍可能「失败即丢」或 busy 卡盘 |
| `file-queue.ts` ≤300 | 既有债（约 583 行）；T1 允许增量 | 拆分另任务，不阻断本变更 |
| 知识库 R3 改写 | `02` §十 归 `/kb-archive` | 文档与代码短暂不一致直至 archive |

## 3、验收追溯表

| 验收点（01/02/03） | 方式 | 冒烟/必须手工 | 证据类型 |
|---|---|---|---|
| 01 §6.1.1 瞬时失败可恢复 | E2E-1 | **必须手工** | `.claimed→.qmsg` + 再入 dispatch / 可重试待办 |
| 01 §6.1.2 不再失败即消失 | ST-2 + E2E-1 | **冒烟+手工** | 未耗尽禁 `ackMessages`；磁盘可再 claim |
| 01 §6.1.3 重试上限+停试可感知 | E2E-3 | **必须手工** | `dispatch_retry_exhausted` + 停试通知 |
| 01 §6.1.4 成功不重复轰炸 | ST-3 + E2E-4 | **冒烟+手工** | ok 仅 `clearAttempt`；ack 仍走 final/`ackOnReply` |
| 01 §6.2.1 队列恢复独立于通知 | ST-1/ST-2 | **冒烟（已通过）** | release 接线存在；非仅 notify |
| 01 §6.3 / 02 行数与注释 | ST-4 | **冒烟（已通过）** | orchestrator 264 / retry 96；file-queue 债已知 |
| 02 §八·（二）busy 释放再调度 | E2E-2 | **必须手工** | 磁盘 + `dispatch_retry_scheduled`/`agent_busy_requeue` |
| 02 §八·（二）耗尽无轰炸 | E2E-3 | **必须手工** | 耗尽后无该 session 自动重调度 |
| 02 §八·（二）ok 清零 attempt | ST-3 + E2E-4 | **冒烟+手工** | `clearAttempt` 命中 |
| 02 §八·（二）无新抽象/Electron import | ST-5 | **冒烟（已通过）** | 无 `retry-policy` import |
| T1 release 原语磁盘行为 | T1 本地实测 | **冒烟（apply 已通过）** | claim→release→`.qmsg` 可计 |
| T1 不存在 id / ack 语义未变 | ST-1 | **冒烟（已通过）** | 导出存在；`ackMessages` 未改删语义（04） |
| T2 Orchestrator 接线 | ST-2/ST-6 | **冒烟（已通过）** | deps 注入 + handleLaunchFailure 路径 |
| 04 D1 HTTP 旁路 | — | **范围外未测** | 见 §2；不阻断主路径 |
| 02 §十 知识库 R3 | archive | **待 archive** | 非本 06 阻断 |

## 4、场景摘要

### 4.1 手工 E2E（必须）

| ID | 场景 | 前置 | 触发 | 期望 | 失败判责 |
|---|---|---|---|---|---|
| E2E-1 | 瞬时失败可恢复 | Daemon 运行；可制造一次 launch 失败后恢复 | IM 入队 → 失败 → 等待退避窗口 | 消息回 `.qmsg`；无需重发 IM 再入 `dispatchSessionToAgent` 或仍可重试 | 仍直接消失→查是否误走 ack；未 release→查 `handleLaunchFailure` |
| E2E-2 | busy 释放再调度 | Agent busy / 可返回 busy | 入队触发 busy | `.claimed→.qmsg`；延时后再 dispatch；日志含 `dispatch_retry_scheduled` 或 `agent_busy_requeue` | 卡 `.claimed`→未 release；无限重试→查 max |
| E2E-3 | 非 busy 耗尽停试 | 可持续失败（如 Agent API 不可用） | 同一 session 连续失败至 3 次重试上限 | 出现 `dispatch_retry_exhausted`；停试可感知通知；之后无该 session 自动轰炸；最终 ack | 无限重试→计数未耗尽；无通知→notify 路径 |
| E2E-4 | 成功不双跑 | 正常可 launch | 一次成功交给执行 | ok 后不 release；无同批二次领取轰炸；final/`ackOnReply` 才 ack | 双跑→误 release 或 attempt 未清 |

### 4.2 静态冒烟（已执行）

| ID | 核对点 | 路径/命令 | 期望 | 结果 |
|---|---|---|---|---|
| ST-1 | `releaseClaimedMessages` 导出 | `src/bridge/file-queue.ts` | 导出函数存在 | **通过** |
| ST-2 | 失败路径 release + 日志关键字 | `daemon-orchestrator-retry.ts` | `releaseClaimedMessages`；`dispatch_retry_scheduled` / `dispatch_retry_exhausted`；`MAX_DISPATCH_RETRIES=3`；退避 600/1200/2400 | **通过** |
| ST-3 | ok 清零 / deps 面 | `daemon-orchestrator.ts` | deps 含 release；接线 `createDispatchRetry` | **通过** |
| ST-4 | 行数约束 | `wc -l` | orchestrator/retry ≤300；file-queue 债已知 | **通过**（264 / 96；file-queue 583 债） |
| ST-5 | 禁止 Electron retry-policy | `rg` daemon 编排文件 | 零命中 import | **通过** |
| ST-6 | daemon 注入 | `daemon.ts` | import + `createOrchestrator` 注入 | **通过** |
| ST-7 | 类型检查 | `npx tsc --noEmit` | exit 0 | **通过** |

### 4.3 旁路与债（记录，不阻断）

| 项 | 观察 | 处理 |
|---|---|---|
| HTTP `/api/agent/dispatch` | 非 busy 失败仍 `ackMessages`；busy 仅 `scheduleBusyRetry`、无 release | 04 D1；另开变更/T-FIX |
| 知识库 R3 | 概览仍写旧「失败 ack 不 re-queue」 | `/kb-archive` 按 `02` §十更新 |

## 5、脚本位置与环境

| 项目 | 说明 |
|---|---|
| 自动化脚本 | **无**（本变更未建 `auto_test/`） |
| 定向扫描 | `rg releaseClaimedMessages\|dispatch_retry_scheduled\|dispatch_retry_exhausted`；`rg retry-policy`（daemon 编排侧） |
| 手工前置 | Daemon 与 Agent/Electron 同版本；可写队列目录；可检索 daemon 日志 |
| 环境变量 | 无新增必填；**不写密钥** |
| 副作用 | E2E 可能产生失败通知与队列文件 rename；静态/`tsc` 无写库 |

## 6、输出与记录规范

执行记录仅表格一行一次（命令/结果/结论短语）；**禁止**粘贴完整终端或含 token 日志。

## 7、执行记录

| 日期 | 环境 | 命令/动作 | 结果 | 备注 |
|---|---|---|---|---|
| 2026-07-12 | 本地（apply） | T1 claim→`releaseClaimedMessages`→`.qmsg` | 通过 | builder 本地实测摘要 |
| 2026-07-12 | 本地（apply） | `tsc --noEmit` | 通过 | builder 曾跑 |
| 2026-07-12 | 本地（kb-test） | `npx tsc --noEmit` | 通过 | 本轮复跑 |
| 2026-07-12 | 本地（kb-test） | ST-1～ST-6 符号/行数/注入/无 Electron import | 通过 | 静态契约 |
| 2026-07-12 | — | E2E-1～4 | 待用户执行 | 主路径必须手工 |
| 2026-07-12 | — | HTTP dispatch 旁路 | 未测（范围外） | 04 D1 债 |
