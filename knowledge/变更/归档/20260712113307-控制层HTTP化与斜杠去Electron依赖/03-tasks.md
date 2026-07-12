# 控制层HTTP化与斜杠去Electron依赖 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **任务数**：9（T1–T6 + T-FIX-01～03 债务修复）
> **T8 划界**：`/merge` 与合并卡按钮归变更 `20260712113253-合并卡飞书按钮与merge指令`；本变更**不得**实现 `handleMergeBatchAction`、合并卡路由或 `POST /api/control-command` 总线。

## 一、执行计划

### （一）依赖图

```mermaid
flowchart TD
  T1["T1 Electron command-executor 抽出"]
  T2["T2 POST /api/command/execute"]
  T3["T3 /api/mcp 扩展与 manage_mcp"]
  T4["T4 daemon-slash-executor 核心"]
  T5["T5 handleCommand 与 SLASH_EXEC_MODE"]
  T6["T6 菜单与 Agent 管理去 fcmd"]
  T1 --> T2
  T2 --> T4
  T3 --> T4
  T4 --> T5
  T5 --> T6
```

**CodeGraph 文件依赖边**（`projectPath=/home/suveng/doger/cursor-claw`）：

| 源符号/文件 | 依赖/波及 | 任务 |
|-------------|-----------|------|
| `checkAndExecutePendingCommands` | `daemon-manager.ts` ← `command-handler` import；影响 `startStatusPolling`、`startDaemon` | T1 |
| `handleCommand` | `daemon.ts` → `pushCommandToQueue`；调用方 `startFeishuChannel`、`initWeChatChannel` | T5 |
| `pushCommandToQueue` | 同上 + `feishu-event-handlers`、`daemon-http-admin-crud` | T5、T6 |
| `forwardElectronAgentApi` | `daemon-orchestrator.ts`；模式参照新增 `forwardElectronCommandApi` | T4 |
| `createAdminContentRoutes` / `handleMcpAdmin` | `daemon-http-admin-content.ts` ← `daemon-http-admin-crud` | T3 |
| `handleAgentAdmin` | `daemon-http-admin-crud.ts` → `pushCommandToQueue` | T6 |
| `onFeishuMenuV6` | `feishu-event-handlers.ts` → `pushCommandToQueue` | T6 |
| `handleFeishuMcpCommand` | `command-handler.ts:466`；语义 SSOT，T2 路由复用 | T1、T2 |
| `agent-sdk-http.ts` | Electron 统一 HTTP 网关；新增 command execute 路由 | T2 |

**01 验收追溯**：

| 01 验收 | 主责任务 |
|---------|----------|
| AC1 主路径斜杠 Electron 未 claim 仍可完成 | T4、T5 |
| AC2 `/mcp` 核心动作经 Daemon HTTP | T3、T4 |
| AC3 Electron 重启窗口不静默丢失 | T1、T2、T4、T5 |
| AC4 未授权仍拒绝且提示可理解 | T4、T5 |
| AC5 卡片与 Agent 执行无回归 | 全任务禁止改 MergeBatch/orchestrator dispatch 语义 |

**02 §六步骤对齐**：T1→步骤 1、8；T2→步骤 2；T3→步骤 5（M2/M3/A1）；T4→步骤 3；T5→步骤 4、9；T6→步骤 6、7。

### （二）分组调度

| 轮次 | 并行任务 | 说明 |
|------|----------|------|
| **第一轮** | T1、T3 | 无共享写文件；T1 改 Electron `daemon-manager`；T3 改 Daemon admin 路由 |
| **第二轮** | T2 | 依赖 T1；仅改 `agent-sdk-http.ts` |
| **第三轮** | T4 | 依赖 T2、T3；新建 `daemon-slash-executor.ts`，增量 `daemon-orchestrator.ts` |
| **第四轮** | T5 | 依赖 T4；仅改 `daemon.ts`（`handleCommand`、双写、`SLASH_EXEC_MODE`） |
| **第五轮** | T6 | 依赖 T5；改 `feishu-event-handlers.ts`、`daemon-http-admin-crud.ts` |

