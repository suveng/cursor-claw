# ClaudeAgent MCP 展示与注入对齐 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### 1.1 依赖图

```
T1 ──→ T2 ──┐
T3 ─────────→ T5 ──→ T6
T4 ─────────→ T5
```

### 1.2 分组调度

- **第一轮（并行）**: T1, T3, T4
- **第二轮**: T2（依赖 T1）
- **第三轮**: T5（依赖 T1/T2/T3/T4）
- **第四轮**: T6（依赖 T5）

## 2、任务清单

## T1: 注入层 cc-mcp-loader 改读 Claude 原生源

### 背景

CC 引擎当前抄了 Cursor 路径读 `.cursor/mcp.json`，与 Claude Code 官方 scope 表（project=`.mcp.json`、user/local=`~/.claude.json`）不符。本任务修正注入层配置源，是 CC 路径 MCP 唯一真相的基础。

### 上下文文件

- CodeGraph: `loadInlineCcMcpServers` / `mergeMcpJsonEntries` / `readMcpServersBlock` — 定位 cc-mcp-loader 调用链
- 必读: `electron/cc-mcp-loader.ts` — 当前实现（读 `.cursor/mcp.json`，需改读 `.mcp.json`+`~/.claude.json`）
- 必读: `electron/mcp-sdk-loader.ts` — 对称参考（SDK 路径保持 `.cursor/mcp.json` 不改，仅参考 stdio resolve/cwd 逻辑）
- 参考: `https://code.claude.com/docs/en/mcp` — 官方 scope 表

### 实现范围

- 修改: `electron/cc-mcp-loader.ts` `mergeMcpJsonEntries` — 从读 `~/.cursor/mcp.json`+`{ws}/.cursor/mcp.json` 改为读 `~/.claude.json`(user scope `mcpServers` + local scope `projects[ws].mcpServers`) + `{ws}/.mcp.json`；project 覆盖 user/local
- 新增: `electron/cc-mcp-loader.ts` `readClaudeJsonMcpServers(workspaceDir)` — 读 `~/.claude.json`，提取 user scope 顶层 `mcpServers` 与 `projects[ws].mcpServers`（local scope），合并（local 覆盖 user）
- 保留: `toStdioInlineConfig`/`toHttpInlineConfig`/`resolvePathLikeSegment`/stdio cwd 逻辑不变；OAuth `resolveOAuthAccessToken` 暂留 Cursor store（首版 stdio-only，标 known limitation 注释）

### 接口契约

- `mergeMcpJsonEntries(workspaceDir: string): Record<string, RawMcpEntry>` — 签名不变，实现改读路径
- `readClaudeJsonMcpServers(workspaceDir: string): Record<string, RawMcpEntry>` — 新增，供 fallback 与 T5 读盘使用
- `loadInlineCcMcpServers` / `appendInlineMcpToCcOptions` 签名不变

### 验收标准

- [ ] `mergeMcpJsonEntries` 不再读任何 `.cursor/mcp.json` 路径
- [ ] 对 `/Users/suwenguang/work/code`，`loadInlineCcMcpServers` 返回的 `codegraph` args 为 `["serve","--mcp"]`（来自 `.mcp.json`），无 `--path`
- [ ] `~/.claude.json` 的 user `mcpServers` 与 `projects[ws].mcpServers` 正确合并（local 覆盖 user）
- [ ] `{ws}/.mcp.json` 覆盖 `~/.claude.json` 同名 server
- [ ] 文件缺失或解析失败返回空对象（沿用 `readMcpServersBlock` 容错）
- [ ] OAuth known limitation 有注释说明
- [ ] 无 02/03 未要求的抽象层或新依赖（Ponytail）

### 依赖

前置任务：无；后续任务：T2, T5

## T2: CC 路径 session 缓存 + strictMcpConfig + 暴露 session getter

### 背景

CC 引擎需缓存运行时 MCP 状态供 idle 展示，启用 `strictMcpConfig` 让 inline 唯一，并向 T5 暴露按 sessionKey 取 session/activeQuery 的导出。

