# Electron 主进程目录语义对齐 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **硬约束**：仅 `git mv` + 相对 import 改写，不改业务逻辑；不拆分超大文件；不保留旧路径 re-export shim；`electron/main.ts`、`electron/preload.ts` 留根目录。

## 1、执行计划

### （一）依赖图

```
T0（正交变更闸门）
  └──→ T1（叶节点：app/config/workflow/scheduling/agent/shared）
         └──→ T2（mcp + loaders）
                ├──→ T3（cursor-sdk）──┐
                ├──→ T4（claude-code）─┼──→ T6（session）
                └──→ T5（codex+opencode）┘
                                      └──→ T7（daemon）
                                             └──→ T8（main.ts 枢纽）
                                                    └──→ T9（AGENTS 分层）
                                                           └──→ T10（build + grep）
                                                                  └──→ T11（知识库，kb-librarian）
```

### （二）分组调度

- **第零轮（闸门）**：T0 — 确认 `20260701212732`、`20260701212827` 已 archive 或工作区无未合并冲突
- **第一轮**：T1 — 创建子目录 + 叶节点 `git mv` + 本批 import
- **第二轮**：T2 — `mcp/`、`mcp/loaders/` 迁移 + import
- **第三轮（并行）**：T3、T4、T5 — 四引擎子目录迁移 + import（无同文件冲突）
- **第四轮**：T6 — `session/` 迁移 + import（依赖引擎与 mcp 新路径）
- **第五轮**：T7 — `daemon/` 迁移 + import（枢纽，约 22 处 import）
- **第六轮**：T8 — `main.ts` import 收尾（约 10 处）
- **第七轮**：T9 — `electron/AGENTS.md` 分层至 12 个子目录
- **第八轮**：T10 — `npm run build` + 旧路径 `rg` 零残留
- **第九轮**：T11 — 知识库路径同步（**kb-librarian** 执行）

## 2、任务清单

## T0: 正交变更协调闸门

### 背景

`01` 验收 7 与 `02` 步骤 D0 要求：本变更 `git mv` 前须确认进行中 SDK 变更 `20260701212732`（Cursor SDK 本地配置来源对齐）、`20260701212827`（CursorSDK 执行引擎事件流消费）已 archive 或已 rebase 到当前分支，避免与逻辑改动交织导致冲突难以解。

### 上下文文件

- CodeGraph: `mcp-sdk-loader` / `sdk-run-recover` / `session-mcp-sdk-path` — 确认正交变更触及的枢纽符号当前路径
- 必读: `knowledge/变更/归档/20260701212732-Cursor SDK 本地配置来源对齐/00-manifest.json` — 确认 stage=archived
- 必读: `knowledge/变更/归档/20260701212827-CursorSDK执行引擎事件流消费/00-manifest.json` — 确认 stage=archived
- 必读: 本文件 `T3`～`T7` 所列文件 — 核对工作区 `git status` 无上述变更的未合并改动

### 实现范围

- 修改: 无代码改动
- 执行: `git status electron/` 检查；若 `20260701212732`/`20260701212827` 未 archive，须先 merge/rebase 其代码再开始 T1
- 登记: 在 commit message 或 PR 描述注明「D0 闸门已通过」

### 接口契约

- **闸门通过条件**：`electron/agent-sdk.ts`、`electron/daemon-manager.ts`、`electron/mcp-sdk-loader.ts`、`electron/session-mcp-*.ts`、`electron/sdk-run-*.ts` 等工作区内容与正交变更合并后一致，无 `UU`/`AA` 冲突标记

### 验收标准

- [ ] `20260701212732`、`20260701212827` manifest `stage` 均为 `archived`，或等效已合并到当前分支
- [ ] `git status electron/` 无未解决 merge 冲突
- [ ] **01 验收 7**：spot check 文件 `sdk-run-recover.ts`、`session-mcp-sdk-path.ts`、`mcp-sdk-loader.ts` 逻辑与正交变更合并后一致（非回退）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T1

---

