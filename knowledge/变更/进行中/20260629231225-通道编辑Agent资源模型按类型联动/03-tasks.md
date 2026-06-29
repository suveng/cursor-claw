# 通道编辑 Agent 资源与模型按类型联动 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **变更 ID**：`20260629231225-通道编辑Agent资源模型按类型联动`

## 一、执行计划

### （一）依赖图

```mermaid
flowchart LR
    T1["T1\nChannelPanel 类型联动 UI"]
    T2["T2\n构建验证与行数合规"]
    T1 --> T2
```

**说明**：本变更仅改 Renderer 单文件（必要时抽取子组件）；无 IPC、执行引擎或类型定义变更。T1 完成后 T2 串行执行构建与合规检查。

### （二）分组调度

- **第一轮**：T1（`ChannelEditModal` 条件 UI、`fetchModels` 守卫、资源切换清理、下拉分组）
- **第二轮**：T2（依赖 T1；`npm run build`、单文件行数合规确认）

---

## 二、任务清单

<!-- 以下每条任务自包含；builder 只读单条 T{n} + 上下文文件即可开工，不应回读 02-design.md -->

---

## T1: 通道编辑 Agent 资源与模型按类型联动

### 背景

`ChannelEditModal`（`ChannelPanel.tsx`）的「Agent 资源与模型」区块在 Claude Code Profile 接入后仍为 Cursor 时代固定布局：无论 `resource.type` 均展示「获取模型列表」与通道级主/其他人模型；`fetchModels` 仅区分 `sdk` 与「其他」（走 `listModels` CLI），未识别 `claude-code`，导致绑定 CC Profile 时界面误导。

本任务对齐 01 §F1–F4 与 02 步骤 CE-2～CE-9：以 `resource?.type` 驱动 UI 分支；Cursor CLI/SDK 保持现网通道级模型配置；Claude Code Profile 隐藏列表入口与通道模型控件，改为 Profile 说明区；切换 `agentResourceId` 时即时联动并清理 draft 模型字段；资源下拉用 optgroup 或等价方式区分三类。

**业务要点**：
- **Cursor CLI / SDK**：保留「获取模型列表」+ 通道级主模型、其他人模型（行为与变更前一致）。
- **Claude Code Profile**：隐藏「获取模型列表」；**不**调用 `listCcModels` / `listModels` / `listSdkModels`；展示 Profile 模型说明（可读 `resource.model`；未配置时说明执行时使用 SDK 默认）。
- **切换 agentResourceId**：模型 UI 即时联动；已有 `useEffect` 清空 `modelOptions`（CE-7）；补充切至 CC 时清空 draft 的 `model`/`modelParams`/`othersModel`/`othersModelParams`（CE-8）。
- **资源下拉**：CLI / SDK / CC 三组可辨（`<optgroup>` 或类型前缀文案）。

### 上下文文件

- 必读: `src/renderer/components/ChannelPanel.tsx` — `ChannelEditModal`（约 L244 起）、`fetchModels`（约 L268–283）、`modelOptions` 清空 effect（约 L285–287）、「Agent 资源与模型」JSX（约 L541–578）、资源 `<select>`（约 L552–554）
- 必读: `src/shared/channel-types.ts` — `AgentResource.type: "cli" | "sdk" | "claude-code"`、`AgentResource.model?`
- 参考: `src/renderer/pages/Settings.tsx` — `fetchTaskModels`（约 L411–431）：三分支思路；**通道 CC 不照搬 `listCcModels`**
- 参考: `src/renderer/components/AgentPanel.tsx` — Profile 层「默认模型（选填）」与卡片展示 `r.model`（约 L271–275、L321–324）
- 参考: `electron/agent-cc-http.ts` — 运行时 `resource.model` 优先于通道 model（约 L218–226）；本任务**不改**执行链
- 参考: `knowledge/变更/进行中/20260629231225-通道编辑Agent资源模型按类型联动/01-proposal.md` — 验收标准 1–6

### 实现范围

- 修改: `src/renderer/components/ChannelPanel.tsx`（`ChannelEditModal` 内）：
  1. **类型派生变量（CE-2）**：`isCcProfile = resource?.type === "claude-code"`；`isCursorChannel = resource?.type === "cli" || resource?.type === "sdk"`。
  2. **条件 UI（CE-4/CE-5）**：`isCcProfile` 时隐藏「获取模型列表」按钮、主模型与其他人模型控件；展示只读说明区（Profile 名称、`resource.model` 或「未配置默认模型，执行时使用 Claude Code SDK 内置默认」类文案）。
  3. **fetchModels 守卫（CE-6）**：函数开头 `if (resource?.type === "claude-code") return`；`sdk` 分支调 `listSdkModels`，`cli` 分支调 `listModels`；**禁止**调用 `listCcModels`。
  4. **切换资源清理 draft（CE-8）**：`agentResourceId` onChange（或等价 effect）中，若新资源为 `claude-code`，`set` 清空 `model`/`modelParams`/`othersModel`/`othersModelParams`；从 CC 切回 Cursor 时保留 draft 中已持久化通道模型（打开弹窗 `useState(channel)` 已带值，勿误清）。
  5. **资源下拉分组（CE-9）**：将 flat `resources.map` 改为按 `type` 分 `<optgroup label="Cursor CLI">` / `"Cursor SDK"` / `"Claude Code Profile"`；option 文案保留 SDK 的 `email` 后缀等现有提示。
  6. **注释**：新增/修改逻辑含中文注释，说明 CC 与 Cursor 分支差异。
