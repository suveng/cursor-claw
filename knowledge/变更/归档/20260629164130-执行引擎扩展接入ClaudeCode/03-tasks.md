# 执行引擎扩展接入 ClaudeCode - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### 1.1 依赖图

```
T2（独立）
T1 ──→ T3 ──→ T5 ──→ T7
         └──→ T6
T1 ──→ T4
T1 ──→ T7（类型依赖，但 T5 完成后才可执行）
```

### 1.2 分组调度

- **第一轮（并行）**: T1, T2
- **第二轮（并行）**: T3, T4（均依赖 T1）
- **第三轮（并行）**: T5, T6（均依赖 T3）
- **第四轮**: T7（依赖 T1 + T5）

## 2、任务清单

<!-- 以下每条任务自包含；子 agent 执行时只读单条 T{n} + 上下文文件 -->

---

## T1: 扩展 AgentResource 共享类型与 config-store

### 背景
`AgentResource` 接口目前只有 `"cli" | "sdk"` 两种类型。为接入 Claude Code SDK Profile，需要新增 `"claude-code"` union 成员，并加入 `baseUrl`（自定义 Anthropic 端点）和 `model`（默认模型）两个可选字段。这是所有下游改动的类型基础，必须最先完成。`config-store.ts` 新增 ID 生成函数以隔离 Claude Code Profile 的 ID 命名空间。

### 上下文文件
- 必读: `src/shared/channel-types.ts` — AgentResource、MessageChannel 接口定义，改动目标文件
- 必读: `electron/config-store.ts` — 查看 `newSdkResourceId()` 函数实现，新函数以此为参考
- 参考: `electron/agent-sdk.ts` — 第 1559-1564 行，SdkModelOption 类型（了解现有 sdk type 使用场景）

### 实现范围
- 修改: `src/shared/channel-types.ts` — `AgentResource.type` union 加 `"claude-code"`；接口加两个可选字段 `baseUrl?: string` 和 `model?: string`
- 修改: `electron/config-store.ts` — 新增导出函数 `newClaudeCodeResourceId(): string`，返回 `"cc_" + randomHex(8)`（参考同文件的 `newSdkResourceId()` 实现，用 `crypto.randomBytes(4).toString("hex")` 生成 8 位 hex）

### 接口契约
- `AgentResource.type: "cli" | "sdk" | "claude-code"` — T3/T4/T6/T7 等所有下游根据此 union 做类型收窄
- `AgentResource.baseUrl?: string` — T3（agent-claude-sdk.ts）读取；空值 = 使用 Anthropic 默认端点
- `AgentResource.model?: string` — T7（AgentPanel.tsx）编辑/保存
- `newClaudeCodeResourceId(): string` — T7（AgentPanel.tsx 前端新建 CC Profile 时生成 ID）

### 验收标准
- [ ] `AgentResource.type` 包含 `"claude-code"`，TypeScript 编译无报错
- [ ] `AgentResource` 含 `baseUrl?: string` 和 `model?: string` 可选字段
- [ ] `newClaudeCodeResourceId()` 返回以 `"cc_"` 开头的 12 位字符串
- [ ] 现有 `type: "cli"` 和 `type: "sdk"` 的运行时逻辑不受影响（无破坏性改动）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖
- 前置任务: 无
- 后续任务: T3, T4, T6, T7

---

## T2: 扩展 context-usage 模型上限 fallback

### 背景
`resolveModelContextLimit` 函数当前先调用 `Cursor.models.list({ apiKey })` 获取模型上限，失败后才走 `MODEL_LIMIT_HEURISTICS` 启发式推断。启发式规则中已有 `claude → 200k`。当 Claude Code SDK 引擎使用 Anthropic API Key 时，调用 `Cursor.models.list` 会失败（Key 不兼容）。需要在函数入口对 Claude 模型名称提前短路，直接走启发式推断，避免无效的 Cursor SDK 调用。

### 上下文文件
- 必读: `electron/context-usage.ts` — `resolveModelContextLimit` 函数（第 138-167 行），`MODEL_LIMIT_HEURISTICS` 数组，`modelLimitCache` Map
- 参考: `electron/agent-sdk.ts` — 搜索 `resolveModelContextLimit` 的调用点，了解 apiKey 参数来源

### 实现范围
- 修改: `electron/context-usage.ts` — 在 `resolveModelContextLimit` 函数体内，**缓存查询之后、`Cursor.models.list` 调用之前**，加入 Claude 模型短路判断：若 `modelId.startsWith("claude-")` 则跳过 `Cursor.models.list`，直接走 `MODEL_LIMIT_HEURISTICS` 推断（现有逻辑不变，只是跳过第一步）

### 接口契约
- `resolveModelContextLimit(modelId, apiKey)` 签名不变
- 对 `claude-*` 模型，返回 200k（启发式规则已覆盖）；对其他模型，行为与现在完全一致