**同文件冲突清单（须串行）**：

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `electron/daemon/daemon-manager.ts` | T1（抽出 executor + dual poll 跳过） |
| `electron/agent/cursor-sdk/agent-sdk-http.ts` | T2 |
| `src/daemon/daemon-orchestrator.ts` | T4（`forwardElectronCommandApi`） |
| `src/daemon/daemon.ts` | T5（`handleCommand` 接线；**不**实现 `/merge`） |

## 二、任务清单

## T1: Electron command-executor 抽出与 poll 路径改造

### 背景

现网斜杠执行逻辑嵌在 `checkAndExecutePendingCommands`（`daemon-manager.ts:901`），HTTP 同步执行与遗留 5s poll 无法共用。本任务抽出 `executeFileCommand` 供 T2 HTTP 路由与 poll 双路径复用，并为 `dual` 模式预留 `messageId` 跳过钩子（步骤 F2、P1）。

### 上下文文件

- CodeGraph: `checkAndExecutePendingCommands` `handleFeishuMcpCommand` — poll 执行 switch 与 MCP 语义
- 必读: `electron/daemon/daemon-manager.ts` — `checkAndExecutePendingCommands`（约 L901–1070）
- 必读: `electron/scheduling/command-handler.ts` — `handleFeishuMcpCommand`（L466）、`handleFeishuModelCommand`、`reportCommandResult`
- 参考: `knowledge/变更/进行中/20260712113307-控制层HTTP化与斜杠去Electron依赖/01-proposal.md` — R4、§八 双写

### 实现范围

- 新建: `electron/scheduling/command-executor.ts` —
  - `export async function executeFileCommand(cmd: FileCommand, ctx: CommandExecutorContext): Promise<{ ok: boolean; message: string }>`
  - 自 `checkAndExecutePendingCommands` 搬迁 switch 分支（help/status/list/clean/stop/restart/model/mcp/chat/task/workflow 等），保持与现网 `reportCommandResult` 语义一致
  - `CommandExecutorContext` 含 `port`、`messageId`、`chatId`、`chatType`、必要 `TaskRunFn` 等最小字段
- 修改: `electron/daemon/daemon-manager.ts` —
  - `checkAndExecutePendingCommands` 改为遍历 pending 后调用 `executeFileCommand`
  - 新增可选 `shouldSkipCommand?(messageId: string): boolean` 注入点（T5 经 Daemon HTTP 或共享状态提供 dedup；本期可先接 env/回调占位，dual 期 poll 跳过已执行 `messageId`）

### 接口契约

- `export interface FileCommand { command: string; messageId: string; chatId?: string; chatType?: string; ... }`（与现网 `.fcmd` JSON 对齐）
- `export async function executeFileCommand(cmd: FileCommand, ctx: CommandExecutorContext): Promise<{ ok: boolean; message: string }>`
- `checkAndExecutePendingCommands` 对外签名不变；内部仅委托 executor

### 验收标准

- [ ] `executeFileCommand` 覆盖原 `checkAndExecutePendingCommands` 全部斜杠分支，单测式冒烟：`/help`、`/status` 返回与变更前一致（AC5）
- [ ] `daemon-manager.ts` 增量后 ≤300 行，否则继续拆文件（§八·（二）第 9 项）
- [ ] poll 路径在注入 `shouldSkipCommand` 返回 true 时跳过该 `messageId`（为 T5 dual dedup 预留）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: Electron POST /api/command/execute

### 背景

Daemon 侧需同步调用 Electron 执行 `/stop`、`/model`、`/mcp` 等主进程指令，消除 5s poll 延迟。本任务在 `agent-sdk-http` 注册 `POST /api/command/execute`，复用 T1 的 `executeFileCommand`（步骤 F1）。

### 上下文文件

