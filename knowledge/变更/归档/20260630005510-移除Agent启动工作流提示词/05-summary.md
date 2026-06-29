# 移除 Agent 启动工作流提示词 - 变更总结

> **变更 ID**：`20260630005510-移除Agent启动工作流提示词`
> **来源**：kb-lite
> **lite 类型**：记录型 lite
> **阶段**：`applied`（LITE-01 done；待 `/kb-archive` 迁移与 changelog）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/agent-launcher.ts` | **LITE-01**：`buildPrompt` 删除两条硬编码工作流前缀 push（`useMainWorkspace` / `chatType === "workflow"` 分支）；保留 `taskMessage` 块（`---`、`任务内容:`、正文）与会话元数据块（`---`、`会话元数据:`、`[session_key=…]`、`[chat_type=…]`）；签名保留 `_useMainWorkspace?` 以兼容既有调用方，参数不再参与 Prompt 组装 |
| `electron/AGENTS.md` | 模块边界补充：`buildPrompt` 只拼接任务内容与 session 元数据，**不含**工作流前缀 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入（显式）**：`agent-sdk.ts` / `agent-claude-sdk.ts` 调用方逻辑（仍传 `useMainWorkspace`，无功能性改动）；proto/DB、飞书/微信通道、changelog（archive 阶段再定）。

**统计**：2 文件改动；硬编码前缀文案仓库内 grep 零命中。

## 2、与设计的差异

无结构性偏差，与 `01-proposal.md` LITE-01 一致。

## 3、影响范围

- **涉及模块**：Electron Agent 启动 Prompt 组装（SDK / Claude Code 共用 `buildPrompt`）。
- **行为变更**：每次 launch/dispatch 组装的 Prompt **不再**在首部注入「工作流规则 / digital-identity」硬编码句；任务正文与会话元数据结构不变。
- **调用方**：`agent-sdk.ts`、`agent-claude-sdk.ts` 继续调用 `buildPrompt(meta, taskMessage, sessionKey, useMainWorkspace)`；第四参仅为兼容占位。
- **接口/proto/数据**：无对外 HTTP/proto 契约变更；无持久化模型变更。
- **用户可见性**：IM 侧文案与调度语义不变；Agent 侧收到的启动 Prompt 更短、噪声更低；规则/skills 仍由项目 rules、skills 与用户任务承载。

### 3.1 Ponytail 技术债

diff 中无 `ponytail:` 注释。**Lean already. Ship.**

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| — | 无 | — |

### 3.2 剩余风险

| 项 | 说明 |
|----|------|
| **规则承载迁移** | 若个别会话曾依赖硬编码前缀触发 workflow/digital-identity 行为，须改由 rules/skills 或任务正文显式说明；本变更 intentional 移除注入 |
| **兼容参数** | `_useMainWorkspace` 暂保留签名；未来若确认全仓无依赖可单独清理（非本 lite 范围） |

## 4、知识库影响清单

记录型 lite：**知识库无需更新**。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/**` | 无需更新 | 无 IM/调度/通道用户可见行为变更 |
| `knowledge/工程平台/**` | 无需更新 | 被删的两句硬编码启动前缀**从未**写入 KB 正文；Prompt 组装为 Electron 内部实现，约定已写入 `electron/AGENTS.md` |
| `knowledge/知识索引.md` | 无需更新 | 无新领域/分区入口 |
| `electron/AGENTS.md` | 已更新（代码仓 AGENTS，非 KB） | builder 已沉淀 `buildPrompt` 不含工作流前缀规矩 |

- [x] 业务域 — 无用户可见行为变更
- [x] 工程平台 — 记录型 lite，删前缀未在 KB 建档，不扩 KB
- [x] 知识索引 — 总入口未变化

## 5、验收步骤

| # | 项 | 操作 | 状态 |
|---|-----|------|------|
| 1 | grep 无硬编码文案 | `rg '请绝对严格遵守工作流|请按照digital-identity' electron/` 或全仓等价 grep，预期零命中 | ✅ 零命中 |
| 2 | buildPrompt 结构 | 有 `taskMessage` 时输出含 `---`、`任务内容:` 与正文；始终含 `会话元数据:` 及 `[session_key=…]`（入参存在时）、`[chat_type=…]`；**不含**工作流前缀句 | ✅ 与 `agent-launcher.ts` 实现一致 |
| 3 | 调用方编译 | `agent-sdk.ts`、`agent-claude-sdk.ts` 仍调用 `buildPrompt`，第四参兼容；`npx tsc --noEmit` 或 `npm run build` | ✅ `tsc --noEmit` 通过 |
| 4 | 会话回归（可选） | 主用户私聊或群聊发起一条 SDK 任务，UI 日志可见 Prompt 无硬编码前缀、任务与元数据正常 | ⏳ 建议人工 |

## 6、归档待办（`/kb-archive`）

- **版本/changelog**：内部 Prompt 简化、无对外 API 变更，archive 时 **patch** bump 并新建 `changelog/<新版本>.json`（条目：移除 Agent 启动硬编码工作流前缀，规则改由 rules/skills 承载）
- **迁移**：`stage` → `archived`，目录 `mv` 至 `knowledge/变更/归档/`
