# 渲染端与 Daemon 目录语义对齐 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### 1.1 依赖图

```
T1 ──→ T2 ──→ T3 ──→ T4 ──┬──→ T5 ──→ T8
                            ├──→ T6 ──→ T7 ──→ T8
```

### 1.2 分组调度

- **第一轮**：T1（单独）
- **第二轮**：T2（单独，workflow 从 shared 迁出须最先）
- **第三轮**：T3（单独，bridge 依赖 shared 中 lark-core 已迁出）
- **第四轮**：T4（单独，daemon 枢纽 + renderer 2 文件 import）
- **第五轮（并行）**：T5、T6（无共享写冲突：T5 仅 `electron/`，T6 仅 `src/**/AGENTS.md` 与根 `src/AGENTS.md`）
- **第六轮**：T7（知识库）
- **第七轮**：T8（全仓构建 + rg 验收）

## 2、任务清单

## T1: 前置核对与目录骨架

### 背景
确认平行变更 `20260702112559` 已归档、对照表文件清单与磁盘一致，并创建语义子目录。避免在 electron 未合并时并行改 `src/` 引用链。

### 上下文文件
- 必读: `knowledge/变更/进行中/20260702120154-渲染端与Daemon目录语义对齐/02-design.md` §1.2 对照表 — 迁移权威清单
- 必读: `knowledge/变更/归档/20260702112559-Electron主进程目录语义对齐/00-manifest.json` — 确认 stage=archived
- 参考: `knowledge/变更/进行中/20260702120154-渲染端与Daemon目录语义对齐/01-proposal.md` §七 验收标准

### 实现范围
- 新建: `src/bridge/wechat/`、`src/workflow/`、`src/daemon/` 目录（`mkdir -p`）
- 修改: 无代码文件；产出核对清单（对照表 20 个 `.ts` + `wechat/` 6 文件均在预期旧路径）

### 接口契约
- 无代码接口变更；目录骨架路径固定为 `src/bridge/`、`src/workflow/`、`src/daemon/`

### 验收标准
- [ ] `20260702112559` 已在 `knowledge/变更/归档/` 且 manifest `stage` 为 `archived` 或 `archived_with_debt`
- [ ] `ls src/daemon.ts src/file-queue.ts src/workflow-engine.ts src/shared/workflow-types.ts` 等对照表旧路径均存在
- [ ] `src/bridge/`、`src/workflow/`、`src/daemon/` 目录已创建且为空（或仅含后续任务将迁入的文件）
- [ ] 无 `02`/`03` 未要求的抽象层或未批准新依赖

### 依赖
- 前置任务: 无
- 后续任务: T2

---

## T2: workflow 域 git mv 与域内 import

### 背景
按 design §6 步骤 3，先将 `shared/` 中工作流专属 4 文件迁入 `workflow/`，再迁移根级工作流 4 文件；并修正域内相对 import。工作流域须先于 daemon/bridge 枢纽更新完成。

### 上下文文件
- 必读: `02-design.md` §1.2 workflow 对照表（8 行）
- 必读: `src/shared/workflow-types.ts`、`workflow-parse.ts`、`workflow-definition-store.ts`、`template-utils.ts` — 迁前 import
- 必读: `src/workflow-engine.ts`、`workflow-store.ts`、`server-workflow.ts`、`builtin-workflows.ts` — 迁后路径与 import

### 实现范围
- 修改（git mv）:
  - `src/shared/workflow-types.ts` → `src/workflow/workflow-types.ts`
  - `src/shared/workflow-parse.ts` → `src/workflow/workflow-parse.ts`
  - `src/shared/workflow-definition-store.ts` → `src/workflow/workflow-definition-store.ts`
  - `src/shared/template-utils.ts` → `src/workflow/template-utils.ts`
  - `src/workflow-engine.ts` → `src/workflow/workflow-engine.ts`
  - `src/workflow-store.ts` → `src/workflow/workflow-store.ts`
  - `src/server-workflow.ts` → `src/workflow/server-workflow.ts`
  - `src/builtin-workflows.ts` → `src/workflow/builtin-workflows.ts`
- 修改: 上述 8 个文件内 `./shared/workflow-*` → `./workflow-*` 等同目录/邻域 import（`.js` 后缀保持 Node16 ESM）

### 接口契约
- 导出符号不变：`WorkflowDefinition`、`WorkflowInstance`、`createInstance`、`startWorkflow`、`loadBuiltinWorkflows`、`registerWorkflowAgentTools` 等
- **禁止**新增 barrel `index.ts` 或 re-export shim