- CodeGraph: `agent-sdk-http` `ensureAgentSdkHttpServer` — 统一网关路由注册模式
- 必读: `electron/agent/cursor-sdk/agent-sdk-http.ts` — 现有 `/api/agent/launch|dispatch` 注册方式
- 必读: `electron/scheduling/command-executor.ts` — T1 产出 `executeFileCommand`
- 必读: `src/daemon/daemon-orchestrator.ts` — `forwardElectronAgentApi`（约 L111）转发模式参照

### 实现范围

- 修改: `electron/agent/cursor-sdk/agent-sdk-http.ts` —
  - 注册 `POST /api/command/execute`
  - 请求体：`{ command: string, messageId: string, chatId?: string, chatType?: string }`
  - 响应：`{ ok: boolean, message: string }`；`message` 中文与 `reportCommandResult` 一致
  - 错误：`400` 未知指令；`503` 服务未就绪（body 含可理解中文）
  - handler 内调用 `executeFileCommand`，**不**经 `.fcmd` 入队

### 接口契约

- `POST /api/command/execute` 请求/响应体见上表（与 `02-design` §四一致）
- 路由与 `launchSdkAgentFromHttp` 同进程、同 `agent-api-port.json` 端口

### 验收标准

- [ ] Electron 运行中 `curl POST /api/command/execute` 传 `/help` 3s 内返回 `{ ok, message }`（AC1 后半）
- [ ] Electron 未监听时 Daemon 经 T4 `forwardElectronCommandApi` 收到 `503` 或等价 `{ ok:false, message }`，非挂死（AC3、AC4）
- [ ] 不修改 `POST /api/agent/launch|dispatch` 契约（AC5）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: T4

---

## T3: /api/mcp 扩展与 manage_mcp HTTP 对齐

### 背景

`/api/mcp` 现仅 list/add/delete（`daemon-http-admin-content.ts:25`），`/mcp` 斜杠 enable/disable 仍走 Electron `mcp-manager`。本任务扩展 Daemon HTTP 覆盖 enable/disable/info，并让 `manage_mcp` MCP 工具直连同一接口（步骤 M2、M3、A1）。

### 上下文文件

- CodeGraph: `createAdminContentRoutes` `manage_mcp` — admin 路由与 MCP 工具入口
- 必读: `src/daemon/daemon-http-admin-content.ts` — `handleMcpAdmin`（L25–77）
- 必读: `src/daemon/server-admin.ts` — `manage_mcp` 工具（约 L108–120）
- 必读: `electron/scheduling/command-handler.ts` — `handleFeishuMcpCommand` 子命令语义（ls/enable/disable/info）
- 参考: `electron/mcp/mcp-manager.ts` — `toggleMcpServer`、健康检查（M3 转发落点）

### 实现范围

- 修改: `src/daemon/daemon-http-admin-content.ts` —
  - `POST /api/mcp` 新增 `action: enable | disable | info`
  - `enable`/`disable`：写配置 + 必要时 `forwardElectronAgentApi` 或薄 HTTP 调 Electron `mcp-manager` 做健康/开关（M3）；失败返回可理解中文
  - `info`：返回 name、scope、enabled、类型/来源/健康摘要
- 修改: `src/daemon/server-admin.ts` —
  - `manage_mcp` 支持 `enable`/`disable`/`info`，经 `daemonPost("/api/mcp", …)` 与斜杠对齐
  - list/add/delete 行为不变

### 接口契约

- `POST /api/mcp` 扩展 action：`enable`/`disable` 需 `name`；`info` 需 `name`；响应 `{ ok, message?, servers?, server? }`
- `manage_mcp` 工具参数与上述 action 一一对应

### 验收标准

- [ ] `/mcp ls`、`/mcp enable <名>` HTTP 路径与现网 Electron 斜杠语义一致（§八·（二）第 3 项；AC2）
- [ ] `manage_mcp` list/add/delete/enable 经 HTTP 可比现网（§八·（二）第 4 项；AC2）
- [ ] MCP 健康态需主进程时，转发失败返回明确中文而非静默成功（§八·（二）风险 M3）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T4

---

