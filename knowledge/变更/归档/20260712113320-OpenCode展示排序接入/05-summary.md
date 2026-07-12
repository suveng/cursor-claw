# OpenCode展示排序接入 - 变更总结

> **变更 ID**：`20260712113320-OpenCode展示排序接入`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（archive 步骤 5 完成；知识库正文待 librarian；迁移前 **勿** 标 archived；用户 orchestrator 请求带债务归档，建议最终形态 `archived_with_debt`）  
> **用户可见性**：是 — OpenCode 飞书私聊多 tool Run 接入与 Cursor 对称的 Presentation defer/Rev2 end-only 链；过程卡在上、assistant 结论在 Run 收尾释放

---

## 1、实际变更

### 1.1 变更摘要

OpenCode 流式出站接入 Presentation 展示排序门控，对称 Cursor `sdk-run-presentation.ts` Rev2 end-only 语义：thinking/notify 级 tool 置双侧闩；含过程 Run 期间 non-final assistant 仅累积 buffer、不 POST；Run 收尾 `flushOpencodeStreamPost(true)` 为唯一 assistant IM 出站；`PRESENTATION_ORDERING=0` 全链早退回滚现网直通。Daemon ordering 主链无改动，仅消费既有 `POST /api/stream-text` 与 `POST /api/presentation-event`。

### 1.2 代码（T1–T4）

| 任务 | 文件 | 关键改动 |
|------|------|----------|
| **T1** | `electron/agent/opencode/agent-opencode-stream.ts` | `markOpencodeProcessEventSeen` 增加 `presentationOrderingEligible` 门控，置 `seenProcessEvent` + `presentationDeferStream`；`postOpencodePresentationEvent` 移除飞书 `feishuSuppressesProcessKind` 早退，始终 POST 由 Daemon 双侧闩 |
| **T2** | `electron/agent/opencode/agent-opencode-events.ts` | `handlePartUpdated` tool `running` 接入 `resolveSdkToolPresentationTier`：notify 级置闩 + POST；silent 级仅 `pushUiLog`，不置闩不 POST |
| **T3** | `electron/agent/opencode/agent-opencode-stream.ts` | 内联 `shouldDeferOpencodeAssistantPost` / `shouldEndOnlyOpencodeAssistantDefer` / `isAwaitingFirstOpencodeProcessEvent` / `scheduleOpencodePreambleRelease`；`appendOpencodeStreamDelta` 与 `doFlushOpencodeStreamPost` non-final 早退（Rev2 end-only）；**未**新建 `agent-opencode-presentation.ts`（279 行 ≤300） |
| **T4** | `electron/agent/opencode/agent-opencode-complete.ts` | `completeOpencodeRun` 收尾前 `clearOpencodeStreamPostTimer`、final flush 后 `streamPostChain = undefined`；确认含过程 defer 场景唯一出站路径 |
| **T4** | `electron/agent/opencode/agent-opencode-utils.ts` | `resetOpencodeRunPresentationState` 补全 timer/链/`streamBuffer`/`outboundMessageId` 清零，避免跨 Run 串 POST |
| **T5** | `electron/agent/opencode/AGENTS.md` | 补充 Presentation 时序编排、defer/end-only、preamble、tool 分级与 Daemon 契约说明 |

**统计**：5 个 Electron 文件修改；`agent-opencode-stream.ts` 279 行；无新 HTTP 路由；无 Daemon 代码改动。

**未纳入（显式）**：`engine-port-adapter.ts` 终态模板；Codex ordering；Daemon `daemon-presentation-*.ts`；四引擎共用 Presentation 抽象层。

### 1.3 变更文档

| 文件 | 说明 |
|------|------|
| `00-manifest.json` | T1–T4 done；T5 pending；reviews T5-D1 accepted_debt |
| `01-proposal.md` | 产品 PRD（R1–R5、验收 1–5） |
| `02-design.md` | 方案设计（S3–S9、X-POST、Rev2 end-only 对称 Cursor） |
| `03-tasks.md` | T1–T5 任务分解 |
| `04-review.md` | focused-review **通过**（T1–T4 无阻断项） |
| `06-automation-test.md` | T1–T4 静态验收通过；T5 M1–M6 待手工 |
| `05-summary.md` | 本文件 |

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **defer 模块落点** | 优先 `agent-opencode-stream.ts`；超限拆 `agent-opencode-presentation.ts` | 全内联 stream（279 行） | **符合** — 04 Ponytail 批准，未预建拆分文件 |
| **S3–S9 / X-POST** | 过程闩、tool 分级、defer 链、final flush、飞书 POST 必达 Daemon | 与 `02`/`03` 逐步一致 | **无功能偏差** |
| **Daemon 主链** | 不改 | 未改 | **符合** |
| **T5 运行时验收** | 01 §六 + 02 §八·（二）六项 E2E | M1–M6 未执行（无飞书/Electron/Daemon 联调环境） | **accepted_debt** — 见 §5 |

