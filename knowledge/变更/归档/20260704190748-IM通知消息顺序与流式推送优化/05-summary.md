# IM 通知消息顺序与流式推送优化 - 变更总结

> **变更 ID**：`20260704190748-IM通知消息顺序与流式推送优化`  
> **来源**：kb-propose · standard flow  
> **阶段**：`archived_with_debt`（T1–T5 + T-FIX-1~4 代码与静态验收通过；04-review 通过；**E10 / 08-verify 第 1 轮 E2E 待维护者复验**；E1–E9 飞书私聊手工待测）  
> **关联验收打回**：`08-verify-issue.md` 第 1 轮 — assistant 答复文案完全相同重复发送

---

## 1、实际变更

### 1.1 代码（T1–T5 + T-FIX-1~4）

| 任务 | 文件 | 关键改动 |
|------|------|----------|
| **T1** | `electron/agent/cursor-sdk/sdk-run-presentation.ts` | `markProcessEventSeen` 移除 `kind==="task"` 与 `feishuSuppressesProcessKind` 早退；保留 `presentationOrderingEligible` 门控；thinking/tool/task 均置 `seenProcessEvent` + `presentationDeferStream` 并 `clearStreamPostTimer` |
| **T2** | `src/daemon/daemon-presentation-milestone.ts` | `sendMilestoneText` 返回 `Promise<boolean>`；空文案/3s 节流/Run 去重上限/`sendFn` 失败 → `false`；里程碑实际出站 → `true` |
| **T3** | `electron/agent/cursor-sdk/sdk-run-stream.ts` | `case "task"` 在 `postPresentationEvent` 前补 `markProcessEventSeen(session, "task")`；thinking/tool 分支零行为改动 |
| **T4** | `src/daemon/daemon.ts` | 飞书抑制分支 `sendMilestoneText` 成功后、仅 `sent === true` 时 mirror ordering 闩——thinking 更新 `thinkingOpen`/`presentationProcessActive`；tool 更新 `activeToolNames`/`presentationProcessActive`；task 仅置 `presentationProcessActive`；过程 idle 改经 `enqueueReleaseDeferredAssistantStream` |
| **T5** | `electron/agent/cursor-sdk/AGENTS.md` | 呈现抑制 ≠ 不参与 ordering defer；task 参与 defer 闩；`markProcessEventSeen` 门控说明 |
| **T5** | `src/daemon/AGENTS.md` | 飞书抑制里程碑 `sent` 后 mirror 编排字段；task handler 置闩不单独 release |
| **T5** | `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | §二/§三：task 参与 ordering、飞书抑制仍 POST 且置闩、里程碑 `sent` 闩锁 |
| **T-FIX-1** | `src/daemon/daemon.ts` | `SessionProgressState.assistantReleaseChain`；`enqueueReleaseDeferredAssistantStream` 串行入链；`releaseDeferredAssistantStreamImpl` 首建前 `assistantCardReleased` 占位、发送失败回滚；`resetPresentationOrderingFields` 清 chain |
| **T-FIX-2** | `electron/agent/cursor-sdk/sdk-run-stream.ts` | `streamRunEvents` 收尾移除 `flushDeferredStreamPost`；仅保留 `flushStreamPost(session, true)` 作为 Run 收尾唯一 final POST |
| **T-FIX-3** | `src/daemon/AGENTS.md` | 补充 enqueue release 链、首建占位与 chain 清理语义 |
| **T-FIX-3** | `electron/agent/cursor-sdk/AGENTS.md` | Run 收尾单 final flush；无收尾双 flush |
| **T-FIX-4** | `src/daemon/daemon.ts` | `handleStreamText` ordering 路径飞行窗口门控：`assistantCardReleased && !outboundMessageId` 时 await chain 刷新 `isFirst`；非 final 返回 `deferred: true`；`releaseDeferredAssistantStreamImpl` try/catch 回滚占位并 rethrow |
| **T-FIX-4** | `src/daemon/AGENTS.md` | 飞行窗口门控与 `assistantReleaseChain` 字段表 |

**用户可见行为**：

- **飞书私聊 IM（ordering 开启）**：思考 / notify 级工具 / task 过程里程碑**先于** assistant CardKit 流式答复首包出现；时间轴自上而下与 SDK 发生顺序一致（F1/F3/F6.1）。
- **答复仍流式**：过程 idle 或 Run 收尾后 assistant 首建，后续 PATCH 持续增长，非一次性长文（F2）。
- **修复 assistant 答复重复发送**：08-verify 第 1 轮反馈的「完全相同文案出现两次」——经 T-FIX-1/2/4 消除并发 release 双首建与 Electron 收尾双 flush 叠加；assistant 首段文案预期只出站一次（验收 9 / E10）。
- **read / glob 等 silent 工具**：仍不出站 IM 过程通知、不置 ordering 闩（F4；工具分级未改）。
- **短问答**：无实质过程时 preamble 400ms 短窗路径未改，首包时延预期与变更前相当（F5）。
- **微信 CardKit 私聊**：非抑制路径 diff 为零，行为不变。

**不变**：`sdk-tool-presentation-tier.ts` 工具分级；`feishu-presentation-gate.ts` 呈现抑制判定；MergeBatch 与 `getPresentationReplyAnchor`；三态进度与 `stop_progress`；`PRESENTATION_ORDERING` MVP 范围（主用户私聊）；Claude/Codex/OpenCode 引擎。

### 1.2 变更文档

| 文件 | 说明 |
|------|------|
| `00-manifest.json` | T1–T5、T-FIX-1~4 done；reviews R1 fixed、R-D1~R-D4 accepted_debt |
| `01-proposal.md` | 产品 PRD（F1–F7、验收 1–9） |
| `02-design.md` | 方案设计（ordering 闩与呈现形态解耦） |
| `03-tasks.md` | T1–T5 + T-FIX 任务清单 |
| `04-review.md` | 三轮 focused-review 通过 |
| `06-automation-test.md` | 静态 + E1–E10 联调清单 |
| `08-verify-issue.md` | 第 1 轮验收打回与根因（assistant 重复） |
| `05-summary.md` | 本文件 |

**版本与 changelog**：本轮不写（归 `/kb-archive` + **kb-release**）。

---

## 2、与设计的差异

与 `02-design` / `03-tasks` 核心契约一致；T-FIX 为 08-verify 暴露缺陷的增强修复，无阻断性设计偏差。

| 项 | 设计预期 | 实际 | 评估 |
|----|----------|------|------|
| S6-E1：移除 task/飞书抑制早退 | `markProcessEventSeen` 统一置闩 | 一致 | ✅ |
| S4-Task-E：task 分支前置闩 | `postPresentationEvent` 前 `markProcessEventSeen` | 一致 | ✅ |
| S4-M-Ret：`sendMilestoneText` 返回 boolean | 节流/去重/空/失败 → false | 一致 | ✅ |
| S4-M-T/Tool/Task：飞书抑制 + sent 后 mirror 闩 | thinking/tool mirror CardKit 字段；task 仅 `presentationProcessActive` | 一致 | ✅ |
| 呈现抑制 ≠ 不参与 ordering defer | Electron 仍 POST 并置闩；Daemon sent 后 mirror | 一致 | ✅ |
| S7：过程 idle → release assistant 首建 | 改经 `enqueueReleaseDeferredAssistantStream` 串行 | 增强（T-FIX-1） | ✅ |
| S9：Run 收尾单 final flush | 移除收尾 `flushDeferredStreamPost` | 增强（T-FIX-2） | ✅ |
| 08-verify：消除 assistant 双首建 | chain 串行 + 占位回滚 + 飞行窗口门控 | T-FIX-1/2/4 对齐 | ✅ |
| 工具分级 / MergeBatch / 三态不改 | 无相关 diff | 一致 | ✅ |
| T5 三份文档同步 | AGENTS ×2 + `06-CursorSDK执行引擎.md` | 已更新 | ✅ |

### 2.1 评审项

| ID | 状态 | 说明 |
|----|------|------|
| **R1** | **fixed**（T-FIX-4） | `handleStreamText` 与 release 飞行窗口竞态：`assistantCardReleased` 已占位但 `outboundMessageId` 未写入时并发 stream-text 仍 `isFirst=true` 重复首建 → 飞行窗口门控 + impl try/catch 回滚 |
| **R-D1** | accepted_debt | Electron 过程事件到达即置 defer 闩；Daemon 飞书里程碑仅在 `sent === true` 时置 `presentationProcessActive`——双侧触发条件不完全对称；节流跳过时 Electron defer、Daemon 不置闩属合理，Run final flush 兜底 |
| **R-D2** | accepted_debt | 纯 task 场景 mid-run 不单独 `releaseDeferredAssistantStream`，依赖 thinking/tool idle 或 Run final；02 §6 步骤 5、§8.1 风险已写明 |
| **R-D3** | accepted_debt | Run 收尾跨通道：`flushStreamPost(final)` 与 Daemon `enqueueRelease` 仍可能近时序叠加；T-FIX-2 移除 non-final 双 POST、T-FIX-4 门控缓解；E2E 复验优先 |
| **R-D4** | accepted_debt | `enqueueReleaseDeferredAssistantStream` 外层 `.catch` 仅 WARN、与 Electron `streamPostChain` 一致；impl try/catch 回滚 `assistantCardReleased` 并 rethrow，失败场景依赖后续 release 重试 |

---

## 3、影响范围

- **主用户飞书私聊 + Cursor SDK**：ordering 闩与呈现形态解耦，修复「结论抢先于过程里程碑」根因；T-FIX 修复 assistant 重复首建。
- **Electron defer 链**：thinking / notify tool / task 均参与 `seenProcessEvent` / `presentationDeferStream`；assistant delta 在过程活跃时累积 defer；Run 收尾单 final POST。
- **Daemon 里程碑路径**：`sendMilestoneText` 真实出站后 mirror CardKit 路径等价的 `SessionProgressState` 编排字段；`assistantReleaseChain` 串行 release。
- **IM 阅读体验**：长任务过程序列稳定于结论之上；与归档变更 `20260704174846`（think/task defer）、`20260704183752`（tool 分级 silent）、`20260627210352`（Presentation 编排基线）互补。
- **非目标**：飞书群聊 ordering 扩展、微信/其他引擎、Electron 设置 UI、用户可配置通知开关、proto/DB 未改。

### 3.1 Ponytail 技术债

> 来源：`src/daemon/daemon.ts` 本变更新增 `// ponytail:` 注释（3 条）；复用 Electron `streamPostChain` 模式，无新抽象层或配置开关。