## T4: daemon-slash-executor 与 Electron 同步转发

### 背景

Daemon 须成为 IM 斜杠 SSOT：`executeSlashCommand` 进程内即时执行并 `replyToMessage`，本地指令（help/status/list/clean）不调 Electron，其余经 `forwardElectronCommandApi` 同步 POST（步骤 E1、L2、F3、M1）。**禁止**处理 `/merge`（T8 划界）。

### 上下文文件

- CodeGraph: `handleCommand` `pushCommandToQueue` `buildHelpText` — 现网入队与本地 help
- 必读: `src/shared/feishu-help-text.ts` — `buildHelpText`（约 L30）
- 必读: `src/daemon/daemon-orchestrator.ts` — `forwardElectronAgentApi`（L111）、`readElectronAgentApiPort`
- 必读: `src/daemon/daemon-http-admin-content.ts` — T3 扩展后的 `handleMcpAdmin`（`/mcp` 子命令复用或内联调用）
- 必读: `electron/scheduling/command-executor.ts`、`agent-sdk-http.ts` — T1/T2 产出

### 实现范围

- 新建: `src/daemon/daemon-slash-executor.ts`（≤300 行）—
  - `export async function executeSlashCommand(deps: SlashExecutorDeps, text: string, messageId: string, chatId?: string, chatType?: string): Promise<void>`
  - 忽略 `/merge` 及 `merge_*` 前缀（T8 由 `handleCommand` 前置分支处理，执行器 double-guard）
  - 本地：`/help`、`/status`、`/list`、`/clean` 等 Daemon 可完成指令，结束时 `deps.replyToMessage`
  - `/mcp`：解析子命令，调 T3 同等逻辑或 `localDaemonUrl("/api/mcp")` 内循环
  - Electron 依赖：`forwardElectronCommandApi` → `POST /api/command/execute`；失败映射「应用未运行」类中文（AC4）
  - 结构化日志：`slash_exec` 字段（command、message_id、mode、ok、source）
- 修改: `src/daemon/daemon-orchestrator.ts` —
  - 导出 `forwardElectronCommandApi(subpath, body)`，复用 `readElectronAgentApiPort` + `httpJson` 模式（与 `forwardElectronAgentApi` 对称）

### 接口契约

- `export interface SlashExecutorDeps { replyToMessage; log; forwardElectronCommandApi; getSlashExecMode; ... }`
- `export async function executeSlashCommand(deps, text, messageId, chatId?, chatType?): Promise<void>`
- `forwardElectronCommandApi(subpath: string, body: object): Promise<{ ok: boolean; error?: string; message?: string }>`

### 验收标准

- [ ] `SLASH_EXEC_MODE=daemon` 时飞书发 `/status`，Electron **未** claim 仍 3s 内收到回复（§八·（二）第 1 项；AC1）
- [ ] Electron 退出时 `/help` 可回复；`/stop` 返回「应用未运行」类文案（§八·（二）第 2 项；AC4）
- [ ] `/mcp ls`、`/mcp enable <名>` 经执行器与 T3 HTTP 语义一致（§八·（二）第 3 项）
- [ ] 执行器**不**处理 `/merge`；与 `/status` 同会话连发无交叉污染（§八·（二）第 7 项；T8 划界）
- [ ] 日志含 `slash_exec`（§八·（二）第 8 项）
- [ ] 新文件 ≤300 行（§八·（二）第 9 项）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T2、T3
- 后续任务: T5

---

## T5: handleCommand 接线与 SLASH_EXEC_MODE 双写

### 背景

`handleCommand` 现仅 `pushCommandToQueue`（`daemon.ts:1288-1290`），须改为主路径 `executeSlashCommand`，并用 `SLASH_EXEC_MODE` 控制是否写 `.fcmd` 及 dedup（步骤 R1、W1、L1）。**不实现** `/merge` 本体；若变更 `20260712113253` 已 apply，须保持其前置分支在 `executeSlashCommand` 之前。

### 上下文文件

