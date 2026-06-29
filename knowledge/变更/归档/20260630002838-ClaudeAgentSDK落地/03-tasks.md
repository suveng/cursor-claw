# Claude Agent SDK 落地 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### （一）依赖图

```
T1 ──→ T2 ──┐
T1 ──→ T5 ──┼──→ T4 ──→ T3 ──→ T7
T1 ──→ T6 ──┘              └──→ T8
```

- **T1** 为 npm 依赖基线，解除 `@anthropic-ai/claude-agent-sdk` 类型与 lockfile 阻塞。
- **T2 / T5 / T6** 在 T1 完成后可并行：MCP 加载器、类型+二进制工具、打包配置互不写同一文件。
- **T4** 依赖 **T5**（`CcSessionAgent.activeQuery` 类型已就绪）。
- **T3** 集成 **T2+T4+T5+T6**，为唯一重写 `agent-claude-sdk.ts` 的任务。
- **T7 / T8** 在 **T3** 完成后串行或并行（T8 可选，建议 T7 先落文档约定）。

### （二）分组调度

- **第一轮（并行）**: T1
- **第二轮（并行）**: T2, T5, T6（均依赖 T1）
- **第三轮**: T4（依赖 T5）
- **第四轮**: T3（依赖 T2, T4, T5, T6）
- **第五轮（并行）**: T7, T8（均依赖 T3；T8 可选）

---

## 2、任务清单

<!-- 以下每条任务自包含；子 agent 执行时只读单条 T{n} + 上下文文件 -->

---

## T1: 依赖迁移 package.json

### 背景

Claude 执行路径须从 `@anthropic-ai/claude-code` CLI 包迁移至官方 `@anthropic-ai/claude-agent-sdk` 库调用（对应设计 P-17）。本任务仅改依赖声明与 lockfile，为后续 TypeScript 实现提供 SDK 类型与平台 optional 包解析基础，不涉及业务代码改动。

### 上下文文件

- 必读: `package.json` — 当前 `@anthropic-ai/claude-code` 位于 `dependencies`
- 必读: `package-lock.json` — 确认移除旧包、解析新 optional 平台包
- 参考: `electron/agent-sdk.ts` L616-648 — `@cursor/sdk-${platform}-${arch}` optional dep 模式（对称参考）
- 参考: `@anthropic-ai/claude-agent-sdk` npm 文档 — 确认 optional 平台包命名（如 `claude-agent-sdk-darwin-arm64`）

### 实现范围

- 修改: `package.json` — `dependencies` 移除 `@anthropic-ai/claude-code`；新增 `@anthropic-ai/claude-agent-sdk`（版本以 npm 最新稳定为准）；按 SDK 文档添加平台 optional dependencies（darwin-arm64/x64、win32-x64、linux-x64 等）
- 修改: `package-lock.json` — 运行 `npm install` 后提交 lockfile 变更
- 不改: 任何 `electron/` 源码（留给 T3～T5）

### 接口契约

- `package.json` 中 **不得** 再含 `@anthropic-ai/claude-code`
- `node_modules/@anthropic-ai/claude-agent-sdk` 可 resolve；当前平台 optional 包存在于 lockfile
- 下游 T2～T6 可 `import { query } from "@anthropic-ai/claude-agent-sdk"`（或 SDK 实际导出路径）

### 验收标准

- [ ] `npm install` 无报错
- [ ] `rg '@anthropic-ai/claude-code' package.json package-lock.json` 无命中
- [ ] `rg '@anthropic-ai/claude-agent-sdk' package.json` 有命中
- [ ] lockfile 含当前开发平台 optional 包条目
- [ ] 覆盖 01 验收 6、7 的依赖前提（无双轨 CLI dep）
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: 无
- 后续任务: T2, T3, T4, T5, T6

---

## T2: 新建 cc-mcp-loader.ts

### 背景

01 验收 4 要求 Claude Run 可注入已配置 MCP 服务。Cursor SDK 路径已有 `mcp-sdk-loader.ts` 读取 `~/.cursor/mcp.json` 与 workspace `.cursor/mcp.json` 并合并 OAuth；Claude Agent SDK 路径需对称模块，在每次 `query()` 时 inline 传入 `mcpServers`（SDK 不持久化 MCP 配置，对称 Cursor `agent.send` 每次重传）。

