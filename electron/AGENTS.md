# Electron 主进程约定

## 会话进度通知（daemon `/api/send-text`）

- **三态文案**：冷启动「正在启动」由 **Daemon orchestrator** 下发；进入处理后「Agent 处理中…」由 `agent-sdk` 在 `agent.send` 成功后发送；入队确认由 daemon `buildEnqueueStatusText` 发（勿在 electron 侧重复近义句）。
- **Agent 阶段上报**：`daemon-client.reportSessionAgentPhase` → `POST /api/session-agent-phase`；与三态 notify 同挂点、失败仅 WARN、不阻断启动。
- **落点**：`agent-sdk` 在 `agent.send` 成功后、`streamRunEvents` 前发处理中；已运行 session early return 不得再发处理中。
- **失败 notify**：用户可见文案须可理解；路径、stack、进程细节仅写 UI 日志，不经 `/api/send-text` 下发。

## Agent 失败日志归档

- **配置**：`AppConfig.crashAnalysisDir`（Settings general「崩溃分析目录」，存绝对路径；空字符串=未配置，跳过归档）。复用 `config:get`/`config:save`，无新 IPC。
- **入口**：`crash-log-archiver.archiveAgentFailureLogs(ctx)` — 同步 best-effort，内部 catch 不 throw，**不阻断** `notifySdkFailure` / `notifyDispatchFailure`。
- **挂接点**（与失败 notify 同路径）：
  - `notifySdkFailure`：`errorNotified` 闩通过后、`notifySessionChat` 前；默认 `sdk_run_error`，CANCELLED→`sdk_cancelled`；`streamRunEvents` catch 经 notify 传 `sdk_stream_exception`
  - `notifyDispatchFailure`：`dispatch_failed` UI 日志后、IM notify 前（`failureType=dispatch_failed`）；无 session 时不传 `session` 字段
  - `finalizeSdkRunOnTimeout`：在 `await notifySdkFailure` **之前**调用（`sdk_timeout`）；notify 内见闩跳过重复归档
- **幂等**：`SdkSessionAgent.failureArchiveDone`；`startSdkRun` / `resetSdkRunPresentationState` 清零；写盘成功后 archiver 置 `true`；finalizer→notify 同次失败只产生**一个**事件目录
- **产物**：`{crashAnalysisDir}/{yyyymmddhhmmss[-NNN]}/` — `electron-log.txt`（UTF-8，行格式与 UI 日志一致）+ `meta.json`；目录名上海时区 14 位，根下已存在则 `-001`、`-002`…
- **快照**：归档前 `pushUiLog` 写入 `[crash-archive-trigger] failureType=… sessionKey=…`；从 `getLogBuffer()` 定位**最后一条**含该 marker 的行为锚点，取锚点及前最多 30、后最多 30 行（不足取全部）；`meta.json.buffer` 含 `totalInSnapshot`、`anchorIndex`、`linesBefore`/`linesAfter`、`truncatedBefore`/`truncatedAfter`
- **边界**：**不改** IM 文案；**不**读/复制 `daemon.log`（本阶段）；**不**覆盖 CLI 路径；`dispatchToSdkAgent` 早退 `no resident agent`（仅 pushUiLog）**不**触发归档；未配置时 WARN「未配置崩溃分析目录，跳过归档」（同进程节流）

## Claude Agent SDK 模块边界

