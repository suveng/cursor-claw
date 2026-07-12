# 工作流恢复入口与信号接口 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` §六验收 1–5、`03-tasks.md` T1–T6 + AC-01～AC-11、`04-review.md`（通过，无阻断项）
> **评审结论**：focused-review 无严重/警告项；§7 遗留债务（入口日志误标、双轨日志格式）不阻断 test

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 轻量静态（grep/行数）+ HTTP 契约（临时 Daemon）；**不**启动 Electron、**不**跑单测/集成测 |
| **目标** | 验证三入口（UI IPC、斜杠、HTTP 信号）接线、T10 主链划界、状态码映射与 AC-07/08 无回归 |
| **与验收关系** | 每条场景对应 `03` 任务验收或 `01` §六；T6 AC 单独标 **AC-xx** |
| **本期执行** | `auto_test/run-workflow-resume-contract.sh` 静态 + HTTP 400/404；AC-01/03/04/05/06/11 实机仍待补 |
| **轻量静态** | 新文件行数 ≤300；符号/日志 source 五类；无 gateway、无 `.fcmd` resume 绕路 ✅ |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| paused 实例真实恢复（AC-01、01 验收 1） | 需 Electron + 可暂停工作流实例 + Agent | 引擎/launch 链运行时待证 |
| 飞书 `/workflow resume` 实机（AC-01、AC-11） | 无飞书 Bot 凭据；Electron 未常驻 | T10 转发链仅静态 + 归档契约继承 |
| HTTP 200 + stdout `__WF_LAUNCH__`（AC-03） | 契约脚本仅测 400/404；paused 须种子实例 | 路由与 `resumeWorkflowAndEmit` 已静态接线 |
| running/completed 三入口 409/错误（AC-04、AC-05） | 需多状态实例 | 引擎文案映射已静态 |
| `notifyChatId` 通知（AC-06） | 需 IM 通道与 paused 实例 | runner/emit 路径含 notify |
| 斜杠未授权 G1（01 验收 2） | 需飞书实机 | 沿用现网门控，本变更未改 |
| 队列/orchestrator 运行时回归（AC-07） | 仅 diff 未触及 | 静态 0 命中；spot-check 待运维 |

## 3、验收追溯表

| ID | 验收摘要（01/03/02·八·二） | 验证方式 | 证据类型 | 状态 |
|----|---------------------------|----------|----------|------|
| 01-1 | paused 经产品入口恢复继续执行 | 实机 UI/斜杠/HTTP | 实例 status + Agent | ⚠️ 待实机 |
| 01-2 | 授权 resume 可用，未授权拒绝 | 斜杠 G1 + loopback | 飞书/HTTP | ⚠️ 斜杠/HTTP 静态；G1 待实机 |
| 01-3 | HTTP 信号恢复合法 paused | curl + stdout | 200 + `__WF_LAUNCH__` | ⚠️ 404/400 ✅ 契约；200 待实机 |
| 01-4 | 非 paused 恢复可读错误 | 三入口 + HTTP 409 | 文案 | ⚠️ 映射静态 ✅；运行时待证 |
| 01-5 | 无 Gateway；队列无回归 | grep + diff | 源码 | ✅ 静态 |
| T1 | `resumeWorkflowInstance` SSOT | grep + 行数 | 源码 | ✅ |
| T1 | 非 paused 透传引擎 message | 读 runner | 源码 | ✅ |
| T1 | `workflow_resume` source=electron | grep | 源码 | ✅ |
| T2 | `/workflow resume` 经 T10，无 `.fcmd` | grep | 源码 | ✅ |
| T2 | `WORKFLOW_SUBCMD_HELP` / `COMMANDS` | grep | 源码 | ✅ |
| T2 | `workflow_resume` source=slash | grep | 源码 | ✅ |
| T3 | `workflow:resume` IPC 三端一致 | grep preload/env/manager | 源码 | ✅ |
| T3 | paused 详情「恢复」按钮 | grep WorkflowInstanceDetail | 源码 | ✅ |
| T3 | Panel + Detail ≤300 行 | wc -l | 行数 | ✅ |
| T4 | `resumeWorkflowAndEmit` + `__WF_*` | grep emitLaunch | 源码 | ✅ |
| T4 | `server-workflow.ts` ≤300 | wc -l | 行数 | ✅ |
| T4 | `workflow_resume` source=daemon | grep | 源码 | ✅ |
| T5 | `POST /api/workflow-signal` 注册 | grep routes + HTTP | 源码/HTTP | ✅ |
| T5 | 400/404/409 映射 | HTTP 契约 | curl | ✅ 400/404；409 待实机 |
| T5 | loopback 信任域 | 读 daemon-http-server | 设计 | ✅ 静态 |
| T5 | `workflow_resume` source=http | grep | 源码 | ✅ |
| AC-01 | 三入口恢复 | 实机联调 | E2E | ⚠️ 待实机 |
| AC-02 | 斜杠门控 + UI 本地 + HTTP loopback | 静态 + 实机 | 混合 | ⚠️ 静态 ✅ |
| AC-03 | HTTP paused → ok + `__WF_LAUNCH__` | curl + 日志 | HTTP/stdout | ⚠️ 待实机 |
| AC-04 | running/completed 三入口错误 | 实机 | 文案 | ⚠️ 待实机 |
| AC-05 | 二次 resume 幂等错误 | 实机 | 文案 | ⚠️ 待实机 |
| AC-06 | `notifyChatId` 通知 | 实机 IM | 消息 | ⚠️ 待实机 |
| AC-07 | 队列/orchestrator 无变化 | diff/grep | 源码 | ✅ diff 0 命中 |
| AC-08 | 无分支 Gateway | grep 恢复文件 | 源码 | ✅ 0 命中 |
| AC-09 | 新文件 ≤300 行 | wc -l | 行数 | ✅ |
| AC-10 | 五类 `workflow_resume` source | grep | 源码 | ✅ ui/slash/http/daemon/electron |
| AC-11 | Electron 退出斜杠「应用未运行」 | 停 Electron + `/workflow resume` | 飞书 | ⚠️ 待实机（继承 T10 契约） |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| 编译 | HTTP 契约前须 `npm run build:mcp && npm run build:bundle`（bundle 须含 `workflow-signal`） |
| Daemon | 契约脚本自启临时实例；实机联调须常驻 Daemon |
| Electron | UI/斜杠恢复须主进程运行；`agent-api-port.json` 可读 |
| 工作流数据 | paused 实例：设置页暂停或引擎置 `paused`；HTTP 路径读 `APP_DATA_DIR` workflow-store |
| 飞书 | Bot 已授权；`SLASH_EXEC_MODE=daemon` 且 Electron 运行 |
| 凭据 | **勿**写入本文；用「已配置」描述 |

