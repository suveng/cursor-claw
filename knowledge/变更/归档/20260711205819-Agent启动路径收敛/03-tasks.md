# Agent 启动路径收敛 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 一、执行计划

### （一）依赖图

```
T1 ──→ T2 ──→ T4
          └──→ T5
T3（deferred，本期不实施）
```

- **T1 / T2** 均修改 `electron/session/session-dispatcher.ts` 不同区段，须**串行**（先统一 `launchAgent`，再改 `initSessionDispatcher`）。
- **T4 / T5** 在 T1+T2 实现落地后并行，分别更新业务域知识库与工程 AGENTS 约定。
- **T3** 按 02 §二 ponytail 口径 defer，manifest `status=deferred`，不纳入 apply 调度。

### （二）分组调度

- **第一轮**：T1（`launchAgent` 统一网关）
- **第二轮**：T2（`initSessionDispatcher` 懒加载）
- **第三轮（并行）**：T4（知识库）、T5（AGENTS 沉淀）
- **不调度**：T3（deferred）

## 二、任务清单

## T1: 统一 launchAgent 经统一网关

### 背景

01 R1 要求 IM、定时任务、工作流、chat new 全部 Agent 启动须经统一网关 SSOT。现网 `session-dispatcher.launchAgent` 对 SDK 经 Daemon 三角跳转、对 CC/Codex/OpenCode 直 POST 各引擎独立端口，与 IM 路径（`agent-sdk-http`）不一致。本任务删除四引擎分叉，统一委托 `launchSdkAgentFromHttp`，由网关内 `resolveBoundAgentResourceType` 路由至各引擎 handler。

### 上下文文件

- CodeGraph: `launchAgent` `launchSdkAgentFromHttp` `resolveBoundAgentResourceType` — 本地入口与网关路由链
- 必读: `electron/session/session-dispatcher.ts` — `launchAgent`（L277-402）、`launchIndependentAgent`/`launchWorkflowAgent`/`launchSessionAgent`（L404-431）
- 必读: `electron/agent/cursor-sdk/agent-sdk-http.ts` — `launchSdkAgentFromHttp`（L107-187）、`resolveBoundAgentResourceType`（L67-89）
- 参考: `src/daemon/daemon-orchestrator.ts` — `forwardElectronAgentApi`（L91-104）；IM 路径对照，**本任务不改 Daemon**
- 参考: `electron/agent/claude-code/agent-claude-sdk.ts`、`electron/agent/codex/agent-codex-sdk.ts`、`electron/agent/opencode/agent-opencode-sdk.ts` — `register*LaunchHandler` 模块加载注册

### 实现范围

- 修改: `electron/session/session-dispatcher.ts` —
  - **删除** `launchAgent` 内 `resource.type` 四分支（约 L362-401）：SDK 经 Daemon `POST /api/agent/launch`、Codex/OpenCode/CC 经 `get*AgentApiPort` 直 POST 各 `/api/*/agent/launch`
  - **改为** 组装 `launchBody` 后统一 `return launchSdkAgentFromHttp(launchBody)`（进程内优先，避免 SDK 任务 Electron→Daemon→Electron 绕路）
  - **清理** 不再使用的 import：`getCcAgentApiPort`、`getCodexAgentApiPort`、`getOpencodeAgentApiPort` 及仅服务于直连分支的 `httpPost`/`cachedLock`（若 launchAgent 内无其他引用）
  - **新增** import：`launchSdkAgentFromHttp` from `../agent/cursor-sdk/agent-sdk-http`
  - 保留 `launchAgent` 前置校验（资源类型、API Key、工作目录、`launchBody` 字段）不变
- 不改: `launchIndependentAgent`、`launchWorkflowAgent`、`launchSessionAgent` 签名与调用方；`agent-sdk-http.ts` 路由实现；Daemon `forwardElectronAgentApi`

### 接口契约

- `launchAgent(p: LaunchAgentParams): Promise<{ ok: boolean; error?: string }>` — 行为不变；内部实现统一委托 `launchSdkAgentFromHttp(launchBody)`
- `launchBody` 字段与现网一致：`session_key`、`chat_type`、`task_text`、`channel_id`、`model`、`model_params`、`working_directory`、`chat_name`、`use_main_workspace`、`sender_open_id`、`message_ids`（可选）
- `launchSdkAgentFromHttp(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>` — 网关 SSOT；按 `resolveBoundAgentResourceType` 委托 `launchCcAgentFromHttp` / `launchCodexAgentFromHttp` / `launchOpencodeAgentFromHttp` / SDK `launchSdkAgent`

