# SDK 首条冷启动优化产品需求文档

> **变更 ID**：`20260711211323-SDK首条冷启动优化`
> **来源**：kb-propose
> **类型**：性能优化
> **优先级**：P2
> **外部 PRD**：无
> **Figma 设计图**：无
> **任务记录**：无

## 一、背景与问题

飞书私聊首条消息经 Daemon 入队后，用户感知到 Agent **RUNNING** 约需 **25s**。2026-07-11 19:58 生产日志（`daemon.log`）拆解如下：

| 时间点 | 事件 | 说明 |
|--------|------|------|
| 19:58:17.797 | 收到私聊消息 | 用户发信 |
| 19:58:18.236 | 入队 | Daemon 排队 |
| 19:58:18.537 | orchestrator-claim | Daemon 调度 ~1.3s，**非瓶颈** |
| 19:58:19.527 | `Agent.create` 开始 | Electron SDK 冷启动 |
| 19:58:24.733 | Agent 创建完成 | ~5s |
| 19:58:29.522 | 第二次 bootstrap/config | `models.list` 阻塞路径，~5s |
| 19:58:41.760 | `dispatch_retry` ok | `agent.send` ~12s |
| 19:58:42.422 | RUNNING | 用户可见运行态 |

**根因**：Electron Cursor SDK launch 冷路径在 send 前**串行**执行 `Agent.create`（~5s）→ `resolveContextLimitForSession` / `Cursor.models.list`（~5s）→ `agent.send`（~12s），累计约 **25s**。Daemon 调度仅 ~1.3s，优化焦点在 SDK 执行引擎与通道预热/进度反馈。

## 二、目标与非目标

### 目标（必须达成）

1. **缩短首条 RUNNING 感知**：通过 A1～A3 并行化与 bootstrap 复用，composer 等常见模型首条冷启动较基线减少 **≥8s**（目标 ~15s 内；`agent.send` ~12s 仍可能存在）。
2. **A1 启发式 context limit**：命中 `MODEL_LIMIT_HEURISTICS`（含 composer）时同步写入 cache，`models.list` 后台 refresh，**不阻塞** send 前路径。
3. **A2 launch 并行**：`Agent.create` 与 `resolveContextLimitForSession` 并行，send 前统一 await；`dispatchToSdkAgent` 热路径评估对齐。
4. **A3 bootstrap 复用**：同次 launch 内 `buildSendOptions` 复用 launch 时 bootstrap 结果，避免二次 `bootstrapSdkPluginWorkspace`。
5. **B1 bind 后预热**：通道 bind 成功后 fire-and-forget 预热（`ensureAgentSdkHttpServer` 已就绪、可选轻量 `models.list` / plugin bootstrap），使**下次**首条消息冷启动进一步缩短；预热失败**不阻断** bind。
6. **B2 细粒度进度**：将单一「正在启动」拆分为至少 **2 个**可区分阶段文案（如「正在连接 Agent」「正在准备模型」等，design 阶段细化）。

### 非目标（明确不做）

- **C1 SDK 后端 `agent.send` 优化**：~12s 为 Cursor SDK 外部依赖，标注外部依赖、不在本期实现范围。
- **不改**飞书卡片布局、Electron 界面结构或用户指令语法。
- **不在 propose 阶段**拆分历史超限源码文件（实现时遵守单文件 ≤300 行约束）。

## 三、方案说明

### A1：启发式 context limit（`context-usage.ts`）

- `resolveModelContextLimit` 对命中 `MODEL_LIMIT_HEURISTICS`（含 composer）的 modelId：**启发式优先、同步写入 cache**。
- `Cursor.models.list` 改**后台 refresh**，校正 cache，失败不影响首条 send。
- Claude 已有短路逻辑保持；pre-send 阻断与 context footer 语义不变。

### A2：create 与 context limit 并行（`agent-sdk.ts`）

