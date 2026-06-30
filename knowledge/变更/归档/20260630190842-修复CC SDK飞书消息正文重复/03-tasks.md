# 修复 CC SDK 飞书消息正文重复 — 任务分解

> **来源**：kb-lite（基于 `01-proposal.md`、`02-design.md`）

## 一、执行计划

### （一）依赖图

```
T1（单任务闭环）
```

### （二）分组调度

- **单轮**：T1 覆盖类型、事件映射、状态重置与可选 AGENTS 文档，由 kb-builder 一次完成。

## 二、任务清单

---

## T1: CC SDK partial/assistant 流式正文去重

### 背景

`includePartialMessages: true` 时 Claude Agent SDK 对同一条 assistant 回复同时发送 `stream_event`/`text_delta` 与 `assistant`/`text` block。`agent-cc-events.ts` 两路均调用 `appendCcAssistantStreamDelta`，飞书 f41 stream-text 累积全文重复两遍。本任务以 session 标志闩去重，保留增量流式与 usage/tool 等旁路逻辑。

### 上下文文件

- 必读：`electron/agent-cc-events.ts` — `handleStreamEvent`（约 69–86 行）、`handleContentBlocks`（约 36–66 行）、`handleSdkMessage` assistant 分支（约 128–136 行）
- 必读：`electron/agent-cc-types.ts` — `CcSessionAgent` 接口（约 34 行起）
- 必读：`electron/agent-cc-utils.ts` — `resetCcRunPresentationState`（约 117–140 行）
- 参考：`electron/agent-claude-sdk.ts` — `buildQueryOptions` 第 88 行 `includePartialMessages: true`（理解根因，**不改**）
- 参考：`electron/agent-cc-presentation.ts` — `appendCcAssistantStreamDelta`（调用方减少重复 append）
- 可选：`electron/AGENTS.md` — Claude Agent SDK 事件映射小节补一句去重约定

### 实现范围

- 修改：`electron/agent-cc-types.ts`
  - `CcSessionAgent` 增加 `ccTextFromPartialStream?: boolean`（附中文注释说明语义）
- 修改：`electron/agent-cc-events.ts`
  - `handleStreamEvent`：`text_delta` 且 `session.f41Stream` 将 append 前，置 `session.ccTextFromPartialStream = true`
  - `handleContentBlocks`：assistant `text` block 且 `session.f41Stream` 时，**仅当** `!session.ccTextFromPartialStream` 调用 `appendCcAssistantStreamDelta`；`appendCcLog` 非 f41 分支不变
  - `handleSdkMessage`：`msg.type === "assistant"` 分支处理完毕（`return` 前）置 `session.ccTextFromPartialStream = false`
- 修改：`electron/agent-cc-utils.ts`
  - `resetCcRunPresentationState` 清零 `ccTextFromPartialStream`
- 可选：`electron/AGENTS.md` — 事件映射段补充「partial text_delta 与 assistant text block 去重」一句

### 接口契约

- 无对外 API 变更
- 内部：`CcSessionAgent.ccTextFromPartialStream?: boolean` 生命周期 = 单次 assistant 轮次（assistant 收尾或 reset 清零）

### 验收标准

- [ ] f41 流式 eligible + CC 引擎：飞书 IM assistant 正文**不重复两遍**（对应 01 验收 1）
- [ ] 流式过程中正文仍随 `text_delta` 增量更新（对应 01 验收 2）
- [ ] 仅 `assistant` text block、无 `text_delta` 时正文正常展示（对应 01 验收 3）
- [ ] thinking、tool、usage、`presentationOrderingEligible` / deferred 行为与修复前一致（对应 01 验收 4）
- [ ] 连续多轮 dispatch 每轮正文不重复；新 Run `resetCcRunPresentationState` 后标志已清（对应 01 验收 5）
- [ ] TypeScript 编译无新增错误（对应 01 验收 6）
- [ ] 无新增文件或未批准依赖；单文件仍 ≤300 行

### 依赖

- 前置任务：无
- 后续任务：无（完成后更新 manifest `LITE-01` → `done`）