### 验收标准

- [ ] `launchAgent` 源码中**不存在** `getCcAgentApiPort` / `getCodexAgentApiPort` / `getOpencodeAgentApiPort` 调用（02 §八·（二））
- [ ] 定时任务、工作流、`/chat new` 触发 CC/Codex/OpenCode 时，日志/调试可见经 `launchSdkAgentFromHttp` 统一网关路由，**非**独立端口 POST（02 §八·（二））
- [ ] 四引擎（SDK / CC / Codex / OpenCode）在 **IM + 定时任务 + 工作流 + chat new** 四类入口下启动、调度、回复与失败提示与变更前一致（01 验收 2、R5）
- [ ] IM 路径 `forwardElectronAgentApi("/api/agent/launch")` 行为与变更前一致（冒烟；02 §八·（二））
- [ ] 修改文件含中文注释说明统一网关委托意图；`session-dispatcher.ts` ≤300 行（超限须按 AGENTS 设计模式拆分，非本期预建抽象）
- [ ] `npm run build` 通过（01 验收 4）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T2、T4、T5

---

## T2: initSessionDispatcher 引擎服务懒加载

### 背景

01 R2/R3 要求应用启动时不得无条件拉起未使用引擎的 Agent 服务；仅 SDK Profile 时进程内 Agent HTTP 服务实例数应为 **1**（统一网关）。现网 `initSessionDispatcher` 无条件调用 `ensureClaudeCodeHttpServer` / `ensureCodexHttpServer` / `ensureOpencodeHttpServer`，导致仅 SDK 用户仍常驻 4 个 HTTP 服务。本任务移除 init 热路径上的三引擎 ensure，非 SDK 引擎在首次 `launchSdkAgentFromHttp` 时由进程内 handler 启动 Run，无需先起独立 HTTP server。

### 上下文文件

- CodeGraph: `initSessionDispatcher` `ensureAgentSdkHttpServer` `initDaemonManager` — init 链与网关常驻
- 必读: `electron/session/session-dispatcher.ts` — `initSessionDispatcher`（L664-677）
- 必读: `electron/daemon/daemon-manager.ts` — `initDaemonManager`（L1237-1243），确认仍调用 `ensureAgentSdkHttpServer`
- 必读: `electron/agent/cursor-sdk/agent-sdk-http.ts` — `ensureAgentSdkHttpServer`（L194+）、`getAgentSdkApiPort`
- 参考: `electron/agent/claude-code/agent-cc-http.ts`、`electron/agent/codex/agent-codex-http.ts`、`electron/agent/opencode/agent-opencode-http.ts` — `ensure*HttpServer` 定义（本期不从 init 调用，handler 路径不依赖其监听）

### 实现范围

- 修改: `electron/session/session-dispatcher.ts` —
  - **删除** `initSessionDispatcher` 内三行：`ensureClaudeCodeHttpServer()`、`ensureCodexHttpServer()`、`ensureOpencodeHttpServer()`（L674-676）
  - **清理** 若 `ensureClaudeCodeHttpServer` 等 import 仅用于 init 则移除；`getClaudeCodeSessionList` 等会话列表 import 保留
- 确认（仅读，无改动除非顺序错误）: `electron/daemon/daemon-manager.ts` — `initDaemonManager` 在 `initSessionDispatcher()` 之后仍调用 `ensureAgentSdkHttpServer()`
- 不改: 各 `agent-*-http.ts` 中 `ensure*HttpServer` 函数体（per-engine HTTP server 择机下线非本期）；`launchSdkAgentFromHttp` 进程内委托逻辑

### 接口契约

- `initSessionDispatcher(): void` — 仅注册 resolver/observability；**不再**拉起 CC/Codex/OpenCode HTTP server
- `ensureAgentSdkHttpServer(): void` — 仍由 `initDaemonManager` 调用；写入 `userData/agent-api-port.json`，供 Daemon IM 转发
- 首次非 SDK launch：经 T1 统一路径 `launchSdkAgentFromHttp` → `launchCcAgentFromHttp` 等进程内 handler（各 `agent-*-sdk.ts` 模块加载时已 `register*LaunchHandler`）