- CodeGraph: `handleCommand` `pushCommandToQueue` `isCommand` `COMMANDS` — 斜杠识别与入队
- 必读: `src/daemon/daemon.ts` — `handleCommand`（L1287+）、`pushCommandToQueue`（L1211）、`COMMANDS`（L1173）
- 必读: `src/daemon/daemon-slash-executor.ts` — T4 产出
- 参考: `knowledge/变更/进行中/20260712113253-合并卡飞书按钮与merge指令/03-tasks.md` — T5 `/merge` 划界（**只读**，不修改该变更代码）

### 实现范围

- 修改: `src/daemon/daemon.ts` —
  - `handleCommand`：`isCommand` 后 →（T8 `/merge` 前置分支若已存在则保留）→ `await executeSlashCommand(...)`
  - 读取 `SLASH_EXEC_MODE`：`daemon`（默认目标）| `dual` | `electron`；`dual` 时执行后条件 `pushCommandToQueue`；`electron` 回滚仅入队
  - 进程内 `slashExecutedMessageIds` Map（`messageId`→时间戳，60s TTL）；dual 期供 T1 poll `shouldSkipCommand` 查询（经 deps 或 HTTP 小接口，最小实现即可）
  - `daemon` 模式默认不再写 `.fcmd` 主路径
  - `wireDaemonSubmodules` 注入 `executeSlashCommand` 所需 deps

### 接口契约

- 环境变量 `SLASH_EXEC_MODE`: `daemon` | `dual` | `electron`；迁移期默认 `dual`（与 `02-design` §四一致）
- `slashExecutedMessageIds` 去重 API 供 Electron poll 跳过（函数或 `GET` 查询，由实现择最小路径）

### 验收标准

- [ ] 主路径斜杠在 Electron 未 claim 时仍可完成（01 AC1）
- [ ] `dual` 模式同 `messageId` 不双回复；切 `daemon` 后无新 `.fcmd` 残留（§八·（二）第 5 项；01 §八）
- [ ] Electron 重启窗口内斜杠不静默丢失（01 AC3）
- [ ] 未授权通道仍被 G1 门控拒绝，与现网一致（01 AC4）
- [ ] **不**修改 `/merge`、`handleMergeBatchAction`、MergeBatch 状态机（T8 划界；01 AC5）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T4
- 后续任务: T6

---

## T6: 飞书菜单与 Agent 管理去 fcmd

### 背景

飞书 `menu_v6` 与 `handleAgentAdmin` 的 stop/restart/reset 仍经 `pushCommandToQueue` 绕 5s poll。本任务改调 `executeSlashCommand` 或直连 T2 HTTP，完成迁移收尾（步骤 M0、A2）。

### 上下文文件

- CodeGraph: `onFeishuMenuV6` `handleAgentAdmin` — 菜单与 admin 绕路点
- 必读: `src/daemon/feishu-event-handlers.ts` — `onFeishuMenuV6`（L45+）、`FeishuEventHandlerDeps`
- 必读: `src/daemon/daemon-http-admin-crud.ts` — `handleAgentAdmin`（L124–152）
- 必读: `src/daemon/daemon-slash-executor.ts` — T4 产出
- 必读: `src/daemon/daemon.ts` — `feishuEventDeps` 组装（约 L1089、L1158）

### 实现范围

- 修改: `src/daemon/feishu-event-handlers.ts` —
  - `FeishuEventHandlerDeps` 增加 `executeSlashCommand`（或等价回调）
  - `onFeishuMenuV6`：菜单项映射斜杠文本后调 `executeSlashCommand`，`source=menu`；**不**默认 `pushCommandToQueue`（`SLASH_EXEC_MODE=electron` 回滚除外）
- 修改: `src/daemon/daemon-http-admin-crud.ts` —
  - `handleAgentAdmin` 的 `stop`/`restart`/`reset` 改调 `executeSlashCommand` 或 `forwardElectronCommandApi("/api/command/execute")`；`launch`/`clean` 保持现网语义
  - 移除对 `pushCommandToQueue` 的 admin 绕路依赖（deps 可保留供 dual 回滚）

