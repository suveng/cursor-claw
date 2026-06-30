# 修复 CC SDK 飞书消息正文重复 — 轻量变更说明

> **变更 ID**：`20260630190842-修复CC SDK飞书消息正文重复`
> **来源**：kb-lite
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无（kb.project.json 未配置 integrations.registry）
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

飞书 IM 通道绑定 Claude Agent SDK（CC）引擎后，用户私聊或群聊（f41 流式 eligible）收到的 assistant 回复正文**整段重复两遍**（例如「你好你好」、长文首尾各出现一次完整内容）。

现象仅影响 CC 路径经 `POST /api/stream-text` 累积出站的消息；非 f41 路径走 `appendCcLog` 聚合，表现可能不同。

## 根因

- **配置**：`electron/agent-claude-sdk.ts` 的 `buildQueryOptions` 设置 `includePartialMessages: true`（约第 88 行），SDK 在单轮 assistant 回复期间同时推送两路文本：
  1. `stream_event` + `content_block_delta` + `text_delta`（增量）
  2. `assistant` message + `text` content block（完整正文）
- **落点**：`electron/agent-cc-events.ts` 中 `handleStreamEvent`（约第 77–78 行）与 `handleContentBlocks`（约第 43–44 行）在 `session.f41Stream` 为真时**均**调用 `appendCcAssistantStreamDelta`，将两路内容写入同一 `streamBuffer`。
- **结果**：飞书 stream-text 节流 POST 携带的累积全文约为实际回复长度的 2 倍。

## 变更说明

### LITE-01：partial/assistant 双路正文去重

以 session 级标志 `ccTextFromPartialStream` 记录本轮是否已从 `text_delta` 增量写入；若已增量写入，则跳过 `assistant` message 中 `text` block 的 `appendCcAssistantStreamDelta`（保留 usage、thinking、tool 等逻辑）。每轮 `assistant` message 处理完毕或 `resetCcRunPresentationState` 时清零标志。

**预期改动文件**：

| 文件 | 改动 |
|------|------|
| `electron/agent-cc-types.ts` | `CcSessionAgent` 增加 `ccTextFromPartialStream?: boolean` |
| `electron/agent-cc-events.ts` | `handleStreamEvent` / `handleContentBlocks` / `handleSdkMessage` 去重逻辑 |
| `electron/agent-cc-utils.ts` | `resetCcRunPresentationState` 清零标志 |
| `electron/AGENTS.md` | 可选：一行说明 partial/assistant 去重语义 |

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、根因、修复方向已明确 |
| 修改范围 | 3～4 个 electron 文件，无跨端 |
| 接口契约 | 无 proto/HTTP/IPC 签名变更 |
| 数据/权限 | 不变 |
| 知识库 | 记录型，archive 阶段 05-summary 即可 |

## 验收标准

1. **正文不重复**：CC 引擎 + f41 流式 eligible 场景下，飞书 IM 展示的 assistant 正文与模型实际输出一致，**不出现整段重复两遍**。
2. **增量仍可用**：流式场景下正文仍逐字/逐段更新（首包至末包行为与修复前一致，仅消除重复累积）。
3. **无 partial 时回退**：若某轮 SDK 未发 `text_delta`、仅发 `assistant` text block，正文仍正常展示（标志为 false 时不跳过）。
4. **旁路逻辑不受影响**：thinking、tool_use、tool_result、usage 更新、Presentation 时序编排（`presentationOrderingEligible` / deferred）行为不变。
5. **Run 间隔离**：连续 dispatch 多轮后每轮正文均不重复；`resetCcRunPresentationState` 后标志已清零。
6. **TypeScript 编译通过**。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/agent-cc-events.ts` | **主改动**：事件映射去重 |
| `electron/agent-cc-types.ts` | session 标志字段 |
| `electron/agent-cc-utils.ts` | presentation 状态重置 |
| `electron/AGENTS.md` | 可选文档一句 |
| CC + 飞书 f41 流式路径 | 用户可见 IM 正文 |
| Cursor SDK / Codex / OpenCode 路径 | 无改动 |

**不在范围**：Daemon stream-text API、proto、Settings UI、changelog（archive 阶段再定）。

## 待 builder 事项

- 实现 LITE-01 后更新 manifest：`tasks[0].status = done`，`files[]` 中 code 条目 `status` 改为 `changed`。
- 完成后由 kb-scribe 补写 `05-summary.md`；lite 可与实现同轮进入 review/test/archive。