| 位置 | 注释摘要 | 已知简化 / 债务 |
|------|----------|-----------------|
| `releaseDeferredAssistantStreamImpl`（~L583） | 异步发送前占位，避免并发 release 重复首建；发送完全失败则回滚 | check-then-act 改为占位 + try/catch 回滚；发送中途部分成功场景仍依赖通道幂等 |
| `enqueueReleaseDeferredAssistantStream`（~L667） | 复用 Electron `streamPostChain` 模式，串行化 release 避免并发首建重复 assistant 卡 | 链式 Promise 非独立队列模块；外层 `.catch` 吞异常仅 WARN（R-D4 accepted） |
| `handleStreamText` ordering 分支（~L734） | 飞行窗口门控 — release 已占位但 outbound 尚未写入时，等待 chain 完成再判 `isFirst` | 占位与 outbound 写入窗口内非 final 返回 `deferred: true`；跨通道 Run final 近时序仍可能叠加（R-D3 accepted） |

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；T5 已落地必须更新项；archive 确认全部闭环。

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — §二 PRESENTATION_ORDERING、§三 `markProcessEventSeen`/task 规则、飞书抑制仍 POST 且置闩、里程碑 sent 闩锁（T5）

### （二）可能更新（视实现结果）

- [x] `electron/agent/cursor-sdk/AGENTS.md` — 抑制≠defer、task 参与 ordering、Run 收尾单 final flush（T5 + T-FIX-3）
- [x] `src/daemon/AGENTS.md` — 飞书抑制里程碑 sent 后 mirror 编排字段、enqueue release 链与飞行窗口门控（T5 + T-FIX-3/4）
- [x] `knowledge/业务域/Agent调度/` IM 呈现相关段落 — 本变更行为修正已并入 `06-CursorSDK执行引擎.md`，无额外子模块拆分
- [x] `knowledge/变更/归档/20260627210352-飞书Presentation展示时序编排/` 交叉引用 — 本变更为其时序编排飞书里程碑 + task 缺口补丁，archive 时目录并列即可