### 验收标准
- [ ] `modelId = "claude-sonnet-4-6"` 时，函数不调用 `Cursor.models.list`，直接返回 200000
- [ ] `modelId = "claude-2.1"` 时，函数不调用 `Cursor.models.list`，返回非 null 的上限值
- [ ] `modelId = "cursor-small"` 等非 Claude 模型时，行为与修改前完全一致
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖
- 前置任务: 无
- 后续任务: T3

---

## T3: 新建 Claude Code SDK 执行引擎 agent-claude-sdk.ts

### 背景
这是本次变更的核心任务。参照 `agent-sdk.ts` 的整体骨架，新建 `agent-claude-sdk.ts`，使用 `@anthropic-ai/claude-code` SDK 实现 Agent 执行引擎。引擎复用 `agent-run-guard.ts`（mutex/watchdog）、`context-rotation-lite.ts`（上下文轮转）和 `agent-launcher.ts`（buildPrompt）等引擎无关模块，产出 `PresentationEvent` 格式与现有 Cursor SDK 引擎一致，下游 Presentation 层无感知。HTTP server 使用原生 `http.createServer`，注册 `/api/cc/agent/launch` 和 `/api/cc/agent/dispatch` 路由（与现有 `/api/agent/*` 并列，不影响现有端点）。`apiKey` 和 `baseUrl` 从 `channel_id → getChannel() → getAgentResource()` 解析（与 agent-sdk.ts 的 `launchSdkAgentFromHttp` 模式一致），不从 HTTP body 传入。

### 上下文文件
- 必读: `electron/agent-sdk.ts` — 完整文件（结构参考：SdkSessionAgent 接口字段、launchSdkAgent、streamRunEvents、handleSdkEvent、ensureAgentSdkHttpServer、launchSdkAgentFromHttp 的实现模式）
- 必读: `electron/agent-run-guard.ts` — 导出函数签名：acquireRunGuard、releaseRunGuard、completeRunGuard、watchRunGuard
- 必读: `electron/context-rotation-lite.ts` — maybeRotateContext 签名
- 必读: `electron/agent-launcher.ts` — 导出：ChatType、LaunchMeta、buildPrompt、resolveSessionChatName
- 必读: `electron/daemon-client.ts` — 导出：reportSessionAgentPhase、httpPost、readLockFile（HTTP 工具函数）
- 必读: `electron/context-usage.ts` — createAgentSendOptions、resolveContextLimitForSession、formatContextFooter、appendContextFooter（T2 完成后此文件已兼容 Claude 模型）
- 参考: `electron/config-store.ts` — getChannel、getAgentResource、resolveChannelForSession（供 launchCcAgentFromHttp 解析 channel 配置）
- 参考: `src/shared/channel-types.ts` — AgentResource 类型（T1 完成后含 baseUrl 字段）

### 实现范围
- 新建: `electron/agent-claude-sdk.ts` — 完整 Claude Code SDK 执行引擎，包含：
  1. **`ClaudeCodeSessionAgent` 接口**：镜像 `SdkSessionAgent` 的核心字段（sessionKey、agent 实例、run 状态、watchdogState、f41Stream、streamBuffer 等生命周期管理字段）；`apiKey`、`baseUrl`、`model` 字段替代 Cursor SDK 专有字段
  2. **`ClaudeCodeLaunchOptions` 接口**（见设计 §5.2）
  3. **`launchClaudeCodeAgent(opts: ClaudeCodeLaunchOptions)`**：创建 Claude Code SDK agent 实例（使用 apiKey + baseUrl），调用 `acquireRunGuard`，发送首条消息，启动 `streamCcEvents`
  4. **`streamCcEvents(session, run)`**：遍历 Claude Code SDK 流式事件，调用 `handleCcEvent`
  5. **`handleCcEvent(session, event)`**：将 Claude Code SDK 事件映射到 `PresentationEvent`（assistant/thinking/tool/diff/merge_batch），POST 到 Daemon 的 `/api/stream-text` 和 `/api/process-event`
  6. **`dispatchToClaudeCodeAgent(sessionKey, taskText, messageIds?)`**：向 resident session 发送新任务
  7. **`ensureClaudeCodeHttpServer()`**：注册 `/api/cc/agent/launch` 和 `/api/cc/agent/dispatch` 路由（复用现有 HTTP server 实例，通过 URL pathname 比较路由）
  8. **`launchCcAgentFromHttp(body)`**：HTTP 入口，从 `body.channel_id → getChannel() → getAgentResource()` 解析 apiKey/baseUrl
  9. **查询函数**：`isClaudeCodeSessionRunning(sessionKey)`, `getClaudeCodeSessionList()`, `stopClaudeCodeSession(sessionKey)`, `stopAllClaudeCodeSessions()`
  10. **`checkClaudeCodeApiKey(apiKey: string)`**：验证 Anthropic API Key 有效性（发一条 dry-run 请求或调用 SDK auth check）

