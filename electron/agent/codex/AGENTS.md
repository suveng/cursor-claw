# agent/codex/ — Codex 引擎边界

## Codex Agent SDK 模块边界

- **执行引擎**：`agent-codex-sdk.ts` 入口编排 `launchCodexAgent`/`dispatchToCodexAgent`（`new Codex` + `startThread` + `runStreamed`）；复杂逻辑下沉 `agent-codex-events` / `agent-codex-stream` / `agent-codex-utils`；**单文件 ≤300 行**。
- **Session 注册表**：`agent-codex-session-registry.ts` 维护 `CODEX_SESSIONS` Map 与 `getCodexSessionList`/`isCodexSessionRunning`/`stopCodexSession`/`stopAllCodexSessions`；`agent-codex-sdk.ts` re-export 以保持 `daemon/daemon-manager`/`session/session-dispatcher` import 路径不变（对称 `agent-cc-session-registry.ts`）。
- **类型 SSOT**：`agent-codex-types.ts` 导出 `CodexSessionAgent`/`CodexLaunchOptions`；`mcp/loaders/codex-mcp-loader` import 该 `CodexLaunchOptions`，勿重复定义。
- **CLI 二进制**：`checkCodexCliAvailable`/`resolveCodexCliPath` 解析 `@openai/codex` optional 平台包 `vendor/*/bin/codex`；launch 前检测，缺失返回「未检测到 Codex CLI，请先安装」。
- **事件映射**：`agent-codex-events.ts` 处理 8 类 `ThreadEvent`（含 SDK `type:"error"` 与设计稿 `thread.error` 兼容）；未识别事件/ThreadItem 子类型 `WARN` 不崩溃。
- **流式出站**：`agent-codex-stream.ts` 对称 CC（400ms 节流、`streamPostChain` 串行、`completeCodexRun` footer）；`app/ui-logger` 的 `SessionSource` 含 `"codex"`。
- **失败文案**：`codex-failure-messages.ts` 纯函数模块；用户可见 IM 文案经 `formatCodexFailureMessage(error)`；apiKey 脱敏经 `maskCodexApiKey`；**禁止** `OPENAI_API_KEY`/apiKey 明文进入文案、UI 日志或崩溃归档快照。`agent-codex-utils` re-export `maskCodexApiKey`，勿重复实现。
- **MCP 内联**：`mcp/loaders/codex-mcp-loader.ts` 读 Codex CLI 原生 `config.toml`（`~/.codex/config.toml` global + `{ws}/.codex/config.toml` project），**不读** `.cursor/mcp.json` / `.mcp.json`。优先级 project > global；`loadCodexMcpServers` / `appendInlineMcpToCodexOptions` 每次 launch 重传 `mcpServers`（仿 CC/SDK 路径）。stdio resolve/cwd 约定与 `cc-mcp-loader` 一致。TOML 解析为文件内最小实现，**禁止**为此加 npm 依赖。
- **HTTP 桥接**：`agent-codex-http.ts` 独立 server（仿 `agent-cc-http.ts`）；`session/session-dispatcher` 的 `initSessionDispatcher` 调 `ensureCodexHttpServer()`；端口 `userData/codex-agent-api-port.json`（写入失败 WARN）；路由 `POST /api/codex/agent/launch|dispatch`；launch/dispatch handler 由 `agent-codex-sdk.ts` 末尾 `registerCodex*Handler` 注入；`session-dispatcher.launchAgent` 在 `resource.type === "codex"` 时 POST 本地端口。

## 编码规矩

- **单文件 ≤300 行**；MCP loader `../../mcp/loaders/codex-mcp-loader`。
- TOML 解析为文件内最小实现，**禁止**加 npm 依赖。
