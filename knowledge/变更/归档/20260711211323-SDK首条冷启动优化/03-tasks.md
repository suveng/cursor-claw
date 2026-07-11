# SDK 首条冷启动优化 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 一、执行计划

### （一）依赖图

```
T1 ──→ T3 ──→ T4
T1 ──→ T5 ──→ T6
T2 ──→ T4
T7（独立）
```

- **T1 / T2 / T7** 无交叉文件，可首轮并行。
- **T3** 依赖 T1（`resolveContextLimitForSession` 须先具备启发式同步返回 + 后台 list 行为）；修改 `agent-sdk.ts` 单文件。
- **T4** 依赖 T3（launch 须已写入 `lastInjectedMcpServers`）；可选依赖 T2（`launchBootstrapDone` 断言字段）。
- **T5** 依赖 T1（预热调用 `resolveModelContextLimit`）；新建 `sdk-warmup.ts`。
- **T6** 依赖 T5（三挂点 import `warmupSdkAfterBind`）；`daemon-manager.ts` 与 `daemon.ts` 无重叠符号，同轮可并行写。
- **T7** 仅 Daemon 呈现层，与 Electron SDK 改动无编译依赖，可与 T1 并行。

> CodeGraph 索引未初始化（02 §七）；依赖边经源码 import/调用链复核：`agent-sdk.ts` → `context-usage.ts`、`sdk-run-dispatch.ts`；`sdk-warmup.ts` → `context-usage.ts`、`plugin-sdk-bootstrap`；Daemon 三挂点 → `sdk-warmup.ts`。

### （二）分组调度

- **第一轮（并行）**：T1、T2、T7
- **第二轮（并行）**：T3、T5
- **第三轮（并行）**：T4、T6

## 二、任务清单

## T1: A1 启发式 context limit 与后台 models.list

### 背景

首条冷启动约 5s 阻塞在 `resolveModelContextLimit` 同步 `await Cursor.models.list`。本任务实现 A1：composer 等命中 `MODEL_LIMIT_HEURISTICS` 时**同步写 cache 并立即返回**；`models.list` 改 fire-and-forget 后台 refresh，不阻塞 send 前路径。为 A2 并行 `resolveContextLimitForSession` 与 B1 预热提供非阻塞 limit 解析基础。

### 上下文文件

- CodeGraph: `resolveModelContextLimit` `resolveContextLimitForSession` `MODEL_LIMIT_HEURISTICS` — limit 解析链与调用方（init 后 `projectPath` 指向仓库根）
- 必读: `electron/agent/cursor-sdk/context-usage.ts` — `resolveModelContextLimit`（L139-178）、`resolveContextLimitForSession`（L181-192）、`MODEL_LIMIT_HEURISTICS`（L45-52）、`modelLimitCache`
- 参考: `electron/agent/cursor-sdk/agent-sdk.ts` — launch/dispatch 对 `resolveContextLimitForSession` 的调用时机（L181、L252）
- 参考: `electron/agent/cursor-sdk/context-usage.ts` — `evaluatePreSendContextPressure`、`appendContextFooter`（pre-send 与 footer 语义须保持）

### 实现范围

- 修改: `electron/agent/cursor-sdk/context-usage.ts` —
  - `resolveModelContextLimit`：cache 未命中时，**先**查 `inferContextLimitFromModelId`；命中则同步 `modelLimitCache.set` 并返回，同时 `void refreshModelLimitFromList(...)`（新增私有函数，fire-and-forget）
  - 新增模块级 `refreshInflight: Set<string>`（key=`apiKey:modelId`），防止同一对并发重复后台 list
  - `refreshModelLimitFromList`：try `Cursor.models.list` → 提取 limit 写 cache；catch 仅 UI 日志，不抛错、不阻断调用方
  - Claude `claude-` 短路逻辑**保持**；未命中启发式且无 cache 时，可同步 await list（兼容冷门 model）或启发式兜底后后台 refresh——以**不阻塞 composer 首条**为优先
  - `resolveContextLimitForSession` **签名不变**；行为受益于 `resolveModelContextLimit` 非阻塞