### 上下文文件

- 必读: `electron/mcp-sdk-loader.ts` — 完整文件（合并逻辑、stdio 相对路径 resolve、HTTP OAuth 模板）
- 必读: `electron/mcp-project-dir.ts` — `readMcpAuthStore`、`McpAuthEntry` 类型
- 参考: `electron/agent-sdk.ts` — 搜索 `loadInlineMcpServers`、`appendInlineMcpToSendOptions` 调用点（对称用法）
- CodeGraph: `loadInlineMcpServers` — 定位 Cursor MCP 注入调用链

### 实现范围

- 新建: `electron/cc-mcp-loader.ts` — 仿 `mcp-sdk-loader.ts` 结构，输出 Claude Agent SDK 的 `McpServerConfig` 类型（以 `@anthropic-ai/claude-agent-sdk` 导出为准，非 `@cursor/sdk`）
- 实现: `mergeMcpJsonEntries(workspaceDir)` — 复用/global+project 合并语义（project 覆盖 global）
- 实现: stdio command/args 相对路径 resolve（`workspaceDir` 为 cwd，与 mcp-sdk-loader 规则一致）
- 实现: HTTP/sse remote 配置 + `mcp-auth.json` OAuth Bearer 合并
- 不改: `agent-claude-sdk.ts`（T3 集成）

### 接口契约

- `export function loadInlineCcMcpServers(workspaceDir: string): Record<string, McpServerConfig>` — 返回 SDK 可用的 inline MCP 表
- `export function appendInlineMcpToCcOptions<T extends { mcpServers?: Record<string, McpServerConfig> }>(options: T, workspaceDir?: string): T` — 合并 `mcpServers` 至 `query()` options；`workspaceDir` 空时仅读 global
- 模块 **不** import `agent-claude-sdk` / `agent-cc-*`（避免循环依赖）

### 验收标准

- [ ] TypeScript 编译通过；文件 ≤300 行
- [ ] disabled server、HTTP OAuth、stdio 相对路径三类配置均有单元路径可手动验证（实现注释标明测试方式）
- [ ] 与 `mcp-sdk-loader.ts` 合并优先级一致（project 覆盖 global）
- [ ] 覆盖 01 验收 4、02 八·（二）MCP stdio + HTTP OAuth 各一条的前提
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T1
- 后续任务: T3

---

## T3: 重写 agent-claude-sdk.ts 核心

### 背景

Claude 执行核心须用 `@anthropic-ai/claude-agent-sdk` 的 `query()`（及可选 `startup()` 预暖）替换 `spawn` + `buildSpawnArgs`（P-4～P-6、P-12）。保留 `launchClaudeCodeAgent` / `dispatchToClaudeCodeAgent` / stop 系列 **对外签名不变**，HTTP handler 注入模式不变；`agent-cc-http.ts` **不得修改**。processing 判定由 `child !== null` 改为 `activeQuery !== null || pendingDispatch`。

### 上下文文件

- 必读: `electron/agent-claude-sdk.ts` — 完整现有实现（spawn、buildSpawnArgs、buildSpawnEnv、dispatch、stop）
- 必读: `electron/agent-cc-types.ts` — T5 完成后 `CcSessionAgent`（含 `activeQuery`）
- 必读: `electron/agent-cc-events.ts` — T4 完成后 `streamCcSdkMessages` 导出
- 必读: `electron/cc-mcp-loader.ts` — T2 完成后 MCP 合并 API
- 必读: `electron/agent-cc-utils.ts` — T5 完成后 `ensureCcAgentBinaryPaths`、`resolveCcAgentBinaryPath`
- 必读: `electron/agent-sdk.ts` — 对称参考：`launchSdkAgent`、`dispatchToSdkAgent`、`ensureSdkBinaryPaths` 调用时机、`presentationOrderingEligible` / `PRESENTATION_ORDERING` 模式（设计 P-8）
- 必读: `electron/agent-cc-stream.ts` — `completeCcRun`、`flushStreamPost` 出站 API（不改签名）
- 必读: `electron/agent-run-guard.ts`、`electron/context-rotation-lite.ts` — guard 与 ccSessionId 轮转（行为不变）
- 参考: `electron/agent-cc-http.ts` — 确认 handler 注入接口未变