## T1: 叶节点目录迁移（app / config / workflow / scheduling / agent/shared）

### 背景

按 import 自叶向根策略，先迁移依赖扇出最低的工程平台与横切模块，为后续 `mcp/`、引擎、`session/`、`daemon/` 提供稳定目标路径。本批共 15 个 `.ts` 文件。

### 上下文文件

- CodeGraph: `main-window` / `config-store` / `workflow-runner` / `agent-launcher` — `codegraph_impact` 列出引用方，指导 import 改写完整性
- 必读: `electron/main.ts` — 当前对 `main-window`、`config-store`、`tray`、`updater` 等 import（迁移后 T8 统一改 main，本批仅改已移动文件内部及互相引用）
- 必读: `electron/workflow-runner.ts` — 引用 `agent-sdk` 等（目标路径尚未存在时暂保留旧路径，T3 后由 T6/T7 接续）

### 实现范围

- 新建目录: `electron/app/`、`electron/config/`、`electron/workflow/`、`electron/scheduling/`、`electron/agent/shared/`
- `git mv`（仅路径，不改逻辑）:
  - `electron/main-window.ts` → `electron/app/main-window.ts`
  - `electron/tray.ts` → `electron/app/tray.ts`
  - `electron/ui-logger.ts` → `electron/app/ui-logger.ts`
  - `electron/proxy-env.ts` → `electron/app/proxy-env.ts`
  - `electron/config-store.ts` → `electron/config/config-store.ts`
  - `electron/updater.ts` → `electron/config/updater.ts`
  - `electron/workflow-file.ts` → `electron/workflow/workflow-file.ts`
  - `electron/workflow-runner.ts` → `electron/workflow/workflow-runner.ts`
  - `electron/command-handler.ts` → `electron/scheduling/command-handler.ts`
  - `electron/cron-scheduler.ts` → `electron/scheduling/cron-scheduler.ts`
  - `electron/agent-launcher.ts` → `electron/agent/shared/agent-launcher.ts`
  - `electron/agent-run-guard.ts` → `electron/agent/shared/agent-run-guard.ts`
  - `electron/crash-log-archiver.ts` → `electron/agent/shared/crash-log-archiver.ts`
  - `electron/retry-policy.ts` → `electron/agent/shared/retry-policy.ts`
  - `electron/workspace-injector.ts` → `electron/agent/shared/workspace-injector.ts`
- 修改: 上述已移动文件内全部 `from "./…"` / `from "../…"` 相对 import；`../src/shared/` 深度按新层级改写（如 `app/main-window.ts` → `../../src/shared/...`）
- 修改: 仍留根目录的文件中**指向本批已移动文件**的 import（若存在）

### 接口契约

- 各文件导出符号名**不变**（如 `getConfig`、`pushUiLog`、`launchWorkflow`）
- **禁止**新建 barrel `index.ts` 或路径别名 `@electron/*`
- `electron.vite.config.ts` **不修改**（入口仍为 `electron/main.ts`）

### 验收标准

- [ ] 15 个文件均已 `git mv` 至目标路径，`git log --follow` 可追踪历史
- [ ] 本批文件内相对 import 编译无误；`codegraph_impact` 对本批符号零遗漏旧扁平路径引用
- [ ] `electron/` 根目录除 `main.ts`、`preload.ts` 外，本批旧文件名不再存在
- [ ] 无业务逻辑 diff（`git diff` 仅 import 与路径相关行）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T0
- 后续任务: T2

---

## T2: MCP 模块迁移（mcp / mcp/loaders）

### 背景

MCP 为跨引擎横切模块；`mcp-types`、`mcp-project-dir` 为叶节点，四引擎 loader 统一落 `mcp/loaders/`。本批 9 个 `.ts` 文件，完成后引擎与 session 可引用新 loader 路径。

### 上下文文件

