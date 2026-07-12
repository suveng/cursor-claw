# agent/opencode/ — OpenCode 引擎边界

## OpenCode Agent SDK 模块边界

- **文件命名**：`agent-opencode-*.ts` / `opencode-*.ts` 对称 Codex 拆分；入口 `agent-opencode-sdk.ts` **≤300 行**，复杂逻辑下沉 events/stream/utils/complete/session-registry。
- **HTTP**：`agent-opencode-http.ts`；端口 `userData/opencode-agent-api-port.json`；路由 `POST /api/opencode/agent/launch|dispatch`；`session/session-dispatcher` 的 `initSessionDispatcher` 调 `ensureOpencodeHttpServer()`。
- **内嵌 server**：`resolveOpencodeClient` 按 Profile id 缓存；`stopAllOpencodeSessions` 调 `closeAllEmbeddedOpencodeServers()`。
- **ui-logger.SessionSource** 含 `"opencode"`（`app/ui-logger.ts`）。

## Engine Port

- `engine-port-adapter.ts` — `AgentEnginePort` 六方法；`registerOpencodeEnginePort()` 于 `agent-sdk-http` 注册；`mapOpencodeSseToRunEvent` 映射 SSE → `RunEvent`。
- 终态 IM：`agent-opencode-complete.ts` 委托 `completeOpencodeViaLifecycle` / `notifyOpencodeWatchdogTimeout` / `notifyOpencodeRunFailure` → `RunLifecycle` + `completeRunFromTemplate`。**禁止**在 adapter 外平行实现完整终态 lifecycle。
- 运行中 IM（「Agent 处理中…」）直接 import `shared/run-notify`；失败文案 `opencode-failure-messages.ts` 委托 `formatRunFailureMessage`。

## 编码规矩

- MCP loader `../../mcp/loaders/opencode-mcp-loader`。
- 对称 Codex 文件命名：`agent-opencode-*.ts` / `opencode-*.ts`。
