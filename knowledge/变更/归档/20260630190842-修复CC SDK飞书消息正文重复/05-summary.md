# 修复 CC SDK 飞书消息正文重复 — 变更总结

> **变更 ID**：`20260630190842-修复CC SDK飞书消息正文重复`
> **来源**：kb-lite
> **lite 类型**：记录型 lite（Bug）
> **阶段**：`tested`（LITE-01 done；静态 + 编译已通过；K1–K5 飞书 IM 台架待用户执行）

---

## 1、变更摘要

飞书 IM 通道绑定 Claude Agent SDK（CC）引擎且走 f41 流式 eligible 路径时，assistant 回复正文在 IM 中**整段重复两遍**（如「你好你好」、长文首尾各出现一次全文）。

根因：`includePartialMessages: true` 下 SDK 对同一条 assistant 回复同时投递 `stream_event`/`text_delta` 与 `assistant`/`text` block，`agent-cc-events.ts` 两路均 `appendCcAssistantStreamDelta`，`stream-text` 累积全文约为实际长度 2 倍。

本次以 session 标志 `ccTextFromPartialStream` 闩去重：优先信任 partial 增量路径；若本轮已从 `text_delta` 写入，则跳过 `assistant` text block 的 append；每轮 assistant 收尾及 `resetCcRunPresentationState` 时清零。保留 `includePartialMessages: true` 与 thinking/tool/usage 等旁路逻辑不变。

## 2、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/agent-cc-types.ts` | `CcSessionAgent` 新增 `ccTextFromPartialStream?: boolean`（中文 JSDoc） |
| `electron/agent-cc-events.ts` | `handleStreamEvent`：`text_delta` + `f41Stream` 时先置位再 append；`handleContentBlocks`：f41 下仅当 `!ccTextFromPartialStream` 时 append text block；`handleSdkMessage` assistant 分支末尾清零 |
| `electron/agent-cc-utils.ts` | `resetCcRunPresentationState` 清零 `ccTextFromPartialStream` |
| `electron/AGENTS.md` | 事件映射段补充 partial/assistant 去重一句 |

**变更文档**：`01-proposal.md`、`02-design.md`、`03-tasks.md`、`06-automation-test.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入**：`agent-claude-sdk.ts`（`includePartialMessages: true` 不改）、`agent-cc-presentation.ts` / `agent-cc-stream.ts` 节流逻辑、Daemon `/api/stream-text` 契约、proto/Settings UI/changelog（archive 阶段再定）。

## 3、与设计的差异

无。实现与 `01-proposal.md`、`02-design.md` 步骤 E-1～E-7 一致；`electron/AGENTS.md` 文档句已落盘（02 标为可选）。

## 4、影响范围

| 范围 | 说明 |
|------|------|
| **端** | Electron 主进程 CC 事件映射层 |
| **模块** | `agent-cc-events.ts`（主改动）、`agent-cc-types.ts`、`agent-cc-utils.ts` |
| **用户可见** | **是** — CC + 飞书 f41 流式路径下 IM assistant 正文不再整段重复；增量流式体验保留 |
| **不涉及** | Cursor SDK / Codex / OpenCode 路径；非 f41 的 `appendCcLog` 路径；HTTP/proto/持久化 |
| **关联背景** | CC 引擎经 `20260630002838-ClaudeAgentSDK落地` 接入；IM 路由经 `20260629233840-修复IM通道ClaudeCodeLaunch路由` 统一 |

### 4.1 Ponytail 技术债

无（diff 中无 `ponytail:` 注释）。

## 5、验收对照

| # | 验收项（来源 `01-proposal.md`） | 状态 |
|---|--------------------------------|------|
| 1 | CC + f41 流式：飞书 IM assistant 正文不整段重复两遍 | ⏳ 台架 **K1** 待用户执行 |
| 2 | 流式过程正文仍随 `text_delta` 增量更新 | ⏳ 台架 **K2** 待用户执行 |
| 3 | 无 `text_delta`、仅 assistant text block 时正文正常 | ✅ 静态（`!ccTextFromPartialStream` 分支）；⏳ K3 可选 |
| 4 | thinking、tool、usage、Presentation 时序不变 | ✅ 静态；⏳ 台架 **K4** 待用户执行 |
| 5 | 连续多轮 dispatch 每轮不重复；reset 后标志清零 | ✅ 静态；⏳ 台架 **K5** 待用户执行 |
| 6 | TypeScript 编译通过 | ✅ `npx tsc --noEmit` exit 0 |

**建议手测步骤**（详见 `06-automation-test.md` §4.1）：

1. 飞书私聊绑定 Claude Agent Profile，`npm run dev` + Daemon 运行 → 发短句与长文，确认 IM 正文无双倍重复（K1）。
2. 长文回复过程中观察 IM 消息逐段增长，末包字数与 Agent 面板 CC `text` 日志一致（K2）。
3. 连续 3 轮 dispatch，每轮正文均不重复；Stop 后新 Run 首条正常（K5）。

## 6、知识库影响清单

记录型 lite：**`knowledge/` 业务域与工程平台正文无需更新**；实现约定已沉淀于 `electron/AGENTS.md`。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/**` | **不需要** | 用户可见行为为 IM 正文展示修复，无新业务规则或接口契约 |
| `knowledge/工程平台/**` | **不需要** | 去重闩为 CC 事件映射内部实现；无 IPC/渲染层/打包变更 |
| `knowledge/知识索引.md` | **不需要** | 无新领域/分区入口 |
| `electron/AGENTS.md` | **已更新**（代码仓 AGENTS，非 KB） | partial/assistant 去重语义已写入事件映射段 |

- [x] 业务域 — 无结构性文档变更
- [x] 工程平台 — 记录型不扩 KB
- [x] 知识索引 — 总入口未变化
- [x] `electron/AGENTS.md` — 去重约定已沉淀

## 7、归档待办（`/kb-archive`）

- **stage**：`tested` → `archived`（建议 K1/K2 手测通过后再归档，或按 lite 策略带台架债务归档）
- **目录**：`mv` 至 `knowledge/变更/归档/`
- **版本 / changelog**：按 archive 规则 patch bump 与 `changelog/` 条目（用户可见 IM 正文修复）
- **知识库同步**：**跳过** — 本变更无 `knowledge/` 正文待维护项
