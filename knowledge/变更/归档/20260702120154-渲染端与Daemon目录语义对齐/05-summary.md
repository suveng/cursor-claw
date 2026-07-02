# 渲染端与 Daemon 目录语义对齐 - 变更总结

> **变更 ID**：`20260702120154-渲染端与Daemon目录语义对齐`  
> **来源**：kb-propose · standard flow  
> **阶段**：`reviewed`（待 kb-release 迁移至 `归档/`）  
> **用户可见性**：无 — **跳过** `changelog/` 与 `package.json` version bump（纯内部工程结构重构）

---

## 1、实际变更

### 代码

**迁移方式**：20 个根级 / `shared/` 下 `.ts` 经 `git mv` 迁入 `src/bridge/`、`src/workflow/`、`src/daemon/` 语义子目录；`wechat/` 子树整体归位 `bridge/wechat/`；全仓相对 import 改写；无 barrel `index.ts`、无路径别名、无旧路径 re-export shim。

| 分区 | 内容 | 关键改动 |
|------|------|----------|
| `bridge/`（11） | `file-queue.ts`、`wechat-manager.ts`、`lark-core.ts`、`wechat/*`（6 文件） | 自 `src/` 根与 `shared/` 迁入；域内 import 对齐 |
| `workflow/`（8） | `workflow-types.ts`、`workflow-parse.ts`、`workflow-definition-store.ts`、`template-utils.ts`、`workflow-engine.ts`、`workflow-store.ts`、`server-workflow.ts`、`builtin-workflows.ts` | 自 `src/` 根与 `shared/` 迁入；域内 import 对齐 |
| `daemon/`（3） | `daemon.ts`、`daemon-scheduled-tasks.ts`、`server-admin.ts` | 自 `src/` 根迁入；枢纽 `daemon.ts` 跨域 import 全部更新 |
| 根入口 | `src/daemon-entry.ts` | `./daemon.js` → `./daemon/daemon.js` |
| `electron/`（6 + 补修） | `workflow/workflow-runner.ts`、`workflow/workflow-file.ts`、`preload.ts`、`scheduling/command-handler.ts`、`config/config-store.ts`、`daemon/daemon-client.ts` | workflow 相关 `src/` import 升一级至 `src/workflow/*` |
| `electron/`（补修） | `daemon/daemon-manager.ts` | wechat 动态 import 路径对齐 `src/bridge/wechat/` |
| `renderer/`（2） | `env.d.ts`、`components/WorkflowPanel.tsx` | `workflow-types` 引用改为 `../workflow/workflow-types` |

**`src/` AGENTS.md 分层（5）**

| 文件 | 改动 |
|------|------|
| `src/AGENTS.md` | 升为根索引，链到子目录 `AGENTS.md` |
| `src/daemon/AGENTS.md` | 新建；承接 orchestrator / MergeBatch / Presentation 等 Daemon 编排约定 |
| `src/bridge/AGENTS.md` | 新建；队列、飞书/微信通道约定 |
| `src/workflow/AGENTS.md` | 新建；工作流引擎 / MCP 存储约定（R2 补修职责边界表述） |
| `src/shared/AGENTS.md` | 新建；跨域类型与 presentation gate 引用约定 |

**`electron/` AGENTS.md 补修（评审 T-FIX）**

| 文件 | 改动 |
|------|------|
| `electron/session/AGENTS.md` | R3：SessionMcpPanel 约定改链 `src/renderer/components/AGENTS.md` |
| `electron/workflow/AGENTS.md` | 随 workflow 分区路径同步（与 `20260702112559` electron 变更一致） |

**知识库源码锚点（4 + 1）**

| 文件 | 改动 |
|------|------|
| `knowledge/业务域/消息桥接/00-README.md` | 锚点指向 `src/bridge/*` |
| `knowledge/业务域/工作流/00-README.md` | 锚点指向 `src/workflow/*` |
| `knowledge/业务域/Agent调度/00-README.md` | 含 `src/daemon/daemon.ts` orchestrator 行 |
| `knowledge/工程平台/Daemon守护进程/00-README.md` | 入口 `daemon-entry.ts` → `daemon/daemon.ts` |
| `knowledge/工程平台/Daemon守护进程/01-概览.md` | R1：旧 `src/daemon.ts` 改为 `src/daemon/daemon.ts` |

**构建验收**：`npm run build` 通过；全仓旧扁平路径 `rg` 零命中。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`
- `00-manifest.json`（T1–T8 全 `done`；stage=`reviewed`）

---

## 2、与设计的差异

无。

评审 R1–R3 文档修复（`01-概览.md` 路径、`workflow/AGENTS.md` 职责边界、`session/AGENTS.md` 渲染端链接）均已 T-FIX 合入；`04-review.md` 设计偏差表全 ✅。

---

## 3、影响范围

- **`src/` 守护进程与桥接**：目录树与知识库消息桥接 / 工作流 / Agent 调度 / Daemon 分区语义对齐；HTTP 路由、MCP handler、IPC 契约、运行时行为 **不变**。
- **`electron/`**：仅对 `src/` 的 import 字符串变更；与平行变更 `20260702112559`（electron 主进程目录对齐）协调完成。
- **渲染端**：`renderer/` 目录树不迁移；仅 2 处 `workflow-types` import 路径更新；UI 与交互 **不变**。
- **构建**：`daemon-entry.ts` 仍留 `src/` 根；`tsconfig.json` `rootDir=src` 未变；`dist/daemon-entry.js` / `dist-bundle/daemon-entry.mjs` 正常产出。
- **非目标**：`daemon.ts` 体量拆分、功能行为变更、用户界面变更。

### 3.1 Ponytail 技术债

无（本次 diff 未新增 `ponytail:` 注释）。

---

## 4、知识库影响清单

- [x] `knowledge/业务域/消息桥接/00-README.md`
- [x] `knowledge/业务域/工作流/00-README.md`
- [x] `knowledge/业务域/Agent调度/00-README.md`
- [x] `knowledge/工程平台/Daemon守护进程/00-README.md`
- [x] `knowledge/工程平台/Daemon守护进程/01-概览.md`（评审补修）
- [x] `knowledge/知识索引.md` — 无入口变化，无需更新