### 上下文文件

- CodeGraph: `CC_SESSIONS` / `buildQueryOptions` / `handleSdkMessage` — 定位 session 存储与 init 处理
- 必读: `electron/agent-cc-types.ts` — `CcSessionAgent` 结构（加字段）
- 必读: `electron/agent-cc-events.ts` — `handleSdkMessage` init 分支（L97-105，当前只取 session_id/model）
- 必读: `electron/agent-claude-sdk.ts` — `buildQueryOptions`(L79-94)、`CC_SESSIONS`(L37)、`getClaudeCodeSessionList`
- 必读: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `SDKSystemMessage.mcp_servers`(L4089)、`Options.strictMcpConfig`(L1877)、`Query.mcpServerStatus`(L2330)

### 实现范围

- 修改: `electron/agent-cc-types.ts` `CcSessionAgent` 加 `lastMcpServersSnapshot?: Array<{ name: string; status: string; config?: unknown; scope?: string; tools?: unknown[] }>`
- 修改: `electron/agent-cc-events.ts` init 分支 — 除现有 `session_id`/`model` 外，缓存 `msg.mcp_servers` 到 `session.lastMcpServersSnapshot`
- 修改: `electron/agent-claude-sdk.ts` `buildQueryOptions` — 设 `strictMcpConfig: true`；注入后 UI 日志打 `[mcp] inline N servers`（N=Object.keys(mcpServers).length）
- 新增导出: `electron/agent-claude-sdk.ts` `getCcSession(sessionKey): CcSessionAgent | undefined`（读 CC_SESSIONS）；`getCcActiveQuery(sessionKey): Query | null`（取 session.activeQuery）

### 接口契约

- `getCcSession(sessionKey: string): CcSessionAgent | undefined` — 供 T5 取 session 缓存
- `getCcActiveQuery(sessionKey: string): Query | null` — 供 T5 调 `mcpServerStatus()`
- `CcSessionAgent.lastMcpServersSnapshot` 字段定义在 agent-cc-types.ts

### 验收标准

- [ ] `buildQueryOptions` 返回的 options 含 `strictMcpConfig: true`
- [ ] CC Run 启动时 UI 日志含 `[mcp] inline N servers`
- [ ] `system/init` 事件后 `session.lastMcpServersSnapshot` 含 `msg.mcp_servers` 全部条目
- [ ] idle 会话（activeQuery=null）`lastMcpServersSnapshot` 保留上次值不清空
- [ ] `getCcSession`/`getCcActiveQuery` 可被外部模块 import
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T1（strictMcpConfig 依赖 inline 配置源正确）；后续任务：T5

## T3: SDK 路径 session 缓存注入快照 + 暴露 session getter

### 背景

Cursor SDK 无 MCP list/status API，展示只能用「注入的 mcpServers 快照」。本任务在 SDK session 上缓存最后一次注入的 mcpServers，并向 T5 暴露 session getter。不改注入源（仍 `.cursor/mcp.json`）。

### 上下文文件

- CodeGraph: `sdkSessions` / `loadInlineMcpServers` / `buildSendOptions` — 定位 SDK session 存储与注入点
- 必读: `electron/agent-sdk.ts` — `SdkSessionAgent`(L46)、`sdkSessions`(L122)、注入点 L695(`buildSendOptions` 经 `appendInlineMcpToSendOptions`)、L728(`maybeRotateSessionForPressure`)、L1215(`launchSdkAgent`)
- 必读: `electron/mcp-sdk-loader.ts` — `loadInlineMcpServers`/`appendInlineMcpToSendOptions`

### 实现范围