- 不改: `evaluatePreSendContextPressure`、`appendContextFooter`、pre-send 阻断阈值

### 接口契约

- `resolveModelContextLimit(modelId: string, apiKey: string): Promise<number | null>` — 对外签名不变；composer 等启发式命中时同步返回，不 await `models.list`
- `resolveContextLimitForSession(session: { modelId?: string; apiKey?: string; contextLimitTokens?: number }): Promise<void>` — 签名不变；可传入 launch 前临时 `{ modelId, apiKey }` 对象（无 `session.agent` 依赖）
- 模块私有: `refreshModelLimitFromList(modelId, apiKey): void` — fire-and-forget；日志可检索 `model_limit_refresh`

### 验收标准

- [ ] composer 模型（如 `composer-2`）首调 `resolveModelContextLimit` **同步返回** 200k（或启发式值），不 await `models.list`（01 验收 2；02 §八·（二）composer 首条路径 create 与 list 时间戳重叠或 list 在 send 之后）
- [ ] `daemon.log` / UI 日志首条冷启动：`Agent.create` 完成后不再阻塞 ~5s 的同步 `models.list` 再 send（01 验收 2）
- [ ] 后台 list 成功后可校正 `modelLimitCache`；失败仅 WARN，不阻断 send（01 验收 6）
- [ ] Claude 短路、`evaluatePreSendContextPressure`、`context_blocked`、`appendContextFooter` 行为 spot check 无回归（01 验收 6；02 §八·（二））
- [ ] 文件含中文注释说明启发式优先与 `refreshInflight` 意图；`context-usage.ts` ≤300 行
- [ ] `tsc --noEmit` 通过（01 验收 7）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T3、T5

---

## T2: A3 可选 session bootstrap 标记字段

### 背景

A3 要求 `buildSendOptions` 复用 launch 时 bootstrap 结果。`lastInjectedMcpServers` 已存在于 `SdkSessionAgent`；设计 §五 可选增加 `launchBootstrapDone` 供 `buildSendOptions` 断言 launch 已 detailed bootstrap，避免 recover/rotation 路径误判。本任务仅扩展类型与 launch 写入，不含 dispatch 消费逻辑。

### 上下文文件

- CodeGraph: `SdkSessionAgent` `lastInjectedMcpServers` — session 字段与 A3 消费点
- 必读: `electron/agent/cursor-sdk/sdk-session-types.ts` — `SdkSessionAgent`（L9-108），`lastInjectedMcpServers`（L102-103）
- 参考: `electron/agent/cursor-sdk/agent-sdk.ts` — launch 写入 `lastInjectedMcpServers`（L173）
- 参考: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` — `buildSendOptions` / `logSdkConfigSources`（L34-55）

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-session-types.ts` —
  - 在 `SdkSessionAgent` 新增可选字段 `launchBootstrapDone?: boolean`，中文 JSDoc：「launch 已完成 detailed bootstrap，供 buildSendOptions 跳过二次 bootstrap」
- 不改: 其他 session 字段；本任务**不**改 `agent-sdk.ts`（由 T3 写入 `launchBootstrapDone: true`）

### 接口契约

- `SdkSessionAgent.launchBootstrapDone?: boolean` — launch detailed bootstrap 成功后置 `true`；T3 写入、T4 读取

### 验收标准

- [ ] `SdkSessionAgent` 含 `launchBootstrapDone?: boolean` 及中文注释（02 §五）
- [ ] 现有引用 `SdkSessionAgent` 的编译无破坏；可选字段不强制赋值
- [ ] `sdk-session-types.ts` ≤300 行
- [ ] `tsc --noEmit` 通过（01 验收 7）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T4

---

## T3: A2 launch 并行 create/limit 与 B2 阶段二文案

### 背景

现网 `launchSdkAgent` 串行 `Agent.create` → `resolveContextLimitForSession` → send，累计 ~10s。本任务重构为 `Agent.create` ∥ `resolveContextLimitForSession`（临时 `{ modelId, apiKey }`），`Promise.all` 后再组装 `session`、`sdkSessions.set`、pre-send 与 `sendWithRetry`。同时在 send 前下发 B2 阶段二「正在准备模型…」。`dispatchToSdkAgent` 保持串行并加注释说明热路径不并行原因（S13）。