### 验收标准

- [ ] 仅 SDK Profile **冷启动**后：进程内 HTTP 监听仅 `agent-api-port.json` 对应 **1** 实例；无 `cc-agent-api-port.json` / `codex-agent-api-port.json` / `opencode-agent-api-port.json` 写入（除非后续手动触发该引擎 launch）（01 验收 1、02 §八·（二））
- [ ] 多引擎 Profile **首次**通过 IM 或任务触发 CC/Codex/OpenCode 时，Agent 正常启动，后续长驻与调度与现网一致（01 场景 F、R4）
- [ ] `initSessionDispatcher` 源码中不存在 `ensureClaudeCodeHttpServer` / `ensureCodexHttpServer` / `ensureOpencodeHttpServer` 调用
- [ ] `initDaemonManager` 仍调用 `ensureAgentSdkHttpServer`（grep 确认）
- [ ] 四引擎 IM + 任务 + 工作流 + chat new 行为不回归（01 验收 2）
- [ ] 修改含中文注释；相关文件 ≤300 行
- [ ] `npm run build` 通过（01 验收 4）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: T4、T5

---

## T3: shared launch-request 解析收敛（deferred）

### 背景

02 §二 明确 `launchBody` 解析分散在 `session-dispatcher` 与 `agent-sdk-http` 两处，抽取 `shared/launch-request.ts` 属 scope 过大的 ponytail 预建通用层。本期 YAGNI defer 至后续变更；body 组装与解析保持现网分散实现，由 T1 统一网关委托覆盖产品目标。

### 上下文文件

- 参考: `electron/session/session-dispatcher.ts` — `launchBody` 组装（约 L347-360）
- 参考: `electron/agent/cursor-sdk/agent-sdk-http.ts` — `launchSdkAgentFromHttp` body 解析（L107-122）
- 参考: `knowledge/变更/进行中/20260711205819-Agent启动路径收敛/02-design.md` §二 边界说明

### 实现范围

- **本期不实施**。不得新建 `electron/agent/shared/launch-request.ts` 或等价抽象模块。
- 后续变更再评估：在确认 IM/本地入口 body 字段漂移风险后，再收敛解析 SSOT。

### 接口契约

- 无（deferred）

### 验收标准

- [ ] manifest `T3.status === "deferred"`
- [ ] 本期 diff 中**无** `launch-request` 新建文件或未批准的 shared 解析层
- [ ] T1/T2 完成后 `launchBody` 字段在 `session-dispatcher` 与 `launchSdkAgentFromHttp` 间仍兼容（手工或冒烟确认）

### 依赖

- 前置任务: 无（不纳入 apply）
- 后续任务: 无（留待独立变更）

---

## T4: 知识库更新「全路径统一网关」

### 背景

01 R6 与验收 3 要求 `knowledge/业务域/Agent调度/03-启动与自动重连.md` §二 更新为全路径（IM + 任务 + 工作流 + chat new）经 `agent-sdk-http` 统一网关的架构描述，与 T1/T2 实现一致。现网 §二 仍写「任务/工作流→launchAgent 直 POST 各 agent-api」，与收敛后行为冲突。

### 上下文文件

- 必读: `knowledge/业务域/Agent调度/03-启动与自动重连.md` — §二「设计决策与取舍」全文
- 必读: `knowledge/业务域/Agent调度/00-README.md` — 阅读路径与索引
- 参考: `knowledge/变更/进行中/20260711205819-Agent启动路径收敛/01-proposal.md` §四 F1-F6、§五 R1-R6
- 参考: `electron/agent/cursor-sdk/agent-sdk-http.ts` — 统一网关符号名（以代码为准写文档）

### 实现范围

- 修改: `knowledge/业务域/Agent调度/03-启动与自动重连.md` —
  - **§二** 改为：全路径经 `agent-sdk-http` `/api/agent/launch|dispatch`（Daemon IM 转发 + Electron 本地 `launchSdkAgentFromHttp`）；应用 init 仅常驻 SDK 网关（`ensureAgentSdkHttpServer`）；非 SDK 引擎首次 launch 进程内委托各 handler，**不**在 init 无条件拉起 per-engine HTTP server
  - **§四** 客户端流程（若有启动链路 mermaid/步骤）与 §二 口径对齐
  - **§十** 变更记录追加本变更日期摘要
