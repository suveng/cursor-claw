# IM 通知消息顺序与流式推送优化 - 变更总结

> **变更 ID**：`20260704190748-IM通知消息顺序与流式推送优化`  
> **来源**：kb-propose · standard flow  
> **阶段**：`archived_with_debt`（T1–T5 + T-FIX-1~4 + Rev2 T-Rev2-01~04 代码与静态验收通过；04-review 通过；**E10 / 08-verify 第 2 轮 E2E 待维护者复验**；E1–E9 飞书私聊手工待测）  
> **关联验收打回**：`08-verify-issue.md` 第 1 轮 assistant 重复；第 2 轮要求过程实时、答复收尾流式（Rev2）

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

### 1.2 代码（Rev2：T-Rev2-01~04 end-only assistant IM）

| 任务 | 文件 | 关键改动 |
|------|------|----------|
| **T-Rev2-01** | `electron/agent/cursor-sdk/sdk-run-presentation.ts` | `shouldEndOnlyAssistantDefer` 门控：含实质过程 Run 期间 mid-run 不 release assistant；delta 累积 defer 至 Run 收尾 |
| **T-Rev2-01** | `electron/agent/cursor-sdk/sdk-run-stream.ts` | 配合 end-only 门控；Run 收尾 `flushStreamPost(session, true)` 保留为唯一 assistant 首建/完结路径 |
| **T-Rev2-02** | `src/daemon/daemon.ts` | ordering 路径禁用 process-idle `enqueueRelease`；`handleStreamText` 过程未结束 non-final 仅 defer 累积；final 经 `assistantReleaseChain` 首建+完结；T-FIX-1 串行链与 T-FIX-4 飞行窗口保留 |
| **T-Rev2-03** | `06-automation-test.md` | E10 去重验收项与 Rev2 end-only 契约静态核对 |
| **T-Rev2-04** | `electron/agent/cursor-sdk/AGENTS.md`、`src/daemon/AGENTS.md`、`knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | §3.4 end-only assistant IM：过程实时里程碑、答复仅 Run 收尾首建流式 |

**用户可见行为（含 Rev2）**：

- **过程实时推送**：思考 / notify 级工具 / task 过程里程碑在 Run 期间**实时**推送飞书 IM，顺序与 SDK 发生一致（F1/F3/F6.1/F8）。
- **assistant end-only**：含实质过程的 Run 期间 **零** assistant IM 出站；仅在 Run 收尾、过程全部结束后 **首建** 单条 assistant CardKit 并以流式 PATCH 增长至 final（F2.2/F8）；无实质过程短问答（F5）仍允许 preamble 短窗及时首包。
- **修复 assistant 重复发送**：08-verify 第 1/2 轮反馈的「完全相同文案出现两次」——经 T-FIX-1/2/4 消除并发 release 双首建，Rev2 end-only 废弃 mid-run release 为主路径，单 Run 预期单条 assistant 消息（验收 10–11 / E10）。
- **read / glob 等 silent 工具**：仍不出站 IM 过程通知、不置 ordering 闩（F4）。
- **微信 CardKit 私聊**：非抑制路径 diff 为零，行为不变。

**不变**：`sdk-tool-presentation-tier.ts` 工具分级；`feishu-presentation-gate.ts` 呈现抑制判定；MergeBatch 与 `getPresentationReplyAnchor`；三态进度与 `stop_progress`；`PRESENTATION_ORDERING` MVP 范围（主用户私聊）；Claude/Codex/OpenCode 引擎。

### 1.3 变更文档

| 文件 | 说明 |
|------|------|
| `00-manifest.json` | T1–T5、T-FIX、T-Rev2 done；Rev2 completed；reviews R1 fixed、R-D1~R-D4 accepted_debt |
| `01-proposal.md` | 产品 PRD（F1–F8、验收 1–11） |
| `02-design.md` | 方案设计（ordering 闩 + Rev2 end-only assistant IM） |
| `03-tasks.md` | T1–T5 + T-FIX + T-Rev2 任务清单 |
| `04-review.md` | focused-review 通过 |
| `06-automation-test.md` | 静态 + E1–E10 联调清单 |
| `07-prd-revisions.md` | Rev2 PRD 修订记录 |
| `08-verify-issue.md` | 第 1/2 轮验收打回与根因 |
| `05-summary.md` | 本文件 |

### 1.4 版本与 changelog

| 文件 | 说明 |
|------|------|
| `package.json` | `1.13.4` |
| `changelog/1.13.2.json` | T1–T5：过程通知顺序先于答复 |
| `changelog/1.13.3.json` | T-FIX：修复 assistant 重复发送 |
| `changelog/1.13.4.json` | Rev2：过程实时 + assistant 收尾流式 + 去重 |

---

## 2、与设计的差异

与 `02-design` / `03-tasks` 核心契约一致；T-FIX 为 08-verify 第 1 轮缺陷修复；Rev2 为第 2 轮产品澄清（end-only assistant IM），无阻断性设计偏差。

| 项 | 设计预期 | 实际 | 评估 |
|----|----------|------|------|
| S6-E1：移除 task/飞书抑制早退 | `markProcessEventSeen` 统一置闩 | 一致 | ✅ |
| Rev2 end-only assistant IM | 过程实时；Run 期间零 assistant IM；收尾首建流式 | T-Rev2-01/02 落地 | ✅ |
| S7 idle release | 原设计 idle → release | Rev2 废弃 mid-run release 为主路径 | ✅（Rev2 有意变更） |
| 08-verify：消除 assistant 双首建 | chain 串行 + end-only | T-FIX + Rev2 对齐 | ✅ |
| T5/T-Rev2-04 三份文档同步 | AGENTS ×2 + `06-CursorSDK执行引擎.md` | 已更新 §3.4 | ✅ |

### 2.1 评审项

| ID | 状态 | 说明 |
|----|------|------|
| **R1** | **fixed**（T-FIX-4） | 飞行窗口竞态 → 门控 + impl try/catch 回滚 |
| **R-D1~R-D4** | accepted_debt | 双侧闩不对称、纯 task release、跨通道时序、链外层吞异常 |

---

## 3、影响范围

- **主用户飞书私聊 + Cursor SDK**：ordering 闩与呈现形态解耦；Rev2 end-only assistant IM；T-FIX 修复 assistant 重复首建。
- **Electron defer 链**：thinking / notify tool / task 均参与 defer；assistant delta Run 期间累积；Run 收尾单 final POST 首建。
- **Daemon 里程碑路径**：过程里程碑实时出站；`assistantReleaseChain` 串行 release 仅于 Run 收尾触发。
- **IM 阅读体验**：长任务过程序列稳定于结论之上；单 Run 单条 assistant 消息。

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `src/daemon/daemon.ts` ~L583 `releaseDeferredAssistantStreamImpl` | 异步发送前占位，避免并发 release 重复首建；发送完全失败则回滚 | 占位 + try/catch 回滚；部分成功场景依赖通道幂等 |
| `src/daemon/daemon.ts` ~L667 `enqueueReleaseDeferredAssistantStream` | 复用 Electron `streamPostChain` 模式串行化 release | 链式 Promise 非独立队列；外层 `.catch` 仅 WARN（R-D4） |
| `src/daemon/daemon.ts` ~L734 `handleStreamText` ordering 分支 | 飞行窗口门控 — release 已占位但 outbound 尚未写入时等待 chain | 非 final 返回 `deferred: true`；跨通道 Run final 近时序（R-D3） |

---

## 4、知识库影响清单

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — §3.4 end-only assistant IM、过程实时里程碑（T5 + T-Rev2-04）

### （二）可能更新

- [x] `electron/agent/cursor-sdk/AGENTS.md` — end-only defer、Run 收尾单 final flush（T5 + T-FIX-3 + T-Rev2-04）
- [x] `src/daemon/AGENTS.md` — 飞书里程碑 sent 闩、enqueue release 链、end-only release（T5 + T-FIX + T-Rev2-04）

### （三）不需要更新

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — 无新降级类型
- [x] 工具分级、MergeBatch、三态、其他引擎文档 — 行为不变或非触达
- [x] 知识索引 — 无新子模块入口

---

## 5、遗留债务与归档结果

| 来源 | 债务 | 级别 | 阻塞 archive |
|------|------|------|--------------|
| **E10** | Rev2 去重 + end-only — 飞书私聊含工具 Run 手工复验 | E2E 手工 | **否** |
| **E1–E9** | 01 验收 1–9 飞书私聊联调 | E2E 手工 | **否** |
| **R-D1~R-D4** | accepted_debt | info | **否** |

| 项 | 值 |
|----|-----|
| **归档阶段** | `archived_with_debt` |
| **最高优先 E2E** | **E10**（单 Run 单条 assistant + 过程结束前零 assistant IM） |
| **版本** | `1.13.4` |
| **目录迁移** | `knowledge/变更/归档/20260704190748-IM通知消息顺序与流式推送优化/` |