### 上下文文件

- CodeGraph: `launchSdkAgent` `dispatchToSdkAgent` `notifySessionChat` — 冷/热启动链与 IM notify
- 必读: `electron/agent/cursor-sdk/agent-sdk.ts` — `launchSdkAgent`（L92-225）、`dispatchToSdkAgent`（L227+）
- 必读: `electron/agent/cursor-sdk/context-usage.ts` — `resolveContextLimitForSession`（须 T1 已落地）
- 必读: `electron/daemon/sdk-daemon-notify.ts` — `notifySessionChat` 签名
- 参考: `src/daemon/daemon-orchestrator.ts` — orchestrator 已发「正在连接 Agent…」（T7）；本任务发「正在准备模型…」
- 参考: `electron/agent/cursor-sdk/sdk-session-types.ts` — T2 可选 `launchBootstrapDone`

### 实现范围

- 修改: `electron/agent/cursor-sdk/agent-sdk.ts` —
  - `launchSdkAgent` try 块内，`ensureSdkBinaryPaths()` 之后：
    - `limitPromise = resolveContextLimitForSession({ modelId, apiKey })`（**不**依赖 `session.agent`）
    - `createPromise`：含现有 `bootstrapSdkPluginWorkspace`（`detailed: true` 日志）、`Agent.create`、返回 `{ agent, injected, pluginBoot }`
    - `const [createResult, ] = await Promise.all([createPromise, limitPromise])`
    - **此后**构造 `session`（含 `contextLimitTokens` 自 limit 结果、`lastInjectedMcpServers: injected`、若 T2 已合并则 `launchBootstrapDone: true`）
    - `sdkSessions.set` → `pendingLaunches.delete` → 现有 warn/broadcast
    - **send 前**：`await notifySessionChat(sessionKey, "正在准备模型…")`（B2 `starting_prepare` / S8a）
    - 再 `evaluatePreSendContextPressure` → `acquireRunGuard` → `sendWithRetry`
  - **禁止**在 `Promise.all` 完成前调用 `agent.send`、`evaluatePreSendContextPressure`、`sdkSessions.set`
  - `createPromise` 失败则整段 launch 失败，清理 `pendingLaunches` / `failedCooldowns` / session 与现网一致
  - `dispatchToSdkAgent`：**保持** `await resolveContextLimitForSession(session)` 串行；新增中文注释：缓存命中为 no-op，不与 `maybeRefreshStaleResidentAgent` 并行以免 resident 重建竞态（02 §二 A2、S13）
- 不改: `ensureAgentSdkHttpServer`、processing 早退、`startSdkRun` 后「Agent 处理中…」

### 接口契约

- `launchSdkAgent(opts: SdkLaunchOptions): Promise<{ ok: boolean; error?: string }>` — 行为：create∥limit 后 send；失败清理语义不变
- launch 内 send 前 IM：`notifySessionChat(sessionKey, "正在准备模型…")` — 不带 `stop_progress`
- `dispatchToSdkAgent` — 签名与热路径语义不变；仅注释补充

### 验收标准

- [ ] 新 session、composer 首条 launch：入队到 RUNNING 较基线减少 ≥8s（定性；01 验收 1；受 C1 `agent.send` ~12s 下限约束）
- [ ] `launchSdkAgent` 源码在 `Promise.all([createPromise, limitPromise])` **之后**才 `sdkSessions.set` 与 `sendWithRetry`（02 §二 A2 硬约束）
- [ ] `create` 失败时无 orphan send；`pendingLaunches` / `failedCooldowns` 清理与现网一致（01 验收 6）
- [ ] 用户可见「正在准备模型…」在 create+limit 完成后、send 前出现（01 验收 5 B2；与 T7「正在连接 Agent…」形成两阶段）
- [ ] `dispatchToSdkAgent` 二次发信、热 session、`context_blocked` spot check 无回归（01 验收 6；02 §八·（二））
- [ ] launch 写入 `lastInjectedMcpServers`；若 T2 已落地则 `launchBootstrapDone: true`
- [ ] 中文注释；`agent-sdk.ts` ≤300 行（超限须按 AGENTS 拆子模块，非本期预建抽象）
- [ ] `tsc --noEmit` 通过（01 验收 7）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: T4