### 接口契约
- `export async function launchClaudeCodeAgent(opts: ClaudeCodeLaunchOptions): Promise<{ok: boolean; error?: string}>`
- `export async function dispatchToClaudeCodeAgent(sessionKey: string, taskText: string, messageIds?: string[]): Promise<{ok: boolean; error?: string}>`
- `export function ensureClaudeCodeHttpServer(): void`
- `export function stopClaudeCodeSession(sessionKey: string): void`
- `export function stopAllClaudeCodeSessions(): void`
- `export function isClaudeCodeSessionRunning(sessionKey: string): boolean`
- `export function getClaudeCodeSessionList(): Array<{sessionKey: string; chatType: string; startedAt: number; chatName?: string; pid: number}>`
- `export async function checkClaudeCodeApiKey(apiKey: string): Promise<{ok: boolean; error?: string}>`
- `export const CLAUDE_CODE_MODEL_LIST: Array<{id: string; label: string}>` — 硬编码 Claude 模型列表（claude-opus-4-8、claude-sonnet-4-6、claude-haiku-4-5 等）

### 验收标准
- [ ] TypeScript 编译无报错（`tsc --noEmit` 通过）
- [ ] `isClaudeCodeSessionRunning` 在无活跃 session 时返回 false
- [ ] `ensureClaudeCodeHttpServer()` 多次调用幂等（不重复创建 server）
- [ ] `launchCcAgentFromHttp` 能从 `body.channel_id` 解析 apiKey 和 baseUrl
- [ ] `checkClaudeCodeApiKey` 对无效 key 返回 `{ok: false, error: "..."}`
- [ ] 无对 `@cursor/sdk` 的 import（两引擎互相独立）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖
- 前置任务: T1（AgentResource 类型含 baseUrl），T2（context-usage 兼容 Claude 模型）
- 后续任务: T5, T6

---

## T4: 更新 command-handler.ts 模型列表分支

### 背景
`command-handler.ts` 在处理 `/model` 等指令时，通过 `resource.type === "sdk"` 判断后调用 `listSdkModels` 获取模型选项。对 `claude-code` 类型的 Resource，需要新增分支返回 Claude 模型列表。模型列表直接在本文件内联硬编码（不依赖 agent-claude-sdk.ts），不需要远程拉取，确保本任务可与 T3 并行执行。

### 上下文文件
- 必读: `electron/command-handler.ts` — 完整文件（第 9 行 import agent-sdk，第 54-56 行 resource.type === "sdk" 判断）
- 必读: `src/shared/channel-types.ts` — AgentResource.type（T1 完成后含 "claude-code"）
- 参考: `electron/agent-sdk.ts` — listSdkModels 签名（第 1566 行）

### 实现范围
- 修改: `electron/command-handler.ts` — 在 `resource.type === "sdk"` 判断后加 `else if (resource.type === "claude-code")` 分支：使用文件内联的 Claude 模型硬编码列表（`const CC_MODELS = [{id: "claude-opus-4-8", label: "Claude Opus 4.8"}, {id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6"}, ...]`），构造与 `listSdkModels` 返回格式兼容的响应（`{ok: true, models: [{id, label, params: "", current: id === channel?.model}]}`）；不 import agent-claude-sdk.ts

### 接口契约
- 无新导出；对下游（通道 model 选择逻辑）行为一致，仅返回 Claude 模型列表

### 验收标准
- [ ] `resource.type === "claude-code"` 时，command-handler 返回非空模型列表（含至少 claude-sonnet-4-6 等当前主力型号）
- [ ] `resource.type === "sdk"` 时，原有 `listSdkModels` 分支不受影响
- [ ] TypeScript 编译无报错
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖
- 前置任务: T1（AgentResource.type 含 "claude-code"）
- 后续任务: 无

---

## T5: 更新 main.ts IPC handlers 和 daemon-manager.ts re-export

### 背景
Renderer 前端通过 IPC 验证 Claude Code API Key（`cc:check-api-key`）和获取 Claude 模型列表（`cc:list-models`）。`main.ts` 已有 `sdk:check-api-key`/`sdk:list-models` 通过 `daemon-manager.ts` re-export 导入，Claude Code 版本遵循同一模式：`daemon-manager.ts` re-export `agent-claude-sdk.ts` 的 `checkClaudeCodeApiKey`，`main.ts` 注册两个新 IPC handler。`cc:list-models` 直接使用 `CLAUDE_CODE_MODEL_LIST` 常量，无需远程调用。

### 上下文文件
- 必读: `electron/main.ts` — 第 22-24 行（daemon-manager imports），第 369-370 行（sdk:check-api-key / sdk:list-models handler，作为模板）
- 必读: `electron/daemon-manager.ts` — 第 55 行（`export { checkSdkApiKey, listSdkModels } from "./agent-sdk"` re-export 模式）
- 参考: `electron/agent-claude-sdk.ts` — T3 产出，checkClaudeCodeApiKey 和 CLAUDE_CODE_MODEL_LIST 导出