### 实现范围

- 修改: `electron/agent-claude-sdk.ts` —
  - 删除: `import { spawn }`、`buildSpawnArgs`、`buildSpawnEnv`、`getCcBinaryPath` 引用及全部 spawn 逻辑
  - launch/dispatch: 构建 `query({ prompt, options })` — 含 `model`、`resume: ccSessionId`、`env`（`ANTHROPIC_API_KEY`、有 baseUrl 时 `ANTHROPIC_BASE_URL`、无 baseUrl 时显式 delete 继承）、`pathToClaudeCodeExecutable: resolveCcAgentBinaryPath()`、`mcpServers: loadInlineCcMcpServers(workspaceDir)`（经 `appendInlineMcpToCcOptions`）
  - 每次 query 前调用 `ensureCcAgentBinaryPaths()`
  - 调用 T4 的 `streamCcSdkMessages(session, queryIterator, opts)` 替代 `streamCcEvents(session, child, opts)`
  - 可选: `startup()` 在 `ensureClaudeCodeHttpServer` 或首 launch 前预暖（对称 `SDK_RESIDENT_AGENT`；由 `CC_RESIDENT_AGENT` / `ccResidentModeEnabled()` 控制）
  - `stopClaudeCodeSession` / watchdog 超时: `activeQuery.close()` 或 abort，不再 `child.kill`
  - `isClaudeCodeSessionRunning`: `activeQuery !== null || pendingDispatch`
  - `getClaudeCodeSessionList`: `pid` 字段可恒为 0 或移除 spawn pid 语义（保持返回形状兼容 `daemon-manager.ts`）
  - resident idle 判定: `!activeQuery` 替代 `!child`
  - 补 CC 路径 `PRESENTATION_ORDERING` / `presentationOrderingEligible`（复用 agent-sdk 模式或等价 inline，确保 p2p+f41 时 tool/thinking 不抢 stream-text 首包）
- 不改: `electron/agent-cc-http.ts` 路由与 body 契约

### 接口契约

- `export async function launchClaudeCodeAgent(opts: ClaudeCodeLaunchOptions): Promise<{ ok: boolean; error?: string }>` — 签名不变
- `export async function dispatchToClaudeCodeAgent(sessionKey, taskText, messageIds?): Promise<{ ok: boolean; error?: string }>` — 签名不变；idle resident 用 `options.resume=ccSessionId`
- `export function stopClaudeCodeSession(sessionKey: string): void` — 中止 active Query
- `export function stopAllClaudeCodeSessions(): void`
- `export function isClaudeCodeSessionRunning(sessionKey: string): boolean`
- `export function getClaudeCodeSessionList(): Array<{ sessionKey; chatType; startedAt; chatName?; pid: number }>`
- 模块末尾 `registerCcLaunchHandler` / `registerCcDispatchHandler` 保持不变

### 验收标准

- [ ] `npm run dev` 下 Claude Profile IM launch → 收到流式回复（01 验收 1）
- [ ] launch → complete → dispatch 续跑上下文连贯（01 验收 5；`CC_RESIDENT_AGENT=0` 与默认 resident 均测）
- [ ] thinking / tool / stream-text 三类流式在通道可展示（01 验收 2）
- [ ] 至少一个 MCP 工具在 Claude Run 可调用（01 验收 4）
- [ ] 代码无 `spawn(`、`buildSpawnArgs` 残留
- [ ] `agent-cc-http.ts` diff 为空
- [ ] 文件 ≤300 行，超限须拆至 sibling 模块
- [ ] 覆盖 02 八·（二）resident 双模式链路
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T1, T2, T4, T5, T6
- 后续任务: T7, T8

---

## T4: 重写 agent-cc-events.ts 事件映射

### 背景

事件源从 CLI stdout stream-json（`parseCcEvent` / `streamCcEvents`）切换为 Claude Agent SDK 的 `SDKMessage` async iterator（P-7、P-10、P-12）。保留现有 `handleCcEvent` 的 Presentation 语义与 `agent-cc-stream.ts` 出站契约；Run 完成由 iterator 结束触发 `completeCcRun`，不再依赖子进程 `close` 事件。