### 接口契约

- `onFeishuMenuV6` 菜单项（如 `cmd_status`）与等价斜杠 `/status` 走同一 `executeSlashCommand`
- `POST /api/agent` action `stop|restart|reset` 同步返回执行结果文案

### 验收标准

- [ ] 菜单 `cmd_status` 等与斜杠等价，不经 5s poll（§八·（二）第 6 项；AC5）
- [ ] `manage_agent` stop/restart/reset 不再仅「queued」而无即时反馈（R2；AC2 管理类可比）
- [ ] 卡片与 Agent dispatch/orchestrator 无回归（01 AC5）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T5
- 后续任务: 无（主路径实现完成；债务修复见 T-FIX-01～03）

---

## T-FIX-01: slash_exec 日志补全 source=im|menu

### 背景

`04-review` R1：`slash_exec` 结构化日志当前 `source` 字段表示执行路径（`local|mcp|electron|skip`），与 `02` §八·（二）第 8 项及 T4 验收要求的**通道来源** `source=im|menu` 不一致。`handleCommand` 已接收 `source` 参数（飞书菜单 T6 传 `"menu"`，IM 斜杠默认 `"im"` 或省略），但未传入 `executeSlashCommand` / `logSlashExec`，影响 dual 期可观测与排障。

### 上下文文件

- 必读: `src/daemon/daemon-slash-executor.ts` — `logSlashExec`（L42–47）、`executeSlashCommand`（L79+）、`SlashSource` 类型
- 必读: `src/daemon/daemon.ts` — `handleCommand`（L1344–1383）`source` 参数与 `executeSlashCommand` 调用
- 必读: `src/daemon/feishu-event-handlers.ts` — `onFeishuMenuV6` 传 `"menu"`（L73–78）
- 参考: `knowledge/变更/进行中/20260712113307-控制层HTTP化与斜杠去Electron依赖/04-review.md` — §3-1、R1

### 实现范围

- 修改: `src/daemon/daemon-slash-executor.ts` —
  - `executeSlashCommand` 增加 `channelSource?: "im" | "menu"` 参数（或等价命名，与 `handleCommand` 对齐）
  - `logSlashExec` 字段拆分或扩展：保留执行路径（可重命名为 `exec_path` 或并存），**新增** `source: "im" | "menu"` 写入 `slash_exec` JSON
  - 默认：未传时归一化为 `"im"`（与 IM 斜杠主路径一致）
- 修改: `src/daemon/daemon.ts` —
  - `handleCommand` 将 `source === "menu" ? "menu" : "im"` 传入 `executeSlashCommand`
  - `daemon-http-admin-crud.ts` 经 `handleSlashCommand` 的 admin 路径视为 `"im"`（或文档约定 admin 映射）
- **禁止**改动 `SlashSource` 执行路径语义导致 `/mcp`、`local` 分支回归；仅补通道来源字段

### 接口契约

- `export async function executeSlashCommand(deps, text, messageId, chatId?, chatType?, channelSource?: "im" | "menu"): Promise<void>`
- `slash_exec` JSON 至少含：`command`、`message_id`、`mode`、`ok`、`source`（`im|menu`）；执行路径字段名与现网日志消费方兼容（新增字段优先于破坏性重命名）

### 验收标准

- [ ] **静态**：`executeSlashCommand` 签名含 `channelSource`；`logSlashExec` 输出 JSON 含 `"source":"im"` 或 `"source":"menu"`（R1）
- [ ] **静态**：`handleCommand` 调用链将菜单 `"menu"`、IM 省略/`"im"` 正确下传；`feishu-event-handlers` 菜单路径无需改签名（已传 `"menu"` 至 `handleCommand`）
- [ ] **运行时**：`SLASH_EXEC_MODE=dual`，飞书发 `/status`（IM）→ Daemon 日志 `slash_exec` 含 `"source":"im"`
- [ ] **运行时**：飞书菜单 `cmd_status` → 日志 `slash_exec` 含 `"source":"menu"`
- [ ] **回归**：`local`/`mcp`/`electron` 执行路径与回复语义不变（AC5）
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T4（`executeSlashCommand` / `logSlashExec` 落点）
- 后续任务: 无（修复 R1 后可由 `/kb-revise` 关闭 manifest `reviews[R1]`）

