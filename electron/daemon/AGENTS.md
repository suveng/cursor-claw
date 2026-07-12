# daemon/ — Daemon 桥接与会话 notify

## 会话进度通知（daemon `/api/send-text`）

- **三态文案**：冷启动「正在启动」由 **Daemon orchestrator** 下发；进入处理后「Agent 处理中…」由 `agent/cursor-sdk/agent-sdk.ts` 在 `agent.send` 成功后发送；入队确认由 daemon `buildEnqueueStatusText` 发（勿在 electron 侧重复近义句）。
- **Agent 阶段上报**：`daemon-client.reportSessionAgentPhase` → `POST /api/session-agent-phase`；与三态 notify 同挂点、失败仅 WARN、不阻断启动。
- **落点**：`agent-sdk.ts` 在 `agent.send` 成功后、`streamRunEvents` 前发处理中；已运行 session early return 不得再发处理中。
- **失败 notify**：用户可见文案须可理解；路径、stack、进程细节仅写 UI 日志，不经 `/api/send-text` 下发。
- **dispatch 失败对称 IM**：Daemon orchestrator launch/dispatch 失败经 `src/daemon/daemon-orchestrator-notify.ts` `notifySessionUser` + `formatOrchestratorFailure`（SSOT：`src/shared/orchestrator-failure-formatter.ts`，与 electron `run-failure-formatter` 语义对齐）；`stop_progress: true`；日志字段 `dispatch_failed`。Electron 侧 dispatch 失败仍走 `sdk-run-finalize.notifyDispatchFailure` → `RunLifecycle`。

## 模块边界

- **Daemon 桥接**：IM `POST /api/agent/launch|dispatch` 由 Daemon `forwardElectronAgentApi` 转发至 Electron `agent-sdk-http` 统一网关；与本地 `session-dispatcher.launchAgent` 同路径。
- `daemon-manager.ts`：Daemon 子进程生命周期、IPC 注册枢纽、工作流/任务/通道汇聚；poll 斜杠执行委托 `scheduling/command-executor`；**不拆分**（历史行数超限属已知）。
- poll `messageId` 去重：`setCommandPollSkipChecker` 注入；`dual` 时 `startStatusPolling` 每 tick `syncDaemonSlashExecutedIds`（`GET /commands/executed-ids`）后 poll；**claim 前**须 `shouldSkipDaemonSlashCommand` 调 `GET /commands/skip-check`（批量缓存为快速路径）；skip-check 失败保守跳过；`daemon`/`electron` 清除 checker。
- `daemon-client.ts`：`httpPost` / `httpGet` / 锁文件 / 会话同步（`syncActiveSession`、`setSessionFallback` 等）；各引擎经此通知 Daemon，避免与 `session/session-dispatcher` 循环 import。
- `sdk-daemon-notify.ts`：SDK 会话 IM notify 薄 re-export（→ `agent/shared/run-notify.ts`）。

## 编码规矩

- re-export 须指向新子目录路径（如 `../agent/cursor-sdk/agent-sdk`）；**禁止**旧扁平 `./agent-sdk` shim。
- 动态 import 项目 `src/` 时使用 `../../src/...`（本目录深度 +1）。