- 修改: `electron/agent-sdk.ts` `SdkSessionAgent` interface 加 `lastInjectedMcpServers?: Record<string, McpServerConfig>`；**export interface SdkSessionAgent**（当前未 export，T5 需引用返回类型）
- 修改: `electron/agent-sdk.ts` 三处注入点 — 将 `loadInlineMcpServers(workspaceDir)` 提取到变量 `const injected = loadInlineMcpServers(ws)`，传入 `Agent.create`/`agent.send` 后回写 `session.lastInjectedMcpServers = injected`（L695 若经 `appendInlineMcpToSendOptions` 则在其返回后回写；L728/L1215 直接调用处回写）
- 新增导出: `electron/agent-sdk.ts` `getSdkSession(sessionKey): SdkSessionAgent | undefined`

### 接口契约

- `getSdkSession(sessionKey: string): SdkSessionAgent | undefined` — 供 T5 取注入快照
- `SdkSessionAgent.lastInjectedMcpServers` 字段（export interface）

### 验收标准

- [ ] `SdkSessionAgent` interface 已 export
- [ ] 三处注入点均回写 `session.lastInjectedMcpServers`
- [ ] SDK 会话 `lastInjectedMcpServers` 与 `loadInlineMcpServers(ws)` 返回一致
- [ ] 注入源仍 `.cursor/mcp.json`（不改 mcp-sdk-loader）
- [ ] `getSdkSession` 可被外部模块 import
- [ ] 无 Ponytail 违规

### 依赖

前置任务：无；后续任务：T5

## T4: mcp-status-map 缓存键加 engineType

### 背景

CC 改源后 idle fallback 走 `cc-mcp-loader` 读盘 probe，与 SDK 读 `.cursor/mcp.json` 配置源不同；同 workspace 切 SDK/CC 会话时缓存键需加 engineType 后缀防串台。

### 上下文文件

- CodeGraph: `resolveWorkspaceKey` / `fetchMcpStatusMap` — 定位缓存键逻辑
- 必读: `electron/mcp-status-map.ts` — `resolveWorkspaceKey`(L11-16)、`McpStatusCache`、`mcpStatusCacheByWs`
- 必读: `electron/mcp-manager.ts` — `getMcpStatusMap(force, workspaceDir)` 调用方

### 实现范围

- 修改: `electron/mcp-status-map.ts` `resolveWorkspaceKey(workspaceDir?, engineType?)` — 缓存键改为 `wsKey + "::" + (engineType ?? "sdk")`（默认 sdk 保持现网兼容）
- 修改: `fetchMcpStatusMap` 签名加 `engineType?` 参数透传；`mcpStatusCacheByWs`/`mcpStatusInflightByWs` Map 键随之变化
- 修改: `electron/mcp-manager.ts` `getMcpStatusMap(force, workspaceDir, engineType?)` 透传 engineType

### 接口契约

- `resolveWorkspaceKey(workspaceDir?: string, engineType?: string): string` — 新增可选参数
- `fetchMcpStatusMap(force, servers, ws, engineType?)` — 新增可选参数
- `getMcpStatusMap(force, workspaceDir?, engineType?)` — 新增可选参数

### 验收标准

- [ ] 同 workspace 不同 engineType 缓存键不同（`ws::sdk` vs `ws::claude-code`）
- [ ] 不传 engineType 时默认 `sdk`，现网 SDK 路径行为不变
- [ ] `invalidateMcpStatusCache()` 仍清空全部（行为不变）
- [ ] 无 Ponytail 违规

### 依赖

前置任务：无；后续任务：T5

## T5: 新建 session-mcp-status.ts 取数器

### 背景

展示层需按 sessionKey + engineType 取运行时 MCP 状态。CC 优先 `query.mcpServerStatus()`，idle 用 session 缓存，无 session fallback 读盘；SDK 用注入快照 + probe。本任务聚合 T1-T4 的能力。

### 上下文文件

