# Claude Code 飞书通知对齐 Cursor SDK - 变更总结

> **变更 ID**：`20260705004707-ClaudeCode飞书通知对齐CursorSDK`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested` → `ready_for_archive`（T1–T6 done；T7 in_progress；04-review R1 conditional_pass；E1–E5 飞书真机未测，06 已标注跳过）  
> **范围**：T1–T6 代码与契约文档；T7 知识库 / changelog / 版本 bump 待 archive 后续步骤

---

## 1、实际变更

### 代码（与 manifest.files 一致）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/shared/tool-presentation-dedup.ts` | **新建**（82 行）：自 `sdk-tool-event-dedup.ts` 抽取；`ToolPresentationDedupSession` 切片、`shouldSkipToolCallRunningPresentation`、`isRedundantTaskEventAfterToolCall`；SDK/CC 共用 |
| `electron/agent/cursor-sdk/sdk-tool-event-dedup.ts` | 薄 re-export → shared dedup |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | dedup import 改路径；tier 入口改调 `normalizePresentationToolName`（幂等兼容 canonical 名） |
| `src/shared/tool-presentation.ts` | `normalizePresentationToolName`；`extractShellPresentationFields` / `extractTaskPresentationFields` 扩展 CC 字段形态 |
| `src/shared/sdk-tool-presentation-tier.ts` | tier 解析前 normalize；CC 工具名别名对齐 notify 白名单 |
| `electron/agent/claude-code/agent-cc-types.ts` | `taskSeq`、`lastToolCallRunningDedupKey` 去重状态字段 |
| `electron/agent/claude-code/agent-cc-utils.ts` | `resetCcRunPresentationState` 清零 presentation 去重状态 |
| `electron/agent/claude-code/agent-cc-stream.ts` | **删除** `feishuSuppressesProcessKind` 飞书早退；`markProcessEventSeen(session, kind)` 对齐 SDK |
| `electron/agent/claude-code/agent-cc-events.ts` | 分级门控挂接；thinking/tool 分支 kind 传参；`agent-cc-presentation-tool` 拆分引用 |
| `electron/agent/claude-code/agent-cc-presentation-tool.ts` | **新建**：`resolveSdkToolPresentationTier` 门控；silent 跳过 mark+POST；notify 透传 shell/task 字段 + 去重 |
| `electron/agent/claude-code/AGENTS.md` | §Presentation 契约：禁止飞书早退、分级对称 SDK、dedup 路径、ordering 闩 |
| `electron/agent/shared/AGENTS.md` | 模块边界表新增 `tool-presentation-dedup.ts` 一行 |

**用户可见行为（T1–T6 代码层）**：

- Claude Code 飞书路径**不再**在 Electron 侧因 `feishuSuppressesProcessKind` 早退跳过 presentation POST；thinking/tool 事件仍发往 daemon，由 daemon 决定飞书里程碑出站（thinking 零出站与 SDK 一致）。
- CC 应用与 Cursor SDK 相同的 **notify/silent 分级**：Read/Glob 等只读探查默认不向 IM 出站；Bash/Write/Delete/Task 等动手类仍出站。
- Bash/Task **开始态**携带命令摘要或任务描述（`extractShell*` / `extractTask*` + `taskSeq` 降级 `#N`）。
- 相邻相同 running 去重、Task 双推抑制与 SDK 共用 shared dedup 模块。
- Electron UI `[tool]` / `lastTool` 在 tier 判断前全量记录，排障可观测性不变。

**不变**：`src/daemon/daemon.ts` presentation handlers；Codex/OpenCode 飞书早退（后续）；通道凭据与 MergeBatch 策略。

### 变更文档

- `00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `05-summary.md`（本文件）

### 知识库 / 版本（T7 待办，本步骤未写入）

| 文件 | 状态 |
|------|------|
| `knowledge/业务域/消息桥接/02-飞书通道.md` | T7 待 kb-librarian 补「多引擎统一契约」 |
| `src/shared/AGENTS.md` | T7 待补 `normalizePresentationToolName` 索引（W3） |
| `package.json` | 未 bump（当前 `1.13.9`） |
| `changelog/` | 未新建版本条目 |

---

## 2、与设计的差异

与 `02-design` / `03-tasks` T1–T6 核心契约一致；04-review 无阻断性设计偏差。

**accepted_debt / 已知非阻断**：

| ID | 说明 |
|----|------|
| **W1** | `tool_progress` 去重键与先前 `tool_use`（含 `input`）可能不一致；极端场景 notify 工具或二次 running POST；E5 真机观察 |
| **W5** | CC 仍在每轮 `assistant` 调 `maybeReleaseDeferredAssistant`（02 R4 ordering Rev2 不对称）；本单主验收聚焦飞书过程出站，验收 3 编排失败另开子任务 |
| **W2** | E1–E5 飞书/CC vs SDK 并排验收无仓库内留证；用户明确要求 archive+push，06 已标注手工跳过 |
| **W3/W4** | `src/shared/AGENTS.md` 与自动化单测归 T7 / 可选 |

---

## 3、影响范围

- **Claude Code 引擎**飞书过程出站：分级、开始态文案、去重、ordering 闩与 Cursor SDK 对称；daemon 收到即呈现，**不**二次分级。
- **Cursor SDK**：仅 dedup import 路径与 tier 入口 normalize，**无**行为回归（04-review 确认）。
- **IM 过程消息量**：CC 路径 Read/Glob burst 预期与 SDK 一样不再产生 tool 里程碑 spam；notify 类工具频率与文案丰富度对齐 SDK。
- **PRESENTATION_ORDERING**：CC thinking/tool notify 恢复 POST + `markProcessEventSeen(session, kind)`，assistant defer 闩行为改善；W5 mid-run release 不对称为已知遗留。
- **非目标**：Codex/OpenCode 引擎、Electron 设置 UI、用户可配置通知开关、proto/DB 未改。

### 3.1 Ponytail 技术债

无（本变更 diff 未新增 `ponytail:` 注释；实现为 shared dedup 抽取 + `agent-cc-presentation-tool.ts` 单点门控，无 daemon 二次分级、无配置开关、无事件总线）。

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；供 archive 步骤 6（kb-librarian）与 T7 消费。

### （一）必须更新

- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md` — 多引擎飞书过程通知统一契约；分级表；Electron 不早退；thinking 零出站 + ordering 闩；CC 本次对齐、Codex/OpenCode 后续
- [x] `electron/agent/claude-code/AGENTS.md` — T6 已补 §Presentation 对称 SDK
- [ ] `package.json` + `changelog/<新版本>.json` — 用户可见体验对齐 → patch bump（T7 / kb-release）

### （二）可能更新（视 archive 细化）

- [ ] `src/shared/AGENTS.md` — `normalizePresentationToolName` 与 presentation 段（W3；T7）
- [x] `electron/agent/shared/AGENTS.md` — 本变更已新增 `tool-presentation-dedup.ts` 索引
- [ ] `knowledge/业务域/Agent调度/` CC 引擎文档 — 若与 AGENTS 重复，archive 时择一补交叉链接

### （三）不需要更新

- [ ] `src/daemon/AGENTS.md` — daemon 行为本单不改
- [ ] `electron/agent/codex/AGENTS.md`、`electron/agent/opencode/AGENTS.md` — 非本次范围
- [ ] `knowledge/变更/归档/20260704212716-*` — 已 merged_into 20260704212706
- [ ] 知识索引（`knowledge/**/00-README.md` 等）— 无结构性入口变更
