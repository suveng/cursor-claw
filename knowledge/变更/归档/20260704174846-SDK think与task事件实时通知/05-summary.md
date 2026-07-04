# SDK think与task事件实时通知 - 变更总结

> **变更 ID**：`20260704174846-SDK think与task事件实时通知`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（待 `/kb-test` E2E 勾选与 `/kb-archive`）  
> **范围**：T1–T6；R1/R2 评审修复已关闭

---

## 1、实际变更

### 代码（与 manifest.files code 一致）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/sdk-session-types.ts` | `PresentationKind` 扩展 `"task"`；`PresentationEvent` 新增 `task_status?`、`task_text?` |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | 独立 `case "task"` → `mapTaskMilestoneText` + `postPresentationEvent`；**不**调用 `markProcessEventSeen`；thinking/tool 仍调用 `markProcessEventSeen(session, kind)` |
| `electron/agent/cursor-sdk/sdk-run-presentation.ts` | 移除飞书 early return，抑制场景仍 POST 由 Daemon 降级；`markProcessEventSeen` 门控：飞书抑制或 `kind==="task"` 不置 defer 闩；`maybeReleaseDeferredAssistant` 与 Run 收尾 flush 条件扩展为 `seenProcessEvent \|\| presentationDeferStream`（R2） |
| `src/shared/feishu-presentation-gate.ts` | `isFeishuProcessPresentationSuppressed` 抑制 kind 含 `task`（仅抑制 CardKit，不禁止出站） |
| `src/daemon/daemon-presentation-milestone.ts` | **新建**（125 行）：飞书抑制路径里程碑 `send-text` 降级；`MILESTONE_THROTTLE_MS=3000`、`MILESTONE_MAX_PER_RUN=4`；节流键 `sessionKey:kind:hash(text)`；Run 级去重；`clearMilestoneState` |
| `src/daemon/daemon.ts` | `handleTaskPresentationEvent` 路由；thinking/tool/task 飞书抑制分支改 `sendMilestoneText` 后 `return`；ordering 闩（`presentationProcessActive`/`activeToolNames`/`thinkingOpen`）**仅** CardKit 路径更新（R1）；`stopSessionProgress` 清里程碑状态 |

**用户可见行为**：

- Cursor SDK 运行期间 **task** 里程碑（子任务启动/进行中/完成/失败）经 presentation 链路出站，文案由 SDK `status`/`text` 映射。
- 飞书私聊/群聊：thinking/tool/task 仍抑制 CardKit，改为节流后单条 **send-text** 里程碑，满足最低可见性（F1.4/F4.2）。
- 飞书抑制或 task 过程事件**不**触发 assistant defer；短问答首包时序与现网对齐（R1/R2）。
- 微信/任务面板：task 走 CardKit 或 send-text，与 thinking/tool 模式一致。

**不变**：Claude/Codex/OpenCode 引擎；`STREAM_POST_INTERVAL_MS=400`；MergeBatch；三态「Agent 处理中…」语义；里程碑不带 `message_id`/`stop_progress`。

### 变更文档

- `00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `05-summary.md`（本文件）

**版本与 changelog**：本轮不写（归 `/kb-archive` + kb-release）。

---

## 2、与设计的差异

与 `02-design` 主方案一致；R1/R2 修复后以设计 §2 方案要点 3、§4 契约为准（抑制场景不置 defer 闩 / ordering 闩仅 CardKit 路径）。

| 项 | 设计预期 | 实际 | 评估 |
|----|----------|------|------|
| task 出站 + 文案映射（S5） | `postPresentationEvent({ kind:"task", ... })` | `mapTaskMilestoneText` + 独立 `case "task"` | ✅ |
| 飞书仍 POST、Daemon 降级（S10-F） | 移除 Electron 飞书 early return | `postPresentationEvent` 全通道 POST | ✅ |
| `markProcessEventSeen` 门控（S7） | 抑制或 task 不置 defer | 传入 `kind`；早退不置 `seenProcessEvent`/`presentationDeferStream` | ✅ |
| 里程碑节流 ≥3s、同文案 ≤4/Run | T4 | `daemon-presentation-milestone.ts` 常量与去重 | ✅ |
| task 不参与 ordering 闩 | T5 | `handleTaskPresentationEvent` 仅里程碑文本 | ✅ |
| 飞书抑制仍更新 ordering 闩 | T5 初稿字面 | R1 后抑制路径**不**置 `presentationProcessActive` 等 | ⚠️ 与 T5 初稿略出入，**符合** 02 §2 要点 3；以设计为准 |
| defer 释放条件 | 仅 `seenProcessEvent` | R2：`seenProcessEvent \|\| presentationDeferStream` | ✅ 设计意图闭合 |

**accepted_debt**（非阻断，archive 可顺手）：

| ID | 说明 |
|----|------|
| L450 | `daemon.ts` 飞书门控注释仍写「ordering 闩仍须更新」；R1 后应改为「里程碑降级，不置 ordering 闩」 |
| E2E | 01 验收 1–7、02·八·（二）1–6 代码路径已满足；E2E 勾选待 `/kb-test` |

---

## 3、影响范围

- **Cursor SDK 路径**：thinking/tool/task 过程事件均可感知；飞书为里程碑文本降级，微信为 CardKit/文本。
- **飞书消息频率**：长任务里程碑略增；3s 节流 + 同文案 Run 级 ≤4 条兜底。
- **PRESENTATION_ORDERING**：飞书抑制场景 assistant 不再被无 CardKit 的过程闩误 defer；与变更 `20260627210352` 互补。
- **Daemon**：新增 `daemon-presentation-milestone.ts` 模块；`handlePresentationEvent` 路由扩展 `task`。
- **非目标**：其他执行引擎、Electron 设置 UI、proto/DB、通道凭据配置未改。

### 3.1 Ponytail 技术债

无（本变更 diff 未新增 `ponytail:` 注释；`daemon.ts` L1358 既有 T7 注释非本变更新增）。

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；供 `/kb-archive` 步骤 6（kb-librarian）消费。

### （一）必须更新

- [ ] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — thinking/task 出站；`markProcessEventSeen` defer 门控；`mapTaskMilestoneText`；R2 defer 释放条件
- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md` — 抑制 CardKit 改为里程碑 `send-text` 降级；节流/去重策略

### （二）可能更新（视 archive 细化）

- [ ] `electron/agent/cursor-sdk/AGENTS.md` — 飞书仍 POST；task 分支；defer 门控与 `presentationDeferStream` 释放
- [ ] `src/daemon/AGENTS.md` — `handleTaskPresentationEvent`；飞书 Presentation 段由「静默 `{ ok: true }`」改为 `sendMilestoneText`；ordering 闩仅 CardKit 路径（R1）

### （三）不需要更新

- [ ] 微信通道细节（复用 thinking/tool 模式，无新协议）
- [ ] Claude/Codex/OpenCode 引擎文档
- [ ] Electron 设置 UI
- [ ] `changelog/`、`package.json` 版本（kb-release / archive 处理）