### 实现范围
- 修改: `electron/daemon-manager.ts` — 加一行 re-export：`export { checkClaudeCodeApiKey, CLAUDE_CODE_MODEL_LIST } from "./agent-claude-sdk"`
- 修改: `electron/main.ts` — 在 `registerIpcHandlers` 内，紧接 `sdk:check-api-key` 后加：
  ```typescript
  ipcMain.handle("cc:check-api-key", (_, apiKey: string) => checkClaudeCodeApiKey(apiKey))
  ipcMain.handle("cc:list-models", () => CLAUDE_CODE_MODEL_LIST)
  ```
  并在文件顶部 imports 中从 `./daemon-manager` 加入 `checkClaudeCodeApiKey, CLAUDE_CODE_MODEL_LIST`

### 接口契约
- IPC `cc:check-api-key(apiKey: string)` → `Promise<{ok: boolean; error?: string}>`
- IPC `cc:list-models()` → `Array<{id: string; label: string}>`

### 验收标准
- [ ] Renderer 调用 `window.electronAPI.checkCcApiKey(key)` 返回 `{ok, error?}` 结构
- [ ] Renderer 调用 `window.electronAPI.listCcModels()` 返回非空数组
- [ ] TypeScript 编译无报错
- [ ] 现有 `sdk:check-api-key` / `sdk:list-models` 行为不受影响
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖
- 前置任务: T3（checkClaudeCodeApiKey 和 CLAUDE_CODE_MODEL_LIST 导出）
- 后续任务: T7

---

## T6: 更新 session-dispatcher.ts 路由逻辑

### 背景
`session-dispatcher.ts` 是三条执行路径（IM 消息、任务触发、工作流节点）的唯一路由决策点。当前 `launchAgent()` 对非 `sdk` 类型直接报错。需要新增 `claude-code` 分支，POST 到 `/api/cc/agent/launch`。同时，`isSessionAgentRunning`、`stopSessionAgent`、`stopAllSessionAgents`、`getSessionAgentList` 四个函数需要合并 Claude Code session 的状态，并在 `initSessionDispatcher()` 中调用 `ensureClaudeCodeHttpServer()` 启动 CC 引擎的 HTTP 端点。

### 上下文文件
- 必读: `electron/session-dispatcher.ts` — 完整文件（第 13-20 行 imports，第 54-65 行 stop/isRunning/list 函数，第 243-310 行 launchAgent 核心逻辑，第 555-557 行 initSessionDispatcher）
- 必读: `electron/agent-claude-sdk.ts` — T3 产出，导出函数签名：isClaudeCodeSessionRunning、stopClaudeCodeSession、stopAllClaudeCodeSessions、getClaudeCodeSessionList、ensureClaudeCodeHttpServer
- 必读: `electron/config-store.ts` — getAgentResource（用于 launchAgent 中读取 resource.type）
- 参考: `src/shared/channel-types.ts` — AgentResource.type（T1 产出，含 "claude-code"）

### 实现范围
- 修改: `electron/session-dispatcher.ts`：
  1. **imports**：从 `./agent-claude-sdk` 导入 `isClaudeCodeSessionRunning`, `stopClaudeCodeSession`, `stopAllClaudeCodeSessions`, `getClaudeCodeSessionList`, `ensureClaudeCodeHttpServer`
  2. **`launchAgent()`（第 249 行 resource.type 判断）**：将 `if (resource.type !== "sdk") { return error }` 改为：
     ```typescript
     if (resource.type === "sdk") {
       // 原有路径：POST /api/agent/launch（body 不变）
     } else if (resource.type === "claude-code") {
       // 新路径：POST /api/cc/agent/launch（body 与 sdk 相同，channel_id 用于 Daemon 侧解析 apiKey/baseUrl）
     } else {
       return { ok: false, error: "请配置 SDK 资源（设置 → Agent）" }
     }
     ```
  3. **`isSessionAgentRunning(key)`**：改为 `isSdkSessionRunning(key) || isClaudeCodeSessionRunning(key)`
  4. **`stopSessionAgent(key)`**：先检查两个引擎各自的 isRunning，再调对应的 stop 函数
  5. **`stopAllSessionAgents()`**：调用 `stopAllSdkSessions()` 和 `stopAllClaudeCodeSessions()`
  6. **`getSessionAgentList()`**：合并 `getSdkSessionList()` 和 `getClaudeCodeSessionList()`
  7. **`initSessionDispatcher()`**：加一行 `ensureClaudeCodeHttpServer()`

### 接口契约
- `launchAgent()` 对外行为不变（仍返回 `{ok, error?}`）
- `isSessionAgentRunning`、`stop*`、`getSessionAgentList` 覆盖范围扩展为两引擎之和，接口签名不变

