# Codex展示排序接入 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` §六、`02-design.md` §八·（二）、`03-tasks.md` T1–T5
> **本期结论**：T1–T4 静态契约全绿；T5 清单与静态核对通过；**Daemon 未改**（`git diff -- src/daemon/` 0 行）；`stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 静态源码核对（T1–T4）+ `tsc --noEmit` 编译门禁 + T5 手工清单静态可证项；**不**新增单测/集成测、**不**跑全量 analyze |
| **目标** | 验证 Codex 接入 Presentation defer/Rev2 end-only 链，与 OpenCode/Cursor 对称；仅消费既有 Daemon HTTP 契约 |
| **与验收关系** | 追溯表对应 `03` 任务验收或 `01` §六；`02` §八·（二）六项归入 T5 清单 |
| **本期执行** | T1–T4：grep + 符号/行数 + `04-review` 对照 ✅；T5：清单六项静态可证项 ✅；运行时 IM 体感项标 **清单已核/待实机补证** |
| **Daemon 划界** | `git diff -- src/daemon/` **0 行**；`daemon-presentation-*.ts` 未触及；双侧闩由 Daemon 既有实现承接 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 飞书私聊 Codex 多 tool 时间轴（AC1/AC2） | 无已配置飞书 Bot + Electron/Daemon 联调环境 | defer 链静态接线正确，IM 顺序须实机补证 |
| `PRESENTATION_ORDERING=0/1` 开关体感（AC4） | 需重启 Electron 并改 env | 早退逻辑已静态核对 |
| Codex vs OpenCode/Cursor 并排体感（AC3） | 需双引擎同 prompt 实跑 | 对称实现已对照 `agent-opencode-stream.ts` |
| silent/read vs notify/shell defer 差异 | 须 SSE 实流观察 IM 卡序 | tool 分级静态已接入 `resolveSdkToolPresentationTier` |
| `presentation_order_violation` 无异常峰值 | 须长任务运行时检索 Daemon 日志 | 挂接点在 Daemon 既有模块 |
| preamble 400ms 竞态 | 纯对话首包短窗仅运行时可观察 | 与 OpenCode 同常量 `STREAM_POST_INTERVAL_MS` |

## 3、验收追溯表

| ID | 验收摘要（03/01/02·八·二） | 验证方式 | 证据类型 | 状态 |
|----|---------------------------|----------|----------|------|
| T1 | `presentationOrderingEligible=false` 时 `markCodexProcessEventSeen` no-op | 静态 grep | `stream.ts:244` 门控 return | ✅ 静态 |
| T1 | ordering 开启置 `seenProcessEvent` + `presentationDeferStream` | 静态 grep | `stream.ts:246-247` | ✅ 静态 |
| T1 | 移除 `postCodexPresentationEvent` 飞书早退 | 静态 grep | codex 目录无 `feishuSuppressesProcessKind`；JSDoc L52 | ✅ 静态 |
| T1 | `closeCodexThinkingIfOpen` 经 POST 不被拦截 | 静态调用链 | `events.ts:73` → `stream.ts:53` | ✅ 静态 |
| T2 | notify tool `started` 置闩 + POST | 静态 grep | `events.ts:70-82` tier===notify | ✅ 静态 |
| T2 | silent tool 不置闩、不 POST | 静态 grep | `events.ts:83-86` else 分支 | ✅ 静态 |
| T2 | reasoning 仍置闩 + POST | 静态 grep | `events.ts:60-63` | ✅ 静态 |
| T2 | 未知 item WARN 不崩溃 | 静态 grep | 未改未知分支 | ✅ 静态 |
| T3 | defer 时 `appendCodexStreamDelta` 不 schedule non-final POST | 静态 grep | `stream.ts:222` early return | ✅ 静态 |
| T3 | 纯对话 preamble 400ms | 静态 grep | `scheduleCodexPreambleRelease` L125-135 | ✅ 静态 |
| T3 | `doFlushCodexStreamPost` non-final end-only 早退 | 静态 grep | `stream.ts:164-166` | ✅ 静态 |
| T3 | `PRESENTATION_ORDERING=0` 全链早退 | 静态 grep | `shouldDefer*`/`mark*` 首行 `presentationOrderingEligible` | ✅ 静态 |
| T3 | 主文件 ≤300 行 | `wc -l` | `agent-codex-stream.ts` 275 行 | ✅ 静态 |
| T3 | 无 mid-run release 等价物 | 静态 grep | codex 目录无 `maybeReleaseDeferredAssistant` | ✅ 静态 |
| T4 | Run 收尾 `flushCodexStreamPost(true)` 唯一出站 | 静态 grep | `complete.ts:68-84` Rev2 注释 | ✅ 静态 |
| T4 | 异常/abort 仍 failure notify + 无 buffer 泄漏设计 | 静态读码 | `complete.ts` lifecycle 分支保留 | ✅ 静态 |
| T4 | 新 Run 前闩锁归零 | 静态 grep | `utils.ts` `resetCodexRunPresentationState` 清 timer/链/闩 | ✅ 静态 |
| T4 | `engine-port-adapter` 无签名变更 | manifest 划界 + 未列入改动文件 | 仅 `complete.ts` 消费 | ✅ 静态 |
| DM | Daemon ordering 主链未改 | `git diff -- src/daemon/` | 0 行 diff | ✅ 划界 |
| T5-1 | `PRESENTATION_ORDERING=0` 多 tool 与变更前一致 | 静态早退链 + 清单 M1 | 门控全链 | ✅ 清单/静态 |
| T5-2 | ordering=1：tool 中无 assistant 抢卡；idle 后正文完整 | 静态 defer 链 + 清单 M2 | T3/T4 接线 | ✅ 清单/静态 |
| T5-3 | 同 prompt Codex vs OpenCode/Cursor 并排 | 对称对照 + 清单 M3 | opencode-stream SSOT | ✅ 清单/静态 |
| T5-4 | read silent 不 defer；shell notify defer | 静态 tier 分支 + 清单 M4 | `events.ts:68-86` | ✅ 清单/静态 |
| T5-5 | `presentation_order_violation` 无异常峰值 | 清单 M5 | Daemon 未改 | ✅ 清单/静态 |
| T5-6 | 四引擎 Port smoke；Cursor 无回归 | `tsc --noEmit` + 变更范围仅 codex/ | 未改 adapter/daemon | ✅ 清单/静态 |
| AC1 | 门控内 tool 执行无 assistant 抢首屏 | 合成 T1–T3 + T5-2 | 静态链 | ✅ |
| AC2 | idle 后 deferred 正文释放 | 合成 T3/T4 + T5-2 | 静态链 | ✅ |
| AC3 | 与 OpenCode/Cursor 同场景排序一致 | 合成 T1–T4 + T5-3 | 对称实现 | ✅ |
| AC4 | 排序关闭无卡死、无丢终态 | 合成 T3/T4 + T5-1 | 门控早退 | ✅ |
| AC5 | 四引擎 Port 无回归；范围克制 | T5-6 + 非目标核对 | codex-only diff | ✅ |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| Daemon | 已启动；`readLockFile` 可读 port（运行时项） |
| Electron | 已构建并启动；Codex HTTP 可 dispatch（运行时项） |
| 飞书 | Bot 已授权**私聊**（f41 流式）；可发多 tool prompt（运行时项） |
| 环境变量 | `PRESENTATION_ORDERING`：`1`（默认重点）、`0`（回滚对照） |
| 对照引擎 | OpenCode / Cursor 同 prompt 并排（运行时项） |
| 凭据 | **勿**写入本文；用「已配置」描述 |

### 4.2 手工冒烟清单（T5 / 01 §六 / 02 §八·二）

| # | 场景 | 前置 | 操作 | 期望 | 关联 | 本期 |
|---|------|------|------|------|------|------|
| M1 | 排序关闭回滚 | `PRESENTATION_ORDERING=0`；重启 Electron | Codex 多 tool Run（含 shell） | 时间轴与变更前一致；终态 notify 到达 | AC4、T5-1、02·八·二·1 | ✅ 静态/清单 |
| M2 | 排序开启 defer | `PRESENTATION_ORDERING=1`；飞书私聊 | Codex 多 tool Run | tool 中无 assistant 单独成卡；idle 后正文完整 | AC1/AC2、T5-2、02·八·二·2 | ✅ 静态/清单 |
| M3 | 与 OpenCode/Cursor 并排 | ordering=1；双引擎可用 | 同 prompt 分别 dispatch | 过程在上、结论在下；体感一致 | AC3、T5-3、02·八·二·3 | ✅ 静态/清单 |
| M4 | tool 分级 | ordering=1 | prompt 含 read（silent）+ shell（notify） | read 不 defer；shell defer | T5-4、02·八·二·4 | ✅ 静态/清单 |
| M5 | NF1 可观测 | ordering=1；长任务 | 检索 Daemon 日志 `presentation_order_violation` | 无异常峰值 | T5-5、02·八·二·5 | ✅ 清单（Daemon 未改） |
| M6 | 四引擎 Port | 四引擎均已注册 | launch → dispatch → idle/终态 | Port 契约无变更；Cursor 无回归 | AC5、T5-6、02·八·二·6 | ✅ 静态/清单 |

**T1–T4 静态要点**：`postCodexPresentationEvent` 始终 POST（飞书抑制在 Daemon）；`markCodexProcessEventSeen` 经 `presentationOrderingEligible` 后置双侧闩；`shouldDeferCodexAssistantPost` / `shouldEndOnlyCodexAssistantDefer` 对称 OpenCode Rev2 end-only。

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| tool 中 assistant 仍抢首屏 | Electron defer 未生效；或 notify tool 未置闩（查 T2） |
| idle 后无正文 / 正文截断 | `completeCodexRun` final flush 未触发；Daemon release 链 |
| ordering=0 仍 defer | `PRESENTATION_ORDERING` 未生效或 `f41Stream` 误判 |
| read 误触发 defer | `resolveSdkToolPresentationTier` 分级或 silent 分支回归 |
| 终态丢失 | `engine-port-adapter` / failure notify 路径 |
| `presentation_order_violation` 激增 | preamble 竞态或过程卡晚于 assistant；对照 OpenCode 同场景 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/` | **本期未新增**；验收依赖 §4.2 手工步骤与静态核对 |
| 编译门禁 | `npx tsc --noEmit` exit 0 |
| 可选观测 | Daemon 日志 grep `presentation_order_violation`；Electron UI 日志 `[thinking]`/`[tool]` |
| 环境变量名 | `PRESENTATION_ORDERING`（以项目实际为准） |
| HTTP 契约 | 沿用 `POST /api/stream-text`、`POST /api/presentation-event`（无新路由） |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端日志；§7 备注列仅用结论性短语。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地静态 | T1 闩锁 + 飞书早退移除 | 通过 | stream.ts mark/post |
| 2026-07-12 | 本地静态 | T2 tool 分级 notify/silent | 通过 | events.ts tier 分支 |
| 2026-07-12 | 本地静态 | T3 defer/end-only/preamble 链 | 通过 | stream.ts 105-233 |
| 2026-07-12 | 本地静态 | T4 final flush + reset 闩锁 | 通过 | complete.ts + utils.ts |
| 2026-07-12 | 本地静态 | 行数 ≤300；无 mid-run release | 通过 | stream 275 行 |
| 2026-07-12 | 本地静态 | `git diff -- src/daemon/` | 通过 | 0 行；Daemon 未改 |
| 2026-07-12 | 本地 | `npx tsc --noEmit` | 通过 | 编译门禁 |
| 2026-07-12 | 清单核对 | T5 M1–M6 + 01/02 补充项 | 通过 | 静态可证项全绿 |
| 2026-07-12 | 清单核对 | AC1–AC5 端到端追溯 | 通过 | 合成 T1–T5 |
