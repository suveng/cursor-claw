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