### 验收标准
- [ ] `resource.type === "claude-code"` 时，`launchAgent()` POST 到 `/api/cc/agent/launch` 而非 `/api/agent/launch`
- [ ] `resource.type === "sdk"` 时，原有路径行为不变（验收标准 4）
- [ ] `stopAllSessionAgents()` 停止两个引擎的所有 session
- [ ] `getSessionAgentList()` 返回两个引擎的 session 合并列表
- [ ] `initSessionDispatcher()` 调用后 `/api/cc/agent/launch` 端点可响应 POST 请求
- [ ] TypeScript 编译无报错
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖
- 前置任务: T3（agent-claude-sdk.ts 导出函数）
- 后续任务: 无

---

## T7: 前端 AgentPanel.tsx + Settings.tsx 新增 Claude Code Profile 管理

### 背景
前端需要支持管理员新建、编辑、删除 Claude Code SDK Profile（F1/F8），以及在 IM 通道配置中绑定 Profile（F6 已由 `agentResourceId` 机制自动支持，无需改 MessageChannel 字段）。`AgentPanel.tsx` 在 Cursor SDK 区块下新增独立的「Claude Code SDK」区块，复用现有的新建/编辑/删除/验证交互模式。`Settings.tsx` 的模型列表加载逻辑需兼容 `claude-code` type，调用新 IPC `cc:list-models`。

### 上下文文件
- 必读: `src/renderer/components/AgentPanel.tsx` — 完整文件（现有 Cursor SDK Profile 管理的全部交互逻辑，作为 Claude Code 区块的结构参考）
- 必读: `src/renderer/pages/Settings.tsx` — 第 103 行（agentResources state），第 413-418 行（模型列表加载分支 resource.type === "sdk"），第 737 行（AgentPanel 渲染）
- 必读: `electron/preload.ts` — electronAPI 的类型定义（验证 cc:check-api-key 和 cc:list-models 是否已声明）
- 参考: `src/shared/channel-types.ts` — AgentResource 接口（T1 产出，含 baseUrl、model 字段）

### 实现范围
- 修改: `src/renderer/components/AgentPanel.tsx` — 在现有 Cursor SDK Profile 列表区块之后，新增「Claude Code SDK」独立区块：
  - State：`ccResources`（从 `cfg.agentResources.filter(r => r.type === "claude-code")`），`editingCc`，`isNewCc`，`verifyResultCc`
  - 新建按钮：`setEditingCc({ id: newClaudeCodeResourceId(), type: "claude-code", name: "CC Profile 1", apiKey: "" })`（注：`newClaudeCodeResourceId` 函数在 Renderer 侧需内联实现，格式 `"cc_" + randomHex(8)`）
  - 表单字段：名称（必填）、API Key（必填，密码输入 + 显示切换 + 验证按钮调用 `window.electronAPI.checkCcApiKey(key)`）、API Base URL（选填，placeholder = "https://api.anthropic.com"）、默认模型（选填，文本输入）
  - 保存：更新 `cfg.agentResources`（合并 cc 列表，保留 cli 和 sdk 条目），调用 `config:save`
  - 删除：检查 `channels.filter(c => c.agentResourceId === r.id)` 是否被通道使用，给出确认提示（与 Cursor SDK 删除逻辑一致）
- 修改: `src/renderer/pages/Settings.tsx` — 第 413-418 行模型列表加载：在 `resource.type === "sdk"` 分支后加 `else if (resource.type === "claude-code")` 分支，调用 `window.electronAPI.listCcModels()`
- 修改: `electron/preload.ts` — 若 `electronAPI` 的 TypeScript 接口中未声明 `checkCcApiKey` 和 `listCcModels`，需补充声明

### 接口契约
- 无新 Renderer 导出；通过 IPC 调用 T5 注册的 `cc:check-api-key` / `cc:list-models`
- `cfg.agentResources` 数组同时存储 `type: "sdk"` 和 `type: "claude-code"` 条目，由 config-store 统一持久化

### 验收标准
- [ ] 可新建 Claude Code Profile，保存后出现在列表（含 name、API Key 掩码展示、baseUrl、model）
- [ ] 验证按钮调用 `cc:check-api-key`，返回有效/无效提示
- [ ] 删除 Profile 时，若有通道绑定则给出确认提示
- [ ] 多个 Claude Code Profile 互相独立，编辑一个不影响其他（验收标准 8）
- [ ] Settings.tsx 模型列表加载：`type === "claude-code"` 的通道调用 `listCcModels`，返回 Claude 模型选项
- [ ] Cursor SDK Profile 管理区块行为不受影响
- [ ] TypeScript 编译无报错
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖
- 前置任务: T1（AgentResource 类型），T5（IPC handlers）
- 后续任务: 无

---

## T-FIX-01: 补全 env.d.ts 渲染层类型声明（修复评审 R-S1、R-S2）

### 背景
`src/renderer/env.d.ts` 是渲染进程的全局类型声明文件。T1 已更新 `src/shared/channel-types.ts` 和 `electron/preload.ts`，但 `env.d.ts` 未同步，导致 TypeScript 编译失败：`AgentResource.type` 缺少 `"claude-code"` union 值，`AgentResource` 缺少 `baseUrl`/`model` 字段；`ElectronAPI` 缺少 `checkCcApiKey` 和 `listCcModels` 方法声明。