### 4.2 手工冒烟清单（按 04 建议）

| # | 场景 | 前置 | 操作 | 期望 | 关联 | 本期 |
|---|------|------|------|------|------|------|
| S1 | 设置页恢复 | Electron；paused 实例 | 详情点「恢复」 | status=running；Agent 收到 Prompt | 01-1、AC-01 | 待实机 |
| S2 | 斜杠恢复 | Electron 运行 | `/workflow resume <id>` | ✅ 恢复文案 + 实例 ID | 01-1、T2 | 待实机 |
| S3 | HTTP 恢复 | Daemon；paused 在 store | `POST /api/workflow-signal` body resume | 200 ok；stdout `__WF_LAUNCH__` | 01-3、AC-03 | 待实机 |
| S4 | 非 paused 错误 | running 实例 | 三入口各试一次 | 「工作流非暂停状态」/ HTTP 409 | 01-4、AC-04 | 待实机 |
| S5 | 二次 resume | 已 running | 再发 resume | 同上非 paused 错误 | AC-05 | 待实机 |
| S6 | Electron 未就绪 | 停 Electron | `/workflow resume <id>` | 「应用未运行」类中文 | AC-11 | 待实机 |
| S7 | HTTP 非法请求 | Daemon | action≠resume / 缺 id / 不存在 id | 400 / 400 / 404 | T5 | ✅ 契约 |
| S8 | 通知 | paused + notifyChatId | 任一路径恢复成功 | IM 收到恢复语义通知 | AC-06 | 待实机 |

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| HTTP 全 404 | bundle 未含新路由（未 build:mcp） |
| 斜杠无响应 | Daemon 未跑 / 飞书门控 |
| UI 无恢复按钮 | 实例非 paused 或 preload 未热重载 |
| stdout 无 `__WF_LAUNCH__` | 实例非 paused 或 store 路径不一致 |
| 双入口状态不一致 | Electron userData vs Daemon APP_DATA_DIR（既有限制） |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/run-workflow-resume-contract.sh` | 静态 grep/行数 + 临时 Daemon HTTP（400/404） |
| `auto_test/run-workflow-resume-contract.mts` | 实现；依赖归档 `electron-import-hook.mjs` |
| 前置命令 | `npm run build:mcp && npm run build:bundle` |
| 环境变量名 | `KB_WF_RESUME_TEST_PORT`（可选，默认 0 随机端口） |
| 实机 curl 示例 | `POST http://127.0.0.1:<port>/api/workflow-signal` body `{"action":"resume","instanceId":"<id>"}` |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端输出；§7 备注列仅用结论性短语（如「静态通过」「HTTP 400/404 通过」「S1 待实机」）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地静态 | 关键文件行数 wc -l | 通过 | 109/187/106/277/71 均 ≤300 |
| 2026-07-12 | 本地静态 | T1–T5 符号 grep（resumeWorkflow*、IPC、斜杠、路由） | 通过 | 七文件接线齐全 |
| 2026-07-12 | 本地静态 | T10：resume 无 `.fcmd` 绕路 | 通过 | command-handler + daemon.ts 0 命中 |
| 2026-07-12 | 本地静态 | AC-08 gateway grep 恢复路径 | 通过 | 0 命中 |
| 2026-07-12 | 本地静态 | AC-07 file-queue/orchestrator diff | 通过 | 变更 diff 0 命中 |
| 2026-07-12 | 本地静态 | AC-10 五类 workflow_resume source | 通过 | electron/ui/slash/http/daemon |
| 2026-07-12 | 本地静态 | T4 emitLaunch 于 resumeWorkflowAndEmit | 通过 | server-workflow 含 emitLaunch |
| 2026-07-12 | 契约脚本 | `run-workflow-resume-contract.sh` 静态段 | 通过 | T1–T5 + AC-08/09/10 |
| 2026-07-12 | 契约 HTTP | invalid action / 缺 instanceId / 不存在实例 | 通过 | 400/400/404；须 build:mcp 后 bundle |
| 2026-07-12 | 契约脚本 | `run-workflow-resume-contract.sh` 全量 | 通过 | ALL PASS |
| 2026-07-12 | — | S1–S6 / AC-01/03/04/05/06/11 实机 | 待用户执行 | 需 Electron + paused 实例 + 可选飞书 |