### 上下文文件

- 必读: `electron/agent-cc-events.ts` — 现有 `handleCcEvent`、`streamCcEvents`、`parseCcEvent`、`armCcWatchdog`
- 必读: `electron/agent-cc-stream.ts` — `appendStreamDelta`、`postPresentationEvent`、`completeCcRun`、`markProcessEventSeen`
- 必读: `electron/agent-cc-types.ts` — T5 完成后 `CcSessionAgent`
- 必读: `electron/agent-sdk.ts` — 搜索 `handleSdkEvent` 中 assistant/thinking/tool/result 映射（对称参考）
- 参考: `@anthropic-ai/claude-agent-sdk` 类型定义 — `SDKMessage` 各 variant（assistant、tool、thinking、system/init、result 等）

### 实现范围

- 修改: `electron/agent-cc-events.ts` —
  - 新增: `export function streamCcSdkMessages(session, queryIterator, opts): void`（或 async 等价）— 遍历 SDK 消息流
  - 映射: `SDKAssistantMessage` delta → 现有 text/thinking 处理；tool 事件 → `handleCcEvent` tool 分支；`system/init` 或等价消息写入 `session.ccSessionId`
  - 保留: `armCcWatchdog`、`handleCcEvent` 核心 Presentation 逻辑（可 inline 调整入参类型）
  - 删除: `parseCcEvent`、`streamCcEvents`、所有 stream-json 类型与 `ChildProcess` stdout/stderr 监听
  - iterator 正常结束 / 异常 → 调用 opts.completeCcRun（exitCode 语义改为 0 / 非 0 或 null）
- 不改: `electron/agent-cc-stream.ts` 对外函数签名

### 接口契约

- `export function streamCcSdkMessages(session: CcSessionAgent, queryIterator: AsyncIterable<SDKMessage>, opts: StreamCcSdkMessagesOptions): void`
  - `opts` 含: `resolveChannelType`、`markActivity`、`completeCcRun`（与现 `StreamCcEventsOptions` 对齐）
- `export function armCcWatchdog(session, token, opts)` — 签名保持，内部不再假设 `child` 存在
- `handleCcEvent` — 若仍 export，签名可对 SDK 事件类型做窄化；T3 仅依赖 `streamCcSdkMessages`

### 验收标准

- [ ] 无 `stream-json`、`parseCcEvent`、`streamCcEvents` 导出或引用
- [ ] `system/init.session_id`（或 SDK 等价字段）正确写入 `session.ccSessionId` 供 resume（01 验收 5）
- [ ] tool/thinking/assistant 事件顺序与迁移前 Presentation 行为一致（01 验收 2）
- [ ] Run 结束时 `completeCcRun` 被调用一次（resident 模式保留 Map 条目语义不变）
- [ ] 文件 ≤300 行
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T1, T5
- 后续任务: T3

---

## T5: 更新 agent-cc-types 与 agent-cc-utils

### 背景

数据结构须移除 `ChildProcess` 依赖，新增 SDK `Query` 句柄（P-5）；二进制解析从 CLI `getCcBinaryPath` 改为 SDK 平台包 `pathToClaudeCodeExecutable`（P-13 前半，对称 `ensureSdkBinaryPaths`）。本任务为 T3/T4 提供类型与路径工具，不触碰 launch 主流程。

### 上下文文件

- 必读: `electron/agent-cc-types.ts` — 现有 `CcSessionAgent.child: ChildProcess`
- 必读: `electron/agent-cc-utils.ts` — `getCcBinaryPath`、`resolveCcBinaryPath`（L23-51）
- 必读: `electron/agent-sdk.ts` L616-648 — `ensureSdkBinaryPaths` 候选路径与 asar.unpacked 替换逻辑
- 参考: `@anthropic-ai/claude-agent-sdk` — `Query` 类型导出

### 实现范围