- 可选新建: `src/renderer/components/ChannelModelSection.tsx` — 仅当将模型区块抽取后更易维护时创建；抽取后 `ChannelPanel` import 该子组件。**不要求**重构整个 725 行文件的其他区块。
- 不改: `AgentPanel.tsx`、`Settings.tsx`、`electron/*`、`channel-types.ts`、IPC 定义

### 接口契约

- **无新增 IPC / HTTP / 类型导出**；仍使用：
  - `window.electronAPI.listModels()` — `cli`
  - `window.electronAPI.listSdkModels(apiKey, model, modelParams)` — `sdk`
  - `window.electronAPI.getConfig()` / 通道 save 路径 — 不变
- **组件内约定**：
  - `isCcProfile === true` → DOM 无「获取模型列表」；不触发任何模型列表 IPC
  - `isCursorChannel === true` → 与变更前 Cursor 通道编辑行为一致
  - `agentResourceId` 变更 → `modelOptions` 清空（已有 effect）+ 切 CC 时 draft 模型字段清空

### 验收标准

**01 业务验收（须全部满足）**：

- [ ] **验收 1**：选择 Cursor CLI 或 Cursor SDK — 可见通道级主模型、其他人模型；可使用「获取模型列表」；列表与保存后执行行为与变更前一致（01 §F1）
- [ ] **验收 2**：选择 Claude Code Profile — 不出现「获取模型列表」或 Cursor 模型列表下拉；界面体现模型由 Profile 管理（含 Profile 未填默认模型时的说明或合理留白）（01 §F2）
- [ ] **验收 3**：弹窗内切换 Cursor SDK → Claude Code Profile → Cursor CLI — 每次切换后模型区域形态正确，无上一类型残留选项、错误列表或失效按钮（01 §F3）
- [ ] **验收 4**：Agent 资源下拉中三类资源可被明确区分（optgroup 或等价文案）（01 §F4）
- [ ] **验收 5**：已保存且绑定 CC Profile 的通道重新打开编辑 — **不自动**触发 Cursor 模型列表获取；展示与 F2 一致（01 §F2）
- [ ] **验收 6**：Profile 管理页、任务编辑、IM 消息收发、执行引擎路由行为不变（回归 smoke）（01 非目标）

**02 八·（二）工程补充验收项**：

- [ ] 打开已绑定 CC Profile 的通道编辑：不自动调用 `listModels` / `listSdkModels`
- [ ] `resource.type === "claude-code"` 时 DOM 无「获取模型列表」按钮
- [ ] 切换 Cursor SDK → CC → Cursor CLI：UI 即时切换，无 Cursor 模型下拉残留
- [ ] 资源下拉三组可辨（optgroup 或等价）
- [ ] 新增/修改代码含中文注释；**本任务新增或修改的文件**单文件 ≤300 行（若抽取 `ChannelModelSection.tsx`，该新文件亦须 ≤300 行）
- [ ] 无 02/03 未要求的抽象层或未批准的新依赖

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: 构建验证与行数合规

### 背景

T1 完成 UI 联动后，须确认 TypeScript 构建通过，并核实 AGENTS.md「单文件 ≤300 行」对**本变更触及文件**的合规性。`ChannelPanel.tsx` 现网已超 300 行；若 T1 仅做最小 diff 且未新建子组件，T2 记录「存量超限、本变更未扩大违规范围」；若 T1 新建 `ChannelModelSection.tsx`，则新文件须 ≤300 行。

### 上下文文件

- 必读: T1 修改后的 `src/renderer/components/ChannelPanel.tsx`（及可选 `ChannelModelSection.tsx`）
- 必读: 仓库根 `package.json` — `build` 脚本
- 参考: `AGENTS.md` — 300 行规范

### 实现范围

- 执行: 仓库根 `npm run build`，修复 T1 引入的编译错误（若有）
- 检查: T1 新增或修改的每个源文件行数（`wc -l`）；超标则回退 T1 要求抽取子组件
- 不改: 业务逻辑（除非 build 失败需最小修复）

### 接口契约

- 无新增对外接口
- 构建产物与变更前一致（仅 Renderer UI 行为差异）

### 验收标准

- [ ] `npm run build`  exit 0
- [ ] T1 新建文件（若有）均 ≤300 行
- [ ] 手工复验 T1 中 01 验收 1–5 与八·（二）前五项（快速 UI smoke，不必重复全量回归 6）
- [ ] 无 02/03 未要求的额外改动

### 依赖

- 前置任务: T1
- 后续任务: 无（完成后可进入 `/kb-test`）