- CodeGraph: `getSessionMcpStatus`（新建，无现网）— 用 `codegraph_context` 查 `mcp-manager.getMcpServerListForWorkspace` 参考 entry 构建模式
- 必读: `electron/cc-mcp-loader.ts`（T1 后）— `loadInlineCcMcpServers`/`readClaudeJsonMcpServers` 供 fallback 读盘
- 必读: `electron/agent-claude-sdk.ts`（T2 后）— `getCcSession`/`getCcActiveQuery`
- 必读: `electron/agent-sdk.ts`（T3 后）— `getSdkSession`/`SdkSessionAgent.lastInjectedMcpServers`
- 必读: `electron/mcp-status-map.ts`（T4 后）— `fetchMcpStatusMap` with engineType
- 必读: `electron/mcp-types.ts` — `McpServerEntry` 类型
- 参考: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `McpServerStatus`(L1014)、`Query.mcpServerStatus`(L2330)

### 实现范围

- 新建: `electron/session-mcp-status.ts`（≤200 行）导出 `getSessionMcpStatus(sessionKey)`：
  1. 先试 `getCcSession(sessionKey)` → engineType=`claude-code`：
     - 有 `activeQuery` → `try { const status = await query.mcpServerStatus(); return { servers: mapStatusToEntries(status), statusMap: mapStatusToMap(status), source: "runtime" } } catch { 落到 snapshot }`
     - 有 `lastMcpServersSnapshot` → `return { servers: mapSnapshotToEntries(...), statusMap: ..., source: "snapshot" }`
     - 否则 fallback `cc-mcp-loader` 读盘 → `source: "disk"`
  2. 否则试 `getSdkSession(sessionKey)` → engineType=`sdk`：
     - 取 `session.lastInjectedMcpServers` → 转 `McpServerEntry[]`；状态调 `fetchMcpStatusMap(false, servers, ws, "sdk")` → `source: "runtime"`
  3. 无 session → 抛错或返回空 `{ servers: [], statusMap: {}, source: "disk" }`
- 新建: 私有 helper `mapStatusToEntries`/`mapSnapshotToEntries`/`mapInjectedToEntries`（McpServerStatus/快照/inline → McpServerEntry[]）

### 接口契约

- `getSessionMcpStatus(sessionKey: string): Promise<AgentMcpStatusResult>`
- `AgentMcpStatusResult = { servers: McpServerEntry[]; statusMap: Record<string, string>; source: "runtime" | "snapshot" | "disk" }`（类型可定义在本文件或 mcp-types.ts）

### 验收标准

- [ ] CC activeQuery 时 `source:"runtime"`，servers 来自 `mcpServerStatus()`
- [ ] CC idle 时 `source:"snapshot"`，servers 来自 `lastMcpServersSnapshot`
- [ ] CC 无 session 时 `source:"disk"`，servers 来自 `cc-mcp-loader`
- [ ] SDK 会话 `source:"runtime"`，servers 来自 `lastInjectedMcpServers`
- [ ] `mcpServerStatus()` 抛错时优雅降级到 snapshot（不 crash）
- [ ] 文件 ≤ 200 行
- [ ] 无 Ponytail 违规（session-mcp-status.ts 已在 02 §2 论证必要）

### 依赖

前置任务：T1, T2, T3, T4；后续任务：T6

## T6: 端点层 + 渲染层 IPC + UI dispatch + emptyHint

### 背景

把 T5 的取数器暴露为 IPC，并在 `SessionMcpPanel` 按 engineType dispatch，修正 CC emptyHint 配置源文案。

### 上下文文件

- CodeGraph: `mcp:list-for-workspace` IPC / `SessionMcpPanel.loadMcp` — 定位现有 IPC 与 UI dispatch 点
- 必读: `electron/main.ts` — `registerIpcHandlers` 内 `mcp:*` handler（L204-219）参考新增 `agent:mcp-status`
- 必读: `electron/preload.ts` — `listMcpForWorkspace`/`getMcpStatusMap`(L258-266) 参考新增 `getAgentMcpStatus`
- 必读: `src/renderer/env.d.ts` — `ElectronAPI` MCP 方法签名（L224-232）
- 必读: `src/renderer/components/SessionMcpPanel.tsx` — `loadMcp`(L60-75)、props（L15-21 已含 sessionKey/engineType）
- 必读: `src/renderer/lib/mcp-view-strategy.ts` — `getMcpViewConfig` CC emptyHint（L27-35）
- 必读: `electron/session-mcp-status.ts`（T5 后）— `getSessionMcpStatus` 签名