### 验收标准
- [ ] 对照表 workflow 8 行全部就位；`src/workflow-engine.ts` 等旧根路径不存在
- [ ] `src/workflow/` 内 import 无 `./shared/workflow-` 残留
- [ ] `tsc`（`npm run build:mcp`）在仅完成本任务后：若 daemon 仍引用旧路径预期失败，但 `workflow/` 内文件无 TS 域内错误（可用 `tsc --noEmit` 单文件或完成 T4 后统一 build）
- [ ] 无未批准新依赖或抽象层

### 依赖
- 前置任务: T1
- 后续任务: T3

**可能冲突文件**: `src/workflow/**`（本任务独占）

---

## T3: bridge 域 git mv 与域内 import

### 背景
迁移消息桥接域文件：`file-queue`、`wechat-manager`、`lark-core`、`wechat/` 子树至 `src/bridge/`；修正 bridge 域内 import（含 `lark-core` → `../shared/tool-presentation.js`）。

### 上下文文件
- 必读: `02-design.md` §1.2 bridge 对照表（9 行含 wechat 子树）
- 必读: `src/wechat-manager.ts`、`src/shared/lark-core.ts`、`src/wechat/**`
- 必读: `src/file-queue.ts`

### 实现范围
- 修改（git mv）:
  - `src/file-queue.ts` → `src/bridge/file-queue.ts`
  - `src/wechat-manager.ts` → `src/bridge/wechat-manager.ts`
  - `src/shared/lark-core.ts` → `src/bridge/lark-core.ts`
  - `src/wechat/*` → `src/bridge/wechat/*`（整目录）
- 修改: `bridge/wechat-manager.ts` 内 `./wechat/` → `./wechat/`（同目录下不变或 `./wechat/index.js`）；`./shared/lark-core` → `./lark-core.js`；`bridge/lark-core.ts` 内 `./tool-presentation` → `../shared/tool-presentation.js`

### 接口契约
- 导出符号不变：`pushToFileQueue`、`WeChatManager`、`LarkSender`、`createLarkClient` 等
- `MEDIA_CACHE_DIR` 等常量导出路径仅物理路径变

### 验收标准
- [ ] 对照表 bridge 9 行就位；`src/wechat/`、`src/file-queue.ts` 旧路径不存在
- [ ] `src/bridge/lark-core.ts` 正确引用 `../shared/tool-presentation.js`
- [ ] `src/bridge/wechat-manager.ts` 正确引用 `./wechat/index.js` 与 `./lark-core.js`
- [ ] 无未批准新依赖或抽象层

### 依赖
- 前置任务: T2
- 后续任务: T4

**可能冲突文件**: `src/bridge/**`（本任务独占）

---

## T4: daemon 域迁移与 src 枢纽 import

### 背景
迁移 `daemon.ts` 等 3 文件至 `src/daemon/`；更新 `daemon-entry.ts` 与枢纽 `daemon/daemon.ts` 全部跨域 import；同步 renderer 2 处 `workflow-types` 路径。本任务完成后 `src/` 内旧扁平 import 应清零。

### 上下文文件
- 必读: `02-design.md` §2 import 迁移策略表
- 必读: `src/daemon.ts`（枢纽，仅改 import 行，不改业务逻辑）
- 必读: `src/daemon-entry.ts`
- 必读: `src/daemon-scheduled-tasks.ts`、`src/server-admin.ts`
- 必读: `src/renderer/env.d.ts`、`src/renderer/components/WorkflowPanel.tsx`

### 实现范围
- 修改（git mv）:
  - `src/daemon.ts` → `src/daemon/daemon.ts`
  - `src/daemon-scheduled-tasks.ts` → `src/daemon/daemon-scheduled-tasks.ts`
  - `src/server-admin.ts` → `src/daemon/server-admin.ts`
- 修改: `src/daemon-entry.ts` — `./daemon.js` → `./daemon/daemon.js`
- 修改: `src/daemon/daemon.ts` — 全部 import 按 design 表更新，例如：
  - `./daemon-scheduled-tasks.js` → `./daemon-scheduled-tasks.js`（同目录）
  - `./shared/lark-core.js` → `../bridge/lark-core.js`
  - `./file-queue.js` → `../bridge/file-queue.js`
  - `./wechat-manager.js` → `../bridge/wechat-manager.js`
  - `./server-workflow.js` → `../workflow/server-workflow.js`
  - `./shared/channel-types.js` → `../shared/channel-types.js`
  - `./shared/feishu-presentation-gate.js` → `../shared/feishu-presentation-gate.js`
  - `./shared/tool-presentation.js` → `../shared/tool-presentation.js`
  - `./shared/constants.js` → `../shared/constants.js`
  - `./server-admin.js` → `./server-admin.js`（同目录）