- `launchSdkAgent`：`Agent.create` ∥ `resolveContextLimitForSession`，send 前 `Promise.all` await 两者。
- `dispatchToSdkAgent`：若存在串行 resolve，评估是否同样并行（仅当不破坏既有 guard 与热 session 语义）。

### A3：bootstrap 结果复用（`sdk-run-dispatch.ts`）

- `buildSendOptions` 复用 session 已有 `lastInjectedMcpServers` / launch 时 bootstrap 结果。
- 避免 launch 已在 `agent-sdk.ts` 做过 `bootstrapSdkPluginWorkspace` 后，send 路径再次触发详细 config。
- 必要时在 `sdk-session-types.ts` 缓存 launch bootstrap 元数据（可选）。

### B1：通道 bind 后预热

- **时机**：bind 成功后 fire-and-forget，不阻塞 bind 完成与用户后续操作。
- **内容**：`ensureAgentSdkHttpServer` 已就绪前提下，可选轻量 `models.list`、plugin bootstrap 等预热。
- **挂点**：
  - `initDaemonManager`（`electron/daemon/daemon-manager.ts`）：应用 init，已调 `ensureAgentSdkHttpServer`。
  - `completeBind`（`src/daemon/daemon.ts`）：bind 成功写回侧。
  - `resolveBindWaiter`（`electron/daemon/daemon-manager.ts`，读 `__BIND_RESULT__`）：Electron 侧 bind 成功回调。
- **失败策略**：仅 WARN 日志，**不阻断** bind / 后续 launch。

### B2：细粒度进度文案

- `confirmEnqueueAndStartProgress` / `buildEnqueueStatusText`（`daemon-presentation-handlers.ts`）：入队确认与按 phase 生成文案。
- `dispatchSessionToAgent`（`daemon-orchestrator.ts`）：launch 前 `phase=starting` 与「正在启动」通知拆分为更细阶段。
- 具体阶段划分与文案在 **design 阶段**细化；本期至少 2 个可区分阶段。

## 四、用户故事与验收标准

### 用户故事

- **飞书私聊用户**：发送首条消息后，更快看到 Agent 进入运行态或更细的启动进度，减少「卡住」感知。
- **已 bind 通道用户**：应用启动并完成通道 bind 后，后台预热使后续首条消息冷启动进一步缩短（日志可观测）。
- **热 session 用户**：二次发信、context footer、pre-send 阻断等行为与现网一致，无回归。

### 验收标准

1. **冷启动耗时**：新 session、composer 模型首条 launch，入队到 RUNNING 较基线减少 **≥8s**（目标 ~15s 内；`agent.send` ~12s 仍可能存在）。
2. **models.list 不阻塞**：`daemon.log` 首调不再出现 create 完成后阻塞 ~5s 的 `models.list` 再 send；composer 启发式立即命中。
3. **bootstrap 不重复**：同一次 launch 日志不出现两次 `bootstrapSdkPluginWorkspace` 详细 config 输出。
4. **bind 后预热**：bind 成功后触发预热（日志可观测）；下次首条消息冷启动进一步缩短（定性）；预热失败不影响 bind 与后续消息处理。
5. **B2 细粒度进度**：用户收到比单一「正在启动」更细的进度反馈，至少 **2 个**可区分阶段。
6. **行为不退化**：二次 dispatch / 热 session 正常；context footer、pre-send 阻断逻辑不变。
7. **工程构建**：`tsc --noEmit` 通过。

## 五、影响范围

### 代码文件

