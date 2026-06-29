# 通道编辑 Agent 资源与模型按类型联动 - 变更总结

> **变更 ID**：`20260629231225-通道编辑Agent资源模型按类型联动`
> **来源**：kb-propose（standard）
> **类型**：缺陷修复（P2）
> **阶段**：`tested`（T1/T2 done；`npm run build` 通过；06 手工 E2E 待用户，不阻断后续 archive）
> **实现提交**：`7531519`（分支 `pr-kiki`）

---

## 变更摘要

设置页「通道编辑」弹窗在 Claude Code Profile 接入后，「Agent 资源与模型」区块仍按 Cursor 时代固定布局展示「获取模型列表」与通道级主/其他人模型，未随 `AgentResource.type` 联动。本变更以资源类型驱动 UI：`cli`/`sdk` 保持通道级模型配置与列表获取；`claude-code` 隐藏列表入口与通道模型控件，改为 Profile 只读说明；切换 `agentResourceId` 时即时清理 draft 模型字段并恢复 Cursor 持久化回显；资源下拉按 `<optgroup>` 区分三类资源。执行引擎与 IPC 未改。

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `src/renderer/components/ChannelModelSection.tsx` | **新增**（193 行）：从 `ChannelEditModal` 抽取「Agent 资源与模型」区块；`isCcProfile`/`isCursorChannel` 条件 UI；`fetchModels` 对 `claude-code` 早退且不调用 `listCcModels`；切 CC 清空 draft 模型字段、切回 Cursor 回显 `channel` 快照；`<optgroup>` 分组资源下拉 |
| `src/renderer/components/ChannelPanel.tsx` | **修改**：`ChannelEditModal` 引用 `ChannelModelSection`，删除内联模型区块与相关 state/effect（净减约 76 行）；弹窗其余逻辑不变 |

**变更文档**：`01-proposal.md`、`02-design.md`、`03-tasks.md`、`06-automation-test.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入本变更 manifest（显式）**：`04-review.md`（未执行 formal review）；`electron/*`、`Settings.tsx`、`AgentPanel.tsx`、`channel-types.ts` 未改。

**统计**：1 新增 + 1 修改 Renderer 组件；`ChannelModelSection.tsx` 193 行（≤300）；`ChannelPanel.tsx` 655 行（存量超限，本变更经抽取未扩大）；`npm run build` exit 0（见 `06-automation-test.md` §7）。

## 2、与设计的差异

1. **子组件抽取**：`02-design.md` §三 初稿写「唯一改动文件 `ChannelPanel.tsx`」，§八·（一）已注明超 300 行时须拆分。实现按 §八 倾向抽取 `ChannelModelSection.tsx`，与设计「最小 diff + 必要时抽取」一致，非行为偏差。
2. **其余**：CE-2～CE-9 步骤、`fetchModels` 守卫、optgroup、draft 清理与 02 §六 一致；无 IPC/执行链变更。

## 3、影响范围

- **涉及模块**：Renderer 设置页通道编辑弹窗（`ChannelPanel` → `ChannelModelSection`）。
- **用户可见性**：绑定 Claude Code Profile 的通道编辑不再出现 Cursor 模型列表与「获取模型列表」；Cursor CLI/SDK 行为与变更前一致。
- **未触碰**：Profile CRUD（`AgentPanel`）、任务编辑（`Settings`）、IM 入站/出站、`session-dispatcher`、`agent-cc-http` 运行时模型解析链。
- **已知限制（02 §八·（一））**：历史通道若 CC Profile 下仍存 legacy Cursor `model` 字段，引擎仍可能走 `resolveChannelModel`；UI 清空 draft 可减轻新保存通道，历史数据需人工改绑或清模型（产品未在本变更闭环）。

### 3.1 Ponytail 技术债

diff 中无 `ponytail:` 注释。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| — | 无 | — |

### 3.2 流程与行数债务

| 项 | 说明 |
|----|------|
| **`ChannelPanel.tsx` 655 行** | 超 AGENTS.md 300 行上限；本变更未扩大违规范围，已抽取 `ChannelModelSection.tsx`；完整拆分 `ChannelPanel` 留待独立 refactor |
| **无 formal review** | `04-review.md` 缺失，`reviews=[]`；静态契约与 build 已覆盖 T1/T2；01/§8.2 UI 验收待用户 E2E（见 `06-automation-test.md` §4.1） |

## 4、知识库影响清单

与 `02-design.md` §十 一致；archive 阶段由 **kb-librarian** 视合并结果最终落盘。

### （一）必须更新

- [x] 无（纯 UI 缺陷修复，02 §十·（一）已标注）

### （二）可能更新（视 librarian 归档合并结果）

- [ ] `knowledge/工程平台/` 下 Quasar/设置页或通道管理相关子模块 — 若存在通道编辑描述，补充「Claude Code Profile 通道不在通道级配置模型，以 Profile 默认模型为准」

### （三）不需要更新

- [x] `electron/AGENTS.md`、`src/AGENTS.md` — 执行约定未变
- [x] Profile 管理（`AgentPanel`）文档 — 未改 Profile CRUD
- [x] Proto / 数据模型知识文件 — 无 schema 变更
- [x] `knowledge/知识索引.md` — 总入口未变化

## 5、验收状态

| 维度 | 状态 |
|------|------|
| **T1/T2** | done（manifest `tasks[]`） |
| **`npm run build`** | ✅ exit 0（T2 / `06-automation-test.md` §7） |
| **行数合规（本变更触及文件）** | ✅ `ChannelModelSection.tsx` 193 行；⚠️ `ChannelPanel.tsx` 655 行存量超限未扩大 |
| **01 验收 1–6、§8.2·1–4** | ⏳ 手工 E2E 待用户（`06-automation-test.md` §4.1 S1–S6） |
| **04-review** | 未执行（`reviews=[]`） |
