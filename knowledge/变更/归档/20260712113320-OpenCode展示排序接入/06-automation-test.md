# OpenCode展示排序接入 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` §六 AC1–AC5、`02-design.md` §八·（二）、`03-tasks.md` T1–T5
> **本期结论**：T1–T4 静态验收通过；T5 六项运行时场景待手工（无飞书/Electron/Daemon 联调环境）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 静态源码核对（T1–T4）为主；手工冒烟（飞书私聊 + OpenCode/Cursor 并排）为辅；**不**新增单测/集成测、**不**跑全量 analyze |
| **目标** | 验证 OpenCode 接入 Presentation defer/Rev2 end-only 链，与 Cursor/CC 对称；Daemon 契约消费不变 |
| **与验收关系** | 每条追溯行对应 `03` 任务验收或 `01` §六 AC；`02` §八·（二）六项归入 T5 手工清单 |
| **本期执行** | T1–T4：grep + 符号/行数核对 ✅；T5：环境未就绪标 **待手工** |
| **Daemon 划界** | 本变更不修改 `src/daemon/daemon-presentation-*.ts`；仅验证 Electron 侧 POST 时机对齐 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 飞书私聊 OpenCode 多 tool 时间轴（AC1/AC2） | 无已配置飞书 Bot + Daemon/Electron 未运行 | defer 链静态接线正确，IM 顺序须实机 |
| `PRESENTATION_ORDERING=0/1` 开关对比（AC4） | 需重启 Electron 并改 env | 早退逻辑已静态核对，回滚体感待证 |
| OpenCode vs Cursor 并排体感（AC3） | 需双引擎同 prompt 实跑 | 对称实现已对照 `sdk-run-presentation.ts` |
| silent/read vs notify/shell defer 差异 | 须 SSE 实流观察 IM 卡序 | tool 分级静态已接入 `resolveSdkToolPresentationTier` |
| `presentation_order_violation` 无异常峰值（NF1） | 须长任务运行时检索 Daemon 日志 | 挂接点在 Daemon 既有模块，OpenCode 仅减少违规触发面 |
| 四引擎 Port launch/dispatch/终态 smoke（AC5） | 需全链路 + 四引擎配置 | `engine-port-adapter` 未改签名；complete 路径静态核对 |
| preamble 400ms 竞态 | 纯对话首包短窗仅运行时可观察 | 与 Cursor 同常量 `STREAM_POST_INTERVAL_MS` |

## 3、验收追溯表