| 文件 | 变更项 | 说明 |
|------|--------|------|
| `electron/agent/cursor-sdk/context-usage.ts` | A1 | `resolveModelContextLimit` 启发式 cache + 后台 models.list |
| `electron/agent/cursor-sdk/agent-sdk.ts` | A2 | `launchSdkAgent` / `dispatchToSdkAgent` 并行化 |
| `electron/agent/cursor-sdk/sdk-run-dispatch.ts` | A3 | `buildSendOptions` bootstrap 复用 |
| `electron/agent/cursor-sdk/sdk-session-types.ts` | A3（可选） | launch bootstrap 元数据缓存 |
| `electron/daemon/daemon-manager.ts` | B1 | `initDaemonManager` / `resolveBindWaiter` 预热挂点 |
| `src/daemon/daemon.ts` | B1 | `completeBind` 回调侧预热 |
| `src/daemon/daemon-orchestrator.ts` | B2 | `dispatchSessionToAgent` launch 前细粒度进度 |
| `src/daemon/daemon-presentation-handlers.ts` | B2 | `confirmEnqueueAndStartProgress` / `buildEnqueueStatusText` |

### 知识库

| 文件 | 说明 |
|------|------|
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | **主**：冷启动路径、并行与 bootstrap 复用（archive 阶段落实） |
| `knowledge/业务域/Agent调度/03-启动与自动重连.md` | 若 B1/B2 涉及 Daemon 三态进度则更新（archive 阶段视实现结果） |

### 用户可见影响

- 飞书私聊首条冷启动：RUNNING 感知提前，send 耗时不变（C1 外部依赖）。
- Daemon 调度路径：无结构性变更；B2 仅细化进度文案，不改卡片布局。

**实现阶段约束**（仓库 AGENTS.md）：代码须注释；单文件 ≤300 行，超限须设计模式拆分。

## 六、技术影响（CodeGraph 复核）

> CodeGraph 未初始化；以下为源码检索复核。

| 符号 | 路径 | 职责 |
|------|------|------|
| `launchSdkAgent` | `electron/agent/cursor-sdk/agent-sdk.ts:92` | 冷启动主路径；当前串行 create→resolveContextLimit→send |
| `dispatchToSdkAgent` | `electron/agent/cursor-sdk/agent-sdk.ts:227` | 热 session 二次 dispatch |
| `resolveModelContextLimit` | `electron/agent/cursor-sdk/context-usage.ts:139` | models.list 阻塞点（A1） |
| `ensureAgentSdkHttpServer` | `electron/agent/cursor-sdk/agent-sdk-http.ts:161` | HTTP 网关；init 与 launch 均调用 |
| `initDaemonManager` | `electron/daemon/daemon-manager.ts:1237` | 应用 init；已调 ensureAgentSdkHttpServer + recoverSdkActiveRuns |
| `completeBind` | `src/daemon/daemon.ts:203` | bind 成功写回；B1 预热挂点 |
| `resolveBindWaiter` | `electron/daemon/daemon-manager.ts`（`__BIND_RESULT__` 解析） | Electron 侧 bind 成功回调 |
| `dispatchSessionToAgent` | `src/daemon/daemon-orchestrator.ts:188` | phase=starting + notify「正在启动」 |
| `confirmEnqueueAndStartProgress` | `src/daemon/daemon-presentation-handlers.ts:292` | 入队确认 + 进度指示 |
| `buildEnqueueStatusText` | `src/daemon/daemon-presentation-handlers.ts:116` | 按 phase 生成入队文案 |

## 七、风险与依赖

| 项 | 说明 |
|----|------|
| **C1 外部依赖** | `agent.send` ~12s 为 Cursor SDK 后端行为，本期不优化；冷启动目标 ~15s 仍受 send 下限约束 |
| **预热 fire-and-forget** | B1 预热失败仅 WARN，不阻断 bind / launch；预热收益依赖 bind 后至首条消息的时间窗口 |
| **并行竞态** | A2 `Agent.create` ∥ `resolveContextLimitForSession` 的 await 边界须在 design 阶段明确，避免 send 早于 session 就绪 |
| **单文件约束** | `daemon-manager.ts` 等历史大文件改动须控制 diff 范围，必要时拆子模块（≤300 行） |
| **知识库同步** | `06-CursorSDK执行引擎.md` 须在 archive 阶段与实现一致；`03-启动与自动重连.md` 视 B1/B2 落点决定 |
