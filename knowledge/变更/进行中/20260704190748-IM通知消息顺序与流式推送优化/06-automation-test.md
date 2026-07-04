# IM 通知消息顺序与流式推送优化 - 验收记录

> **变更 ID**：`20260704190748-IM通知消息顺序与流式推送优化`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T5 + T-FIX-1~4 done；04-review 通过（无 open 严重/警告；R-D1/R-D2/R-D3/R-D4 accepted debt）；`stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（04-review §5 + defer/闩锁链 grep/精读）+ **编译门禁**（`npx tsc --noEmit`）+ **飞书私聊手工 E2E**（§4 E1–E10）；**无新增** `auto_test/` 脚本 |
| **目标** | 覆盖 `01-proposal` 验收 1–9、`02-design` §8.2 工程补充 1–8、`03-tasks` T1–T5 + T-FIX-1~4 全部验收条 |
| **最高优先级 E2E** | **E10**（08-verify-issue 第 1 轮「assistant 答复文案完全相同出现两次」复验）+ **E1/E2**（过程先于结论基线）；打回根因 T-FIX-1/2/4，须维护者优先执行 |
| **MVP 范围** | 主用户飞书私聊 + Cursor SDK；`PRESENTATION_ORDERING` 默认开；里程碑降级 + assistant CardKit defer |
| **排除范围** | Claude/Codex/OpenCode 引擎；群聊 ordering 扩展；Electron 设置 UI；微信/群聊深度抽检（01·8 可降级为飞书私聊双场景） |
| **与 review 分工** | 04 已静态确认双侧闩锁、sent 语义与 R-D1/R-D2 accepted debt；IM 时间轴顺序、首包时延、停止/失败须 **应用内手工** |
| **本轮执行** | 2026-07-04 `tsc`（T-FIX 后）通过；T-FIX-1~4 静态✅；E10 + E1/E2 复验待维护者优先 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01·1–2** 过程先于结论、多过程有序 | 须 SDK 真实 Run + 飞书 IM 时间轴目检；headless 无法稳定断言里程碑与 CardKit 首建相对顺序 |
| **01·3** 结论仍流式 | 用户感知级「边生成边长」须 IM 单条消息内观察；无稳定自动化契约 |
| **01·5/6** 短问答首包时延 | 须与变更前主观基线人工对照；preamble 400ms 竞态仅 E3 可量化 |
| **01·7** 停止/失败与三态 | 须运行中 stop 或失败触发；过程—结论相对位置仅 E2E 可证 |
| **01·8–9** 飞书抽检与阅读美观 | 通道凭据与滚动布局须真实会话目检 |
| **§8.2·6** NF1 `presentation_order_violation` | 日志可静态挂接；长任务无新增 WARN 须运行时观察 |
| **§8.2·7–8** 回滚与 MergeBatch | E6 须进程重启设 env；E7 须连发合并 + tool 回复真实状态机 |
| **单元/集成测试** | 仓库规范不写单测；由 review 静态 + 手工冒烟覆盖 |

## 3、验收追溯表

### 3.1 实现任务（T1–T5）

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **T1** | 移除 task/飞书抑制早退；保留 `presentationOrderingEligible` 门控 | 04 §5 + grep | `sdk-run-presentation.ts` | ✅ 静态通过 |
| **T1** | thinking/tool/task 均置 `seenProcessEvent` + `presentationDeferStream` | 04 §5 | 代码复核 | ✅ 静态通过 |
| **T1** | `PRESENTATION_ORDERING=0` 时无副作用 | 04 §5 | 门控 false 早退 | ✅ 静态通过 |
| **T2** | `sendMilestoneText` 返回 `boolean`；sent 语义 | 04 §4 | `daemon-presentation-milestone.ts` | ✅ 静态通过 |
| **T2** | 节流/去重/空文案/失败 → `false` | 04 §5 | 代码复核 | ✅ 静态通过 |
| **T3** | task 分支 `markProcessEventSeen` 在 `postPresentationEvent` 前 | 04 §4 | `sdk-run-stream.ts` | ✅ 静态通过 |
| **T3** | thinking/tool 分支零行为改动 | 04 §5 | diff 复核 | ✅ 静态通过 |
| **T4** | 飞书抑制 + ordering + sent 后 mirror 闩（thinking/tool/task） | 04 §4–5 | `daemon.ts` handlers | ✅ 静态通过 |
| **T4** | 过程 idle → `releaseDeferredAssistantStream` | 04 §5 | release 路径保留 | ✅ 静态通过 |
| **T4** | 节流跳过不误置 `presentationProcessActive` | 04 §5 | sent===false 分支 | ✅ 静态通过 |
| **T5** | 三份文档：抑制≠defer、task 参与 ordering、sent 语义 | 04 §4 | AGENTS + KB | ✅ 静态通过 |
| **编译** | TypeScript 编译 | `npx tsc --noEmit` | exit 0 | ✅ 已执行 |
| **Review** | 04-review 无 open 严重/警告 | `04-review.md` | R-D1/R-D2 accepted | ✅ 静态通过 |
| **回归** | 工具分级 / MergeBatch / preamble 路径未改 | 04 §4 | diff 范围 | ✅ 静态通过 |

### 3.2 产品验收与工程补充（E1–E10）

| ID | 场景 | 01/02 关联 | 验证方式 | 代码层 | E2E |
|----|------|------------|----------|--------|-----|
| **E1** | 思考 → notify 工具（如 shell）→ 答复顺序 | 验收 1 / §8.2·1 / F1 | 飞书私聊联调 | ✅ defer 双侧闩 | ⏳ 待手工 |
| **E2** | 含 ≥2 次 task 里程碑 + 关键工具过程 | 验收 2 / §8.2·2–3 / F3 | 飞书时间轴目检 | ✅ task 参与 defer | ⏳ 待手工 |
| **E3** | 短问答无实质过程；preamble ≤400ms | 验收 5–6 / §8.2·4 / F5 | 首包时延对比 | ✅ preamble 未改 | ⏳ 待手工 |
| **E4** | read/glob silent 不出站、不置闩 | 验收 4 / §8.2·5 / F4 | 含探查 Run | ✅ 分级未改 | ⏳ 待手工 |
| **E5** | 用户停止 / 失败与三态协调 | 验收 7 / F7 | 运行中 stop | ✅ stop 路径未改 | ⏳ 待手工 |
| **E6** | `PRESENTATION_ORDERING=0` 回滚 | §8.2·7 | 重启 + 带 tool Run | ✅ 门控 off | ⏳ 待手工 |
| **E7** | MergeBatch 活跃时 deferred 首建锚定 reply | §8.2·8 / NF2 | 连发合并 + tool | ✅ 锚点未改 | ⏳ 待手工 |
| **E8** | assistant 答复首包后仍流式增长 | 验收 3 / F2 | 长答复 Run 目检 | ✅ release+PATCH | ⏳ 待手工 |
| **E9** | 过程与结论并存时阅读美观；飞书长+短双场景 | 验收 8–9 / F6 | 滚动会话目检 | ✅ 结构性修复 | ⏳ 待手工 |
| **E10** | assistant 首段文案不重复（08-verify 第 1 轮复验） | 08-verify §1 / T-FIX-1~4 | kb-admin 类长 Run 目检 | ✅ release 串行+final-only | ⏳ 待手工（**最高优先**） |

### 3.3 修复任务（T-FIX-1~4）

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **T-FIX-1** | `assistantReleaseChain` 串行 + 首建占位回滚 | 静态 grep + 04-review | `daemon.ts` release 路径 | ✅ 静态通过 |
| **T-FIX-2** | Run 收尾仅 final flush（移除冗余 non-final） | `sdk-run-stream.ts` 精读 | 收尾 flush 链 | ✅ 静态通过 |
| **T-FIX-3** | AGENTS 文档同步 release 串行化与收尾语义 | 静态 | `AGENTS.md` 双侧 | ✅ 静态通过 |
| **T-FIX-4** | 飞行窗口门控 `await chain` + impl try/catch 回滚 | `daemon.ts` L733+ 精读 | `handleStreamText` | ✅ 静态通过 |

## 4、场景摘要

### 4.1 手工 E2E 场景（飞书私聊优先）

**前置（共用）**：Electron 应用已构建并启动；Daemon 运行；Cursor SDK API Key 与飞书通道已配置；`PRESENTATION_ORDERING` 默认开；UI 日志可查看 `[thinking]`、`[task]`、`milestone_fallback`、`presentation_order_violation`。**勿将 apiKey/token 写入知识库**。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 |
|---------|------|------|------|----------|
| **E1** 过程先于结论 | 主用户飞书私聊 SDK | 发送需思考 + shell 类工具（如「拉取最新代码并总结」） | 会话**自上而下**：思考里程碑 → 命令/工具里程碑 → **最后** assistant CardKit 首包；首包不早于过程首次呈现 | 结论抢先 → T1/T4 闩；无里程碑 → 通道/daemon |
| **E2** 多 task + 工具 | 同上 | 触发含子任务拆分 + notify 工具的长 Run | ≥2 条 task 里程碑与工具过程按发生顺序排列；无「后发生在上」 | task 在结论后 → T3/T4；乱序 → NF1 日志 |
| **E3** 短问答 preamble | 同上 | 单轮轻量问答 × ≥3，对比变更前基线 | 首条可见 assistant **无明显变慢**；无「无故等待过程」长空白；preamble 窗内无多余 defer | 明显变慢 → defer 误触；查 preamble 路径 |
| **E4** silent 探查 | 同上 | 触发含 read/glob 的 Run | IM **无** read/glob 过程通知；assistant 不因静默工具误 defer 过久 | 刷屏 → 工具分级回归；误 defer → T1 闩 |
| **E5** 停止与失败 | 进行中 Run | 用户停止或触发失败 | 过程与流式停止更新；结束态可读；无「结论顶置但仍在处理中」矛盾 | 停止仍推送 → stop 清理；失败被掩盖 → 三态路径 |
| **E6** ordering 回滚 | 设 `PRESENTATION_ORDERING=0` 后重启 | 带 tool 任务 × 1 | 行为与变更前一致：无双侧 defer 闩副作用；无卡死 | 仍 defer → 门控；进程未重启 → 环境 |
| **E7** MergeBatch | collecting/ready 态 | 连发触发合并 + 带 tool 回复 | 合并 preview/reply 不回归；deferred assistant 首建仍锚定 `getPresentationReplyAnchor` | reply 错位 → MergeBatch 基线 |
| **E8** 流式保留 | 长答复 Run | 观察 assistant CardKit 首包后 | 单条消息内容持续增长；非过程结束后一次性长文（除非 Run 本身无流式） | 无 PATCH → stream-text 路径 |
| **E9** 美观与抽检 | 飞书私聊 | 长任务 + 短问答各 1；滚动阅读 | 过程序列稳定于结论之上；无频繁跳动或逻辑颠倒；符合 01·8–9 | 结论顶置过程 → ordering 闩；布局跳动 → 通道形态 |
| **E10** assistant 不重复（08-verify 复验） | 主用户飞书私聊 SDK；ordering 开 | 含 task 里程碑 + thinking/tool 过程后 assistant 流式答复（如 kb-admin 编排类长任务） | assistant 首段文案**只出现一次**；无完全相同重复消息；过程里程碑仍在结论之上 | 重复 → T-FIX-1/2/4；顺序错 → T1–T4 |

### 4.2 静态冒烟（本次已执行）

| 检查 | 命令/方式 | 期望 | 结果 |
|------|-----------|------|------|
| TypeScript 编译 | `npx tsc --noEmit` | exit 0 | ✅ |
| defer 闩双侧 | 04-review §5 + 关键符号精读 | T1/T3 Electron + T4 Daemon mirror | ✅ |
| sent 语义 | `sendMilestoneText` 返回值 | 节流跳过不置闩 | ✅ |
| 工具分级未改 | diff | `sdk-tool-presentation-tier.ts` 无变更 | ✅ |
| MergeBatch 未改 | diff | `getPresentationReplyAnchor` 调用保留 | ✅ |

### 4.3 联调观察点（失败判责）

| 现象 | 优先怀疑 | 备注 |
|------|----------|------|
| assistant CardKit 早于里程碑 | 飞书抑制路径未置 Daemon 闩或 Electron defer 未生效 | 查 T1/T4；`presentation_order_violation` WARN |
| task 里程碑在结论之后 | task 未参与 defer | 查 T3 `markProcessEventSeen` |
| 短问答长时间空白 | preamble 竞态或误 defer | 查 `presentationProcessActive` 是否误置 |
| 节流后仍 defer 过久 | R-D1 双侧闩不对称 | Run final flush 应兜底 |
| MergeBatch reply 错 | 合并批次基线 | 非本变更 diff 范围 |
| assistant 首段文案完全相同两次 | 并发 release 双首建 | 查 T-FIX-1/2/4；08-verify 第 1 轮根因 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无（本变更未新增脚本；仓库规范不写单测/E2E 脚手架） |
| **运行依赖** | Electron 桌面应用 + Daemon；Cursor SDK 本地 runtime；飞书通道资源已配置 |
| **环境变量** | `PRESENTATION_ORDERING`（默认开，MVP 主用户私聊 ordering）；`DAEMON_PORT`；飞书 `LARK_*` 仅记变量名，不写值 |
| **E6 数据准备** | 进程级设 `PRESENTATION_ORDERING=0` 或 `false` 后重启 |
| **编译命令** | `npx tsc --noEmit` |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON 或通道凭据原文。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 失败时区分：**环境/通道/SDK 配置** vs **ordering/里程碑/defer 实现**。
- E2E 通过后维护者可在 §7 追加行并将 §3.2 对应项由 ⏳ 改为 ✅。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-04 | 本地 dev | `npx tsc --noEmit` | 通过 | exit 0；主 Agent 执行 |
| 2026-07-04 | 本地 dev | 04-review §5 静态 + T1–T5 代码路径 | 通过 | 无 open 问题 |
| 2026-07-04 | — | E1–E9 飞书私聊手工 E2E | 待维护者执行 | 需飞书 + SDK 已配置 |
| 2026-07-04 | 本地 dev | `npx tsc --noEmit`（T-FIX 后） | 通过 | exit 0 |
| 2026-07-04 | — | E10 + E1/E2 08-verify 复验 | 待维护者 | 验收打回后优先 |