- 修改: `src/daemon/daemon-scheduled-tasks.ts`、`src/daemon/server-admin.ts` 内相对 import
- 修改: `src/workflow/server-workflow.ts` 内对 `daemon` 的引用（若有）及 workflow 跨域 import
- 修改: `src/renderer/env.d.ts` — `../shared/workflow-types` → `../workflow/workflow-types`
- 修改: `src/renderer/components/WorkflowPanel.tsx` — `../../shared/workflow-types` → `../../workflow/workflow-types`

### 接口契约
- `daemonMain` 仍从 `src/daemon/daemon.ts` 导出；`daemon-entry.ts` 为唯一启动入口
- HTTP 路由与 handler 函数签名不变

### 验收标准
- [ ] 对照表 daemon 3 行就位；`src/daemon.ts` 旧根路径不存在
- [ ] `daemon-entry.ts` 仅 import `./daemon/daemon.js`
- [ ] `rg 'from \"\\./file-queue|from \"\\./wechat-manager|from \"\\./shared/lark-core|from \"\\./daemon\\.js\"' src --glob '*.ts'` 零命中（排除 knowledge）
- [ ] `npm run build:mcp` 通过（`tsc` 编译 src 非 renderer）
- [ ] **禁止**拆分或重构 `daemon.ts` 业务逻辑；diff 应主要为 import 行
- [ ] 无未批准新依赖或抽象层

### 依赖
- 前置任务: T3
- 后续任务: T5、T6

**可能冲突文件**: `src/daemon/daemon.ts`、`src/daemon-entry.ts`、`src/renderer/env.d.ts`、`src/renderer/components/WorkflowPanel.tsx`

---

## T5: electron 对 src 的 import 更新

### 背景
更新 `electron/` 约 17 处对 `src/` 的引用：workflow 路径升一级；`shared/channel-types` 等不变。与 T4 并行执行（不写 `src/daemon` 枢纽文件）。

### 上下文文件
- 必读: `02-design.md` §7 参考实现
- 必读: 以下文件（精确 grep 命中）:
  - `electron/workflow/workflow-runner.ts`
  - `electron/workflow/workflow-file.ts`
  - `electron/preload.ts`
  - `electron/scheduling/command-handler.ts`
  - `electron/config/config-store.ts`
  - `electron/daemon/daemon-client.ts`
  - `electron/daemon/daemon-manager.ts`
  - `electron/session/session-dispatcher.ts`
  - `electron/agent/cursor-sdk/sdk-run-stream.ts`
  - `electron/agent/cursor-sdk/sdk-run-presentation.ts`
  - `electron/agent/cursor-sdk/sdk-session-registry.ts`
  - `electron/agent/claude-code/agent-cc-stream.ts`
  - `electron/agent/claude-code/agent-cc-utils.ts`
  - `electron/agent/codex/agent-codex-stream.ts`
  - `electron/agent/opencode/agent-opencode-stream.ts`
  - `electron/agent/opencode/agent-opencode-utils.ts`
  - `electron/agent/opencode/agent-opencode-sdk.ts`

### 实现范围
- 修改: workflow 相关 import 路径：
  - `../../src/shared/workflow-types` → `../../src/workflow/workflow-types`
  - `../../src/shared/workflow-definition-store` → `../../src/workflow/workflow-definition-store`
  - `../../src/workflow-engine` → `../../src/workflow/workflow-engine`
  - `../../src/workflow-store` → `../../src/workflow/workflow-store`
  - `../../src/builtin-workflows` → `../../src/workflow/builtin-workflows`
  - `../src/shared/workflow-types` → `../src/workflow/workflow-types`（preload）
- 不改: `../../src/shared/channel-types`、`constants`、`tool-presentation`、`feishu-presentation-gate` 路径

### 接口契约
- electron 侧无新增导出；仅 import 字符串变更

### 验收标准
- [ ] `rg 'src/workflow-engine|src/workflow-store|src/builtin-workflows|src/shared/workflow-' electron/` 零命中
- [ ] `rg 'src/shared/channel-types|src/shared/constants' electron/` 仍正常命中（路径未误改）
- [ ] 无未批准新依赖或抽象层

### 依赖
- 前置任务: T4
- 后续任务: T8

**可能冲突文件**: `electron/**`（与 T6 无交集）

---

## T6: AGENTS.md 分层与渲染端约定下沉