- CodeGraph: `mcp-manager` / `mcp-sdk-loader` / `loadInlineMcpServers` — `codegraph_impact` 确认全部 import 方
- 必读: `electron/mcp-manager.ts`、`electron/mcp-types.ts` — 模块内互相引用
- 必读: `electron/mcp-sdk-loader.ts`、`electron/cc-mcp-loader.ts`、`electron/codex-mcp-loader.ts`、`electron/opencode-mcp-loader.ts` — loader 对 `mcp-project-dir`、`mcp-types` 的依赖

### 实现范围

- 新建目录: `electron/mcp/`、`electron/mcp/loaders/`
- `git mv`:
  - `electron/mcp-manager.ts` → `electron/mcp/mcp-manager.ts`
  - `electron/mcp-types.ts` → `electron/mcp/mcp-types.ts`
  - `electron/mcp-tools-probe.ts` → `electron/mcp/mcp-tools-probe.ts`
  - `electron/mcp-status-map.ts` → `electron/mcp/mcp-status-map.ts`
  - `electron/mcp-project-dir.ts` → `electron/mcp/mcp-project-dir.ts`
  - `electron/mcp-sdk-loader.ts` → `electron/mcp/loaders/mcp-sdk-loader.ts`
  - `electron/cc-mcp-loader.ts` → `electron/mcp/loaders/cc-mcp-loader.ts`
  - `electron/codex-mcp-loader.ts` → `electron/mcp/loaders/codex-mcp-loader.ts`
  - `electron/opencode-mcp-loader.ts` → `electron/mcp/loaders/opencode-mcp-loader.ts`
- 修改: 本批文件内相对 import；更新 T1 已迁移文件中指向 `mcp-*` 的 import（如 `scheduling/command-handler` 若引用 mcp）

### 接口契约

- `McpServerEntry`、`fetchMcpStatusMap`、`loadInlineMcpServersForSdk` 等导出符号不变
- loader 路径契约: `electron/mcp/loaders/{mcp-sdk,cc,codex,opencode}-mcp-loader.ts`

### 验收标准

- [ ] 9 个文件 `git mv` 完成，根目录无 `mcp-*.ts` 滞留（loader 旧名亦然）
- [ ] `codegraph_impact` 对 `mcp-manager`、`mcp-types`、`mcp-sdk-loader` 无旧路径 import 残留
- [ ] 无业务逻辑 diff
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: T3、T4、T5

---

## T3: Cursor SDK 引擎目录迁移（agent/cursor-sdk）

### 背景

Cursor SDK 共 20 个 `.ts`，含 `agent-sdk` 枢纽（约 19 处 import）及 `sdk-run-*` 执行链。迁移后路径为 `electron/agent/cursor-sdk/`。

### 上下文文件

- CodeGraph: `launchSdkAgent` / `agent-sdk` / `sdk-run-stream` — `codegraph_impact`（约 13 符号扇出）
- 必读: `electron/agent-sdk.ts` — 枢纽 import 清单
- 必读: `electron/sdk-run-recover.ts`、`electron/context-usage.ts` — 正交变更文件，仅改路径
- 参考: `electron/daemon-manager.ts` — 只读当前对 `agent-sdk`、`sdk-run-recover` 的 import（T7 改）

### 实现范围