### 实现范围

- 修改: `electron/main.ts` 新增 `ipcMain.handle("agent:mcp-status", (_, sessionKey) => getSessionMcpStatus(sessionKey))`；import `getSessionMcpStatus`
- 修改: `electron/preload.ts` 新增 `getAgentMcpStatus: (sessionKey: string) => Promise<AgentMcpStatusResult> => ipcRenderer.invoke("agent:mcp-status", sessionKey)`
- 修改: `src/renderer/env.d.ts` `ElectronAPI` 新增 `getAgentMcpStatus(sessionKey: string): Promise<AgentMcpStatusResult>` 签名
- 修改: `src/renderer/components/SessionMcpPanel.tsx` `loadMcp` — 按 `engineType` dispatch：`claude-code`/`sdk` 调 `window.electronAPI.getAgentMcpStatus(sessionKey)`；`codex` 保持 `viewConfig.supported=false` 占位不动；移除对 `listMcpForWorkspace`/`getMcpStatusMap` 的直接调用（CC/SDK 路径）
- 修改: `src/renderer/lib/mcp-view-strategy.ts` CC emptyHint 改为：有 ws `暂无 MCP 配置。可编辑 ~/.claude.json 或 ${ws}/.mcp.json。`；usingFallback `暂无 MCP 配置。可编辑 ~/.claude.json，或在主工作区 ${ws}/.mcp.json 添加。`；SDK 保持 `.cursor/mcp.json` 不变

### 接口契约

- IPC `agent:mcp-status(sessionKey) => Promise<AgentMcpStatusResult>`
- `ElectronAPI.getAgentMcpStatus(sessionKey): Promise<AgentMcpStatusResult>`

### 验收标准

- [ ] CC 会话展开 MCP 面板调 `agent:mcp-status`，列表来自运行时/snapshot/disk
- [ ] SDK 会话展开调 `agent:mcp-status`，列表来自注入快照
- [ ] codex 会话仍显示占位文案，不 crash（验收6）
- [ ] CC emptyHint 显示 `~/.claude.json`/`.mcp.json`，不含 `.cursor`
- [ ] SDK emptyHint 保持 `.cursor/mcp.json` 不变
- [ ] `npm run build` 通过
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T5；后续任务：无

## 3、修复任务（kb-review 产出）

> **来源**：`/kb-review`（基于 `04-review.md` §3 警告 R1–R7 与 §8 修复任务建议）。修复完成后重新运行 `/kb-review` 复评。

## T-FIX-1: T5 snapshot 路径读盘补 config

### 背景

CC idle 时 `lastMcpServersSnapshot` 来自 `SDKSystemMessage.mcp_servers`，类型 `{name,status}[]` 不含 `config`。T5 走 `mapSnapshotToEntries` → `toEntry(s.name, s.config ?? {}, ...)` → `cfg={}` → command/args=`undefined` → UI L169 渲染 `"undefined "`。常见触发场景：CC 会话 idle + 展开 MCP 面板。

### 上下文文件

- 必读: `electron/session-mcp-status.ts` — `mapSnapshotToEntries` / `toEntry`（snapshot 分支）
- 必读: `electron/cc-mcp-loader.ts` — `loadInlineCcMcpServers(workspaceDir)` 读盘补 config
- 必读: `electron/agent-cc-types.ts` — `CcSessionAgent.lastMcpServersSnapshot` 字段与 `workspaceDir`
- 必读: `src/renderer/components/SessionMcpPanel.tsx` L169 — command/args 渲染点

### 实现范围

