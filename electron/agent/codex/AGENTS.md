# agent/codex/ — Codex 引擎边界

## Codex Agent SDK 模块边界

- **执行引擎**：`agent-codex-sdk.ts` 入口编排 `launchCodexAgent`/`dispatchToCodexAgent`（`new Codex` + `startThread` + `runStreamed`）；复杂逻辑下沉 `agent-codex-events` / `agent-codex-stream` / `agent-codex-utils`；**单文件 ≤300 行**。
- **Session 注册表**：`agent-codex-session-registry.ts` 维护 `CODEX_SESSIONS` Map 与 `getCodexSessionList`/`isCodexSessionRunning`/`stopCodexSession`/`stopAllCodexSessions`；`agent-codex-sdk.ts` re-export 以保持 `daemon/daemon-manager`/`session/session-dispatcher` import 路径不变（对称 `agent-cc-session-registry.ts`）。
- **类型 SSOT**：`agent-codex-types.ts` 导出 `CodexSessionAgent`/`CodexLaunchOptions`；`mcp/loaders/codex-mcp-loader` import 该 `CodexLaunchOptions`，勿重复定义。
- **CLI 二进制**：`checkCodexCliAvailable`/`resolveCodexCliPath` 解析 `@openai/codex` optional 平台包 `vendor/*/bin/codex`；launch 前检测，缺失返回「未检测到 Codex CLI，请先安装」。
- **事件映射**：`agent-codex-events.ts` 处理 8 类 `ThreadEvent`（含 SDK `type:"error"` 与设计稿 `thread.error` 兼容）；未识别事件/ThreadItem 子类型 `WARN` 不崩溃。
- **流式出站**：`agent-codex-stream.ts` 对称 CC/OpenCode（400ms 节流、`streamPostChain` 串行）；终态 `completeCodexRun`（`agent-codex-complete.ts`）委托 adapter。
- **Presentation 排序**：`shouldDeferCodexAssistantPost` / `shouldEndOnlyCodexAssistantDefer` / `isAwaitingFirstCodexProcessEvent` / `scheduleCodexPreambleRelease` 在 `agent-codex-stream.ts`；**禁止** mid-run release（Rev2 end-only）。
- **Run 收尾**：`completeCodexRun` 先 `clearCodexStreamPostTimer`，再 `flushCodexStreamPost(true)`（条件 `f41Stream && (streamBuffer.trim() || outboundMessageId)`），收尾后 `streamPostChain = undefined`；`resetCodexRunPresentationState` 同步清 timer/链与 defer 闩锁字段。
- **Presentation 出站**：`postCodexPresentationEvent` **禁止** Electron 侧飞书抑制早退；`markCodexProcessEventSeen` 须经 `presentationOrderingEligible` 门控后再置双侧闩，对称 `markOpencodeProcessEventSeen`。
- **tool 呈现分级**：`agent-codex-events.ts` 须 `import { resolveSdkToolPresentationTier } from "../../../src/shared/sdk-tool-presentation-tier.js"`；禁止在 Codex 目录内复制 notify 白名单。
- **events 与 stream 分工**：tool `started` 分级门控在 `agent-codex-events.ts`；defer/闩锁语义在 `agent-codex-stream.ts`；单文件 ≤300 行。
- **Engine Port**：`engine-port-adapter.ts` — `AgentEnginePort` 六方法；`registerCodexEnginePort()` 于 `agent-sdk-http` 注册；`mapCodexThreadEventToRunEvent` 映射 `ThreadEvent` → `RunEvent`。终态 IM：`completeCodexViaLifecycle` / `notifyCodexRunFailure` / `notifyCodexWatchdogTimeout` → `RunLifecycle` + `completeRunFromTemplate`。**禁止**在 adapter 外平行实现完整终态 lifecycle；运行中 IM 直接 import `shared/run-notify`（无本地 notify 包装副本）。
- **失败文案**：`codex-failure-messages.ts` — 脱敏与归因提取；用户可见句委托 `formatRunFailureMessage`（`formatCodexFailureMessage` 组装 `RunFailureReason`）；apiKey 脱敏经 `maskCodexApiKey`；**禁止** `OPENAI_API_KEY`/apiKey 明文进入文案、UI 日志或崩溃归档。
- **MCP 内联**：`mcp/loaders/codex-mcp-loader.ts` 读 Codex CLI 原生 `config.toml`（`~/.codex/config.toml` global + `{ws}/.codex/config.toml` project），**不读** `.cursor/mcp.json` / `.mcp.json`。优先级 project > global；`loadCodexMcpServers` / `appendInlineMcpToCodexOptions` 每次 launch 重传 `mcpServers`（仿 CC/SDK 路径）。stdio resolve/cwd 约定与 `cc-mcp-loader` 一致。TOML 解析为文件内最小实现，**禁止**为此加 npm 依赖。
- **HTTP 桥接**：`agent-codex-http.ts` 独立 server（仿 `agent-cc-http.ts`）；`session/session-dispatcher` 的 `initSessionDispatcher` 调 `ensureCodexHttpServer()`；端口 `userData/codex-agent-api-port.json`（写入失败 WARN）；路由 `POST /api/codex/agent/launch|dispatch`；launch/dispatch handler 由 `agent-codex-sdk.ts` 末尾 `registerCodex*Handler` 注入；`session-dispatcher.launchAgent` 在 `resource.type === "codex"` 时 POST 本地端口。

## Recover hardening

- **探活**：`codex-run-probe.ts` — `probeCodexRecoverTarget`；`codex-run-recover.ts` guard 前调用；失效 thread → `unrecoverable` + 清盘。
- **CLI 缺失**：`recoverCodexActiveRuns` **禁止**整函数静默早退；遍历盘记录逐条 `notifyResumeFailure` + `clearCodexActiveRun`。
- **失败分类**：消费 `../shared/run-resume-notify` 的 `classifyResumeFailure` / `ResumeFailureCategory`；**不改** orchestrator / IM 入队。
- **活跃 Run 持久化/续接**：`codex-run-persistence.ts` + `codex-run-persist.ts`；`completeCodexRun` 终态 `clearCodexActiveRun`；`codex-run-recover.ts` — `recoverCodexActiveRuns`（`resumeThread` + `startCodexRun`）；init 经 orchestrator。

## 编码规矩

- **单文件 ≤300 行**；MCP loader `../../mcp/loaders/codex-mcp-loader`。
- TOML 解析为文件内最小实现，**禁止**加 npm 依赖。
