# agent/shared/ — 跨引擎共享

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

## 模块边界

- `agent-launcher.ts`：仅 `ChatType` / `buildPrompt` / `resolveSessionChatName` 等 SDK·CC 共享符号；`buildPrompt` 仅透传 `taskMessage`，不注入 rules 或元数据包装；**无** CLI spawn。
- `agent-run-guard.ts`：Run 并发闩与 watchdog 时钟。
- `retry-policy.ts`：幂等键与重试策略。
- `workspace-injector.ts`：自动注入（rules/mcp/skills）已废弃为 no-op；`cleanupLegacyInjection` 仅作可选手动清理，**禁止**在 launch 或 Daemon 启动路径自动调用。

## 编码规矩

- 配置/UI 日志分别走 `../../config/config-store`、`../../app/ui-logger`。
- 挂接点函数在 `../cursor-sdk/` 实现，本目录仅提供 `archiveAgentFailureLogs`。