### 上下文文件
- 必读: `src/renderer/env.d.ts` — 完整文件，定位 AgentResource 接口（第 8-14 行）和 ElectronAPI 接口（约第 164 行起）
- 必读: `electron/preload.ts` — 查看 checkCcApiKey 和 listCcModels 的已声明类型，与 env.d.ts 保持一致
- 必读: `src/shared/channel-types.ts` — AgentResource 权威定义（T1 已更新）

### 实现范围
- 修改: `src/renderer/env.d.ts`：
  1. 第 8-14 行 AgentResource 接口：`type` 改为 `"cli" | "sdk" | "claude-code"`；新增 `baseUrl?: string`、`model?: string` 可选字段
  2. ElectronAPI 接口（紧接 `listSdkModels` 声明之后）新增两行：
     ```ts
     checkCcApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }>
     listCcModels(): Promise<Array<{ id: string; label: string }>>
     ```

### 接口契约
- `AgentResource.type: "cli" | "sdk" | "claude-code"`（与 channel-types.ts 保持一致）
- `ElectronAPI.checkCcApiKey`/`listCcModels` 签名与 preload.ts 一致

### 验收标准
- [ ] `env.d.ts` AgentResource.type 包含 `"claude-code"`
- [ ] `env.d.ts` AgentResource 含 `baseUrl?: string` 和 `model?: string`
- [ ] `env.d.ts` ElectronAPI 含 `checkCcApiKey` 和 `listCcModels` 声明
- [ ] TypeScript 编译无报错（`tsc --noEmit` 或检查 channel-types 一致性）
- [ ] 不修改 env.d.ts 以外的任何文件

### 依赖
- 前置任务: T1（已完成）
- 后续任务: 无（独立修复）

---

## T-FIX-02: 修复 broadcastCcSessionStatus 分区键冲突（修复评审 R-S3）

### 背景
`electron/agent-claude-sdk.ts:418` 调用 `broadcastSessionStatus(list, "sdk")`，与 `agent-sdk.ts` 中 `broadcastSdkSessionStatus` 使用相同的 `"sdk"` 分区键。`ui-logger.ts` 内部以 `sessionPartitions.set(source, list)` 覆盖式存储，导致两者后触发的广播会完全覆盖前者——多引擎并发时 UI 会话列表数据丢失。`SessionSource` 类型当前无 `"claude-code"` 值。

### 上下文文件
- 必读: `electron/ui-logger.ts` — 第 103 行 `SessionSource` 类型定义、第 107 行 `sessionPartitions` Map、第 109 行 `broadcastSessionStatus` 函数
- 必读: `electron/agent-claude-sdk.ts` — 第 408-422 行 `broadcastCcSessionStatus` 函数

### 实现范围
- 修改: `electron/ui-logger.ts` — 第 103 行：将 `export type SessionSource = "cli" | "sdk"` 改为 `export type SessionSource = "cli" | "sdk" | "claude-code"`
- 修改: `electron/agent-claude-sdk.ts` — 第 418 行：将 `broadcastSessionStatus(list, "sdk")` 改为 `broadcastSessionStatus(list, "claude-code")`

### 接口契约
- `SessionSource` union 扩展，向后兼容（现有 "cli"/"sdk" 分区不受影响）
- `broadcastCcSessionStatus()` 对外行为不变，仅分区键更正

### 验收标准
- [ ] `ui-logger.ts` SessionSource 包含 `"claude-code"`
- [ ] `agent-claude-sdk.ts:418` 传递 `"claude-code"` 而非 `"sdk"`
- [ ] `agent-sdk.ts` 的 broadcastSdkSessionStatus 仍传递 `"sdk"`，不受影响
- [ ] TypeScript 编译无报错
- [ ] 仅修改上述两处，不扩散

### 依赖
- 前置任务: 无（独立修复）
- 后续任务: T-FIX-03（split 前需先修正，避免 split 后重复操作）

---

## T-FIX-04: 修复 guard 泄漏、pendingDispatch 永久锁死及 ANTHROPIC_BASE_URL 继承（修复评审 R-S5、R-W1、R-W2）

### 背景
三处并行修复，均在 `electron/agent-claude-sdk.ts`：
1. **R-S5**：`dispatchToClaudeCodeAgent`（约第 907-918 行）在 `acquireRunGuard` 返回 `acquired=false` 时直接 return，未清零 `session.pendingDispatch`，session 永久锁死
2. **R-W1**：`launchClaudeCodeAgent`（第 774-889 行）`acquireRunGuard` 成功后若后续抛出异常，finally 块不调用 `releaseRunGuard`，guard 泄漏
3. **R-W2**：spawn env 构造（第 863-864 行、第 939-940 行）用 `if (session.baseUrl)` 才设置 `ANTHROPIC_BASE_URL`，但父进程 env 中可能已有该变量，baseUrl 为空时应显式 delete