- 新建目录: `electron/agent/cursor-sdk/`
- `git mv`（20 文件）:
  - `electron/agent-sdk.ts` → `electron/agent/cursor-sdk/agent-sdk.ts`
  - `electron/agent-sdk-http.ts` → `electron/agent/cursor-sdk/agent-sdk-http.ts`
  - `electron/sdk-api-models.ts` → `electron/agent/cursor-sdk/sdk-api-models.ts`
  - `electron/sdk-session-registry.ts` → `electron/agent/cursor-sdk/sdk-session-registry.ts`
  - `electron/sdk-session-types.ts` → `electron/agent/cursor-sdk/sdk-session-types.ts`
  - `electron/sdk-run-dispatch.ts` → `electron/agent/cursor-sdk/sdk-run-dispatch.ts`
  - `electron/sdk-run-finalize.ts` → `electron/agent/cursor-sdk/sdk-run-finalize.ts`
  - `electron/sdk-run-lifecycle.ts` → `electron/agent/cursor-sdk/sdk-run-lifecycle.ts`
  - `electron/sdk-run-persist.ts` → `electron/agent/cursor-sdk/sdk-run-persist.ts`
  - `electron/sdk-run-persistence.ts` → `electron/agent/cursor-sdk/sdk-run-persistence.ts`
  - `electron/sdk-run-presentation.ts` → `electron/agent/cursor-sdk/sdk-run-presentation.ts`
  - `electron/sdk-run-recover.ts` → `electron/agent/cursor-sdk/sdk-run-recover.ts`
  - `electron/sdk-run-stream.ts` → `electron/agent/cursor-sdk/sdk-run-stream.ts`
  - `electron/sdk-run-watchdog.ts` → `electron/agent/cursor-sdk/sdk-run-watchdog.ts`
  - `electron/finalize-sdk-run.ts` → `electron/agent/cursor-sdk/finalize-sdk-run.ts`
  - `electron/context-usage.ts` → `electron/agent/cursor-sdk/context-usage.ts`
  - `electron/context-usage-pressure.ts` → `electron/agent/cursor-sdk/context-usage-pressure.ts`
  - `electron/context-usage-run-end.ts` → `electron/agent/cursor-sdk/context-usage-run-end.ts`
  - `electron/context-rotation-lite.ts` → `electron/agent/cursor-sdk/context-rotation-lite.ts`
  - `electron/sdk-failure-messages.ts` → `electron/agent/cursor-sdk/sdk-failure-messages.ts`
- 修改: 本目录内全部相对 import；典型跨树路径:
  - `agent-sdk.ts` → `../../mcp/loaders/mcp-sdk-loader`
  - `agent-sdk.ts` → `../shared/agent-launcher`
  - `sdk-run-*.ts` 互引与同目录 `agent-sdk`
- 修改: T1/T2 已迁移文件中指向本批旧路径的 import

### 接口契约

- `launchSdkAgent`、`recoverSdkActiveRuns`、`getSdkSession` 等导出符号不变
- `agent-sdk.ts` 内 re-export（若有）路径同步更新，**不**在旧路径留 shim

### 验收标准

- [ ] 20 个文件均在 `electron/agent/cursor-sdk/`，根目录无 `agent-sdk*`、`sdk-run-*`、`context-usage*`、`sdk-failure-messages` 滞留
- [ ] `codegraph_impact` 对 `launchSdkAgent`、`recoverSdkActiveRuns` 无 `./agent-sdk` 等旧 import
- [ ] 无业务逻辑 diff；`daemon-manager.ts` 内 re-export 若存在留待 T7
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T2
- 后续任务: T6

---

## T4: Claude Code 引擎目录迁移（agent/claude-code）

### 背景

Claude Code 引擎 10 个 `.ts` 迁至 `electron/agent/claude-code/`；`cc-sdk-hooks` 为引擎运行时 hook，**不**迁入 `mcp/loaders/`。

### 上下文文件

- CodeGraph: `launchCcAgent` / `agent-claude-sdk` — `codegraph_impact`
- 必读: `electron/agent-claude-sdk.ts`、`electron/agent-cc-http.ts`
- 必读: `electron/cc-sdk-hooks.ts`、`electron/cc-watchdog-finalize.ts`

### 实现范围

- 新建目录: `electron/agent/claude-code/`
- `git mv`（10 文件）:
  - `electron/agent-claude-sdk.ts` → `electron/agent/claude-code/agent-claude-sdk.ts`
  - `electron/agent-cc-stream.ts` → `electron/agent/claude-code/agent-cc-stream.ts`
  - `electron/agent-cc-presentation.ts` → `electron/agent/claude-code/agent-cc-presentation.ts`
  - `electron/agent-cc-types.ts` → `electron/agent/claude-code/agent-cc-types.ts`
  - `electron/agent-cc-utils.ts` → `electron/agent/claude-code/agent-cc-utils.ts`
  - `electron/agent-cc-http.ts` → `electron/agent/claude-code/agent-cc-http.ts`
  - `electron/agent-cc-session-registry.ts` → `electron/agent/claude-code/agent-cc-session-registry.ts`
  - `electron/agent-cc-events.ts` → `electron/agent/claude-code/agent-cc-events.ts`
  - `electron/cc-sdk-hooks.ts` → `electron/agent/claude-code/cc-sdk-hooks.ts`
  - `electron/cc-watchdog-finalize.ts` → `electron/agent/claude-code/cc-watchdog-finalize.ts`