- 修改: `electron/session-mcp-status.ts` snapshot 分支 — 在 `mapSnapshotToEntries` 前调 `loadInlineCcMcpServers(ccSession.workspaceDir)` 读盘，按 `name` 匹配合并 `config`；或退化路径：snapshot 缺 config 时只显示 name+status，不渲染 command 行（`toEntry` 收到 `cfg=null` 时返回不携带 command/args 的 entry）。

### 接口契约

- `getSessionMcpStatus` 签名不变；`mapSnapshotToEntries` 内部合并逻辑不暴露新 API。

### 验收标准

- [ ] CC idle 会话展开 MCP 面板，列表项 command/args 不再显示 `"undefined"`
- [ ] snapshot 缺 config 时读盘补全；读盘也缺失则降级只显示 name+status
- [ ] 读盘失败不抛错，落到降级展示
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T5；后续任务：无

## T-FIX-2: T5 加 CC status 枚举→UI 词汇映射

### 背景

CC runtime/snapshot status 枚举 `connected/failed/needs-auth/pending/disabled` 与 UI 期望 `ready/enabled/disabled/needs_login` 不匹配。`connected` 不命中 `isReady` 走红色；`needs-auth`（连字符）不匹配 `needs_login` → CC URL 型 MCP 缺授权时**永远不显示授权按钮**。

### 上下文文件