- **执行引擎**：`agent-claude-sdk.ts` 使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` API（非 spawn CLI）；HTTP 契约由 `agent-cc-http.ts` 暴露，handler 经依赖注入注册。
- **Session 注册表**：`agent-cc-session-registry.ts` 维护 `CC_SESSIONS` Map 与 `getClaudeCodeSessionList`/`getCcSession`/`getCcActiveQuery` 查询导出；`agent-claude-sdk.ts` re-export 三函数以保持 `daemon-manager`/`session-dispatcher` import 路径不变。
- **MCP 内联**：`cc-mcp-loader.ts` 读取 global/project `.cursor/mcp.json` 合并 OAuth（对称 `mcp-sdk-loader.ts`）；每次 `query()` 经 `appendInlineCcMcpToCcOptions` 重传 `mcpServers`（SDK 不持久化 inline 配置）。
- **事件映射**：`agent-cc-events.ts` 遍历 `SDKMessage` async iterator（含 `includePartialMessages` stream_event）；Presentation 出站复用 `agent-cc-stream.ts`。f41 流式下 `stream_event`/`text_delta` 与 `assistant`/`text` block 经 `ccTextFromPartialStream` 去重，仅一路 append 正文。
- **二进制打包**：`ensureCcAgentBinaryPaths()` / `resolveCcAgentBinaryPath()` 解析 `@anthropic-ai/claude-agent-sdk-${platform}-${arch}` 内 `claude` 可执行文件；`electron-builder.yml` asarUnpack 解包平台包。
- **resident 与 resume**：`CC_RESIDENT_AGENT`（默认开，`0` 关闭）Run 结束保留 Map 条目；`ccSessionId` 来自 SDK `system/init` / `result`，传入 `options.resume` 续跑上下文。
- **Presentation 时序**：CC 路径对称 SDK 的 `PRESENTATION_ORDERING`（`presentationOrderingEligible` = 开关 + f41Stream + p2p）；tool/thinking 不抢 stream-text 首包。
- **SDK hooks（CC）**：hook 逻辑放 `cc-sdk-hooks.ts`（`buildCcSdkHooks` / `formatCcHookUiLog`）；`buildQueryOptions` 合并 `hooks` + `includeHookEvents: true`；回调与 `hook_*` 流事件经 `markSessionActivity` 刷新时钟，UI 日志含 `hook_event=`，**禁止** hook 原文 IM notify。
- **watchdog 超时（CC）**：**idle 与 absolute 解耦** — idle 默认 `CC_IDLE_TIMEOUT_MS`/`SDK_IDLE_TIMEOUT_MS`（300s）；absolute 默认 `CC_ABSOLUTE_TIMEOUT_MS`/`CC_RUN_WATCHDOG_MS`/`SDK_RUN_WATCHDOG_MS`/`PLATFORM_RUN_LIMIT_MS`（7min），**不得**再等于 idle 默认。与 SDK 共用 `NEVER_CANCEL_ON_DURATION`（默认 true）：`watchRunGuard.timeoutMs` 传 `Number.MAX_SAFE_INTEGER`，idle 仍走 `onTick`+`lastActivityAt`；关闭 never-cancel 时 absolute 硬 cap **仅**在 `onTick` 分支（`runStartedAt`），不经 guard L73 单一 timeout。`armCcWatchdog.onTimeout` 先置 `watchdogTimedOut` 再 close Query；`completeCcRun` 超时分支走 `cc-watchdog-finalize.ts`，复用 `formatUserSdkFailureMessage({ isTimeoutFailure: true })`，**跳过** `failedCooldowns`；主动 `stopClaudeCodeSession` 不得置 `watchdogTimedOut`。

## Codex Agent SDK 模块边界

- **执行引擎**：`agent-codex-sdk.ts` 入口编排 `launchCodexAgent`/`dispatchToCodexAgent`（`new Codex` + `startThread` + `runStreamed`）；复杂逻辑下沉 `agent-codex-events` / `agent-codex-stream` / `agent-codex-utils`；**单文件 ≤300 行**。
- **Session 注册表**：`agent-codex-session-registry.ts` 维护 `CODEX_SESSIONS` Map 与 `getCodexSessionList`/`isCodexSessionRunning`/`stopCodexSession`/`stopAllCodexSessions`；`agent-codex-sdk.ts` re-export 以保持 `daemon-manager`/`session-dispatcher` import 路径不变（对称 `agent-cc-session-registry.ts`）。
- **类型 SSOT**：`agent-codex-types.ts` 导出 `CodexSessionAgent`/`CodexLaunchOptions`；`codex-mcp-loader` import 该 `CodexLaunchOptions`，勿重复定义。
- **CLI 二进制**：`checkCodexCliAvailable`/`resolveCodexCliPath` 解析 `@openai/codex` optional 平台包 `vendor/*/bin/codex`；launch 前检测，缺失返回「未检测到 Codex CLI，请先安装」。
- **事件映射**：`agent-codex-events.ts` 处理 8 类 `ThreadEvent`（含 SDK `type:"error"` 与设计稿 `thread.error` 兼容）；未识别事件/ThreadItem 子类型 `WARN` 不崩溃。
- **流式出站**：`agent-codex-stream.ts` 对称 CC（400ms 节流、`streamPostChain` 串行、`completeCodexRun` footer）；`ui-logger.SessionSource` 含 `"codex"`。
- **失败文案**：`codex-failure-messages.ts` 纯函数模块；用户可见 IM 文案经 `formatCodexFailureMessage(error)`；apiKey 脱敏经 `maskCodexApiKey`；**禁止** `OPENAI_API_KEY`/apiKey 明文进入文案、UI 日志或崩溃归档快照。`agent-codex-utils` re-export `maskCodexApiKey`，勿重复实现。
- **MCP 内联**：`codex-mcp-loader.ts` 读 Codex CLI 原生 `config.toml`（`~/.codex/config.toml` global + `{ws}/.codex/config.toml` project），**不读** `.cursor/mcp.json` / `.mcp.json`。优先级 project > global；`loadCodexMcpServers` / `appendInlineMcpToCodexOptions` 每次 launch 重传 `mcpServers`（仿 CC/SDK 路径）。stdio resolve/cwd 约定与 `cc-mcp-loader` 一致。TOML 解析为文件内最小实现，**禁止**为此加 npm 依赖。
- **HTTP 桥接**：`agent-codex-http.ts` 独立 server（仿 `agent-cc-http.ts`）；`initSessionDispatcher` 调 `ensureCodexHttpServer()`；端口 `userData/codex-agent-api-port.json`（写入失败 WARN）；路由 `POST /api/codex/agent/launch|dispatch`；launch/dispatch handler 由 `agent-codex-sdk.ts` 末尾 `registerCodex*Handler` 注入；`session-dispatcher.launchAgent` 在 `resource.type === "codex"` 时 POST 本地端口。

## OpenCode Agent SDK 模块边界

- **文件命名**：`agent-opencode-*.ts` / `opencode-*.ts` 对称 Codex 拆分；入口 `agent-opencode-sdk.ts` **≤300 行**，复杂逻辑下沉 events/stream/utils/complete/session-registry。
- **HTTP**：`agent-opencode-http.ts`；端口 `userData/opencode-agent-api-port.json`；路由 `POST /api/opencode/agent/launch|dispatch`；`initSessionDispatcher` 调 `ensureOpencodeHttpServer()`。
- **内嵌 server**：`resolveOpencodeClient` 按 Profile id 缓存；`stopAllOpencodeSessions` 调 `closeAllEmbeddedOpencodeServers()`。
- **ui-logger.SessionSource** 含 `"opencode"`。

## Cursor SDK Run 模块边界

- **入口编排**：`agent-sdk.ts` launch/dispatch/HTTP 路由；复杂逻辑下沉 `sdk-run-*`；**单文件 ≤300 行**。
- **事件流 SSOT**：`sdk-run-stream.ts` — `streamRunEvents`+`handleSdkEvent`；运行期仅 `for await (run.stream())`；`run.wait()` 仅 `finalizeRunContextUsage`/`completeSdkRun` 收尾。
- **生命周期**：`sdk-run-lifecycle.ts` — `startSdkRun`（挂 watchdog+stream+持久化）、`completeSdkRun`（幂等收尾+`clearActiveSdkRun`）、`stopSdkSession`（`markSdkRunUserStopped`+abort）。
- **watchdog**：`sdk-run-watchdog.ts` — `armRunWatchdog`；idle/absolute 解耦；`tool_running`/`awaiting_user`/`lastTool.running` 豁免 idle 取消（对称 CC）。
- **持久化**：`sdk-run-persistence.ts` — `userData/sdk-active-runs.json` 读写；`sdk-run-persist.ts` 呈现游标 3s 节流写盘。
- **续接**：`sdk-run-recover.ts` — `recoverSdkActiveRuns`（`Agent.resume`+`Agent.getRun`→`startSdkRun`）；`notifyResumeFailure` 一次 IM 提示；`daemon-manager` init 挂接。
- **呈现/收尾/分发**：`sdk-run-presentation.ts`（stream-text/PRESENTATION_ORDERING）、`sdk-run-finalize.ts`（超时/失败 notify）、`sdk-run-dispatch.ts`（sendWithRetry）。
- **会话注册表**：`sdk-session-registry.ts`+`sdk-session-types.ts` — `sdkSessions` Map、`markSessionActivity`、`runPhase`；`agent-sdk.ts` re-export 查询 API。

## 模块边界

- `main-window.ts`：`BrowserWindow` 创建与 renderer 加载（dev `loadURL` / 打包 `loadFile`、`did-fail-load` fallback）；`main.ts` 仅注入退出状态并注册 IPC。
- `proxy-env`：子进程/Daemon 启动时的 HTTP(S) 代理 env 注入；**不** spawn Cursor CLI。
- `agent-launcher`：仅 `ChatType` / `buildPrompt` / `resolveSessionChatName` 等 SDK·CC 共享符号；`buildPrompt` 仅透传 `taskMessage`，不注入 rules 或元数据包装；**无** CLI spawn。
- `session-dispatcher`：任务/工作流/`/chat` 经 Daemon `POST /api/agent/launch` 启动；**不**扫描 IM 队列（T7 迁入 Daemon）；**launch 前不得**调用 `workspace-injector` 写盘。
- `workspace-injector`：自动注入（rules/mcp/skills）已废弃为 no-op；`cleanupLegacyInjection` 仅作可选手动清理，**禁止**在 launch 或 Daemon 启动路径自动调用。
- `agent-sdk`：SDK 生命周期与事件流；通知 daemon 时用 `daemon-client.httpPost`，避免与 `session-dispatcher` 循环 import。
- **SDK 流式桥接（f41Eligible）**：主用户私聊或飞书群聊（`allowOthers`）+ SDK 资源时，`handleSdkEvent` assistant delta → `POST /api/stream-text`（累积全文、400ms 节流）；首包不带 `outbound_message_id`，后续回传 daemon 返回值。`flushStreamPost` 经 `session.streamPostChain` 串行 in-flight：每次 POST 入链并 await 上一包完成后再发，避免并发首包；`final` 包同样入链末尾，且携带 `message_id`（当次 claim 末条 inbound id，经 launch/dispatch `message_ids` → `session.inboundMessageIds`）。会话结束或 `stopSdkSession` 时 `resetStreamPostChain` 清 timer 与链。非 f41Eligible 仍走 `appendSdkLog`，不调 stream-text。eligible 须与 Daemon `isStreamTextEligible` 一致。
- **Presentation 时序编排（PRESENTATION_ORDERING）**：`presentationOrderingEligible(session)` = 开关开启 **且** `f41Stream && p2p`（主用户私聊 SDK）。`seenProcessEvent` / `presentationDeferStream` 见 tool/thinking 后置闩；含过程 Run 内 assistant delta 只累积 `streamBuffer` 不 `scheduleStreamPost`；首包未见过程事件时 `schedulePreambleRelease`（400ms 与 stream 节流对齐）短窗等待 tool/thinking，`doFlushStreamPost` 非 final 复检 `shouldDeferAssistantPost`；过程事件 `clearStreamPostTimer`。thinking 结束 `closeThinkingIfOpen` 传 `final: true` 并 `maybeReleaseDeferredAssistant`。Run 收尾 `streamRunEvents` 强制 flush。daemon 返回 `deferred: true` 时设 `presentationDeferStream`。纯对话（始终无过程事件）经 preamble 短窗后 POST，不额外延迟于现网 400ms 节流。`resetSdkRunPresentationState` / `startSdkRun` 清零编排布尔与 buffer。
- **Presentation 出站（tool/thinking）**：`handleSdkEvent` 中 `tool_call` / `thinking` → `POST /api/presentation-event`（`PresentationEvent`）；工具 `running` 时清该 `tool_name` 的 `toolPresentationOutboundIds` 以新建 CardKit，完成/失败回传 `outbound_message_id` 供 PATCH；assistant 正文仍仅走 stream-text，不经 notify 发工具进度。**飞书门控**：`postPresentationEvent` 入口 `isFeishuProcessPresentationSuppressed` — 飞书全通道（私聊+群聊）抑制 tool/thinking POST，过程见 SDK UI 日志；微信不受影响。PRESENTATION_ORDERING 仍仅 p2p。
- **SDK 错误 notify**：失败经 `notifySdkFailure` → `notifySessionChat(..., stop_progress: true)`。用户可见文案经 `sdk-failure-messages.formatUserSdkFailureMessage`（`formatSdkStreamFailure` 委托）；`notifySdkFailure` 组装 peak/limit、`errorCode`、`run.result` 与 `isRunTimeoutFailure` 标志。**失败归因类别**（优先级）：`timeout`（`isTimeoutFailure`）→ `context_exhausted` → `session_abnormal` → `safe_sdk_message` → `fallback_actionable`。路径：`streamRunEvents` catch（非 aborted）、短 `CANCELLED`（极少）、`run.status === "error"` 且非超时（`completeSdkRun`）。stack/tool 名仅写 UI 日志；用户主动 `stopSdkSession`（aborted）不 notify。**平台长时结束**（非 aborted + `durationMs ≥ PLATFORM_RUN_LIMIT_MS` 7min）：`CANCELLED`/`ERROR`/`EXPIRED`/`run.status=error` 经 `isRunTimeoutFailure` → `finalizeSdkRunOnTimeout`（trigger `status`/`stream`/`complete`），IM 走超时分支，归档 `sdk_timeout`；**finalizer 先 notify 再 abort**（避免 aborted 闩跳过 IM）。**短 ERROR**（<7min、非 F3.2）：不走 finalizer，走 `completeSdkRun` 通用文案 + `failedCooldowns`。**F3.2 / 20min 保活超时档**仍由 `isRunTimeoutFailure` 判定。`runFinalizing` + `session.run` 空检查幂等；`completeSdkRun` 已收尾则跳过。
- **SDK MCP 内联**：`mcp-sdk-loader.loadInlineMcpServersForSdk` 仅 inline HTTP/sse/OAuth 依赖项；stdio/command 默认由 `settingSources` 加载（`SDK_MCP_STDIO_INLINE=1` 可回滚全量 inline）。`appendInlineMcpToSendOptions` 内部调用筛选函数。三处注入点（`launchSdkAgent`/`buildSendOptions`/`maybeRotateSessionForPressure`）统一使用 `loadInlineMcpServersForSdk`；`lastInjectedMcpServers` 仅含实际 inline 条目。启动/send 前 `pushUiLog` 输出 `[config] settingSources=project,user cwd=… inlineMcp=…`（S13 可观测）。
- **CC MCP 内联**：`cc-mcp-loader.loadInlineCcMcpServers` 读 Claude Code 原生配置源，**不读任何 `.cursor/mcp.json`**。配置源与优先级：`{ws}/.mcp.json`(project) > `~/.claude.json` projects[ws].mcpServers(local) > `~/.claude.json` 顶层 mcpServers(user)；同名 server 以高优先级 scope 整条覆盖（字段不跨 scope 合并）。`readClaudeJsonMcpServers(workspaceDir)` 导出 user+local 合并（local 覆盖 user），供 fallback/T5 读盘；`mergeMcpJsonEntries` 签名不变，在其上叠加 project `.mcp.json`。**stdio**（`toStdioInlineConfig`）resolve/cwd 约定与 SDK 路径一致（`workspaceDir` 非空时 `cwd=ws`，路径型 `command`/`args` resolve 绝对路径；bare 命令名与 `--` 前缀 flag 不 resolve）。**known limitation**：(1) 优先级 project>local>user 与官方 Claude Code（local>project>user）不一致——团队 `.mcp.json` 权威，适团队机器人场景；(2) 未实现 project scope 审批门控（`enabledMcpjsonServers`/`disabledMcpjsonServers`），首版信任 workspace 全量加载 `.mcp.json`；(3) HTTP/sse OAuth token 暂留 Cursor `mcp-auth.json` store，与 Claude 原生 OAuth 不兼容，首版 CC MCP stdio-only。`query()` 每次重传 `mcpServers`（inline 不持久化）；与 `mcp-sdk-loader` 的 `.cursor/mcp.json` 路径相互独立。**strictMcpConfig**：`buildQueryOptions` 设 `strictMcpConfig: true`——SDK 只用 inline `mcpServers`，忽略 project `.mcp.json`/user settings/plugins 原生加载（inline 已从原生源合并，避免重复加载与配置源串台）；注入后 UI 日志 `[mcp] inline N servers`（N=`Object.keys(options.mcpServers).length`）供排查。**MCP 状态快照缓存**：`CcSessionAgent.lastMcpServersSnapshot`（`Array<{name,status,config?,scope?,tools?}>`）由 `agent-cc-events.handleSdkMessage` 在 `system/init` 分支缓存 `msg.mcp_servers`；**只在 init 时覆写，idle/complete 不清空**，供 Dashboard idle 会话展示 MCP 列表（与 SDK 路径 `lastInjectedMcpServers` 对称，但 CC 取 SDK 运行时上报而非注入侧快照）。**session 导出**：`getCcSession(sessionKey): CcSessionAgent | undefined` 读 `CC_SESSIONS` 供外部模块（T5 MCP 面板）取 session 缓存；`getCcActiveQuery(sessionKey): Query | null` 取 `session.activeQuery`（idle 返回 null）供 T5 调 `query.mcpServerStatus()` 拉运行时状态。
- **SDK 自动压缩**：`Agent.create` / `agent.send` 无显式 `autoCompress` 配置项；接近上下文上限时由 harness **默认** summarization/compression。`agent.send` 挂载 `onDelta`，`summary-started` / `summary-completed`（及 `summary`）写入 SDK UI 日志，前缀 `[compression]`。**pre-send 可观测**：`launchSdkAgent` / `dispatchToSdkAgent` 在 `resolveContextLimitForSession` 之后、`agent.send` 之前调用 `evaluatePreSendContextPressure` → UI 日志 `[compression] pre-send usage {pct}%`（≥85% limit，不阻断 send）。**turn-ended 高水位**：占用 ≥85% limit 时 `[compression] high-watermark {pct}%`（`context-usage-pressure` + `handleAgentSendDelta`）。
- **SDK 上下文 footer（IM 回复）**：**单一落点** `agent-sdk` — Run 流结束后 `finalizeRunContextUsage` 读 `run.usage`（必要时 `run.wait()`），与 `onDelta` turn-ended 快照 **并排打 `[context-usage]` 日志**；`doFlushStreamPost(..., final=true)` 前 `applyContextFooterToBuffer` 写入 `streamBuffer`；中间 chunk 不含 footer。footer **优先** `run.usage.totalTokens`，不可得时回退 turn-ended/peak；格式 `\n\n---\n上下文：{p}% ({usedK}k/{limitK}k)`（有上限）或 `\n\n---\n上下文：已用 {usedK}`；上限来自 `Cursor.models.list` 或 modelId 启发式（session 级缓存）。`appendContextFooter` 对已含「上下文：」的正文幂等。CLI 路径不在 IM scope。
- **SDK 自动压缩飞书通知**：`summary-started` 经 `notifySessionChat` 下发「正在压缩上下文…」（与「Agent 处理中…」同语义，不传 `stop_progress`）；每 Run 至多一次（`compressionNotified`）；`summary-completed` 仅写 UI 日志。
- **SDK 长驻 Agent（`SDK_RESIDENT_AGENT`）**：默认开启；`SDK_RESIDENT_AGENT=0` 回退 Run 结束 `close()`。**非超时 error**：`completeSdkRun` 在 `residentMode` **保留**实例、`reportSessionAgentPhase(idle)` 触发 Daemon flush。**超时类**：`finalizeSdkRunOnTimeout` 后 `agent.close()` + 删 session（长驻与非长驻均清理），下条 launch 重建；**不写 `failedCooldowns`**。`isSdkSessionRunning` 仅 processing（`run`/`pendingDispatch`），idle 用 `hasSdkSession`。二次任务 `dispatchToSdkAgent`；`launchSdkAgent` 遇 processing 会话 WARN 早退 `{ ok: true }`。失败日志 `dispatch_failed` / `agent_failed`。`ensureAgentSdkHttpServer` 应用 init 启动，端口 `userData/agent-api-port.json`；Daemon 转发 `POST /api/agent/launch|dispatch`。**Daemon 统一入口路由**：`launchSdkAgentFromHttp` / `dispatchAgentFromHttp` 按 `resolveBoundAgentResourceType` 委托 — `claude-code` → `launchCcAgentFromHttp` / `dispatchToClaudeCodeAgent`，`sdk` → 现有 SDK 逻辑，legacy `cli` 绑定返回明确错误；与 `session-dispatcher.launchAgent` 双引擎口径一致。
- **ContextRotation 切换顺序**：轮转必须“先 `Agent.create` 成功，再替换 `session.agent`，最后 best-effort 关闭旧实例”；创建失败时保留旧实例继续 send，禁止先 `close` 再创建导致会话假存活。
- **IM 调度双引擎**：Daemon `POST /api/agent/launch|dispatch` 经 `agent-sdk` 按通道资源类型路由（SDK / Claude Code）；无 CLI spawn、无 `poll-message`。

## 通道配置字段

- `MessageChannel` 增删字段须同步：`src/shared/channel-types.ts`、`electron/preload.ts`、`src/renderer/env.d.ts`（`ChannelConfig`）。
- `AgentResource.type` 三处同步（`channel-types` / `preload` / `env.d.ts`）；`engineType` 两处同步（`preload` / `env.d.ts`）。新增引擎类型时同步扩展 `findFirstRunnableResource` 兜底链与 `config-store` 侧 `new*ResourceId()`；已删除 Codex 绑定（`isCodexResourceId`）时 `getAgentResource` **不** fallback 其他 Profile。
- 旧通道读时兜底写在 `config-store.getChannels`，与 `ChannelPanel` reload / `emptyChannel` 保持一致。
- **SDK error 可观测性**：`handleSdkEvent` 在 `tool_call` 时写入 `session.lastTool`；`run.status === "error"` 时 UI 日志单行 `运行错误详情:` 含 `sessionKey`、`agentId`、`durationMs`、`lastTool`、`run.result`、`errorCode`、`waitResult` 等结构化字段。
- **保活失败文案（F3.2）**：超时类由 `isRunTimeoutFailure` 判定后 `formatUserSdkFailureMessage` 输出「会话因等待超时已退出…」（含 F3.2 shell:running + duration≥20min、平台长时 ≥7min）；`isTimeoutFailure` 分支**优先于** CANCELLED 固定「任务已取消」句。`notifySdkFailure` 用 `run`/`runStartedAt` 解析 duration。平台长时 `CANCELLED/ERROR/EXPIRED` 经 finalizer 即时 notify；短 ERROR 走 `completeSdkRun`。非超时 tool/上下文失败走 `sdk-failure-messages` 归因。

## MCP 文件拆分

- `mcp-types.ts`：共享类型（`McpServerEntry`、`McpToolInfo`）。
- `mcp-tools-probe.ts`：`queryToolsViaProtocol` / `queryToolsViaHttp` 直连探测。
- `mcp-status-map.ts`：状态 map 30s 缓存与单条探测编排。
- **mcp-status-map 缓存键**：`resolveWorkspaceKey(workspaceDir?, engineType?)` 返回 `wsKey::engineType`（`ws` 省略回退 `config.workspaceDir`，再省略为 `__default__`；`engineType` 省略默认 `sdk` 保持现网兼容）。`mcpStatusCacheByWs` / `mcpStatusInflightByWs` Map 键随之用组合键，防同 workspace 切 SDK/CC 会话时 idle fallback 读盘 probe 与 SDK 配置源串台。`probeCwd` 用原始 workspace 路径，**不含** engineType 后缀（探测 cwd 与引擎类型无关）。`fetchMcpStatusMap(force, servers, ws?, engineType?)` / `getMcpStatusMap(force, workspaceDir?, engineType?)` 透传 engineType；`invalidateMcpStatusCache()` 仍清空全部。新增参数均可选，main.ts `mcp:status-map` IPC 与飞书 `/mcp` 当前不传 engineType，默认 sdk 行为不变。
- `mcp-manager.ts`：CRUD、toggle、login 说明、对外导出；**不** spawn `agent mcp`。

## Session MCP 取数器

- **入口**：`session-mcp-status.getSessionMcpStatus(sessionKey): Promise<AgentMcpStatusResult>` — 展示层按 sessionKey 取运行时 MCP 状态的唯一入口；返回 `{ servers: McpServerEntry[]; statusMap: Record<string,string>; source }`，`source ∈ "runtime" | "snapshot" | "disk"`。聚合 T1（`cc-mcp-loader`）/T2（`agent-claude-sdk`）/T3（`agent-sdk`）/T4（`mcp-status-map`）能力，**不**自建抽象层、**不**重复读盘/probe 逻辑。
- **dispatch 规则**（按序短路）：(1) `getCcSession` 命中 → CC 路径三态：`getCcActiveQuery` 非空则 `await query.mcpServerStatus()`（`source:"runtime"`；抛错 `catch` 降级 snapshot，**不 crash**）→ 否则 `lastMcpServersSnapshot` 非空走 `source:"snapshot"` → 否则 `loadInlineCcMcpServers(workspaceDir)` 读盘 `source:"disk"`；(2) `getSdkSession` 命中 → `session-mcp-sdk-path.buildSdkRuntimeEntries` 合并磁盘列表与 `lastInjectedMcpServers`，标注 `rawConfig.__sdkLoadVia`（inline/settingSources/plugin），再 `fetchMcpStatusMap` probe，`source:"runtime"`；(3) 无任何 session → 空态 `{ servers: [], statusMap: {}, source: "disk" }`（不抛错，让 UI 显示空列表）。
- **source 三态语义**：`runtime` = 运行时探测/SDK 上报（CC `mcpServerStatus()` 或 SDK `fetchMcpStatusMap` probe）；`snapshot` = session 缓存（CC idle 会话的 `lastMcpServersSnapshot`，含上次 init 上报的 status）；`disk` = 读盘（CC session 缺 query/snapshot 时 `loadInlineCcMcpServers`，或无 session 空态）。展示层可按 source 区分"实时/缓存/降级"渲染与刷新策略。
- **helper 映射约定**：私有 `toEntry(name, cfgLike, source)` 统一字段提取（`type = cfg.url ? "url" : "command"`，`source` 标 `"project"`，`authenticated: false` 首版不处理 OAuth，`enabled: true`，`rawConfig: cfg`；`command/args/url` 仅 cfg 有值时写入，避免 UI `"undefined"`）——兼容 CC `McpServerStatus.config`、CC snapshot `config?: unknown`、SDK/CC inline `McpServerConfig`（stdio `command/args/env` 与 http/sse `url/headers`）。`mapSnapshotToEntries` 在 snapshot 缺 config 时按 name 合并 `loadInlineCcMcpServers` 读盘结果（try/catch 不抛错）。`mapStatusToEntries`/`mapSnapshotToEntries`/`mapInjectedToEntries` 三 helper 均委托 `toEntry`；CC runtime/snapshot 的 `statusMap` 由 `buildStatusMap` + 私有 `mapCcStatusToUi` 将 CC 枚举（`connected`→`ready`、`needs-auth`→`needs_login` 等）映射为 UI 词汇；SDK `fetchMcpStatusMap` probe 结果不经 `buildStatusMap`，勿二次映射。**禁止**在取数器内重建 `mcp-manager.buildEntry` 审批/scope 逻辑——首版简化，展示用配置源统一标 project。

## Session MCP 端点契约（agent:mcp-status IPC）

- **IPC handler**：`registerIpcHandlers` 内 `mcp:*` handler 之后 `ipcMain.handle("agent:mcp-status", (_e, sessionKey, force?, engineType?, workspaceDir?) => getSessionMcpStatus(sessionKey, force, engineType, workspaceDir))`；`force` 透传 SDK `fetchMcpStatusMap` 跳过 30s 缓存；`engineType`/`workspaceDir` 供 CC 无 session 读盘 fallback。顶部 `import { getSessionMcpStatus } from "./session-mcp-status"`。
- **preload 暴露**：`contextBridge` 的 `api` 对象内 `getMcpStatusMap` 之后 `getAgentMcpStatus: (sessionKey, force?, engineType?, workspaceDir?) => ipcRenderer.invoke("agent:mcp-status", sessionKey, force, engineType, workspaceDir)`；返回 `Promise<AgentMcpStatusResult>`，`AgentMcpStatusResult` 在 preload 内 `export interface` 本地声明（与 `McpServerEntry` 同模式），字段与 `electron/session-mcp-status` 对齐（`servers`/`statusMap`/`source`）。
- **env.d.ts 签名**：`ElectronAPI.getAgentMcpStatus(sessionKey, force?, engineType?, workspaceDir?): Promise<AgentMcpStatusResult>`；`AgentMcpStatusResult` 经 `/// <reference path="./types/mcp.d.ts" />` 引入。
- **保留项**：`mcp:list-for-workspace` / `mcp:status-map` IPC 与 preload `listMcpForWorkspace` / `getMcpStatusMap` **保留不动**——IM `/mcp` CRUD 与 Settings 仍用；仅 `SessionMcpPanel` CC/SDK 路径不再直调（见 src/AGENTS.md SessionMcpPanel dispatch）。

## CC MCP 审批门控函数（cc-mcp-loader.ts）

- **命名约定**：审批门控函数 `readCcProjectApproval`/`filterApprovedProjectMcp`/`loadApprovedInlineCcMcpServers`；前缀 `Cc` 表 Claude Code 路径，`Approved` 表经审批门控过滤，与全量函数 `loadInlineCcMcpServers`（展示取数依赖，**保留全量不删**）成对存在。注入入口（`appendInlineMcpToCcOptions`）改调过滤后函数，展示取数仍调全量函数。
- **`~/.claude.json` 读取容错规矩**：读 `~/.claude.json` 任何字段（含 `projects[ws].enabledMcpjsonServers`/`disabledMcpjsonServers`/`enableAllProjectMcpServers`）须沿用 `readClaudeJsonMcpServers` 容错策略——文件缺失/解析失败/projects 缺失/ws 空/字段非数组 → 容错为空数组/`false`；数组字段用 `Array.isArray` 校验后再 `as string[]`，布尔字段用 `=== true` 收敛。统一 `try/catch` 兜底返回缺省值，不抛错。
- **`filterApprovedProjectMcp` 签名约定**：须传 `workspaceDir` 第三参数用于读 `{ws}/.mcp.json` servers 键集合区分 project scope（`mergeMcpJsonEntries` 中 project 覆盖 user/local，project 条目即 `.mcp.json` 键集合）；缺失则无法满足"user/local 不过滤 + project 均未命中弃"。复用 `readMcpServersBlock` 读 `.mcp.json`，不新建 scope 标注抽象。

## MCP 启用状态类型语义（mcp-types.ts / mcp.d.ts）

- `McpServerEntry.enabled?: boolean` 字段须附中文注释明三态语义：`false`=审批未启用/被禁用（project scope 未在白名单或显式 disabled，未注入运行）；`true`=审批启用或 user/local scope（不经审批）；`undefined`=历史数据，向后兼容按 true 处理。
- `electron/mcp-types.ts`（主进程侧）与 `src/renderer/types/mcp.d.ts`（渲染层 ambient）两处定义须保持注释与语义一致；不新增枚举字段表达 disabled，展示由 `enabled:false` + `statusMap["disabled"]` 双通道承担。