其余与 `02-design.md` 一致，无阻断性设计偏差。

---

## 3、影响范围

- **模块**：`electron/agent/opencode/`（stream、events、complete、utils、AGENTS.md）；Daemon 仅消费既有 ordering API。
- **用户可见**：OpenCode 飞书私聊（f41 + `PRESENTATION_ORDERING=1`）多 tool Run 过程卡不抢 assistant 首屏；idle 后 deferred 正文完整释放；排序关闭行为回滚现网。
- **接口/proto**：无新增路由与契约变更。
- **数据**：无持久化变更；会话内存字段 `seenProcessEvent`/`presentationDeferStream`/`streamBuffer` 已有，本变更接入消费。
- **风险残留**：T5 运行时未证；知识库 `09-OpenCodeSDK执行引擎.md` §九 限制项待 librarian 归档更新。

### 3.1 Ponytail 技术债

本变更相关 diff（`agent-opencode-stream.ts` / `events.ts` / `complete.ts` / `utils.ts` / `AGENTS.md`）中 **无** `ponytail:` 注释。

> 说明：`electron/agent/opencode/agent-opencode-utils.ts:28` 存在既有 `ponytail: SDK 无 global.health…`，**不在本变更 diff 内**，不记入本表。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| （无） | — | — |

04-review Ponytail 轴结论：**Lean already. Ship.**（defer 链内联 stream，未预建四引擎共用层。）

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；由 **kb-librarian** 在 archive 步骤 6 落盘（本步骤 **不写** 业务域正文）。

### （一）必须更新

- [ ] `knowledge/业务域/Agent调度/09-OpenCodeSDK执行引擎.md` — 移除 §九「presentationOrderingEligible 未接入」限制项；补充 Presentation defer/Rev2 end-only、tool 分级、`agent-opencode-stream.ts` 参考锚点
- [x] `electron/agent/opencode/AGENTS.md` — Presentation 时序编排段落（已随 T5 apply 更新；librarian 写知识正文时须对齐）

### （二）可能更新（视 librarian 合并结果）

- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md` — 四引擎 presentation-event POST 口径表（OpenCode 纳入双侧门控）
- [ ] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — 交叉引用「OpenCode 已对齐 Rev2 end-only」一句（避免重复铺陈）

### （三）不需要更新

- [x] Daemon 工程平台分区正文 — 行为未改，仅 OpenCode 客户端接入
- [x] Proto / Flutter / Quasar 分区
- [x] `knowledge/业务域/Agent调度/08-CodexSDK执行引擎.md` — Codex ordering 不在本变更范围
- [x] `knowledge/知识索引.md` — 入口结构无变化

---

## 5、验收与遗留债务

| 维度 | 状态 |
|------|------|
| **T1–T4** | done（manifest `tasks[]`；静态证据见 06 §3/§7） |
| **04-review** | ✅ 通过（T1–T4 无严重/警告） |
| **06 静态** | ✅ T1–T4 grep/行数/符号核对通过 |
| **06 M1–M6** | ⏳ **accepted_debt** — 飞书/Electron/Daemon 运行时待手工；不阻断本步骤文档准备 |
| **01 §六 AC1–AC5** | ⏳ 代码路径静态对齐；⏳ 端到端以 M1–M6 为准 |
| **知识库 §十** | ⏳ 待 librarian 步骤 6（非代码债） |

### 遗留债务（写入 `reviews[]`，建议迁移时 `archived_with_debt`）

| ID | 来源 | status | 摘要 |
|----|------|--------|------|
| T5-D1 | 04 §7 / 06 §2/§7 | accepted_debt | T5 M1–M6 运行时验收未执行：`PRESENTATION_ORDERING=0/1` 回滚与 defer、飞书 OpenCode 多 tool、与 Cursor 并排、silent/notify 分级、`presentation_order_violation` 日志、四引擎 Port smoke |

### 手工冒烟清单（T5 / 06 §4.2）

| # | 场景 | 本期 |
|---|------|------|
| M1 | `PRESENTATION_ORDERING=0` 多 tool 回滚对照 | 待手工 |
| M2 | ordering=1 飞书 OpenCode defer + idle 释放 | 待手工 |
| M3 | 同 prompt OpenCode vs Cursor 并排体感 | 待手工 |
| M4 | read silent 不 defer；shell notify defer | 待手工 |
| M5 | `presentation_order_violation` 无异常峰值 | 待手工 |
| M6 | 四引擎 Port launch/dispatch/终态 smoke | 待手工 |

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并登记 debt / files；**保持 `stage=tested`**。
- **暂勿** `mv` 至归档、**暂勿** 标 `archived` / `archived_with_debt`（迁移与 stage 收尾归 release/librarian；用户 orchestrator 已请求带债务归档）。
- inspector 建议最终形态：`archived_with_debt`（因 T5-D1）。