- 修改: 本目录内 import；`agent-claude-sdk` → `../../mcp/loaders/cc-mcp-loader`；更新 T1/T2 中旧路径引用

### 接口契约

- `launchClaudeCodeAgent`、`getCcSession`、`getClaudeCodeSessionList` 导出不变
- `agent-claude-sdk.ts` re-export 三查询函数契约不变（调用方 import 路径变）

### 验收标准

- [ ] 10 个文件均在 `electron/agent/claude-code/`
- [ ] `codegraph_impact` 对 `agent-claude-sdk` 无旧扁平路径
- [ ] 无业务逻辑 diff
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T2
- 后续任务: T6

---

## T5: Codex 与 OpenCode 引擎目录迁移

### 背景

Codex（10 文件）与 OpenCode（10 文件）对称迁移至 `electron/agent/codex/`、`electron/agent/opencode/`，可与 T3/T4 并行。

### 上下文文件

- CodeGraph: `launchCodexAgent` / `launchOpencodeAgent` — `codegraph_impact`
- 必读: `electron/agent-codex-sdk.ts`、`electron/agent-opencode-sdk.ts`
- 参考: `electron/codex-failure-messages.ts`、`electron/opencode-failure-messages.ts`

### 实现范围

- 新建目录: `electron/agent/codex/`、`electron/agent/opencode/`
- `git mv` Codex（10）:
  - `electron/agent-codex-sdk.ts` → `electron/agent/codex/agent-codex-sdk.ts`
  - `electron/agent-codex-stream.ts` → `electron/agent/codex/agent-codex-stream.ts`
  - `electron/agent-codex-http.ts` → `electron/agent/codex/agent-codex-http.ts`
  - `electron/agent-codex-watchdog.ts` → `electron/agent/codex/agent-codex-watchdog.ts`
  - `electron/agent-codex-events.ts` → `electron/agent/codex/agent-codex-events.ts`
  - `electron/agent-codex-complete.ts` → `electron/agent/codex/agent-codex-complete.ts`
  - `electron/agent-codex-utils.ts` → `electron/agent/codex/agent-codex-utils.ts`
  - `electron/agent-codex-types.ts` → `electron/agent/codex/agent-codex-types.ts`
  - `electron/agent-codex-session-registry.ts` → `electron/agent/codex/agent-codex-session-registry.ts`
  - `electron/codex-failure-messages.ts` → `electron/agent/codex/codex-failure-messages.ts`
- `git mv` OpenCode（10）:
  - `electron/agent-opencode-sdk.ts` → `electron/agent/opencode/agent-opencode-sdk.ts`
  - `electron/agent-opencode-stream.ts` → `electron/agent/opencode/agent-opencode-stream.ts`
  - `electron/agent-opencode-http.ts` → `electron/agent/opencode/agent-opencode-http.ts`
  - `electron/agent-opencode-watchdog.ts` → `electron/agent/opencode/agent-opencode-watchdog.ts`
  - `electron/agent-opencode-events.ts` → `electron/agent/opencode/agent-opencode-events.ts`
  - `electron/agent-opencode-complete.ts` → `electron/agent/opencode/agent-opencode-complete.ts`
  - `electron/agent-opencode-utils.ts` → `electron/agent/opencode/agent-opencode-utils.ts`
  - `electron/agent-opencode-types.ts` → `electron/agent/opencode/agent-opencode-types.ts`
  - `electron/agent-opencode-session-registry.ts` → `electron/agent/opencode/agent-opencode-session-registry.ts`
  - `electron/opencode-failure-messages.ts` → `electron/agent/opencode/opencode-failure-messages.ts`
