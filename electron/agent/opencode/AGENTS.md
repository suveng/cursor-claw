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
- **单文件 ≤300 行**；defer 链优先内联 `agent-opencode-stream.ts`，超限再拆 `agent-opencode-presentation.ts`（对称 CC）。

## Presentation defer 链（agent-opencode-stream.ts）

- **门控 SSOT**：`presentationOrderingEligible`（`agent-opencode-utils.ts`）= `PRESENTATION_ORDERING` 开关 + `f41Stream`；不满足时 defer/preamble 函数均 no-op，行为与变更前一致。
- **闩锁**：`markOpencodeProcessEventSeen` 置 `seenProcessEvent`/`presentationDeferStream` 并 `clearOpencodeStreamPostTimer`；对称 Cursor `markProcessEventSeen`。
- **defer 判定**：`shouldDeferOpencodeAssistantPost` — ordering 且尚无 `outboundMessageId` 且已见过程或 daemon 已 deferred。
- **Rev2 end-only**：`shouldEndOnlyOpencodeAssistantDefer` — 同上条件下 `doFlushOpencodeStreamPost` non-final **禁止 POST**；**禁止** mid-run release 等价物，唯一 assistant IM 出站仅 `flushOpencodeStreamPost(true)`（`agent-opencode-complete.ts` Run 收尾）。
- **Run 收尾**：`completeOpencodeRun` 先 `clearOpencodeStreamPostTimer`，再 `flushOpencodeStreamPost(true)`（条件 `f41Stream && (streamBuffer.trim() || outboundMessageId)`），收尾后 `streamPostChain = undefined`；`resetOpencodeRunPresentationState` 同步清 timer/链与 defer 闩锁字段。
- **preamble**：纯对话（`isAwaitingFirstOpencodeProcessEvent`）经 `scheduleOpencodePreambleRelease`（400ms，复用 `STREAM_POST_INTERVAL_MS`）短窗等待过程事件后再 `scheduleOpencodeStreamPost`。
- **appendOpencodeStreamDelta**：飞书 plain 早退保留；defer 时仅累积 buffer；preamble 路径不立即 POST。
- **postOpencodeStreamText**：daemon 返回 `deferred: true` 时设 `presentationDeferStream`（不变）。
- **Presentation 出站**：`postOpencodePresentationEvent` **禁止** Electron 侧飞书抑制早退；`markOpencodeProcessEventSeen` 须经 `presentationOrderingEligible` 门控后再置双侧闩，对称 `sdk-run-presentation.markProcessEventSeen`。
- **tool 呈现分级**：`agent-opencode-events.ts` 须 `import { resolveSdkToolPresentationTier } from "../../../src/shared/sdk-tool-presentation-tier.js"`；禁止在 OpenCode 目录内复制 notify 白名单。
- **events 与 stream 分工**：tool `running` 分级门控在 `agent-opencode-events.ts`；defer/闩锁语义在 `agent-opencode-stream.ts`；单文件 ≤300 行。