---

## T4: A3 buildSendOptions bootstrap 复用

### 背景

同次 launch 内 `agent-sdk.ts` 已 `bootstrapSdkPluginWorkspace`（detailed），`buildSendOptions` 经 `logSdkConfigSources` 再次 bootstrap 产生二次详细 config（~5s 级日志）。本任务：`lastInjectedMcpServers` 非空时直接 `appendInlineMcpToSendOptions`，跳过 `logSdkConfigSources` 内 bootstrap；recover/rotation 未写该字段时 fallback 现网行为。

### 上下文文件

- CodeGraph: `buildSendOptions` `logSdkConfigSources` `bootstrapSdkPluginWorkspace` — send 前 MCP 注入链
- 必读: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` — `buildSendOptions`（L41-55）、`logSdkConfigSources`（L34-38）
- 必读: `electron/agent/cursor-sdk/agent-sdk.ts` — launch 写入 `lastInjectedMcpServers`（T3）
- 参考: `electron/agent/cursor-sdk/sdk-run-recover.ts`、`sdk-resident-refresh.ts` — 未写 `lastInjectedMcpServers` 的 fallback 路径
- 参考: `electron/agent/cursor-sdk/sdk-session-types.ts` — `launchBootstrapDone`（T2，可选断言）

### 实现范围

- 修改: `electron/agent/cursor-sdk/sdk-run-dispatch.ts` —
  - `buildSendOptions`：若 `session.lastInjectedMcpServers` 非空（且可选 `launchBootstrapDone !== false`），用该快照调用 `appendInlineMcpToSendOptions`，**不**调用 `logSdkConfigSources`
  - 否则保持现网：`logSdkConfigSources` → bootstrap → 写回 `lastInjectedMcpServers`
  - `logSdkConfigSources` 保留供 recover/rotation；detailed config 日志仅 launch 路径一次（02 §二 A3）
- 不改: `sendWithRetry`、`maybeRotateSessionForPressure`、`createAgentSendOptions`

### 接口契约

- `buildSendOptions(session: SdkSessionAgent, idempotencyKey: string): Parameters<SDKAgent["send"]>[1]` — 签名不变；有 `lastInjectedMcpServers` 时跳过二次 bootstrap
- 消费: `session.lastInjectedMcpServers`（launch 写入）；可选 `session.launchBootstrapDone`

### 验收标准

- [ ] 同次 launch 日志仅**一条** `bootstrapSdkPluginWorkspace` detailed config（01 验收 3；02 §八·（二））
- [ ] composer 首条冷启动合计较基线减少 ≥8s（与 T1+T3 叠加；01 验收 1）
- [ ] recover / resident-refresh 等未写 `lastInjectedMcpServers` 时仍 fallback bootstrap，行为与现网一致（01 验收 6；02 §八·（一）A3 风险）
- [ ] `dispatchToSdkAgent` 热路径 send 正常（01 验收 6）
- [ ] 中文注释；`sdk-run-dispatch.ts` ≤300 行
- [ ] `tsc --noEmit` 通过（01 验收 7）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T3；可选 T2
- 后续任务: 无

---

## T5: B1 SDK 预热模块 sdk-warmup.ts

### 背景

bind 成功后至首条消息间存在预热窗口。设计 B1 抽取 `warmupSdkAfterBind` 统一入口：在 `ensureAgentSdkHttpServer` 已就绪前提下，fire-and-forget 轻量 `bootstrapSdkPluginWorkspace`（非 detailed）+ 后台 `resolveModelContextLimit("composer-2", apiKey)`。失败仅 WARN，不阻断 bind/launch。

### 上下文文件

- CodeGraph: `ensureAgentSdkHttpServer` `bootstrapSdkPluginWorkspace` `resolveModelContextLimit` — 预热可复用符号
- 必读: `electron/agent/cursor-sdk/agent-sdk-http.ts` — `ensureAgentSdkHttpServer`（L161+）
- 必读: `electron/mcp/loaders/plugin-sdk-bootstrap.ts` — `bootstrapSdkPluginWorkspace`
- 必读: `electron/agent/cursor-sdk/context-usage.ts` — `resolveModelContextLimit`（T1 非阻塞语义）
- 参考: `electron/daemon/daemon-manager.ts` — `initDaemonManager` 已调 `ensureAgentSdkHttpServer`（L1243）
- 参考: 同目录 `02-design.md` §四 `warmupSdkAfterBind` 签名（实施时以本任务契约为准）

### 实现范围

- 新建: `electron/agent/cursor-sdk/sdk-warmup.ts`（≤300 行）—
  - 导出 `warmupSdkAfterBind(opts: { apiKey?: string; workspaceDir?: string; source: string }): void`
  - 实现：`void` 启动 async IIFE；`source` 写入日志前缀（`init` / `bind-electron` / `bind-daemon`）
  - 无 `apiKey` 或 `workspaceDir` 时早退 WARN，不抛错
  - 内容：`bootstrapSdkPluginWorkspace(workspaceDir)`（**非** detailed `logSdkPluginConfig`）+ `void resolveModelContextLimit("composer-2", apiKey)`
  - 日志关键字 `sdk_warmup` 可检索；catch 仅 `pushUiLog` WARN
- 不改: `agent-sdk.ts` launch 主路径；Daemon HTTP 路由

### 接口契约

- `warmupSdkAfterBind(opts: { apiKey?: string; workspaceDir?: string; source: string }): void` — fire-and-forget；**不**返回 Promise；调用方 `void warmupSdkAfterBind(...)` 或 `.catch` 包裹内部 async
- 日志: `[sdk_warmup] source=...` 开始/完成/失败

### 验收标准

- [ ] `sdk-warmup.ts` 存在且导出 `warmupSdkAfterBind`；单文件 ≤300 行、含中文注释（02 B1d）
- [ ] 预热失败仅 WARN，不 throw 至调用方（01 验收 4）
- [ ] 日志含可检索 `sdk_warmup`（02 §八·（二））
- [ ] 不新增 npm 依赖；不复用 trait/通用抽象层（Ponytail）
- [ ] `tsc --noEmit` 通过（01 验收 7）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: T6

---

## T6: B1 三挂点接入 warmupSdkAfterBind

### 背景

B1 须在通道 bind 成功与应用 init 后触发预热，使下次首条消息冷启动进一步缩短。三挂点：`initDaemonManager`（已 bind 通道时）、`resolveBindWaiter`（Electron bind 回调）、`completeBind`（Daemon 写回侧）。均 fire-and-forget，失败不阻断 bind。

### 上下文文件

- CodeGraph: `initDaemonManager` `resolveBindWaiter` `completeBind` — 三挂点位置
- 必读: `electron/daemon/daemon-manager.ts` — `initDaemonManager`（L1237+）、`resolveBindWaiter`（L192-198）、`__BIND_RESULT__` 解析处（约 L654）
- 必读: `src/daemon/daemon.ts` — `completeBind`（L203-213）
- 必读: `electron/agent/cursor-sdk/sdk-warmup.ts` — T5 导出
- 参考: `electron/config/config-store.ts` 或 `getConfig()` — 解析 `workspaceDir`、通道 SDK `apiKey`（与现网 launch 同源）

### 实现范围

- 修改: `electron/daemon/daemon-manager.ts` —
  - `initDaemonManager` 末尾（`ensureAgentSdkHttpServer` 之后）：若已有 bind 通道且能解析 apiKey/workspaceDir，则 `void warmupSdkAfterBind({ ..., source: "init" })`
  - `resolveBindWaiter` resolve 成功后：同法 `source: "bind-electron"`
  - diff 最小化；**不拆分** daemon-manager（历史超限已知）
- 修改: `src/daemon/daemon.ts` —
  - `completeBind` 成功写回 `__BIND_RESULT__` 之后：`void warmupSdkAfterBind({ ..., source: "bind-daemon" })`（动态 import 或顶层 import 与域内 ESM 约定一致）
- 不改: bind 成功回执、armed-bind 状态机、`__BIND_RESULT__` 协议

### 接口契约

- 调用: `void warmupSdkAfterBind({ apiKey, workspaceDir, source })` — 三处 `source` 分别为 `init`、`bind-electron`、`bind-daemon`
- apiKey/workspaceDir 解析失败时**跳过**预热，不阻断 bind

### 验收标准

- [ ] bind 成功后 `daemon.log` / UI 出现 `sdk_warmup` 且 `source=bind-electron` 或 `bind-daemon`（01 验收 4；02 §八·（二））
- [ ] 应用 init 且通道已 bind 时出现 `source=init` 预热日志（01 验收 4）
- [ ] 预热失败不影响 bind 完成与后续首条消息 launch（01 验收 4、6）
- [ ] bind 后至首条消息冷启动定性缩短（日志可观测 cache/bootstrap 命中；01 验收 4）
- [ ] 中文注释；`daemon.ts` ≤300 行；`daemon-manager.ts` diff 范围可控
- [ ] `tsc --noEmit` 通过（01 验收 7）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T5
- 后续任务: 无

---

## T7: B2 Daemon 层细粒度进度文案

### 背景

现网 orchestrator 与入队确认均使用笼统「正在启动」。B2 将 Daemon 侧拆为阶段一 `starting_connect`：「正在连接 Agent…」；入队 `buildEnqueueStatusText` 在 `phase===starting` 时对齐。阶段二「正在准备模型…」由 T3 在 Electron launch 下发；阶段三「Agent 处理中…」现网不改。

### 上下文文件

- CodeGraph: `dispatchSessionToAgent` `buildEnqueueStatusText` `notifySessionUser` — Daemon 进度文案链
- 必读: `src/daemon/daemon-orchestrator.ts` — `dispatchSessionToAgent`（L188-242），`notifySessionUser(sessionKey, "正在启动")`（L196）
- 必读: `src/daemon/daemon-presentation-handlers.ts` — `buildEnqueueStatusText`（L116-130）、`confirmEnqueueAndStartProgress`（L292+）
- 参考: `electron/daemon/AGENTS.md` — 三态文案职责边界
- 参考: `src/daemon/AGENTS.md` — 会话进行中指示、`stop_progress` 规则

### 实现范围

- 修改: `src/daemon/daemon-orchestrator.ts` —
  - `dispatchSessionToAgent`：`sessionAgentPhaseMap.set(sessionKey, "starting")` 后，`notifySessionUser` 文案改为 **「正在连接 Agent…」**（S4a / `starting_connect`）
- 修改: `src/daemon/daemon-presentation-handlers.ts` —
  - `buildEnqueueStatusText`：`phase === "starting"` 时改为 **「已收到。正在连接 Agent，你的消息已排队」**（S2，与 S4a 一致）
  - `phase === "processing"` 等分支**保持**
- 不改: `session-agent-phase` 协议、`startSdkRun` 的「Agent 处理中…」、飞书卡片布局

### 接口契约

- `buildEnqueueStatusText(sessionKey, pending): string` — `starting` 分支新文案；签名不变
- orchestrator notify：冷启动 launch 前固定「正在连接 Agent…」
- 阶段 key 对照（文档/日志可选）：`starting_connect` → 本任务文案；`starting_prepare` → T3；`processing` → 现网

### 验收标准

- [ ] `phase=starting` 期间用户至少看到「正在连接 Agent…」（入队或 orchestrator）与 T3「正在准备模型…」**两个可区分阶段**（01 验收 5；02 §八·（二））
- [ ] `buildEnqueueStatusText` 在 `starting` 时为「已收到。正在连接 Agent，你的消息已排队」（±排队后缀）（02 §二 B2 表）
- [ ] 「Agent 处理中…」仍为 send 成功后下发，本任务不重复近义句（01 非目标 / 02 不改项）
- [ ] 二次 dispatch、合并批次 F1、progress stop 语义无回归（01 验收 6）
- [ ] 中文注释；两文件均 ≤300 行
- [ ] `tsc --noEmit` 通过（01 验收 7）
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: 无
