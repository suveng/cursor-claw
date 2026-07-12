# Codex展示排序接入 - 变更总结

> **变更 ID**：`20260712145313-Codex展示排序接入`  
> **来源**：kb-propose · standard flow  
> **基线**：`20260712113320-OpenCode展示排序接入`（OpenCode Rev2 end-only 已落地）  
> **阶段**：`tested`（本步骤仅写 `05-summary.md`；**勿** `mv` 归档、**勿** commit；知识库正文待 `/kb-archive` librarian）  
> **用户可见性**：是 — Codex 飞书私聊多 tool Run 接入与 OpenCode/Cursor 对称的 Presentation defer/Rev2 end-only 链；过程卡在上、assistant 结论在 Run 收尾释放

---

## 1、实际变更

### 1.1 变更摘要

Codex 流式出站接入 Presentation 展示排序门控，对称 OpenCode 归档实现与 Cursor `sdk-run-presentation.ts` Rev2 end-only 语义：thinking/notify 级 tool 置双侧闩；含过程 Run 期间 non-final assistant 仅累积 buffer、不 POST；Run 收尾 `flushCodexStreamPost(true)` 为唯一 assistant IM 出站；`postCodexPresentationEvent` 移除飞书早退，presentation-event 必达 Daemon 双侧闩；`PRESENTATION_ORDERING=0` 全链早退回滚现网直通。Daemon ordering 主链无改动（`git diff -- src/daemon/` 0 行），仅消费既有 `POST /api/stream-text` 与 `POST /api/presentation-event`。

### 1.2 代码（T1–T5）

| 任务 | 文件 | 关键改动 |
|------|------|----------|
| **T1** | `electron/agent/codex/agent-codex-stream.ts` | `markCodexProcessEventSeen` 增加 `presentationOrderingEligible` 门控，置 `seenProcessEvent` + `presentationDeferStream` + `clearCodexStreamPostTimer`；`postCodexPresentationEvent` 移除飞书 `feishuSuppressesProcessKind` 早退，始终 POST 由 Daemon 双侧闩 |
| **T2** | `electron/agent/codex/agent-codex-events.ts` | `handleItemStarted` tool 分支接入 `resolveSdkToolPresentationTier`：notify 级置闩 + POST；silent 级仅 `pushUiLog`，不置闩不 POST |
| **T3** | `electron/agent/codex/agent-codex-stream.ts` | 内联 `shouldDeferCodexAssistantPost` / `shouldEndOnlyCodexAssistantDefer` / `isAwaitingFirstCodexProcessEvent` / `scheduleCodexPreambleRelease`；`appendCodexStreamDelta` 与 `doFlushCodexStreamPost` non-final 早退（Rev2 end-only）；**未**新建 `agent-codex-presentation.ts`（275 行 ≤300） |
| **T4** | `electron/agent/codex/agent-codex-complete.ts` | `completeCodexRun` 收尾前 `clearCodexStreamPostTimer`、final flush 后 `streamPostChain = undefined`；含过程 defer 场景唯一出站路径 |
| **T4** | `electron/agent/codex/agent-codex-utils.ts` | `resetCodexRunPresentationState` 补全 timer/链与 defer 闩锁字段清零，避免跨 Run 串 POST |
| **T5** | `electron/agent/codex/AGENTS.md` | 补充 Presentation 时序编排、defer/end-only、preamble、tool 分级与 Daemon 契约说明 |

**统计**：5 个 Electron 文件修改（+85 / −19 行）；`agent-codex-stream.ts` 275 行；无新 HTTP 路由；无 Daemon 代码改动；`npx tsc --noEmit` 通过。

**未纳入（显式）**：`engine-port-adapter.ts` 终态模板；Daemon `daemon-presentation-*.ts`；四引擎共用 Presentation 抽象层；微信通道；飞书卡片模板大改。

### 1.3 变更文档

| 文件 | 说明 |
|------|------|
| `00-manifest.json` | T1–T5 done；R1 pass；stage=tested |
| `01-proposal.md` | 产品 PRD（R1–R5、验收 §六） |
| `02-design.md` | 方案设计（S2–S9、X-POST、X-RESET；对称 OpenCode 基线） |
| `03-tasks.md` | T1–T5 任务分解 |
| `04-review.md` | focused-review **通过**（T1–T4 无阻断；open/accepted_debt 0） |
| `06-automation-test.md` | T1–T4 静态全绿；T5 M1–M6 静态可证项通过 |
| `05-summary.md` | 本文件 |

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **defer 模块落点** | 优先 `agent-codex-stream.ts`；超限拆 `agent-codex-presentation.ts` | 全内联 stream（275 行） | **符合** — 04 Ponytail 批准，未预建拆分文件 |
| **S2–S9 / X-POST / X-RESET** | 过程闩、tool 分级、defer 链、final flush、飞书 POST 必达 Daemon | 与 `02`/`03` 逐步一致 | **无功能偏差** |
| **Daemon 主链** | 不改 | 未改（0 行 diff） | **符合** |
| **T5 运行时体感** | 01 §六 + 02 §八·（二）六项 E2E | M1–M6 以静态契约 + 对称 OpenCode SSOT 核对通过；飞书/Electron 联调项见 06 §2 残留风险 | **observation** — 不记入 manifest `accepted_debt`（与 R1 0 债一致）；archive 后可择机实机补证 |

