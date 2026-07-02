# agent/claude-code/ — Claude Code 引擎边界

## Claude Agent SDK 模块边界

- **执行引擎**：`agent-claude-sdk.ts` 使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` API（非 spawn CLI）；HTTP 契约由 `agent-cc-http.ts` 暴露，handler 经依赖注入注册。
- **Session 注册表**：`agent-cc-session-registry.ts` 维护 `CC_SESSIONS` Map 与 `getClaudeCodeSessionList`/`getCcSession`/`getCcActiveQuery` 查询导出；`agent-claude-sdk.ts` re-export 三函数以保持 `daemon/daemon-manager`/`session/session-dispatcher` import 路径不变。
- **MCP 内联**：`mcp/loaders/cc-mcp-loader.ts` 读取 global/project `.cursor/mcp.json` 合并 OAuth（对称 `mcp/loaders/mcp-sdk-loader.ts`）；每次 `query()` 经 `appendInlineCcMcpToCcOptions` 重传 `mcpServers`（SDK 不持久化 inline 配置）。
- **事件映射**：`agent-cc-events.ts` 遍历 `SDKMessage` async iterator（含 `includePartialMessages` stream_event）；Presentation 出站复用 `agent-cc-stream.ts`。f41 流式下 `stream_event`/`text_delta` 与 `assistant`/`text` block 经 `ccTextFromPartialStream` 去重，仅一路 append 正文。
- **二进制打包**：`ensureCcAgentBinaryPaths()` / `resolveCcAgentBinaryPath()` 解析 `@anthropic-ai/claude-agent-sdk-${platform}-${arch}` 内 `claude` 可执行文件；`electron-builder.yml` asarUnpack 解包平台包。
- **resident 与 resume**：`CC_RESIDENT_AGENT`（默认开，`0` 关闭）Run 结束保留 Map 条目；`ccSessionId` 来自 SDK `system/init` / `result`，传入 `options.resume` 续跑上下文。
- **Presentation 时序**：CC 路径对称 SDK 的 `PRESENTATION_ORDERING`（`presentationOrderingEligible` = 开关 + f41Stream + p2p）；tool/thinking 不抢 stream-text 首包。
- **SDK hooks（CC）**：hook 逻辑放 `cc-sdk-hooks.ts`（`buildCcSdkHooks` / `formatCcHookUiLog`）；`buildQueryOptions` 合并 `hooks` + `includeHookEvents: true`；回调与 `hook_*` 流事件经 `markSessionActivity` 刷新时钟，UI 日志含 `hook_event=`，**禁止** hook 原文 IM notify。
- **watchdog 超时（CC）**：**idle 与 absolute 解耦** — idle 默认 `CC_IDLE_TIMEOUT_MS`/`SDK_IDLE_TIMEOUT_MS`（300s）；absolute 默认 `CC_ABSOLUTE_TIMEOUT_MS`/`CC_RUN_WATCHDOG_MS`/`SDK_RUN_WATCHDOG_MS`/`PLATFORM_RUN_LIMIT_MS`（7min），**不得**再等于 idle 默认。与 SDK 共用 `NEVER_CANCEL_ON_DURATION`（默认 true）：`watchRunGuard.timeoutMs` 传 `Number.MAX_SAFE_INTEGER`，idle 仍走 `onTick`+`lastActivityAt`；关闭 never-cancel 时 absolute 硬 cap **仅**在 `onTick` 分支（`runStartedAt`），不经 guard L73 单一 timeout。`armCcWatchdog.onTimeout` 先置 `watchdogTimedOut` 再 close Query；`completeCcRun` 超时分支走 `cc-watchdog-finalize.ts`，复用 `formatUserSdkFailureMessage({ isTimeoutFailure: true })`，**跳过** `failedCooldowns`；主动 `stopClaudeCodeSession` 不得置 `watchdogTimedOut`。

## CC MCP 内联（配置源）

- `mcp/loaders/cc-mcp-loader.ts` 的 `loadInlineCcMcpServers` 读 Claude Code 原生配置源，**不读任何 `.cursor/mcp.json`**。配置源与优先级：`{ws}/.mcp.json`(project) > `~/.claude.json` projects[ws].mcpServers(local) > `~/.claude.json` 顶层 mcpServers(user)；同名 server 以高优先级 scope 整条覆盖（字段不跨 scope 合并）。`readClaudeJsonMcpServers(workspaceDir)` 导出 user+local 合并（local 覆盖 user），供 fallback 读盘；`mergeMcpJsonEntries` 签名不变，在其上叠加 project `.mcp.json`。**stdio**（`toStdioInlineConfig`）resolve/cwd 约定与 SDK 路径一致（`workspaceDir` 非空时 `cwd=ws`，路径型 `command`/`args` resolve 绝对路径；bare 命令名与 `--` 前缀 flag 不 resolve）。**known limitation**：(1) 优先级 project>local>user 与官方 Claude Code（local>project>user）不一致——团队 `.mcp.json` 权威，适团队机器人场景；(2) 未实现 project scope 审批门控（`enabledMcpjsonServers`/`disabledMcpjsonServers`），首版信任 workspace 全量加载 `.mcp.json`；(3) HTTP/sse OAuth token 暂留 Cursor `mcp-auth.json` store，与 Claude 原生 OAuth 不兼容，首版 CC MCP stdio-only。`query()` 每次重传 `mcpServers`（inline 不持久化）；与 `mcp/loaders/mcp-sdk-loader` 的 `.cursor/mcp.json` 路径相互独立。**strictMcpConfig**：`buildQueryOptions` 设 `strictMcpConfig: true`——SDK 只用 inline `mcpServers`，忽略 project `.mcp.json`/user settings/plugins 原生加载（inline 已从原生源合并，避免重复加载与配置源串台）；注入后 UI 日志 `[mcp] inline N servers`（N=`Object.keys(options.mcpServers).length`）供排查。**MCP 状态快照缓存**：`CcSessionAgent.lastMcpServersSnapshot`（`Array<{name,status,config?,scope?,tools?}>`）由 `agent-cc-events.handleSdkMessage` 在 `system/init` 分支缓存 `msg.mcp_servers`；**只在 init 时覆写，idle/complete 不清空**，供 Dashboard idle 会话展示 MCP 列表（与 SDK 路径 `lastInjectedMcpServers` 对称，但 CC 取 SDK 运行时上报而非注入侧快照）。**session 导出**：`getCcSession(sessionKey): CcSessionAgent | undefined` 读 `CC_SESSIONS` 供外部模块（SessionMcpPanel）取 session 缓存；`getCcActiveQuery(sessionKey): Query | null` 取 `session.activeQuery`（idle 返回 null）供调 `query.mcpServerStatus()` 拉运行时状态。

## CC MCP 审批门控函数（cc-mcp-loader.ts）

- **命名约定**：审批门控函数 `readCcProjectApproval`/`filterApprovedProjectMcp`/`loadApprovedInlineCcMcpServers`；前缀 `Cc` 表 Claude Code 路径，`Approved` 表经审批门控过滤，与全量函数 `loadInlineCcMcpServers`（展示取数依赖，**保留全量不删**）成对存在。注入入口（`appendInlineMcpToCcOptions`）改调过滤后函数，展示取数仍调全量函数。
- **`~/.claude.json` 读取容错规矩**：读 `~/.claude.json` 任何字段（含 `projects[ws].enabledMcpjsonServers`/`disabledMcpjsonServers`/`enableAllProjectMcpServers`）须沿用 `readClaudeJsonMcpServers` 容错策略——文件缺失/解析失败/projects 缺失/ws 空/字段非数组 → 容错为空数组/`false`；数组字段用 `Array.isArray` 校验后再 `as string[]`，布尔字段用 `=== true` 收敛。统一 `try/catch` 兜底返回缺省值，不抛错。
- **`filterApprovedProjectMcp` 签名约定**：须传 `workspaceDir` 第三参数用于读 `{ws}/.mcp.json` servers 键集合区分 project scope（`mergeMcpJsonEntries` 中 project 覆盖 user/local，project 条目即 `.mcp.json` 键集合）；缺失则无法满足"user/local 不过滤 + project 均未命中弃"。复用 `readMcpServersBlock` 读 `.mcp.json`，不新建 scope 标注抽象。

## 编码规矩

- MCP loader import `../../mcp/loaders/cc-mcp-loader`；**不读** `.cursor/mcp.json`（配置源见上节）。
- **单文件 ≤300 行**；共享符号 `../shared/agent-launcher`。
