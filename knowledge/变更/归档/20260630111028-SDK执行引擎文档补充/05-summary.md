# SDK 执行引擎文档补充 · 变更总结

> **变更 ID**：`20260630111028-SDK执行引擎文档补充`  
> **来源**：kb-lite  
> **lite 类型**：知识同步型 lite（纯知识库，无代码变更）  
> **阶段**：`archived`（LITE-01 done；已迁至 `knowledge/变更/归档/`）

---

## 1、实际更新清单

| 路径 | 一句话 |
|------|--------|
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | **新建** Cursor SDK 十段式子模块：长驻/dispatch、agent-api、MCP inline、流式 Presentation、超时与 ContextRotation。 |
| `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md` | **新建** Claude Code SDK 十段式子模块：`query()`/resume、cc-agent-api、cc-mcp-loader、事件映射与 resident 语义。 |
| `knowledge/业务域/Agent调度/00-README.md` | 文件清单增 06/07；推荐阅读路径增 **「SDK 排查：06 → 07 → 03」**；关键源码表补 CC 模块路径。 |
| `knowledge/业务域/Agent调度/01-概览.md` | 架构图增 cc-agent-api 分支；子模块清单与文档入口链接 06/07；双引擎约束与 06/07 对齐。 |

**核实方式**：CodeGraph 未加载；kb-librarian 直读 `electron/agent-sdk.ts`、`agent-claude-sdk.ts`、`agent-cc-*.ts`、`session-dispatcher.ts` 等源码核对结论，关键决策已标注代码依据。

**明确未改**：业务代码、proto、配置实现；Codex/OpenCode 引擎文档（见进行中变更 `20260630104714`、`20260630105159`）；`03-启动与自动重连.md`（与 06/07 分工，仅交叉引用）。

---

## 2、验收对照

| # | 验收项（来源 `01-proposal.md`） | 状态 |
|---|--------------------------------|------|
| 1 | **06 十段式**：一～十段齐全；单文件 ≤3000 字符（实测 **2582** 字符）；结论可回源码 | ✅ |
| 2 | **07 十段式**：一～十段齐全；单文件 ≤3000 字符（实测 **2572** 字符）；结论可回源码 | ✅ |
| 3 | **00-README**：文件清单含 06/07；阅读路径含 **「SDK 排查：06 → 07 → 03」** | ✅ |
| 4 | **01-概览**：「四、子模块清单」与「十、文档入口」均链接 06/07；双引擎描述与 06/07 无矛盾 | ✅ |
| 5 | **以代码为准**：无依据处标「（待确认/推测）」（如 07 §九 SDK 无 `startup()` 导出） | ✅ |
| 6 | **范围边界**：06/07 仅覆盖 Cursor SDK 与 Claude Code SDK | ✅ |
| 7 | **总索引**：未改 `knowledge/知识索引.md` | ✅（见下） |

### 未改 `knowledge/知识索引.md` 原因

- 本次为 Agent 调度域**局部索引**变更（`00-README` 清单与阅读路径），总索引入口与领域分区结构未变。
- `01-proposal.md` 已约定默认不更新总索引；无 README 链接失真或新领域入口需求。

---

## 3、知识库结论

**已同步 Agent 调度 06/07**：Cursor SDK 与 Claude Code SDK 执行引擎现各有独立编号子模块，固定阅读路径 **06 → 07 → 03** 可供 SDK/CC 差异排查；`01-概览` 总图与子模块入口已与双引擎架构对齐。

---

## 4、归档状态

- 本变更目录已由 `进行中/` 迁至 `knowledge/变更/归档/20260630111028-SDK执行引擎文档补充/`（kb-release）
- **kb-check 修补**（2026-06-30）：同步 `00-manifest.json` 中 3 条 `change_doc` 路径至归档前缀；`knowledge` 四条路径未变

**说明**：本 lite 无代码 diff，未 bump 版本与 changelog。