| ID | 验收摘要（03/01/02·八·二） | 验证方式 | 证据类型 | 状态 |
|----|---------------------------|----------|----------|------|
| T1 | `presentationOrderingEligible=false` 时 `markOpencodeProcessEventSeen` no-op | 静态 grep | `stream.ts:250` 门控 return | ✅ 静态 |
| T1 | ordering 开启置 `seenProcessEvent` + `presentationDeferStream` | 静态 grep | `stream.ts:252-253` | ✅ 静态 |
| T1 | 移除 `postOpencodePresentationEvent` 飞书早退 | 静态 grep | 无 `feishuSuppressesProcessKind`；JSDoc L64 | ✅ 静态 |
| T1 | `closeOpencodeThinkingIfOpen` 经 POST 不被拦截 | 静态调用链 | `events.ts:59` → `stream.ts:242` | ✅ 静态 |
| T2 | notify tool `running` 置闩 + POST | 静态 grep | `events.ts:56-67` tier===notify | ✅ 静态 |
| T2 | silent tool 不置闩、不 POST | 静态 grep | `events.ts:68-71` else 分支 | ✅ 静态 |
| T2 | reasoning 仍置闩 + POST | 静态 grep | `events.ts:45-47` | ✅ 静态 |
| T2 | 未知 part WARN 不崩溃 | 静态 grep | `events.ts:88` | ✅ 静态 |
| T3 | defer 时 `appendOpencodeStreamDelta` 不 schedule non-final POST | 静态 grep | `stream.ts:228` early return | ✅ 静态 |
| T3 | 纯对话 preamble 400ms | 静态 grep | `scheduleOpencodePreambleRelease` L137-144 | ✅ 静态 |
| T3 | `doFlushOpencodeStreamPost` non-final end-only 早退 | 静态 grep | `stream.ts:174-176` | ✅ 静态 |
| T3 | `PRESENTATION_ORDERING=0` 全链早退 | 静态 grep | `shouldDefer*`/`mark*` 首行 `presentationOrderingEligible` | ✅ 静态 |
| T3 | 主文件 ≤300 行 | `wc -l` | `agent-opencode-stream.ts` 279 行 | ✅ 静态 |
| T3 | 无 mid-run release 等价物 | 静态 grep | opencode 目录无 `maybeReleaseDeferredAssistant` | ✅ 静态 |
| T4 | Run 收尾 `flushOpencodeStreamPost(true)` 唯一出站 | 静态 grep | `complete.ts:65-68` Rev2 注释 | ✅ 静态 |
| T4 | 异常/abort 仍 failure notify + 无 buffer 泄漏设计 | 静态读码 | `complete.ts:79-92`；`resetOpencodeRunPresentationState` 清 buffer/闩 | ✅ 静态 |
| T4 | 新 Run 前闩锁归零 | 静态 grep | `utils.ts:123-124` `seenProcessEvent`/`presentationDeferStream` | ✅ 静态 |
| T4 | `engine-port-adapter` 无签名变更 | manifest 划界 + 未列入改动文件 | 仅 `complete.ts` import 消费 | ✅ 静态 |
| T5-1 | `PRESENTATION_ORDERING=0` 多 tool 与变更前一致 | 重启 Electron + 飞书 OpenCode Run | IM 时间轴 | ⚠️ 待手工 |
| T5-2 | ordering=1：tool 中无 assistant 抢卡；idle 后正文完整 | 飞书私聊 OpenCode | IM 卡序 | ⚠️ 待手工 |
| T5-3 | 同 prompt OpenCode vs Cursor 并排 | 双引擎实跑 | 过程在上、结论在下 | ⚠️ 待手工 |
| T5-4 | read silent 不 defer；shell notify defer | 含两类 tool 的 prompt | IM/日志 | ⚠️ 待手工 |
| T5-5 | `presentation_order_violation` 无异常峰值 | Daemon 日志检索 | WARN 计数 | ⚠️ 待手工 |
| T5-6 | 四引擎 Port smoke | launch/dispatch/终态 | 无回归 | ⚠️ 待手工 |
| AC1 | 门控内 tool 执行无 assistant 抢首屏 | 合成 T1–T3 + T5-2 | 飞书 | ⚠️ 待手工 |
| AC2 | idle 后 deferred 正文释放 | 合成 T3/T4 + T5-2 | 飞书 | ⚠️ 待手工 |
| AC3 | 与 Cursor 同场景排序一致 | 合成 T1–T4 + T5-3 | 体感 | ⚠️ 待手工 |
| AC4 | 排序关闭无卡死、无丢终态 | 合成 T3/T4 + T5-1 | 飞书+终态 | ⚠️ 待手工 |
| AC5 | 四引擎 Port 无回归 | T5-6 | smoke | ⚠️ 待手工 |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| Daemon | 已启动；`readLockFile` 可读 port |
| Electron | 已构建并启动；OpenCode HTTP 可 dispatch |
| 飞书 | Bot 已授权**私聊**（f41 流式）；可发多 tool prompt |
| 环境变量 | `PRESENTATION_ORDERING`：`1`（默认重点）、`0`（回滚对照）；可选 `OPENCODE_RESIDENT_AGENT` |
| 对照引擎 | Cursor 同会话或并排会话，同 prompt |
| 凭据 | **勿**写入本文；用「已配置」描述 |

### 4.2 手工冒烟清单（T5 / 01 §六 / 02 §八·二）