- 修改: `electron/agent-cc-types.ts` —
  - 删除: `import type { ChildProcess }`、`child: ChildProcess | null`
  - 新增: `activeQuery: Query | null`（或 SDK 等价 abort 句柄类型）
  - 更新字段注释：`ccSessionId` 来自 SDK init/result，非 CLI `--resume`
- 修改: `electron/agent-cc-utils.ts` —
  - 删除: `getCcBinaryPath`、`resolveCcBinaryPath` 及 CLI 相关注释
  - 新增: `ensureCcAgentBinaryPaths(): void` — 解析 `@anthropic-ai/claude-agent-sdk-${platform}-${arch}` 内 Claude Code 可执行文件，设置 SDK 所需 env 或返回路径（对称 ensureSdkBinaryPaths；asar 路径须 `.asar` → `.asar.unpacked`）
  - 新增: `resolveCcAgentBinaryPath(): string` — 供 `query()` options.pathToClaudeCodeExecutable
  - 保留: `f41Eligible`、`ccResidentModeEnabled`、`resetCcRunPresentationState`、`setWatchdogState`、`markSessionActivity` 等

### 接口契约

- `CcSessionAgent.activeQuery: Query | null` — T3/T4 读写
- `export function ensureCcAgentBinaryPaths(): void` — T3 每次 query 前调用
- `export function resolveCcAgentBinaryPath(): string` — T3 传入 query options
- **不再导出** `getCcBinaryPath` / `resolveCcBinaryPath`

### 验收标准

- [ ] `agent-cc-types.ts` 无 `ChildProcess` import
- [ ] `rg 'getCcBinaryPath|resolveCcBinaryPath' electron/` 仅命中本任务删除前的历史（任务完成后无命中）
- [ ] dev 环境 `resolveCcAgentBinaryPath()` 返回 exists 路径（或明确 WARN 日志）
- [ ] 两文件合计逻辑清晰，单文件 ≤300 行
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T1
- 后续任务: T3, T4

---

## T6: Electron 打包配置

### 背景

macOS 打包版须在 asar 内解包 Claude Agent SDK 平台二进制，使用户无需本机预装 `claude` CLI（P-13、01 验收 6、F6）。对称现有 `@cursor/sdk-*/bin/*` 的 `asarUnpack` 配置。

### 上下文文件

- 必读: `electron-builder.yml` — 现有 `asarUnpack`（L20-22 含 `@cursor/sdk-*/bin/*`）
- 必读: `electron/agent-sdk.ts` L616-648 — asar.unpacked 路径 fallback 模式
- 必读: `scripts/after-pack.cjs` — 是否需补充 CC SDK 二进制校验（可选）
- 参考: T5 完成后 `ensureCcAgentBinaryPaths` 候选路径列表

### 实现范围

- 修改: `electron-builder.yml` — `asarUnpack` 增加 `node_modules/@anthropic-ai/claude-agent-sdk-*/**/*`（或 SDK 文档要求的 glob，须覆盖 darwin-arm64 可执行文件）
- 可选修改: `scripts/after-pack.cjs` — 打包后断言平台包存在（仅当 after-pack 已有类似 Cursor SDK 检查时对称添加）
- 不改: `agent-claude-sdk.ts`（T5/T3 负责运行时路径解析）

### 接口契约

- 打包产物内 `app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/` 含可执行 Claude Code 二进制
- 与 T5 `ensureCcAgentBinaryPaths` 搜索路径一致

### 验收标准

- [ ] `npm run pack:mac` 或 `dist:mac` 构建成功（arm64 优先）
- [ ] 打包产物目录存在解包后的 SDK 平台包（手动 ls 或 after-pack 断言）
- [ ] 覆盖 01 验收 6、02 八·（二）`npm run dist:mac` 前提
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T1
- 后续任务: T3（完整打包验收在 T3 后联调）

---

## T7: 更新约定文档与品牌文案

### 背景

设计 P-16 要求产品界面与文档统一使用「Claude Agent」称谓，删除 spawn/CLI 约定并补充 SDK/MCP/打包条目（01 验收 8；知识库更新计划十·（一））。本任务不改执行逻辑，仅文档与 UI 字符串。

### 上下文文件