---

## T-FIX-02: Electron 注册 POST /api/mcp/status-map

### 背景

`04-review` R2：Daemon `fetchElectronMcpStatusMap`（`daemon-http-mcp-admin.ts:128-136`）调用 `POST /api/mcp/status-map`，但 `agent-sdk-http.ts` 仅注册 `launch|dispatch|command/execute|sdk-warmup`，导致 Electron 运行中 `/mcp ls`/`info` 健康列恒为「未知」并带 `healthError`。本任务补齐 M3 闭环，委托 `getMcpStatusMap`（`mcp-manager`）。

### 上下文文件

- 必读: `electron/agent/cursor-sdk/agent-sdk-http.ts` — 路由注册（L193–233）
- 必读: `src/daemon/daemon-http-mcp-admin.ts` — `fetchElectronMcpStatusMap` 请求体 `{ workspaceDir, force: false }`（L128–136）
- 必读: `electron/mcp/mcp-manager.ts` — `getMcpStatusMap(force?, workspaceDir?, engineType?)`（L59+）
- 参考: `electron/main.ts` — IPC `mcp:status-map` 委托模式（L139）
- 参考: `electron/scheduling/command-handler.ts` — `handleFeishuMcpCommand` 健康展示参照（L495+）

### 实现范围

- 修改: `electron/agent/cursor-sdk/agent-sdk-http.ts` —
  - 注册 `POST /api/mcp/status-map`
  - 请求体：`{ workspaceDir?: string, force?: boolean }`（与 Daemon 客户端对齐）
  - 响应：`{ ok: true, statusMap: Record<string, string> }` 或 `{ ok: false, error: string }`（中文可理解）
  - handler 内 `await getMcpStatusMap(force ?? false, workspaceDir)`，**不**经 `.fcmd` 或 IPC 绕路
- 可选（≤300 行约束）：若 `agent-sdk-http.ts` 逼近上限，可拆至 `agent-mcp-http.ts` 薄模块并由 sdk-http import
- **禁止**修改 `POST /api/agent/launch|dispatch`、`POST /api/command/execute` 契约

### 接口契约

- `POST /api/mcp/status-map`
  - 请求：`{ workspaceDir?: string, force?: boolean }`
  - 成功：`{ ok: true, statusMap: Record<string, string> }`（键为 MCP 名，值为健康状态字符串，与 `getMcpStatusMap` 一致）
  - 失败：`{ ok: false, error: string }`，HTTP 400/503 与现网 agent-api 错误风格一致

### 验收标准

- [ ] **静态**：`agent-sdk-http.ts`（或拆出模块）存在 `/api/mcp/status-map` 路由分支，import `getMcpStatusMap`（R2）
- [ ] **静态**：Daemon `fetchElectronMcpStatusMap` 请求路径与响应字段无需改动即可对接
- [ ] **运行时**：Electron 运行中 `curl -X POST http://127.0.0.1:<agent-api-port>/api/mcp/status-map -d '{"workspaceDir":"<workspace>"}'` 返回 `{ ok: true, statusMap: {...} }`
- [ ] **运行时**：Daemon `POST /api/mcp` action `info` 或斜杠 `/mcp ls`，健康列展示非「未知」（无 `healthError` 端点缺失类文案）
- [ ] **回归**：`enable`/`disable` 写盘语义不变；端点缺失时仍不静默成功（AC2）
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T3（Daemon MCP HTTP 与 `fetchElectronMcpStatusMap` 客户端）
- 后续任务: 无（修复 R2 后可由 `/kb-revise` 关闭 manifest `reviews[R2]`）

---

## T-FIX-03: dual 模式 poll claim 前 skip-check 去重

