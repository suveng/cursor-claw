# agent/shared/ — 跨引擎共享

## Agent 失败日志归档

- **配置**：`AppConfig.crashAnalysisDir`（Settings general「崩溃分析目录」，存绝对路径；空字符串=未配置，跳过归档）。复用 `config:get`/`config:save`，无新 IPC。
- **入口**：`crash-log-archiver.archiveAgentFailureLogs(ctx)` — 同步 best-effort，内部 catch 不 throw，**不阻断** `completeRunFromTemplate` / `notifyDispatchFailure`。
- **挂接点**（与终态 notify 同路径，经 `completeRunFromTemplate`）：
  - 引擎失败：`errorNotified` 闩通过后、`notifySessionChat` 前；默认 `sdk_run_error`，`user_cancelled`→`sdk_cancelled`；stream catch 经 `completeSdkFailureViaTemplate` 传 `sdk_stream_exception`
  - `notifyDispatchFailure`：`dispatch_failed` UI 日志后、IM notify 前（`failureType=dispatch_failed`）；无 session 时不传 `session` 字段
  - `finalizeSdkRunOnTimeout`：归档在 `completeRunFromTemplate` 内与 notify 同次（`sdk_timeout`）；`errorNotified` 闩跳过重复归档
- **幂等**：`SdkSessionAgent.failureArchiveDone`；`startSdkRun` / `resetSdkRunPresentationState` 清零；写盘成功后 archiver 置 `true`；finalizer→notify 同次失败只产生**一个**事件目录
- **产物**：`{crashAnalysisDir}/{yyyymmddhhmmss[-NNN]}/` — `electron-log.txt`（UTF-8，行格式与 UI 日志一致）+ `meta.json`；目录名上海时区 14 位，根下已存在则 `-001`、`-002`…
- **快照**：归档前 `pushUiLog` 写入 `[crash-archive-trigger] failureType=… sessionKey=…`；从 `getLogBuffer()` 定位**最后一条**含该 marker 的行为锚点，取锚点及前最多 30、后最多 30 行（不足取全部）；`meta.json.buffer` 含 `totalInSnapshot`、`anchorIndex`、`linesBefore`/`linesAfter`、`truncatedBefore`/`truncatedAfter`
- **边界**：**不改** IM 文案；**不**读/复制 `daemon.log`（本阶段）；**不**覆盖 CLI 路径；`dispatchToSdkAgent` 早退 `no resident agent`（仅 pushUiLog）**不**触发归档；未配置时 WARN「未配置崩溃分析目录，跳过归档」（同进程节流）

## RunLifecycle / Engine Port / 终态契约（四引擎 SSOT）

- **类型 SSOT**：`run-lifecycle-types.ts` — `RunPhase`、`RunEvent`、`RunFailureReason`、`AgentEnginePort`、`RunLifecycleSessionSlice`；各引擎 session 全量类型**禁止** import 进 shared 终态模块。
- **Port 注册表**：`agent-engine-port.ts` — `registerEnginePort` / `getEnginePort`；四引擎 `engine-port-adapter.ts` 于 `cursor-sdk/agent-sdk-http.ts` `ensureAgentSdkHttpServer` 注册（`sdk` / `claude-code` / `codex` / `opencode`）；launch/dispatch 经查表，未注册走 legacy handler。
- **终态 IM 唯一出站**：`run-notify.notifySessionChat` — 仅 `daemon-client`；`daemon/sdk-daemon-notify.ts` 与 `claude-code/agent-cc-notify.ts` **仅 re-export**；Codex/OpenCode **直接** import `run-notify`（禁止再写完整 `send-text`）。
- **失败文案**：`run-failure-formatter.formatRunFailureMessage` — 引擎终态用户句 SSOT；Daemon dispatch 失败文案 SSOT 在 `src/shared/orchestrator-failure-formatter.ts`（`run-failure-formatter` re-export），`src/daemon/daemon-orchestrator-notify.ts` 仅 re-export。
- **收尾模板**：`run-complete-template.completeRunFromTemplate` — 幂等 `errorNotified`/`runFinalizing`；f41 stream 成功路径由引擎 stream 收尾，模板**禁止**双写 assistant。
- **状态机**：`run-lifecycle.createRunLifecycle` — 四引擎终态须经 `enterNotifying` → `completeRunFromTemplate`；`resume()` S7 续接待完善。
- **adapter 唯一切面**：各引擎 `engine-port-adapter.ts` 实现 `AgentEnginePort` 六方法；**禁止**在 adapter 外平行实现完整终态 notify/failure/complete 主路径（绕开 `errorNotified` 闩或模板直发失败/超时/取消 IM）；运行中「Agent 处理中…」、pre-send 阻断、resume 失败等**非终态** notify 除外。
- **guard 挂接**：`agent-run-guard.enterGuardWithLifecycle(session, lifecycle?)` — busy 经 `formatRunFailureMessage` + `notifySessionChat` 一次 IM；闩算法核心不改。

## 模块边界

- `agent-launcher.ts`：仅 `ChatType` / `buildPrompt` / `resolveSessionChatName` 等跨引擎共享符号；`buildPrompt` **只**透传 `taskMessage` 正文（不首行注入 `group_name:`、不写占位、不注入 rules）；**禁止**再为 Prompt 组装挂 `pushUiLog group_name=`；`resolveSessionChatName` 仅服务会话状态广播，**不是** Prompt 注入入口；**无** CLI spawn。
- `agent-run-guard.ts`：Run 并发闩、`enterGuardWithLifecycle` 与 watchdog 时钟。
- `tool-presentation-dedup.ts`：跨引擎 tool running 去重与 Task 双推抑制（SDK/CC 共用 `ToolPresentationDedupSession` 切片）。
- `retry-policy.ts`：幂等键与重试策略。
- `workspace-injector.ts`：自动注入（rules/mcp/skills）已废弃为 no-op；`cleanupLegacyInjection` 仅作可选手动清理，**禁止**在 launch 或 Daemon 启动路径自动调用。
- `launch-request-resolve.ts`：IM + 本地四入口 launch body/workDir/model 解析 SSOT（`parseLaunchRequestBody` / `resolveLaunchWorkDir` / `resolveLaunchModel` / `buildLaunchRequestBody`）；纯函数、无 HTTP/会话副作用；各 `agent-*-http.ts` 与 `session-dispatcher-launch` 改调本模块，**禁止**再内联重复解析块。

## 编码规矩

- 配置/UI 日志分别走 `../../config/config-store`、`../../app/ui-logger`。
- 挂接点函数在 `../cursor-sdk/` 实现，本目录仅提供 `archiveAgentFailureLogs`。
- `buildPrompt` 兼容参数位可保留但**勿**再传 `chatName`/`senderOpenId`（二者留给 session 广播）；四引擎 launch/dispatch 禁止另抽 Prompt 组装 helper / 中间层。
- 单文件 ≤300 行；本目录不新增 pub 依赖。