- 必读: `electron/AGENTS.md` — 现有 CC spawn、stream-json 相关段落
- 必读: `src/renderer/components/AgentPanel.tsx` — 搜索 `Claude Code`、`claude-code`
- 必读: `src/renderer/pages/Settings.tsx` — Claude Profile 区块文案
- 参考: `electron/command-handler.ts` — `/model` 等用户可见错误文案
- 参考: T3 完成后实际模块边界（cc-mcp-loader、query 路径）

### 实现范围

- 修改: `electron/AGENTS.md` —
  - 删除: spawn CLI、`getCcBinaryPath`、`stream-json` 约定
  - 新增: Claude Agent SDK 模块边界（agent-claude-sdk / cc-mcp-loader / agent-cc-events SDKMessage）、MCP inline 每次 query 重传、`ensureCcAgentBinaryPaths` + asarUnpack、resident 与 `ccSessionId` resume、Presentation 对齐说明
- 修改: `src/renderer/components/AgentPanel.tsx` — 「Claude Code」→「Claude Agent」（用户可见标签，保留 `type: "claude-code"` 内部值）
- 修改: `src/renderer/pages/Settings.tsx` — 同上品牌统一
- 可选: `electron/command-handler.ts` — 用户可见句中的「Claude Code」→「Claude Agent」
- 不改: `agent-cc-http.ts`、路由路径 `/api/cc/agent/*`

### 接口契约

- 无新增代码 API；文档描述与 T3 实现一致
- UI 仍使用 `AgentResource.type === "claude-code"` 内部标识

### 验收标准

- [ ] `rg 'Claude Code Agent|Claude Code SDK' electron/AGENTS.md src/renderer/` 无用户可见禁用表述（日志前缀 `CC` 可保留）
- [ ] `electron/AGENTS.md` 含 Claude Agent SDK、MCP、打包三节要点
- [ ] 覆盖 01 验收 8
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T3
- 后续任务: 无

---

## T8: 清理废弃 spawn 与死代码（可选）

### 背景

迁移完成后须满足 01 验收 7「无双轨残留」与 02 八·（二）`rg spawn.*claude` / `stream-json` 无 CC 路径命中。T3～T5 应已删除主路径；本任务做全库扫尾、移除仅 spawn 时代遗留的 dead code，并确认 `agent-cc-stream.ts` 仍被 SDK 路径使用则保留。

### 上下文文件

- 必读: T3/T4/T5 完成后的 `electron/agent-claude-sdk.ts`、`electron/agent-cc-events.ts`、`electron/agent-cc-utils.ts`
- 参考: `electron/agent-cc-stream.ts` — 确认仍被 handleCcEvent 使用，**不删除**除非零引用
- 参考: 设计一·（三）改动汇总「删除」清单

### 实现范围

- 删除/清理: 任意残留的 `buildSpawnArgs`、`buildSpawnEnv`、`streamCcEvents`、`parseCcEvent`、`getCcBinaryPath` 定义与 import
- 删除: 对 `@anthropic-ai/claude-code` 的全部 import（若 T1 后仍有漏网）
- 删除: hotfix `20260630000313` 相关 `--verbose` spawn 修复代码（若仍存在）
- 保留: `agent-cc-stream.ts`、`agent-cc-http.ts`、`context-rotation-lite.ts`（设计明确不改）
- 全库: `rg '@anthropic-ai/claude-code|stream-json|buildSpawnArgs|getCcBinaryPath' electron/` 清零

### 接口契约

- 无新增导出；仅删除与收窄 import

### 验收标准

- [ ] `rg '@anthropic-ai/claude-code' electron/` 无命中
- [ ] `rg 'stream-json|buildSpawnArgs|getCcBinaryPath|streamCcEvents' electron/` 无命中
- [ ] `rg 'spawn.*claude|spawn\(.*getCc' electron/` 无 CC 路径命中
- [ ] TypeScript 编译与 `npm run dev` smoke 通过
- [ ] Cursor SDK 路径 smoke 无回归（01 验收 9；02 八·（二））
- [ ] 覆盖 01 验收 7
- [ ] 无 `02`/`03` 未要求的抽象层、trait/mixin 中间层或未批准的新依赖

### 依赖

- 前置任务: T3
- 后续任务: 无