- 修改: 两目录内 import；loader 引用 `../../mcp/loaders/{codex,opencode}-mcp-loader`

### 接口契约

- `launchCodexAgent`、`launchOpencodeAgent` 及 session-registry 查询导出不变

### 验收标准

- [ ] 20 个文件分别在 `agent/codex/`、`agent/opencode/`
- [ ] `codegraph_impact` 无 `agent-codex-sdk`、`agent-opencode-sdk` 旧路径
- [ ] 无业务逻辑 diff
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T2
- 后续任务: T6

---

## T6: 会话调度目录迁移（session）

### 背景

`session-dispatcher` 为调度枢纽（约 9 处 import），`session-mcp-status` 聚合四引擎与 mcp loader。3 个文件迁至 `electron/session/`。

### 上下文文件

- CodeGraph: `initSessionDispatcher` / `getSessionMcpStatus` — `codegraph_impact`
- 必读: `electron/session-dispatcher.ts`、`electron/session-mcp-status.ts`、`electron/session-mcp-sdk-path.ts`

### 实现范围

- 新建目录: `electron/session/`
- `git mv`:
  - `electron/session-dispatcher.ts` → `electron/session/session-dispatcher.ts`
  - `electron/session-mcp-status.ts` → `electron/session/session-mcp-status.ts`
  - `electron/session-mcp-sdk-path.ts` → `electron/session/session-mcp-sdk-path.ts`
- 修改: 本目录 import；典型路径:
  - `session-mcp-status` → `../mcp/loaders/cc-mcp-loader`、`../agent/cursor-sdk/agent-sdk`
  - `session-dispatcher` → `../agent/cursor-sdk/agent-sdk`、`../agent/claude-code/agent-claude-sdk` 等四引擎 HTTP
- 修改: T1 `workflow-runner`、`scheduling/command-handler` 等对 `session-dispatcher` 的引用

### 接口契约

- `initSessionDispatcher`、`dispatchSessionAgents`、`getSessionMcpStatus` 导出不变

### 验收标准

- [ ] 3 个文件在 `electron/session/`
- [ ] `codegraph_impact` 对 `session-dispatcher`、`getSessionMcpStatus` 无旧路径
- [ ] 无业务逻辑 diff
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T3、T4、T5
- 后续任务: T7

---

## T7: Daemon 桥接目录迁移（daemon）

### 背景

`daemon-manager.ts` 为最高扇出枢纽（约 22 处 import），含对 session、四引擎、workflow 的汇聚；`sdk-daemon-notify` 职责为 Daemon HTTP notify，归 `daemon/` 非 SDK 内核。

### 上下文文件

- CodeGraph: `initDaemonManager` / `daemon-manager` — `codegraph_impact`（定义处 + `main.ts` 调用链）
- 必读: `electron/daemon-manager.ts` — 全部 import 与 re-export
- 必读: `electron/daemon-client.ts`、`electron/sdk-daemon-notify.ts`

### 实现范围

- 新建目录: `electron/daemon/`
- `git mv`:
  - `electron/daemon-manager.ts` → `electron/daemon/daemon-manager.ts`
  - `electron/daemon-client.ts` → `electron/daemon/daemon-client.ts`
  - `electron/sdk-daemon-notify.ts` → `electron/daemon/sdk-daemon-notify.ts`
- 修改: 本目录全部相对 import；`daemon-manager` 内 re-export（如 `export { checkSdkApiKey } from "..."`）同步新路径
- 修改: T1 `app/*` 等对 `daemon-client` 的引用（若有）

### 接口契约

- `initDaemonManager`、`startDaemon`、`httpPost`（daemon-client）导出不变
- `../../src/shared/channel-types` 深度保持正确（`daemon/` 与迁移前同级）

### 验收标准

