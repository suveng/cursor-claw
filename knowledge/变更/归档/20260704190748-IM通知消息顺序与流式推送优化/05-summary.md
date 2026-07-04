# IM 通知消息顺序与流式推送优化 - 变更总结

> **变更 ID**：`20260704190748-IM通知消息顺序与流式推送优化`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（静态冒烟 PASS；E1–E9 飞书私聊 E2E 待维护者手测；可 `/kb-archive`）  
> **范围**：T1–T5；04-review 通过（R-D1/R-D2 accepted debt；无 open 严重/警告）

---

## 1、实际变更

### 代码（与 manifest.files code 一致）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/sdk-run-presentation.ts` | **T1**：`markProcessEventSeen` 移除 `kind==="task"` 与 `feishuSuppressesProcessKind` 早退；保留 `presentationOrderingEligible` 门控；thinking/tool/task 均置 `seenProcessEvent` + `presentationDeferStream` 并 `clearStreamPostTimer` |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | **T3**：`case "task"` 在 `postPresentationEvent` 前补 `markProcessEventSeen(session, "task")`；thinking/tool 分支零行为改动 |
| `src/daemon/daemon-presentation-milestone.ts` | **T2**：`sendMilestoneText` 返回 `Promise<boolean>`；空文案/节流/去重/失败 → `false`；里程碑实际出站 → `true` |
| `src/daemon/daemon.ts` | **T4**：飞书抑制分支 `sendMilestoneText` 成功后、仅 `sent === true` 时 mirror ordering 闩——thinking 更新 `thinkingOpen`/`presentationProcessActive`；tool 更新 `activeToolNames`/`presentationProcessActive`；task 仅置 `presentationProcessActive`；过程 idle 仍 `releaseDeferredAssistantStream` |
| `electron/agent/cursor-sdk/AGENTS.md` | **T5**：Presentation 时序编排补充「飞书呈现抑制 ≠ 不参与 ordering defer」；task 参与 defer 闩 |
| `src/daemon/AGENTS.md` | **T5**：飞书抑制里程碑路径 sent 后 mirror 编排字段语义 |
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | **T5**：§二/§三 `markProcessEventSeen`、task 参与 ordering、里程碑 sent 闩锁描述 |

**用户可见行为**：

- **飞书私聊 IM**：思考 / notify 级工具 / task 过程里程碑**先于** assistant CardKit 流式答复首包出现；时间轴自上而下与 SDK 发生顺序一致。
- **答复仍流式**：过程 idle 或 Run 收尾后 assistant 首建，后续 PATCH 持续增长，非一次性长文。
- **read / glob 等 silent 工具**：仍不出站 IM 过程通知、不置 ordering 闩（工具分级逻辑未改）。
- **短问答**：无实质过程时 preamble 400ms 短窗路径未改，首包时延预期与变更前相当。
- **微信 CardKit 私聊**：非抑制路径 diff 为零，行为不变。

**不变**：`sdk-tool-presentation-tier.ts` 工具分级；`feishu-presentation-gate.ts` 呈现抑制判定；MergeBatch 与 `getPresentationReplyAnchor`；三态进度与 `stop_progress`；`PRESENTATION_ORDERING` MVP 范围（主用户私聊）；Claude/Codex/OpenCode 引擎。

### 变更文档

