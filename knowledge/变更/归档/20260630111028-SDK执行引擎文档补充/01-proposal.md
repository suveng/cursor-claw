# SDK执行引擎文档补充轻量变更说明

> **变更 ID**：`20260630111028-SDK执行引擎文档补充`
> **来源**：kb-lite
> **类型**：文档
> **优先级**：P3
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无
> **lite 类型**：知识同步型 lite（纯知识库，无代码变更）

---

## 背景

Agent 调度域当前仅在 `00-README`、`01-概览`、`03-启动与自动重连` 等文件中**零散提及** Cursor SDK 与 Claude Code SDK 双引擎路由、长驻、MCP 等要点，缺少可独立检索、按引擎维度排查的**编号子模块**。

随着 CC 已全面迁移至 `@anthropic-ai/claude-agent-sdk`、Cursor 路径经 `agent-sdk.ts` 长驻执行，执行引擎细节分散在多处子模块与源码注释中，新人与运维排查 SDK/CC 差异时缺少「06 → 07 → 03」的固定阅读路径。

## 变更说明

### LITE-01：补充 Cursor SDK 与 Claude Code SDK 执行引擎知识文档

**新增**（十段式子模块）：

| 文件 | 内容要点 |
|------|----------|
| `06-CursorSDK执行引擎.md` | Cursor SDK 能力范围、长驻/dispatch、agent-api、MCP、流式 Presentation、超时/失败/压缩、关键源码 |
| `07-ClaudeCodeSDK执行引擎.md` | Claude Code SDK（`query()`）能力范围、cc-agent-api、`CC_RESIDENT`/`resume`、cc-mcp-loader、事件映射、与 SDK 路径差异 |

**更新**：

| 文件 | 变更 |
|------|------|
| `00-README.md` | 文件清单增加 06/07；推荐阅读路径增加 **「SDK 排查：06 → 07 → 03」** |
| `01-概览.md` | 子模块清单与文档入口链接 06/07；双引擎架构说明与 06/07 对齐 |

**明确不在范围**：

- 不写 Codex SDK、OpenCode SDK 执行引擎（另有独立变更 `20260630104714`、`20260630105159`）
- 不改业务代码、proto、配置实现
- 不更新 `knowledge/知识索引.md`（除非 README 引用失真，当前仅局部索引变更，总索引入口不变）

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 补齐 06/07 子模块与 README 阅读路径，验收可逐条核对 |
| 修改范围 | Agent 调度域 4 个知识文件（+0 代码） |
| 接口契约 | 不变（+0） |
| 数据/权限 | 不变（+0） |
| 跨端联动 | 无（+0） |
| 知识库 | 知识同步型，多文件联动但域内封闭（+2） |
| **总分** | **≤2**，可走 lite；纯文档无代码 |

## 验收标准

1. **新增 `06-CursorSDK执行引擎.md`**：符合 `knowledge/AGENTS.md` 十段式结构；单文件 **≤3000 字符**；结论与 `electron/agent-sdk.ts`、`session-dispatcher.ts` 等源码一致，关键决策标注代码依据。
2. **新增 `07-ClaudeCodeSDK执行引擎.md`**：同上十段式与字数约束；与 `electron/agent-claude-sdk.ts`、`agent-cc-*.ts`、`cc-mcp-loader` 等实现一致。
3. **更新 `00-README.md`**：文件清单含 06/07；推荐阅读路径含 **「SDK 排查：06 → 07 → 03」**。
4. **更新 `01-概览.md`**：「四、子模块清单」与「十、文档入口」链接 06/07；双引擎描述不与 06/07 矛盾。
5. **以代码为准**：文档中引擎行为、API 入口、长驻/resume/MCP/超时路径须可回 `kb.project.json` 的 `codeRoots` 核实；无依据处标「（待确认/推测）」，禁止编造。
6. **范围边界**：06/07 仅覆盖 Cursor SDK 与 Claude Code SDK；不出现 Codex/OpenCode 引擎正文（可一句指向进行中变更 ID）。
7. **总索引**：默认不修改 `knowledge/知识索引.md`；若 scribe/librarian 发现 README 链接失真再单独说明。

## 影响范围

| 范围 | 说明 |
|------|------|
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | **新建** |
| `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md` | **新建** |
| `knowledge/业务域/Agent调度/00-README.md` | 清单与阅读路径 |
| `knowledge/业务域/Agent调度/01-概览.md` | 子模块清单与文档入口 |
| `knowledge/业务域/Agent调度/03-启动与自动重连.md` | 不强制改；06/07 与之分工：03 保留通用启动/重连，06/07 按引擎展开 |

**不在范围**：业务代码、`knowledge/知识索引.md`（默认）、Codex/OpenCode 文档、工程平台分区正文。

## 实现要点（供 kb-librarian）

- 写 06/07 前先 CodeGraph 或源码核对 `agent-sdk.ts`、`agent-claude-sdk.ts`、`session-dispatcher.ts` 路由与长驻语义。
- 03 已有双引擎摘要：06/07 展开引擎专属细节，避免大段复制；必要时 03 仅保留交叉引用。
- 单文件超 3000 字符按 `knowledge/AGENTS.md` 再拆编号子模块（本变更预期单文件即可）。

## 待后续事项

- 轮 2：kb-scribe 补写 `05-summary.md`（本轮不写）
- 完成后更新 manifest：`tasks[0].status`、`files[]` 实际状态
- archive 时按需 bump 版本与 changelog