- [ ] 3 个文件在 `electron/daemon/`；`daemon-manager.ts` 仅移动不拆分（1566 行属预期）
- [ ] `codegraph_impact` 对 `initDaemonManager` 无 `./daemon-manager` 旧 import
- [ ] re-export 路径全部更新
- [ ] 无业务逻辑 diff
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T6
- 后续任务: T8

---

## T8: main.ts 枢纽 import 收尾

### 背景

`main.ts` 留根目录，为 IPC 注册入口，直接依赖 app、config、daemon、mcp、session、agent 等多子树；须在所有子目录迁移完成后统一改写约 10 处 import。

### 上下文文件

- CodeGraph: `registerIpcHandlers` — `codegraph_impact` 确认 main 依赖闭包
- 必读: `electron/main.ts` — 全部 import 段
- 参考: `electron/preload.ts` — **不迁移**；确认无错误引用主进程内部模块

### 实现范围

- 修改: `electron/main.ts` — 全部 `from "./…"` 改为子目录路径，目标示例:
  - `./config/config-store`
  - `./daemon/daemon-manager`
  - `./mcp/mcp-manager`
  - `./session/session-mcp-status`
  - `./app/tray`、`./app/main-window`、`./app/ui-logger`
  - `./config/updater`
  - `./agent/shared/workspace-injector`
  - `./agent/opencode/agent-opencode-utils`（按实际 import 清单逐项改）

### 接口契约

- `registerIpcHandlers`、IPC 通道名与 handler 行为**不变**
- `electron/preload.ts` **不修改**（除非发现断裂 import，须注明原因）

### 验收标准

- [ ] `main.ts` 无 `./agent-sdk`、`./daemon-manager` 等扁平旧路径
- [ ] `codegraph_impact` 对 `registerIpcHandlers` 依赖文件均为新路径
- [ ] 无业务逻辑 diff（仅 import 行）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T7
- 后续任务: T9

---

## T9: electron/AGENTS.md 分层

### 背景

`01` 验收 5 要求根 `electron/AGENTS.md` 升为索引，各语义子目录具备 `AGENTS.md` 承接对应段落；不改变规矩语义，仅搬迁与链接。

### 上下文文件

- 必读: `electron/AGENTS.md` — 当前全文（约 126 行）
- 参考: `knowledge/业务域/Agent调度/00-README.md` — 子模块与目录对应关系

### 实现范围

- 修改: `electron/AGENTS.md` — 缩为根索引表 + 跨模块规矩 + 链到子目录 `AGENTS.md`
- 新建: 各子目录 `AGENTS.md`（12 个）:
  - `electron/app/AGENTS.md` — 窗口/托盘/UI 日志/代理
  - `electron/config/AGENTS.md` — 配置与更新
  - `electron/daemon/AGENTS.md` — Daemon 桥接
  - `electron/session/AGENTS.md` — 多会话与 Session MCP
  - `electron/scheduling/AGENTS.md` — 定时任务与远程指令
  - `electron/agent/shared/AGENTS.md` — 跨引擎共享
  - `electron/agent/cursor-sdk/AGENTS.md` — Cursor SDK Run 边界
  - `electron/agent/claude-code/AGENTS.md` — Claude Code 边界
  - `electron/agent/codex/AGENTS.md` — Codex 边界
  - `electron/agent/opencode/AGENTS.md` — OpenCode 边界
  - `electron/mcp/AGENTS.md` — MCP 管理与 loader
  - `electron/workflow/AGENTS.md` — 工作流
- 段落迁移: 从根文件按引擎/模块拆入对应子 `AGENTS.md`；文件内路径引用改为新子目录形式

### 接口契约

- 根索引须链接全部 12 个子 `AGENTS.md`，相对路径可点击
- 规矩内容**不删改语义**，仅更新文件路径表述

### 验收标准

- [ ] **01 验收 5**：根索引 + 12 子目录 `AGENTS.md` 存在且链接可达
- [ ] **02·八·（二）**：子目录 `AGENTS.md` 链接在根索引可点击
- [ ] 无新增规矩或与代码不符的描述
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T8
- 后续任务: T10

---

## T10: 构建验收与旧路径零残留

### 背景