### 上下文文件
- 必读: `electron/agent-claude-sdk.ts` — 第 774-889 行（launchClaudeCodeAgent）、第 895-965 行（dispatchToClaudeCodeAgent）、第 855-870 行（launch 的 env 构造）、第 930-945 行（dispatch 的 env 构造）
- 必读: `electron/agent-run-guard.ts` — `acquireRunGuard`、`releaseRunGuard` 签名，了解 token 字段

### 实现范围
- 修改: `electron/agent-claude-sdk.ts`：
  1. **R-S5 修复**（约第 916-918 行）：在 `acquireRunGuard` 返回 `acquired=false` 时的 return 语句之前，加一行 `session.pendingDispatch = false`
  2. **R-W1 修复**（第 886-889 行 finally 块）：在 `CC_PENDING_LAUNCHES.delete(sessionKey)` 后，追加：
     ```ts
     if (guard?.acquired && session && !session.child) {
       releaseRunGuard(sessionKey, guard.token)
     }
     ```
  3. **R-W2 修复**（第 863-864 行 launch env 构造、第 939-940 行 dispatch env 构造）：将两处 `if (session.baseUrl) { env.ANTHROPIC_BASE_URL = session.baseUrl }` 改为：
     ```ts
     if (session.baseUrl) {
       env.ANTHROPIC_BASE_URL = session.baseUrl
     } else {
       delete env.ANTHROPIC_BASE_URL
     }
     ```

### 接口契约
- `launchClaudeCodeAgent` / `dispatchToClaudeCodeAgent` 对外签名不变
- 行为修正：异常路径不再泄漏 guard 和 pendingDispatch 状态

### 验收标准
- [ ] dispatch 函数 guard 失败路径中 `pendingDispatch` 被清零再 return
- [ ] launch 函数 finally 块在 guard 已获取但子进程未启动时调用 `releaseRunGuard`
- [ ] spawn env 构造：baseUrl 为空时显式 `delete env.ANTHROPIC_BASE_URL`（两处）
- [ ] TypeScript 编译无报错
- [ ] 仅修改上述三处逻辑，不扩散

### 依赖
- 前置任务: T-FIX-02（T-FIX-02 也修改同文件，须先完成）
- 后续任务: T-FIX-03（split 前先完成 bug 修复）

---

## T-FIX-03: 拆分 agent-claude-sdk.ts 满足 300 行规范（修复评审 R-S4）

### 背景
`electron/agent-claude-sdk.ts` 共 1244 行，混合了六类职责（类型定义、流式文本辅助、事件处理、核心执行、HTTP Server、API Key 校验），违反 AGENTS.md "代码文件不得超过300行"规范。在 T-FIX-02 和 T-FIX-04 完成后，本任务将文件拆分为 5 个职责明确的文件，每个文件 ≤300 行。

### 上下文文件
- 必读: `electron/agent-claude-sdk.ts` — 完整文件（T-FIX-02 和 T-FIX-04 已修复后的版本）
- 参考: `electron/agent-sdk.ts` — 类似模块的文件组织方式
- 参考: `electron/session-dispatcher.ts` — 查看对 agent-claude-sdk.ts 的 import，拆分后需更新
- 参考: `electron/daemon-manager.ts` — 查看 re-export，拆分后需更新

### 拆分方案

| 文件 | 内容 | 目标行数 |
|------|------|---------|
| `electron/agent-cc-types.ts` | `ClaudeCodeLaunchOptions`、`CLAUDE_CODE_MODEL_LIST`、`CcSessionAgent` 内部接口、`StreamTextPayload` | ~90 行 |
| `electron/agent-cc-stream.ts` | 流式文本辅助函数：`flushCcLog`/`appendCcLog`/`postPresentationEvent`/`postStreamText`/`doFlushStreamPost`/`flushStreamPost`/`scheduleStreamPost`/`appendStreamDelta`/`closeThinkingIfOpen`/`markProcessEventSeen`/`notifySessionChat`；`broadcastCcSessionStatus` | ~200 行 |
| `electron/agent-cc-events.ts` | 事件类型接口（`CcSystemEvent`/`CcAssistantEvent`/`CcUserEvent`/`CcResultEvent`/`CcStreamEvent`）、`parseCcEvent`/`mapContentBlockToUsage`/`handleCcEvent`/`armCcWatchdog`/`completeCcRun`/`streamCcEvents` | ~270 行 |
| `electron/agent-cc-http.ts` | `checkClaudeCodeApiKey`/`CLAUDE_CODE_MODEL_LIST`（re-export）/`writeCcApiPortFile`/`readCcApiBody`/`jsonCcApi`/`parseInboundMessageIds`/`launchCcAgentFromHttp`/`ensureClaudeCodeHttpServer`/`getCcAgentApiPort` | ~230 行 |
| `electron/agent-claude-sdk.ts` | 顶部 imports、常量（WATCHDOG_*、CC_SESSIONS、CC_PENDING_LAUNCHES 等）、二进制路径函数、会话辅助工具（extractChatId/resolveSessionChannelType/f41Eligible/ccResidentModeEnabled/resetCcRunPresentationState/setWatchdogState/markSessionActivity）、`launchClaudeCodeAgent`/`dispatchToClaudeCodeAgent`、停止函数、`getClaudeCodeSessionList`、全部 re-export | ~300 行 |