其余与 `02-design.md` 一致，无阻断性设计偏差。

---

## 3、影响范围

- **模块**：`electron/agent/codex/`（stream、events、complete、utils、AGENTS.md）；Daemon 仅消费既有 ordering API。
- **用户可见**：Codex 飞书私聊（f41 + `PRESENTATION_ORDERING=1`）多 tool Run 过程卡不抢 assistant 首屏；idle 后 deferred 正文完整释放；排序关闭行为回滚现网；与 OpenCode/Cursor 同场景体感对齐。
- **接口/proto**：无新增路由与契约变更。
- **数据**：无持久化变更；会话内存字段 `seenProcessEvent`/`presentationDeferStream`/`streamBuffer` 已有，本变更接入消费。
- **风险残留**：06 §2 所列飞书私聊时间轴、开关体感、并排对比等运行时项待实机补证；知识库 `08-CodexSDK执行引擎.md` 等待 librarian 归档更新。

### 3.1 Ponytail 技术债

本变更相关 diff（`agent-codex-stream.ts` / `events.ts` / `complete.ts` / `utils.ts` / `AGENTS.md`）中 **无** `ponytail:` 注释。

> 说明：`electron/agent/codex/codex-run-probe.ts:45` 存在既有 `ponytail: Codex SDK 无只读 thread 状态 API…`，**不在本变更 diff 内**，不记入本表。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| （无） | — | — |

04-review Ponytail 轴结论：**Lean already. Ship.**（defer 链内联 stream，未预建四引擎共用层；>300 行可拆 `agent-codex-presentation.ts` 升级路径已在 `02`/`03` 保留。）

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；由 **kb-librarian** 在 `/kb-archive` 步骤 6 落盘（本步骤 **不写** 业务域正文）。

### （一）必须更新

- [ ] `knowledge/业务域/Agent调度/08-CodexSDK执行引擎.md` — 补充 Presentation defer/Rev2 end-only、tool 分级、`agent-codex-stream.ts` 参考锚点；移除或改写「ordering 未接入」类限制表述
- [x] `electron/agent/codex/AGENTS.md` — Presentation 时序编排段落（已随 T5 apply 更新；librarian 写知识正文时须对齐）

### （二）可能更新（视 librarian 合并结果）

- [ ] `src/shared/AGENTS.md` — presentation gate 段「Codex 仍早退」改为 Codex 已对齐双侧门控
- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md` — 四引擎 presentation-event POST 口径表（Codex 纳入与 OpenCode 对称）
- [ ] `knowledge/业务域/Agent调度/09-OpenCodeSDK执行引擎.md` — 交叉引用「Codex 已对齐 Rev2 end-only」一句（避免重复铺陈）
- [ ] `knowledge/业务域/Agent调度/01-概览.md` — 若四引擎 ordering 口径表仍记载 Codex 差异则同步

### （三）不需要更新

- [x] Daemon 工程平台分区正文 — 行为未改，仅 Codex 客户端接入
- [x] Proto / Flutter / Quasar 分区
- [x] OpenCode 归档变更目录 — 仅作对齐基线引用
- [x] 微信通道文档 — 01 非目标
- [x] `knowledge/知识索引.md` — 入口结构无变化

---

## 5、验收与遗留债务

| 维度 | 状态 |
|------|------|
| **T1–T5** | done（manifest `tasks[]`；证据见 06 §3/§7） |
| **04-review** | ✅ 通过（R1；blocking/warning/observation 均为 0） |
| **06 静态** | ✅ T1–T4 grep/行数/符号核对通过；Daemon 划界 0 行 |
| **06 M1–M6** | ✅ 静态可证项全绿（清单核对）；⏳ 运行时 IM 体感待实机补证（06 §2，非 manifest 债） |
| **01 §六 AC1–AC5** | ✅ 代码路径静态对齐；端到端体感以实机可选补证 |
| **知识库 §十** | ⏳ 待 librarian archive 步骤 6 |

### 遗留债务

**无**（manifest `reviews[]` open_debt 0 / accepted_debt 0；04 §7 无 open 代码问题）。

### 手工冒烟清单（T5 / 06 §4.2）

| # | 场景 | 本期 |
|---|------|------|
| M1 | `PRESENTATION_ORDERING=0` 多 tool 回滚对照 | ✅ 静态/清单 |
| M2 | ordering=1 飞书 Codex defer + idle 释放 | ✅ 静态/清单 |
| M3 | 同 prompt Codex vs OpenCode/Cursor 并排体感 | ✅ 静态/清单 |
| M4 | read silent 不 defer；shell notify defer | ✅ 静态/清单 |
| M5 | `presentation_order_violation` 无异常峰值 | ✅ 清单（Daemon 未改） |
| M6 | 四引擎 Port launch/dispatch/终态 smoke | ✅ 静态/清单 + tsc |

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并登记 manifest `files[]`；**保持 `stage=tested`**。
- **暂勿** `mv` 至 `knowledge/变更/归档/`、**暂勿** commit/push（迁移与 stage 收尾归 `/kb-archive` release/librarian）。
- 下一步：`/kb-archive` → librarian 按 §4 更新知识库 → `mv` 归档 → commit+push。
