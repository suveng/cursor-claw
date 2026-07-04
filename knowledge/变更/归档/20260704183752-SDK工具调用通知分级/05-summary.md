# SDK 工具调用通知分级 - 变更总结

> **变更 ID**：`20260704183752-SDK工具调用通知分级`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（S-A 冒烟 PASS；S-B～S-E IM E2E 待维护者手测；可 `/kb-archive`）  
> **范围**：T1–T3；04-review R-compliance-1 通过（W1 已修；W2 可选单测不阻断）

---

## 1、实际变更

### 代码（与 manifest.files code 一致）

| 文件 | 关键改动 |
|------|----------|
| `src/shared/sdk-tool-presentation-tier.ts` | **新建**（25 行）：`SdkToolPresentationTier`、`resolveSdkToolPresentationTier`；notify 白名单 `shell`/`write`/`strreplace`/`delete`/`task`；`toLowerCase().trim()` 后查表，未命中默认 `silent` |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | `case "tool_call"` 引入分级门控：`resolveSdkToolPresentationTier(event.name)`；**notify** 保留 `markProcessEventSeen` + `postPresentationEvent` + `maybeReleaseDeferredAssistant`；**silent** 跳过 presentation 与 defer 闩；`pushUiLog` `[tool]`、`session.lastTool`、`runPhase`、watchdog 副作用**全量**不变；`thinking`/`task` 分支零改动 |
| `electron/agent/cursor-sdk/AGENTS.md` | Presentation 出站段落补充 **tool_call 分级门控**：thinking/task 始终 POST；tool_call 仅 notify 白名单 POST；引用 `sdk-tool-presentation-tier.ts` |
| `src/shared/AGENTS.md` | 目录职责表新增 `sdk-tool-presentation-tier.ts` 一行（SDK tool_name → notify/silent SSOT） |

**用户可见行为**：

- Cursor SDK 运行期间 **read / glob / grep / SemanticSearch** 等只读探查类 `tool_call` **默认不向 IM 出站**过程推送，显著减少过程流刷屏。
- **shell / Write / StrReplace / Delete / Task(tool)** 等高价值动手类工具仍及时出站，语义可区分命令执行、写入、删除与子 Agent 派发。
- **thinking / task** 里程碑与实时通知**不受本次分级影响**，与归档变更 `20260704174846` 行为一致。
- read/glob 密集任务不再误触 `markProcessEventSeen("tool")`，assistant 首包在 PRESENTATION_ORDERING 场景下预期更快（与 think/task 变更互补）。
- Electron UI 日志 `[tool]` 仍记录全量工具调用（含 silent），满足开发者/运维排障（01 边界）。

**不变**：`src/daemon/daemon.ts`、飞书 presentation gate、Claude/Codex/OpenCode/CC 引擎、三态语义、MergeBatch、通道凭据配置。

### 变更文档

- `00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `05-summary.md`（本文件）

**版本与 changelog**：本轮不写（归 `/kb-archive` + kb-release）。

---

## 2、与设计的差异

与 `02-design` / `03-tasks` 核心契约一致；唯一字面出入以 T2 契约为准：

| 项 | 设计预期 | 实际 | 评估 |
|----|----------|------|------|
| 唯一门控在 `sdk-run-stream` `case "tool_call"` | `resolveSdkToolPresentationTier` + `if (tier === "notify")` | 一致 | ✅ |
| notify 白名单五项（§1.4） | Set 查表 + 大小写不敏感 | `NOTIFY_TOOL_NAMES` 五项 | ✅ |
| silent 跳过 mark+post（S6s） | tier=silent 不进入 presentation 块 | 一致 | ✅ |
| UI 日志 / lastTool 全量（§1.1） | 门控前 `pushUiLog`、`session.lastTool` | 一致 | ✅ |
| thinking / task 零改动 | 分支 diff 无逻辑变更 | 一致 | ✅ |
| §4 表 silent `maybeReleaseDeferredAssistant`「已有闩时按现网」 | T2 契约：silent 完成态**一律跳过** release | 一致 | ✅（符合 §2 根因 2，避免 read burst 误释放） |
| `06-CursorSDK执行引擎.md`（§10.1） | archive 阶段更新 | 未改（留 archive） | ✅ 符合任务边界 |

**accepted_debt**（非阻断）：

| ID | 说明 |
|----|------|
| W2 | 分级函数无自动化单测，S-A 冒烟已 PASS；可选补 `sdk-tool-presentation-tier.test.ts` |
| E2E | 01 验收 1–6、02·八·（二）1–6 代码路径已满足；S-B～S-E 待维护者手测（不阻断 archive） |

---

## 3、影响范围

- **仅 Cursor SDK** `tool_call` 用户侧过程出站；daemon 收到即呈现，**不**二次分级。
- **IM 过程消息量**：read/glob burst 不再产生 `presentation-event`，长任务过程条数预期明显下降；notify 类工具频率与现网一致。
- **PRESENTATION_ORDERING**：silent 工具不置 `seenProcessEvent`/`presentationDeferStream`，与变更 `20260704174846`（think/task defer 门控）互补。
- **飞书**：silent 工具不再 POST，里程碑 spam 进一步减少；notify 工具仍走 daemon 降级里程碑。
- **非目标**：其他执行引擎、Electron 设置 UI、用户可配置通知开关、proto/DB 未改。

### 3.1 Ponytail 技术债

无（本变更 diff 未新增 `ponytail:` 注释；实现为 25 行 Set 纯函数 + `sdk-run-stream.ts` 单点 `if`，无 daemon 二次分级、无配置开关、无事件总线，符合 02 §2 Ponytail 三问）。

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；供 `/kb-archive` 步骤 6（kb-librarian）消费。

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — §二 tool_call 分级原则（notify vs silent）、`markProcessEventSeen` 仅 notify 触发、UI 日志全量；§三 `handleSdkEvent` tool 分支；§八 read/glob 默认不出站 IM；§十 变更记录

### （二）可能更新（视 archive 细化）

- [x] `electron/agent/cursor-sdk/AGENTS.md` — 本变更已更新 tool_call tier 门控与文件引用（T3）
- [x] `src/shared/AGENTS.md` — 本变更已新增 `sdk-tool-presentation-tier.ts` 索引（T3）

### （三）不需要更新

- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md`（无新降级类型；daemon 不改）
- [ ] Claude/Codex/OpenCode 引擎文档
- [ ] Electron 设置 UI
- [ ] 知识索引（`knowledge/**/00-README.md` 等）
- [ ] `changelog/`、`package.json` 版本（kb-release / archive 处理）