**导入依赖方向（无环）**：
`agent-cc-types.ts` ← `agent-cc-stream.ts` ← `agent-cc-events.ts` ← `agent-claude-sdk.ts` → `agent-cc-http.ts`

### 实现范围
- 新建: `electron/agent-cc-types.ts`
- 新建: `electron/agent-cc-stream.ts`
- 新建: `electron/agent-cc-events.ts`
- 新建: `electron/agent-cc-http.ts`
- 修改: `electron/agent-claude-sdk.ts`（保留但大幅缩减，改为核心逻辑 + re-export 入口）
- 修改: `electron/daemon-manager.ts` — 若 re-export 路径无变化则无需改动；若 `checkClaudeCodeApiKey`/`CLAUDE_CODE_MODEL_LIST` 移到 `agent-cc-http.ts`，需更新 re-export 源路径
- 不修改: `electron/session-dispatcher.ts`、`electron/main.ts`（这些文件 import 自 `agent-claude-sdk.ts`，而 `agent-claude-sdk.ts` 仍作为对外 re-export 入口，调用方无感知）

### 接口契约
- 所有现有 export（`launchClaudeCodeAgent`、`dispatchToClaudeCodeAgent`、`isClaudeCodeSessionRunning`、`stopClaudeCodeSession`、`stopAllClaudeCodeSessions`、`getClaudeCodeSessionList`、`checkClaudeCodeApiKey`、`ensureClaudeCodeHttpServer`、`getCcAgentApiPort`、`CLAUDE_CODE_MODEL_LIST`、`ClaudeCodeLaunchOptions`、`PresentationEvent`/`PresentationKind`）必须仍可从 `electron/agent-claude-sdk.ts` import，外部调用方无需修改

### 验收标准
- [ ] 拆分后所有文件（含新建文件）行数 ≤300 行
- [ ] `electron/agent-claude-sdk.ts` 仍导出所有原始 public symbol，外部调用方（session-dispatcher、daemon-manager、main.ts）无需修改
- [ ] 无循环导入（agent-cc-types ← agent-cc-stream ← agent-cc-events ← agent-claude-sdk → agent-cc-http）
- [ ] TypeScript 编译无报错
- [ ] T-FIX-02 的 `broadcastSessionStatus(list, "claude-code")` 在新文件中正确保留
- [ ] T-FIX-04 的三处 bug 修复（pendingDispatch、releaseRunGuard、ANTHROPIC_BASE_URL）在新文件中正确保留
- [ ] 无 `02`/`03` 未要求的新抽象或新依赖

### 依赖
- 前置任务: T-FIX-02（先修正 broadcastSessionStatus），T-FIX-04（先修复 bug，再 split）
- 后续任务: 无

---

## T-FIX-05: 消除 CC_MODELS 与 CLAUDE_CODE_MODEL_LIST 重复维护（R-N3）

### 背景
`command-handler.ts` 内联硬编码的 `CC_MODELS` 常量（3 项）与 `agent-cc-types.ts` 导出的 `CLAUDE_CODE_MODEL_LIST`（5 项）不同步，导致聊天命令模型列表与设置面板不一致。

### 上下文文件
- 必读: `electron/command-handler.ts` — CC_MODELS 常量与 claude-code 分支（约第 31-72 行）
- 必读: `electron/agent-cc-types.ts` — CLAUDE_CODE_MODEL_LIST 导出（第 29-37 行）

### 实现范围
- 修改: `electron/command-handler.ts` — 删除 `CC_MODELS` 内联常量；在 imports 中增加 `import { CLAUDE_CODE_MODEL_LIST } from "./agent-cc-types"`；在 `claude-code` 分支将 `CC_MODELS.map` 替换为 `CLAUDE_CODE_MODEL_LIST.map`

### 接口契约
- `CLAUDE_CODE_MODEL_LIST` 格式为 `Array<{id: string; label: string}>`，与 `CC_MODELS` 原格式兼容，`ListedModel` 映射逻辑无需改动

### 验收标准
- [ ] `CC_MODELS` 常量已从 `command-handler.ts` 删除
- [ ] `CLAUDE_CODE_MODEL_LIST` 已从 `./agent-cc-types` import
- [ ] `/model ls` 分支使用 `CLAUDE_CODE_MODEL_LIST.map`，展示 5 个模型
- [ ] TypeScript 类型兼容（`{id, label}` 格式不变）
- [ ] 无 `02`/`03` 未要求的新抽象或新依赖

### 依赖
- 前置任务: 无（T-FIX-03 已确保 agent-cc-types.ts 导出 CLAUDE_CODE_MODEL_LIST）
- 后续任务: 无
