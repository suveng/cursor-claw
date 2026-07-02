# Cursor SDK 执行引擎事件流消费 - 变更总结

> **变更 ID**：`20260701212827-CursorSDK执行引擎事件流消费`
> **来源**：kb-propose（standard）
> **stage**：tested（本文件为 archive 步骤 5；release 负责 bump 与 `archived`）

## 1、实际变更

### 代码（与 manifest.files code 一致）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent-sdk.ts` | **重构**为入口编排（272 行）：launch/dispatch、`ensureSdkBinaryPaths`；复杂逻辑下沉 `sdk-run-*` / `sdk-session-*`；re-export `recoverSdkActiveRuns` |
| `electron/agent-sdk-http.ts` | **新增** SDK Agent HTTP 桥接（对称 `agent-cc-http.ts`）；`ensureAgentSdkHttpServer`、launch/dispatch handler |
| `electron/sdk-session-types.ts` | **新增** `SdkSessionAgent`、`RecoverSummary`、`runPhase` 等类型 SSOT |
| `electron/sdk-session-registry.ts` | **新增** `sdkSessions` 注册表、`markSessionActivity`、f41/呈现闩状态 |
| `electron/sdk-daemon-notify.ts` | **新增** `notifySessionChat` 薄封装，解循环 import |
| `electron/sdk-run-persistence.ts` | **新增** 活跃 Run 磁盘快照（`userData/sdk-active-runs.json`）；persist/clear/list/mark |
| `electron/sdk-run-persist.ts` | **新增** 呈现游标变更节流写盘挂接 |
| `electron/sdk-run-stream.ts` | **新增** `streamRunEvents` + `handleSdkEvent` 事件流消费 SSOT |
| `electron/sdk-run-presentation.ts` | **新增** stream-text / presentation-event 呈现与编排 |
| `electron/sdk-run-watchdog.ts` | **新增** idle/draining/cancelling；`tool_running`/`awaiting_user`/`lastTool.running` 豁免 |
| `electron/sdk-run-finalize.ts` | **新增** `completeSdkRun` 收尾、`notifySdkFailure`、超时 finalizer 挂接 |
| `electron/sdk-run-lifecycle.ts` | **新增** `startSdkRun` / `stopSdkSession` / `completeSdkRun` 生命周期 |
| `electron/sdk-run-dispatch.ts` | **新增** `sendWithRetry`、`buildSendOptions`（含 `onActivity` 注入） |
| `electron/sdk-run-recover.ts` | **新增** `recoverSdkActiveRuns`（`Agent.resume` → `getRun` → `streamRunEvents`）、`notifyResumeFailure` |
| `electron/sdk-api-models.ts` | **新增** HTTP launch/dispatch 请求体类型 |
| `electron/context-usage.ts` | `createAgentSendOptions` 扩展 `onActivity?`；summary/turn-ended 刷新 watchdog 活跃时钟 |
| `electron/daemon-manager.ts` | `initDaemonManager` 在 `ensureAgentSdkHttpServer` 后 fire-and-forget 调用 `recoverSdkActiveRuns` |

**统计**：新建 14 + 修改 3 = **17** 个 code 文件；拆分后各文件均 ≤300 行。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`（stage=tested；T1–T6 done）
- `05-summary.md`（本文件）

## 2、与设计的差异

1. **`Agent.getRun` 入参与 02 §四 契约略简**（04-review §4·1）：设计预期 `{ runtime, agentId, apiKey }`；实现 `sdk-run-recover.ts` 仅传 `{ runtime: "local", cwd: workspaceDir }`，依赖前置 `Agent.resume` 建立本地上下文。符合 design §七「以 `@cursor/sdk` 实际签名为准」；不阻断归档；kill-restart 续接仍待 E2E 验证（06 §4.1 S6）。
2. **`stopSdkSession` 先 `markSdkRunUserStopped` 再 `clearActiveSdkRun`**（04-review §4·2）：设计允许「写 `userStopped=true` 或清除记录」择一；实现同函数内标记后立即删除，`userStopped` 不落盘。功能等价（重启后 `listRecoverableSdkRuns` 为空），与 01 验收 7 / T5 目标一致。
3. **模块拆分粒度超出 02 最小方案**：除批准的 `sdk-run-persistence.ts` 与可选 `sdk-run-stream.ts` 外，另拆 `sdk-session-*`、`sdk-run-lifecycle`/`dispatch`/`recover`/`presentation`/`watchdog`/`finalize`/`persist` 等 12 模块——由 AGENTS ≤300 行硬约束驱动，04-review Ponytail 判定为已批准拆分，非未授权抽象。

## 3、影响范围

- **Cursor SDK 执行引擎**：IM / 任务 / 工作流三路径统一经 `streamRunEvents` 持续消费 `run.stream()`；`onDelta` 经 `onActivity` 刷新活跃；watchdog 长工具/等待用户不误杀；Run 启动写 `sdk-active-runs.json`，主进程冷启动 `recoverSdkActiveRuns` 续接。
- **数据**：新增 `userData/sdk-active-runs.json`（含 apiKey，权限随 userData；design 已_ack）。
- **Daemon / IPC**：无新增对外 HTTP/IPC 契约；`POST /api/agent/launch|dispatch` 行为不变。
- **非目标**：Claude Code / Codex / OpenCode 引擎、Electron Settings UI、Daemon 队列编排未改。

### 3.1 Ponytail 技术债

无（归属 code 文件当前内容与 diff 均无 `ponytail:` 注释；04-review §7 记录 shrink 建议保留 `sdk-run-persist.ts` 独立模块，非 ponytail 标记）。

## 4、知识库影响清单

> 来源：`02-design.md` §十；按实现修正，供 archive 步骤 6（kb-librarian）消费。

### （一）必须更新

- [ ] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — 事件流 SSOT（`sdk-run-stream.ts`）；`onActivity`/watchdog 活动判定（`tool_running`/`awaiting_user`）；`sdk-active-runs.json` 持久化与 `recoverSdkActiveRuns` 续接分支；`Agent.resume`/`getRun` 实际入参；模块拆分清单（`sdk-run-*` / `sdk-session-*`）

### （二）可能更新（视 kb-librarian 细化）

- [ ] `knowledge/业务域/Agent调度/01-概览.md` — 核心架构/状态机补「主进程重启续接」分支（若概览图含 SDK 链路）
- [ ] `electron/AGENTS.md` — SDK 模块边界：`sdk-run-persistence`/`sdk-run-recover`/`sdk-run-stream` 职责；`recoverSdkActiveRuns` 启动挂接（`daemon-manager` 经 `agent-sdk` re-export）

### （三）不需要更新

- Claude Code / Codex / OpenCode 子模块知识文件（01 非目标）
- Daemon 编排、`src/AGENTS.md`（无接口变更）
- 设置页、通道配置相关知识文件