- 可选（视篇幅）: `knowledge/业务域/Agent调度/00-README.md` — 若 §二 变更影响推荐阅读顺序则轻量索引一句
- 不改: `02-多会话模型.md`（会话路由 SSOT 正交）；各引擎子模块 07-09（handler 实现不变）

### 接口契约

- 无代码接口；文档术语与代码符号对齐：`launchSdkAgentFromHttp`、`resolveBoundAgentResourceType`、`ensureAgentSdkHttpServer`、`initSessionDispatcher`

### 验收标准

- [ ] `03-启动与自动重连.md` §二 **不再**描述「任务/工作流直 POST 各 agent-api」双轨路径
- [ ] 文档明确四入口（IM、定时任务、工作流、chat new）统一网关 SSOT，与 T1/T2 代码行为一致（01 验收 3）
- [ ] 以代码为准，无编造端口/路径；不确定处标「（待确认）」
- [ ] 单文件 ≤3000 字符；简体中文
- [ ] 无 02/03 未要求的抽象层描述或未批准的新架构层（Ponytail 口径）

### 依赖

- 前置任务: T1、T2
- 后续任务: 无（archive 阶段可复核）

---

## T5: AGENTS.md 工程约定沉淀

### 背景

02 §九·（二）与 §十·（二）要求同步工程侧 AGENTS 约定：任务/工作流/`/chat new` 启动路径由「经 Daemon launch」或「直 POST 各引擎端口」更正为「经 `agent-sdk-http` 统一网关」；init 仅 `ensureAgentSdkHttpServer` 常驻。避免后续开发回退双轨实现。

### 上下文文件

- 必读: `electron/session/AGENTS.md` — 模块边界首段（现写 Daemon `POST /api/agent/launch`）
- 必读: `electron/AGENTS.md` — 「IM 调度」跨模块规矩
- 必读: `electron/agent/cursor-sdk/AGENTS.md` — 「Daemon 统一入口路由」段
- 参考: `electron/daemon/AGENTS.md` — Daemon 桥接边界（确认 IM 转发描述仍准确）
- 参考: `electron/agent/shared/AGENTS.md` — 跨引擎共享边界（仅路径表述，**不**为 T3 预建 launch-request）
- 参考: `src/daemon/daemon-orchestrator.ts` — `forwardElectronAgentApi`（文档引用，**不改源码**）

### 实现范围

- 修改: `electron/session/AGENTS.md` — `session-dispatcher` 边界：任务/工作流/`/chat` 经 `launchSdkAgentFromHttp`（统一网关），**非**按引擎直 POST 独立端口；**不**扫描 IM 队列（不变）
- 修改: `electron/AGENTS.md` — 「IM 调度」：四入口均经 `agent-sdk-http` 路由；init 懒加载约定（仅网关常驻）
- 修改: `electron/agent/cursor-sdk/AGENTS.md` — 补充本地入口（`session-dispatcher.launchAgent`）与 IM（Daemon 转发）双路径均汇入 `launchSdkAgentFromHttp`
- 可选: `electron/daemon/AGENTS.md` — 若 IM 三态/转发描述与统一网关口径需一句对齐则更新；**不改** `src/daemon` 源码
- 不改: 新建 `shared/launch-request.ts`（T3 deferred）

### 接口契约

- 无新增代码接口；AGENTS 为工程侧 SSOT，与 `launchSdkAgentFromHttp` / `initSessionDispatcher` 行为一致

### 验收标准

- [ ] `electron/session/AGENTS.md` 不再暗示 CC/Codex/OpenCode 独立 HTTP launch 为任务/工作流主路径
- [ ] `electron/AGENTS.md` IM 调度段与四引擎统一网关一致
- [ ] `electron/agent/cursor-sdk/AGENTS.md` 明确本地 + Daemon 双入口汇入网关
- [ ] 全文简体中文；各 AGENTS 文件保持 ≤3000 字符量级（单文件规范）
- [ ] 无 02/03 未要求的抽象层或未批准的新模块描述（Ponytail 口径）

### 依赖

- 前置任务: T1、T2
- 后续任务: 无