- 必读: `electron/session-mcp-status.ts` — `buildStatusMap` / `mapStatusToEntries` / `mapSnapshotToEntries`
- 必读: `src/renderer/components/SessionMcpPanel.tsx` L149-151, L172 — `isReady` / `needs_login` 判定
- 参考: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` `McpServerStatus` L1014

### 实现范围

- 修改: `electron/session-mcp-status.ts` — 在 `buildStatusMap` / `mapStatusToEntries` / `mapSnapshotToEntries` 入口加 CC 枚举→UI 词汇映射函数：`connected→ready`、`needs-auth→needs_login`、`failed→原错误文案`、`pending→加载中`、`disabled→disabled`。

### 接口契约

- 内部 helper `mapCcStatusToUi(status: string): string`，不暴露新 public API。

### 验收标准

- [ ] CC `connected` 在 UI 显示为 ready（绿色）
- [ ] CC `needs-auth` 命中 `needs_login`，显示授权按钮
- [ ] CC `failed` / `pending` 文案不丢错误信息
- [ ] SDK 路径 status 映射不受影响
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T5；后续任务：无

## T-FIX-3: force 参数端到端透传

### 背景

`SessionMcpPanel.loadMcp(_force=false)` 参数未使用，IPC `agent:mcp-status` 也无 force。刷新按钮 / `loginMcp` 后 `loadMcp(true)` 的 `true` 被丢弃。SDK 路径 `fetchMcpStatusMap(false,...)` 永远 `force=false` → 30s 内刷新无效。CC runtime 路径无缓存刷新有效，故只影响 SDK。

### 上下文文件

- 必读: `src/renderer/components/SessionMcpPanel.tsx` L64, L107, L125 — `loadMcp` 调用点
- 必读: `electron/session-mcp-status.ts` L112 — `fetchMcpStatusMap` 调用
- 必读: `electron/main.ts` — `agent:mcp-status` IPC handler
- 必读: `electron/preload.ts` — `getAgentMcpStatus` 暴露
- 必读: `src/renderer/env.d.ts` — `ElectronAPI.getAgentMcpStatus` 签名

### 实现范围

- 修改: `electron/session-mcp-status.ts` — `getSessionMcpStatus(sessionKey, force?)` 透传 force 给 `fetchMcpStatusMap`
- 修改: `electron/main.ts` — IPC `agent:mcp-status(sessionKey, force?)`
- 修改: `electron/preload.ts` — `getAgentMcpStatus(sessionKey, force?)`
- 修改: `src/renderer/env.d.ts` — `ElectronAPI.getAgentMcpStatus(sessionKey, force?)` 签名
- 修改: `src/renderer/components/SessionMcpPanel.tsx` — `loadMcp(force)` 透传给 `getAgentMcpStatus`

### 接口契约

- `getSessionMcpStatus(sessionKey: string, force?: boolean): Promise<AgentMcpStatusResult>`
- IPC `agent:mcp-status(sessionKey, force?) => Promise<AgentMcpStatusResult>`
- `ElectronAPI.getAgentMcpStatus(sessionKey: string, force?: boolean): Promise<AgentMcpStatusResult>`

### 验收标准

- [ ] SDK 会话刷新按钮点击后 30s 内列表更新（force=true 命中 `fetchMcpStatusMap(true,...)`)
- [ ] `loginMcp` 后刷新生效
- [ ] 不传 force 时默认 false，现网行为不变
- [ ] CC runtime 路径不受影响
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T5, T6；后续任务：无

## T-FIX-4: getSessionMcpStatus 加 engineType hint + CC 无 session 读盘 fallback

### 背景

`02-design.md` 一·(一) mermaid 标注 `Q -->|无session| FB[cc-mcp-loader读盘]`，意图 CC 会话无 session 也读盘展示。实现把读盘分支放在 `if (ccSession)` 块内，`ccSession===undefined` 时跳过整个 CC 块落到空态。UI `engineType=claude-code` 但 session 销毁竞态时显示空列表而非已配置 MCP。

### 上下文文件

- 必读: `electron/session-mcp-status.ts` L84-117 — CC/SDK 分支结构
- 必读: `electron/cc-mcp-loader.ts` — `loadInlineCcMcpServers(workspaceDir)` 读盘
- 必读: `electron/main.ts` — `agent:mcp-status` IPC handler
- 必读: `electron/preload.ts` — `getAgentMcpStatus` 暴露
- 必读: `src/renderer/env.d.ts` — `ElectronAPI.getAgentMcpStatus` 签名
- 必读: `src/renderer/components/SessionMcpPanel.tsx` — `loadMcp` 已含 `engineType` props
- 参考: `02-design.md` 一·(一) mermaid

### 实现范围

- 修改: `electron/session-mcp-status.ts` — `getSessionMcpStatus(sessionKey, force?, engineType?)` 增加 engineType hint 参数；在 CC 块前加 `if (!ccSession && !sdkSession && engineType === "claude-code")` 读盘 fallback 分支（需 workspaceDir，由调用方或 hint 携带）
- 修改: `electron/main.ts` — IPC `agent:mcp-status(sessionKey, force?, engineType?)` 透传
- 修改: `electron/preload.ts` — `getAgentMcpStatus(sessionKey, force?, engineType?)`
- 修改: `src/renderer/env.d.ts` — 签名加 engineType
- 修改: `src/renderer/components/SessionMcpPanel.tsx` — `loadMcp` 调用时携带 `engineType` props

### 接口契约

- `getSessionMcpStatus(sessionKey: string, force?: boolean, engineType?: string): Promise<AgentMcpStatusResult>`
- IPC / preload / env.d.ts 同步透传 engineType

### 验收标准

- [ ] CC 会话 session 销毁竞态时（`ccSession===undefined` 且 `engineType==="claude-code"`）走读盘 fallback，`source:"disk"`
- [ ] SDK / codex 路径不受影响
- [ ] 不传 engineType 时行为与现状一致（向后兼容）
- [ ] 与 `02-design.md` 一·(一) mermaid 对齐
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T5, T6；后续任务：无

## T-FIX-5: T2 init 快照浅拷贝

### 背景

`session.lastMcpServersSnapshot = msg.mcp_servers` 直接引用 SDK 数组，未浅拷贝。SDK 内部若复用 message buffer 会污染 idle 面板展示。

### 上下文文件

- 必读: `electron/agent-cc-events.ts` L104 — init 分支快照赋值
- 必读: `electron/agent-cc-types.ts` — `lastMcpServersSnapshot` 字段结构（含 `config`/`tools`）

### 实现范围

- 修改: `electron/agent-cc-events.ts` L104 — 改为 `msg.mcp_servers.map(s => ({ ...s, config: s.config ? { ...s.config } : s.config, tools: s.tools ? [...s.tools] : s.tools }))`

### 接口契约

- 字段结构不变，仅赋值改为浅拷贝。

### 验收标准

- [ ] `lastMcpServersSnapshot` 与 `msg.mcp_servers` 不是同一引用
- [ ] `config` / `tools` 嵌套结构浅拷贝
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T2；后续任务：无

## T-FIX-6: agent-claude-sdk.ts 抽 agent-cc-session-registry.ts 控行数

### 背景

`electron/agent-claude-sdk.ts` 由 297 行增至 313 行（本次 +16），新引入 `strictMcpConfig` + UI 日志 + `getCcSession`/`getCcActiveQuery` 推过 300。AGENTS.md「代码文件不得超过 300 行」「超过 300 必须用设计模式重构」。

### 上下文文件

- 必读: `electron/agent-claude-sdk.ts` — `CC_SESSIONS`、`getClaudeCodeSessionList`、`getCcSession`、`getCcActiveQuery`、`buildQueryOptions`
- 必读: `electron/agent-cc-types.ts` — `CcSessionAgent` 类型
- 参考: 既有 `agent-cc-types` / `agent-cc-events` / `agent-cc-stream` / `agent-cc-http` 拆分风格

### 实现范围

- 新建: `electron/agent-cc-session-registry.ts` — 承接 `CC_SESSIONS` Map 与 `getClaudeCodeSessionList` / `getCcSession` / `getCcActiveQuery` 导出
- 修改: `electron/agent-claude-sdk.ts` — 移除上述导出，改为从 `agent-cc-session-registry.ts` re-export 或直接由消费者 import 新文件；`buildQueryOptions` 等保留

### 接口契约

- `getCcSession` / `getCcActiveQuery` / `getClaudeCodeSessionList` 签名不变，仅落点文件迁移
- `agent-claude-sdk.ts` 行数 ≤ 300

### 验收标准

- [ ] `agent-claude-sdk.ts` 行数 ≤ 300
- [ ] `agent-cc-session-registry.ts` 行数 ≤ 300
- [ ] `getCcSession` / `getCcActiveQuery` / `getClaudeCodeSessionList` 可从新文件 import
- [ ] `session-mcp-status.ts` 等消费者 import 路径更新无回归
- [ ] `npm run build` 通过
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T2；后续任务：无

## T-FIX-7: env.d.ts 抽 types/mcp.d.ts 控行数

### 背景

`src/renderer/env.d.ts` 由 297 行增至 306 行（本次 +9），新引入 `AgentMcpStatusResult` interface + `getAgentMcpStatus` 签名推过 300。AGENTS.md「代码文件不得超过 300 行」。

### 上下文文件

- 必读: `src/renderer/env.d.ts` — `McpServerEntry` / `AgentMcpStatusResult` interface 与 `ElectronAPI.getAgentMcpStatus` 签名
- 必读: `src/renderer/components/SessionMcpPanel.tsx` — 消费 `AgentMcpStatusResult` / `McpServerEntry`

### 实现范围

- 新建: `src/renderer/types/mcp.d.ts` — 承接 `McpServerEntry` / `AgentMcpStatusResult` interface 定义
- 修改: `src/renderer/env.d.ts` — 顶部加 `/// <reference path="./types/mcp.d.ts" />`，移除上述 interface 本体；`ElectronAPI.getAgentMcpStatus` 签名保留（依赖 reference 引入类型）

### 接口契约

- `McpServerEntry` / `AgentMcpStatusResult` 类型对外可见性不变
- `env.d.ts` 行数 ≤ 300

### 验收标准

- [ ] `env.d.ts` 行数 ≤ 300
- [ ] `types/mcp.d.ts` 行数 ≤ 300
- [ ] `SessionMcpPanel.tsx` 等 TS 编译通过（类型经 reference 解析）
- [ ] `npm run build` 通过
- [ ] 无 Ponytail 违规

### 依赖

前置任务：T6；后续任务：无