- `00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `05-summary.md`（本文件）

**版本与 changelog**：本轮不写（归 `/kb-archive` + kb-release）。

---

## 2、与设计的差异

与 `02-design` / `03-tasks` 核心契约一致；无阻断性设计偏差（04-review §4 全部 ✅）。

| 项 | 设计预期 | 实际 | 评估 |
|----|----------|------|------|
| S6-E1：移除 task/飞书抑制早退 | `markProcessEventSeen` 统一置闩 | 一致 | ✅ |
| S4-Task-E：task 分支前置闩 | `postPresentationEvent` 前 `markProcessEventSeen` | 一致 | ✅ |
| S4-M-Ret：`sendMilestoneText` 返回 boolean | 节流/去重/空/失败 → false | 一致 | ✅ |
| S4-M-T/Tool/Task：飞书抑制 + sent 后 mirror 闩 | thinking/tool mirror CardKit 字段；task 仅 `presentationProcessActive` | 一致 | ✅ |
| 呈现抑制 ≠ 不参与 ordering defer | Electron 仍 POST 并置闩；Daemon sent 后 mirror | 一致 | ✅ |
| task 不单独 release | 依赖 thinking/tool idle 或 Run final flush | 一致 | ✅ |
| 工具分级 / MergeBatch / 三态不改 | 无相关 diff | 一致 | ✅ |
| T5 三份文档同步 | AGENTS ×2 + `06-CursorSDK执行引擎.md` | 已更新 | ✅ |

**accepted_debt**（非阻断）：

| ID | 说明 |
|----|------|
| R-D1 | Electron 过程事件到达即置 defer 闩；Daemon 飞书里程碑仅在 `sent === true` 时置 `presentationProcessActive`——双侧触发条件不完全对称；节流跳过时 Electron 已 defer、Daemon 不置闩属合理，`streamRunEvents` final flush 兜底 |
| R-D2 | 纯 task 场景 mid-run 不单独 `releaseDeferredAssistantStream`，依赖 thinking/tool idle 或 Run final；02 §6 步骤 5、§8.1 风险已写明 |
| E2E | 01 验收 1–9、02 §8.2 工程补充 1–8 代码路径已满足；E1–E9 飞书私聊手工待维护者执行（06 §7；不阻断 archive） |

---

## 3、影响范围

- **主用户飞书私聊 + Cursor SDK**：ordering 闩与呈现形态解耦，修复「结论抢先于过程里程碑」根因。
- **Electron defer 链**：thinking / notify tool / task 均参与 `seenProcessEvent` / `presentationDeferStream`；assistant delta 在过程活跃时累积 defer。
- **Daemon 里程碑路径**：`sendMilestoneText` 真实出站后 mirror CardKit 路径等价的 `SessionProgressState` 编排字段；`handleStreamText` defer 判定输入修正。
- **IM 阅读体验**：长任务过程序列稳定于结论之上；与归档变更 `20260704174846`（think/task defer）、`20260704183752`（tool 分级 silent）互补。
- **非目标**：飞书群聊 ordering 扩展、微信/其他引擎、Electron 设置 UI、用户可配置通知开关、proto/DB 未改。

### 3.1 Ponytail 技术债

无（本变更 diff 未新增 `ponytail:` 注释；改动集中于 4 个运行时文件 + 3 份文档同步；复用既有 `markProcessEventSeen` / `sendMilestoneText` / `SessionProgressState` 字段，无新抽象层、无配置开关扩展、无事件总线，符合 02 §2 最小方案三问）。

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；供 `/kb-archive` 步骤 6（kb-librarian）消费。

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — §二 PRESENTATION_ORDERING、§三 `markProcessEventSeen`/task 规则、飞书抑制仍 POST 且置闩、里程碑 sent 闩锁

### （二）可能更新（视 archive 细化）

- [x] `electron/agent/cursor-sdk/AGENTS.md` — 本变更已更新：抑制≠defer、task 参与 ordering（T5）
- [x] `src/daemon/AGENTS.md` — 本变更已更新：飞书抑制里程碑 sent 后 mirror 编排字段（T5）

### （三）不需要更新

- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md`（无新降级类型；门控逻辑未改）
- [ ] `src/shared/sdk-tool-presentation-tier.ts` 及工具分级知识（行为不变）
- [ ] MergeBatch、三态进度、里程碑节流参数文档
- [ ] Claude/Codex/OpenCode 引擎文档
- [ ] Electron 设置 UI
- [ ] 知识索引（`knowledge/**/00-README.md` 等）
- [ ] `changelog/`、`package.json` 版本（kb-release / archive 处理）