`01` 验收 2、3 与 `02` 步骤 D6/D7 要求 `npm run build` 通过，且全仓无指向已迁移扁平路径的 import。

### 上下文文件

- 必读: `electron.vite.config.ts` — 确认入口仍为 `electron/main.ts`、`electron/preload.ts`
- CodeGraph: `agent-sdk` / `daemon-manager` / `session-dispatcher` — 最终 `codegraph_impact` 扫尾

### 实现范围

- 执行: `npm run build`（完整构建与类型检查）
- 执行: 旧路径检索（示例，须零命中或仅 `knowledge/**` 历史文档）:
  - `rg 'from ["\']\./(agent-sdk|daemon-manager|session-dispatcher|mcp-sdk-loader)' electron/`
  - `rg 'electron/(agent-sdk|daemon-manager|session-dispatcher)\.ts' --glob '!knowledge/**'`
- 执行: `ls electron/*.ts` 仅 `main.ts`、`preload.ts`
- 执行: **01 验收 6** 手动冒烟 — IM 私聊/群聊、任务、工作流、四引擎 launch/dispatch、Settings MCP、SessionMcpPanel、daemon 启停

### 接口契约

- 构建产物与迁移前行为一致；`electron.vite.config.ts` **未改**入口路径

### 验收标准

- [ ] **01 验收 1**：`electron/` 目录树与对照表一致，根目录无滞留 `.ts`（除 main/preload）
- [ ] **01 验收 2**：`npm run build` 零错误
- [ ] **01 验收 3**：旧扁平路径 import `rg` 零命中（排除 `knowledge/**`）
- [ ] **02·八·（二）**：`electron.vite.config.ts` 未改入口且 build 产物正常
- [ ] **02·八·（二）**：spot check `sdk-run-recover`、`session-mcp-sdk-path`、`mcp/loaders/mcp-sdk-loader` 逻辑与 T0 合并后一致
- [ ] **01 验收 6**：冒烟路径无新增运行时错误或 IPC 失败
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T9
- 后续任务: T11

---

## T11: 知识库路径同步（kb-librarian）

### 背景

`01` 验收 4 与 `02` 步骤 D8 要求更新 Agent 调度「关键源码」表与工程平台主进程文档，使路径与新目录一致。本任务由 **kb-librarian** 执行，非 kb-builder。

### 上下文文件

- 必读: `knowledge/业务域/Agent调度/00-README.md` — 「关键源码」表
- 必读: `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — 正文中的扁平路径
- 参考: `knowledge/工程平台/Electron桌面应用/00-README.md`、`04-配置与更新.md` — 视正文是否含旧路径
- 参考: `src/renderer/components/AGENTS.md` — 若仍写 `electron/session-mcp-status` 旧路径则同步

### 实现范围

- 修改: `knowledge/业务域/Agent调度/00-README.md` — 「关键源码」表改为 `electron/app/`、`electron/agent/cursor-sdk/`、`electron/mcp/loaders/` 等新路径（覆盖 82 个迁移文件的代表性条目）
- 修改: `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — IPC 落点、设计决策、流程表路径改为子目录形式；补「目录语义与 Agent 调度分区对齐」一句
- 可能修改: `knowledge/工程平台/Electron桌面应用/00-README.md` — 增加 `electron/AGENTS.md` 根索引导读
- 可能修改: `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` — `config-store.ts` → `electron/config/config-store.ts`
- 可能修改: `src/renderer/components/AGENTS.md` — SessionMcpPanel 相关旧路径

### 接口契约

- 知识库路径与仓库实际目录一一对应；不写已删除的扁平路径（历史变更文档除外）

### 验收标准

- [ ] **01 验收 4**：Agent 调度 README「关键源码」表路径与新目录一致
- [ ] 工程平台 `02-主进程与IPC.md` 无过时扁平路径（抽样 `daemon-manager`、`main-window`、`agent-sdk`）
- [ ] 无臆造路径；以 T10 后代码为准
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T10
- 后续任务: 无（完成后可 `/kb-archive`）