### 背景
将 `src/AGENTS.md` 中长 Daemon 编排约定下沉至 `src/daemon/AGENTS.md`；新建 `bridge/`、`workflow/`、`shared/` 子目录 `AGENTS.md`；根 `AGENTS.md` 升为索引。满足 01 验收 5。

### 上下文文件
- 必读: 当前 `src/AGENTS.md` 全文
- 参考: `electron/AGENTS.md` 根索引模式（归档变更 20260702112559）
- 参考: `src/renderer/components/AGENTS.md` — 保留不动

### 实现范围
- 修改: `src/AGENTS.md` — 改为根索引（目录导航 + 全局约束 ≤30 行级摘要）
- 新建: `src/daemon/AGENTS.md` — 承接 orchestrator、MergeBatch、Presentation、stream-text 等原根文档主体
- 新建: `src/bridge/AGENTS.md` — 队列、飞书/微信通道、入队进度约定摘要
- 新建: `src/workflow/AGENTS.md` — 工作流引擎/MCP 存储约定摘要
- 新建: `src/shared/AGENTS.md` — 跨域类型与 presentation gate 引用约定

### 接口契约
- 无代码接口；文档链接相对路径正确

### 验收标准
- [ ] 根 `src/AGENTS.md` 链到 4 个子目录 `AGENTS.md`
- [ ] `src/daemon/AGENTS.md` 含原 orchestrator/MergeBatch/Presentation 核心规矩（非流水账）
- [ ] 各 `AGENTS.md` 单文件 ≤300 行（超长则摘要化，不拆代码）
- [ ] 无未批准新依赖或抽象层

### 依赖
- 前置任务: T4
- 后续任务: T7

**可能冲突文件**: `src/AGENTS.md`、`src/*/AGENTS.md`

---

## T7: 知识库源码锚点同步

### 背景
按 design §10.1 更新 5 处知识库「源码锚点/关键源码」表，使路径与迁移后目录一致。

### 上下文文件
- 必读: `02-design.md` §10.1、§10.2
- 必读: `knowledge/业务域/消息桥接/00-README.md`
- 必读: `knowledge/业务域/工作流/00-README.md`
- 必读: `knowledge/业务域/Agent调度/00-README.md`
- 必读: `knowledge/工程平台/Daemon守护进程/00-README.md`
- 必读: `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md`

### 实现范围
- 修改: 上述 README/子模块中 `src/` 路径表，对齐 design 对照表新路径
- 修改（视正文）: `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — 若列举 `server-workflow.ts` 旧路径
- 不改: `knowledge/知识索引.md`、`knowledge/知识地图.md`

### 接口契约
- 无

### 验收标准
- [ ] 消息桥接 README 锚点指向 `src/bridge/*`
- [ ] 工作流 README 锚点指向 `src/workflow/*`
- [ ] Agent调度 README 含 `src/daemon/daemon.ts` orchestrator 行
- [ ] Daemon 工程平台 README 入口为 `daemon-entry.ts` → `daemon/daemon.ts`
- [ ] 无未批准新依赖或抽象层

### 依赖
- 前置任务: T6
- 后续任务: T8

---

## T8: 构建验收与旧路径零残留检索

### 背景
全量构建与 design §8.2 工程补充验收项；确认 01 验收 2、3、6 的工程可验证部分。

### 上下文文件
- 必读: `02-design.md` §8.2
- 必读: `package.json` scripts `build`、`build:mcp`、`build:bundle`
- 参考: `tsconfig.json`、`electron.vite.config.ts`

### 实现范围
- 执行: `npm run build`（clean + build:mcp + build:bundle + electron-vite build）
- 执行: `rg` 旧路径检索（见 design §8.2 与 §1.2 D8）
- 记录: 手动冒烟检查项清单（IM/dispatch/工作流 MCP/Dashboard）写入任务回报，不扩 scope

### 接口契约
- 无

### 验收标准
- [ ] `npm run build`  exit 0
- [ ] `dist/daemon-entry.js` 与 `dist-bundle/daemon-entry.mjs` 存在
- [ ] `rg 'src/file-queue|src/wechat-manager|src/workflow-engine|from \"\\./daemon\\.js\"' --glob '!knowledge/**' --glob '!knowledge/变更/**'` 零命中（进行中变更文档内历史说明可例外）
- [ ] `electron.vite.config.ts` 未误改 `root: src/renderer`
- [ ] 01 验收 1–7 工程向条目均可追溯本任务或前序 T1–T7
- [ ] 无未批准新依赖或抽象层

### 依赖
- 前置任务: T5、T7
- 后续任务: 无（完成后进入 `/kb-review`）

---