| # | 场景 | 前置 | 操作 | 期望 | 关联 | 本期 |
|---|------|------|------|------|------|------|
| M1 | 排序关闭回滚 | `PRESENTATION_ORDERING=0`；重启 Electron | OpenCode 多 tool Run（含 shell） | 时间轴与变更前一致；终态 notify 到达；无挂死 | AC4、T5-1、02·八·二·1 | 待手工 |
| M2 | 排序开启 defer | `PRESENTATION_ORDERING=1`；飞书私聊 | OpenCode 多 tool Run | tool 执行中无 assistant 单独成卡；session.idle 后正文完整一张 | AC1/AC2、T5-2、02·八·二·2 | 待手工 |
| M3 | 与 Cursor 并排 | ordering=1；双引擎可用 | 同 prompt 分别 dispatch OpenCode / Cursor | 过程卡（thinking/tool）在上、结论 assistant 在下；体感一致 | AC3、T5-3、02·八·二·3 | 待手工 |
| M4 | tool 分级 | ordering=1 | prompt 含 `read`（silent）+ `shell`（notify） | read running 不触发 defer；shell running 触发 defer | T5-4、02·八·二·4 | 待手工 |
| M5 | NF1 可观测 | ordering=1；长任务 | 跑完后检索 Daemon 日志 `presentation_order_violation` | 无相对基线异常峰值；若有 WARN 字段齐全 | T5-5、02·八·二·5 | 待手工 |
| M6 | 四引擎 Port | 四引擎均已注册 | 各引擎 launch → dispatch → 等 idle/终态 | 终态契约与 Port 归档一致；OpenCode 无额外回归 | AC5、T5-6、02·八·二·6 | 待手工 |

**T1–T4 静态要点**：`postOpencodePresentationEvent` 始终 POST（飞书抑制在 Daemon）；`markOpencodeProcessEventSeen` 经 `presentationOrderingEligible` 后置双侧闩；`shouldDeferOpencodeAssistantPost` / `shouldEndOnlyOpencodeAssistantDefer` 对称 Cursor Rev2 end-only。

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| tool 中 assistant 仍抢首屏 | Electron defer 未生效；或 notify tool 未置闩（查 T2） |
| idle 后无正文 / 正文截断 | `completeOpencodeRun` final flush 未触发；Daemon release 链 |
| ordering=0 仍 defer | `PRESENTATION_ORDERING` 未生效或 `f41Stream` 误判 |
| read 误触发 defer | `resolveSdkToolPresentationTier` 分级或 silent 分支回归 |
| 终态丢失 | `engine-port-adapter` / failure notify 路径；非本变更 Daemon 改动 |
| `presentation_order_violation` 激增 | preamble 竞态或过程卡晚于 assistant；对照 Cursor 同场景 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/` | **本期未新增**；验收依赖 §4.2 手工步骤 |
| 可选观测 | Daemon 日志 grep `presentation_order_violation`；Electron UI 日志 `[thinking]`/`[tool]` |
| 环境变量名 | `PRESENTATION_ORDERING`、`OPENCODE_RESIDENT_AGENT`（以项目实际为准） |
| HTTP 契约 | 沿用 `POST /api/stream-text`、`POST /api/presentation-event`（无新路由） |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端日志；§7 备注列仅用结论性短语（如「T3 静态通过」「M2 待手工」）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地静态 | T1 闩锁 + 飞书早退移除 | 通过 | stream.ts mark/post |
| 2026-07-12 | 本地静态 | T2 tool 分级 notify/silent | 通过 | events.ts tier 分支 |
| 2026-07-12 | 本地静态 | T3 defer/end-only/preamble 链 | 通过 | stream.ts 116-233 |
| 2026-07-12 | 本地静态 | T4 final flush + reset 闩锁 | 通过 | complete.ts + utils.ts |
| 2026-07-12 | 本地静态 | 行数 ≤300；无 mid-run release | 通过 | stream 279 行 |
| 2026-07-12 | 无服务 | M1–M6 飞书/Electron/Daemon 联调 | 待手工 | 无运行环境 |
| 2026-07-12 | 无服务 | AC1–AC5 端到端 | 待手工 | 依赖 M1–M6 |