### 背景

`04-review` R3：`SLASH_EXEC_MODE=dual` 时 Daemon 主路径即时 `executeSlashCommand` 并 `markSlashMessageIdExecuted`，同时双写 `.fcmd`；Electron poll 经 `syncDaemonSlashExecutedIds` 每 5s 批量拉取 `GET /commands/executed-ids` 填充 `cachedDaemonSlashExecutedIds`，**claim 前**仅查本地缓存。Daemon 标记与 poll 同步之间存在短窗口，Electron 可能在同步前 claim 并二次 `reportCommandResult`。Daemon 已预留 `GET /commands/skip-check?messageId=`（`daemon.ts:1715-1719`），本任务在 **claim 前**对单 `messageId` 实时查询，消除竞态。

### 上下文文件

- 必读: `electron/daemon/daemon-manager.ts` — `checkAndExecutePendingCommands`（L924+）、`syncDaemonSlashExecutedIds`（L897–908）、`wireSlashPollSkipChecker`（L911–917）
- 必读: `src/daemon/daemon.ts` — `GET /commands/skip-check`（L1715–1719）、`markSlashMessageIdExecuted` / `isSlashMessageIdExecuted`
- 参考: `knowledge/变更/进行中/20260712113307-控制层HTTP化与斜杠去Electron依赖/04-review.md` — §3-3、§6 dual 双回复风险表

### 实现范围

- 修改: `electron/daemon/daemon-manager.ts` —
  - 在 `checkAndExecutePendingCommands` 的 `for (const cmd of cmds)` 循环内，**`POST .../commands/claim` 之前**（或 claim 成功后、执行前）对 `cmd.messageId` 调用 `GET http://127.0.0.1:${lock.port}/commands/skip-check?messageId=<id>`
  - 若 `{ executed: true }` 则跳过该条（日志与现网 `commandPollSkipChecker` 跳过一致），**不** claim 或 claim 后立即 continue 不执行（择最小改动且避免重复 claim 副作用）
  - 保留 `syncDaemonSlashExecutedIds` + `cachedDaemonSlashExecutedIds` 作为批量优化（可选：skip-check 命中时写入本地缓存）
  - skip-check 请求失败时：**保守跳过执行**（`executed: true` 等价）或回退 `commandPollSkipChecker`（择一并在代码注释说明，优先防双回复）
- **禁止**修改 `SLASH_EXEC_MODE` 三态语义、`daemon` 模式主路径（无 poll 双写）

### 接口契约

- 既有 Daemon：`GET /commands/skip-check?messageId=<string>` → `{ executed: boolean }`（不变）
- Electron poll：每条 pending 指令在 claim/执行前须查询 skip-check；与 `markSlashMessageIdExecuted` 60s TTL 对齐

### 验收标准

- [ ] **静态**：`checkAndExecutePendingCommands` 在 claim 前或执行前调用 `GET /commands/skip-check`（R3）；非仅依赖 `cachedDaemonSlashExecutedIds`
- [ ] **静态**：`GET /commands/skip-check` 路由与 `isSlashMessageIdExecuted` 逻辑未被削弱
- [ ] **运行时**：`SLASH_EXEC_MODE=dual`，飞书发 `/status`，Daemon 已 reply 后 5s 内 Electron poll **不**二次 `reportCommandResult`（日志无重复 `[指令] 执行 /status` 或双回复）
- [ ] **运行时**：人为构造「Daemon 已 mark、poll 尚未 sync executed-ids」时序（快速连发或 mock 延迟 sync），仍仅一次用户可见回复
- [ ] **回归**：`electron` 模式纯 poll 路径不受影响；`daemon` 模式无 `.fcmd` 双写无此路径
- [ ] 无 `02`/`03` 未要求的抽象层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T5（`slashExecutedMessageIds`、`skip-check` 路由、`markSlashMessageIdExecuted`）
- 后续任务: 无（修复 R3 后可由 `/kb-revise` 关闭 manifest `reviews[R3]`）