### （三）不需要更新（已确认）

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — 无新降级类型；`feishu-presentation-gate` 门控逻辑未改
- [x] `src/shared/sdk-tool-presentation-tier.ts` 及工具分级知识 — 行为不变（F4）
- [x] MergeBatch、三态进度、里程碑节流参数文档 — 无逻辑变更
- [x] Claude/Codex/OpenCode 引擎文档 — 非 Cursor SDK 路径，未触达
- [x] Electron 设置 UI — 非目标
- [x] 知识索引（`knowledge/**/00-README.md` 等）— 行为修正，无新子模块入口
- [x] `changelog/`、`package.json` 版本 — 归 kb-release / archive 步骤处理

---

## 5、遗留债务与归档结果

| 来源 | 债务 | 级别 | 阻塞 archive |
|------|------|------|--------------|
| **E10** | 08-verify 第 1 轮 assistant 答复不重复 — 飞书私聊长任务手工复验 | E2E 手工 | **否**（`archived_with_debt`） |
| **E1–E9** | 01 验收 1–9、02 §8.2 工程补充项飞书私聊联调 | E2E 手工 | **否** |
| **R-D1~R-D4** | 双侧闩不对称、纯 task release、跨通道时序、链外层吞异常 | accepted_debt | **否** |
| **R1** | 飞行窗口竞态 | fixed（T-FIX-4） | — |

| 项 | 值 |
|----|-----|
| **归档阶段** | `archived_with_debt` |
| **最高优先 E2E** | **E10**（assistant 首段不重复）+ **E1/E2**（过程先于结论基线）；见 `06-automation-test.md` §3.2、§4 |
| **版本 / changelog** | 由 **kb-release** 执行（scribe 不写 `package.json` / `changelog/`） |
| **目录迁移** | 待 kb-release `mv` 至 `knowledge/变更/归档/` |
