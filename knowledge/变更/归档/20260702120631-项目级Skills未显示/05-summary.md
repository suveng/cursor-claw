# 项目级 Skills 显示与管理 - 变更总结

> **变更 ID**：`20260702120631-项目级Skills未显示`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（待 `/kb-archive`）  
> **用户可见性**：是 — `package.json` **1.10.0 → 1.10.1**（patch）；新建 `changelog/1.10.1.json`

---

## 1、实际变更

### 代码

| 文件 | 关键改动 |
|------|----------|
| `electron/skills-ipc.ts` | **新增** `SkillScope`、`resolveSkillsDir`、`registerSkillsIpcHandlers`；9 个 `skills:*` channel 末位 `scope?`；`assertSkillPath` 防路径穿越 |
| `electron/main.ts` | 内联 skills handler 迁出，调用 `registerSkillsIpcHandlers()`（248 行） |
| `electron/preload.ts`、`src/renderer/env.d.ts` | Skills API 末位扩展 `scope?: SkillScope`，与 IPC 契约一致 |
| `electron/AGENTS.md` | 补充 `skills-ipc.ts` 模块边界 |
| `src/renderer/components/SettingsSkillsPanel.tsx` | **新增** 双区块面板（上项目下用户）；CRUD 透传 scope；expand key 含 scope |
| `src/renderer/components/SkillTreeBlock.tsx` | **新增** 技能树区块（刷新/展开/禁用态） |
| `src/renderer/components/SkillEditModals.tsx` | **新增** 新建/编辑弹窗（自 Settings 迁入） |
| `src/renderer/components/AGENTS.md` | 补充 Skills 面板组件约定 |
| `src/renderer/pages/Settings.tsx` | Skills Tab 挂载 `<SettingsSkillsPanel workspaceDir={...} />`；首进 tab 加载工作区（R1） |
| `package.json` | version **1.10.1** |
| `changelog/1.10.1.json` | **新增** 用户可见变更条目 |

**不变**：`agent-sdk` `settingSources`、Daemon `/api/skills`、用户级 `~/.cursor/skills` 路径语义。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`（T1–T4 `completed`；R1–R6 `fixed`）
- `05-summary.md`（本文件）

---

## 2、与设计的差异

1. **UI 组件拆分（设计允许）**：`02-design` §六 步骤 4 与 `03-tasks` T3 允许面板超 300 行时拆 `SkillEditModals`；实际另拆 `SkillTreeBlock.tsx`，`SettingsSkillsPanel.tsx` 289 行，符合 E2。
2. **其余与 design S1–S8、E1–E6 一致**：双 scope IPC、双区块展示、无主工作区禁用、作用域文案、main 行数治理均已落地。

---

## 3、影响范围

- **Settings Skills Tab**：可见并管理主工作区 `.cursor/skills/` 项目级 Skills；与用户级双区块区分；对齐 Rules/MCP 项目级心智。
- **IPC**：`scope` 省略时默认 `user`，向后兼容；project 无工作区读空、写返回统一错误文案。
- **非目标**：Daemon/IM Skills、非 Cursor SDK 引擎、SDK 运行时 `settingSources` 行为。

### 3.1 Ponytail 技术债

无。

---

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — Skills 双来源（用户级 + 项目级）、设置界面管理、运行时 `settingSources` 加载
- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — `skills-ipc.ts`、`SkillScope` 末位参数、project 路径与 rules 同级错误契约

**评审**：04-review 通过；R1–R6 均已内联修复；静态项（tsc、E1–E6）通过；01 验收 1–8 运行时项见 `06-automation-test.md` §4.2 待手工冒烟。
