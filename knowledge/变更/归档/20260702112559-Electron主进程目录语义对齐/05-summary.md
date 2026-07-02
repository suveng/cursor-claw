# Electron 主进程目录语义对齐 - 变更总结

> **变更 ID**：`20260702112559-Electron主进程目录语义对齐`  
> **来源**：kb-propose · standard flow  
> **阶段**：`reviewed`（待 kb-release 迁移至 `归档/`）  
> **用户可见性**：无 — **跳过** `changelog/` 与 `package.json` version bump（纯内部工程结构重构）

---

## 1、实际变更

### 代码（与 `manifest.files` role=code 一致）

**迁移方式**：82 个 `.ts` 经 `git mv` 迁入语义化子目录；全仓相对 import 改写；无 barrel `index.ts`、无 `@electron/*` 别名、无旧路径 re-export shim。

| 分区 | 文件 | 关键改动 |
|------|------|----------|
| 根入口 | `electron/main.ts`、`electron/preload.ts` | 保留根目录；枢纽 import 改为子目录路径 |
| 根索引 | `electron/AGENTS.md` | 升级为根索引，链到 12 个子目录 `AGENTS.md` |
| `app/` | `main-window.ts`、`tray.ts`、`ui-logger.ts`、`proxy-env.ts`、`AGENTS.md` | 窗口/托盘/日志/代理环境 |
| `config/` | `config-store.ts`、`updater.ts`、`AGENTS.md` | 配置持久化与更新 |
| `daemon/` | `daemon-manager.ts`、`daemon-client.ts`、`sdk-daemon-notify.ts`、`AGENTS.md` | Daemon 桥接；re-export 指向新子目录 |
| `session/` | `session-dispatcher.ts`、`session-mcp-status.ts`、`session-mcp-sdk-path.ts`、`AGENTS.md` | 多会话调度与 MCP 展示 |
| `scheduling/` | `command-handler.ts`、`cron-scheduler.ts`、`AGENTS.md` | 定时任务与远程指令 |
| `workflow/` | `workflow-file.ts`、`workflow-runner.ts`、`AGENTS.md` | 工作流文件与执行 |
| `agent/shared/` | `agent-launcher.ts`、`agent-run-guard.ts`、`crash-log-archiver.ts`、`retry-policy.ts`、`workspace-injector.ts`、`AGENTS.md` | 跨引擎共享能力 |
| `agent/cursor-sdk/` | 20 个 `agent-sdk*` / `sdk-*` / `context-*` / `finalize-sdk-run.ts`、`AGENTS.md` | Cursor SDK 执行引擎 |
| `agent/claude-code/` | 10 个 `agent-cc-*` / `cc-*`、`AGENTS.md` | Claude Code 执行引擎 |
| `agent/codex/` | 10 个 `agent-codex-*` / `codex-failure-messages.ts`、`AGENTS.md` | Codex 执行引擎 |
| `agent/opencode/` | 10 个 `agent-opencode-*` / `opencode-failure-messages.ts`、`AGENTS.md` | OpenCode 执行引擎 |
| `mcp/` | `mcp-manager.ts`、`mcp-types.ts`、`mcp-tools-probe.ts`、`mcp-status-map.ts`、`mcp-project-dir.ts`、`AGENTS.md` | MCP 管理核心 |
| `mcp/loaders/` | `mcp-sdk-loader.ts`、`cc-mcp-loader.ts`、`codex-mcp-loader.ts`、`opencode-mcp-loader.ts` | 四引擎 MCP 加载器 |

**合计**：82 `.ts` + 13 `AGENTS.md` + `main.ts` + `preload.ts` = **97** 个 code 白名单文件；`electron/` 根除上述入口外无滞留 `.ts`；`electron.vite.config.ts` 入口路径未变（T10 验收通过，未纳入 manifest.files）。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`
- `00-manifest.json`（T0–T11 全 `done`；stage=`reviewed`）

---

## 2、与设计的差异

无。

对照 `02-design.md` §一·（二）82 文件映射与 `04-review.md` §4 分区核对表：各分区数量与设计一致；未引入 barrel、路径别名或旧路径 shim（04-review Ponytail 精简轴：Lean already. Ship.）。

---

## 3、影响范围

- **Electron 主进程**：目录树与知识库 Agent 调度 / Electron 桌面应用 / Daemon / 工作流分区语义对齐；运行时行为、IPC 契约、对外 API **不变**。
- **构建**：`npm run build` 已通过（T10）；`electron/` 内旧扁平 import 名零残留。
- **渲染端**：无 `src/renderer/` 业务逻辑变更；T11 同步了 `AGENTS.md` 与 `mcp.d.ts` 注释路径。
- **正交变更**：T0 已确认 `20260701212732` / `20260701212827` 归档，无 merge 冲突。
- **非目标**：超大文件行数治理、功能行为变更、用户界面变更。

### 3.1 Ponytail 技术债

无（`git diff -- electron/` 未新增或修改 `ponytail:` 注释；既有 ponytail 标记随文件迁移路径更新，语义未变）。

---

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/00-README.md` — 「关键源码」表改为子目录路径（含 `mcp/loaders/`、各 `agent/*` 引擎）
- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — 设计决策、IPC 落点、流程表路径改为子目录形式
- [x] `knowledge/工程平台/Electron桌面应用/00-README.md` — 阅读路径增加 `electron/AGENTS.md` 根索引说明
- [x] `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` — `config-store.ts` 等路径改为 `electron/config/`
- [x] `src/renderer/components/AGENTS.md` — 主进程路径引用同步
- [x] `src/renderer/types/mcp.d.ts` — 注释路径改为 `electron/session/session-mcp-status`
- [x] `knowledge/知识索引.md` — 总入口与领域分区结构未变，无需更新（`02-design.md` §十·（三））

---

## 5、评审与归档备注

- **04-review 结论**：通过；blocking=0；设计偏差=无。
- **T11**：kb-librarian 知识库路径同步已完成（manifest `done`）。
- **01 验收 6**（IM/SDK/MCP/Daemon 手动冒烟）：04-review 未复测；archive 前建议负责人做一次轻量冒烟。
- **版本/changelog**：纯内部重构，**不** bump `package.json` version，**不**新建 `changelog/*.json`。
