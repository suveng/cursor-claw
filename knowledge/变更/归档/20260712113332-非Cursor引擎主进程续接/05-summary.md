# 非Cursor引擎主进程续接 - 变更总结

## 1、实际变更

### 1.1 新增共享层

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/shared/active-run-store.ts` | 泛型 JSON 读写：`readActiveRunRecords` / `upsertActiveRunRecord` / `clearActiveRunRecord` / `listRecoverableActiveRuns` / `markActiveRunUserStopped`；读容错、写失败仅 WARN |
| `electron/agent/shared/run-resume-notify.ts` | `notifyResumeFailure(sessionKey, reason)` — 从 Cursor `sdk-run-recover` 抽取，四引擎共用一次 IM（`stop_progress: true`） |
| `electron/agent/shared/agent-run-recover-orchestrator.ts` | `recoverAllActiveRuns()` — 顺序调用四引擎 recover，单引擎 try/catch，汇总日志 `[recover] recoverAllActiveRuns 完成 sdk=… cc=… codex=… opencode=…` |

### 1.2 新增三引擎持久化与 recover

| 引擎 | persistence | persist（3s 节流） | recover | 盘文件 |
|------|-------------|-------------------|---------|--------|
| Claude Code | `cc-run-persistence.ts` | `cc-run-persist.ts` | `cc-run-recover.ts` | `{userData}/cc-active-runs.json` |
| Codex | `codex-run-persistence.ts` | `codex-run-persist.ts` | `codex-run-recover.ts` | `{userData}/codex-active-runs.json` |
| OpenCode | `opencode-run-persistence.ts` | `opencode-run-persist.ts` | `opencode-run-recover.ts` | `{userData}/opencode-active-runs.json` |

各引擎 Record 含公共字段（`sessionKey`、`workspaceDir`、`apiKey`、`chatType`、`runStartedAt`、呈现游标、`userStopped`）及引擎续接键（`ccSessionId` / `codexSessionId` / `opencodeSessionId`）与 `lastTaskMessage`。

### 1.3 修改挂接点

| 文件 | 关键改动 |
|------|----------|
| `electron/daemon/daemon-manager.ts` | `initDaemonManager`：`recoverSdkActiveRuns` → `recoverAllActiveRuns`（fire-and-forget，失败不阻断 init） |
| `electron/agent/cursor-sdk/sdk-run-recover.ts` | `notifyResumeFailure` 改 import shared；`recoverSdkActiveRuns` 业务逻辑不变 |
| `electron/agent/claude-code/agent-claude-sdk.ts` | Run 启动 `persistCcActiveRunSnapshot(…, true)`；stop `markCcRunUserStopped` |
| `electron/agent/claude-code/agent-cc-stream.ts` | `flushStreamPost` 呈现游标变更后节流 persist |
| `electron/agent/claude-code/agent-cc-events.ts` | 终态 `clearCcActiveRun` |
| `electron/agent/claude-code/agent-cc-types.ts` | `CcSessionAgent` 补充 `runStartedAt` 等持久化切片字段 |
| `electron/agent/codex/agent-codex-sdk.ts` | launch persist + `lastTaskMessage` |
| `electron/agent/codex/agent-codex-session-registry.ts` | stop `markCodexRunUserStopped` |
| `electron/agent/codex/agent-codex-stream.ts` | 呈现 flush persist |
| `electron/agent/codex/agent-codex-events.ts` / `agent-codex-complete.ts` | 终态 clear |
| `electron/agent/codex/agent-codex-types.ts` | session 切片字段 |
| `electron/agent/opencode/agent-opencode-sdk.ts` | launch persist（含 embedded server 参数） |
| `electron/agent/opencode/agent-opencode-session-registry.ts` | stop `markOpencodeRunUserStopped` |
| `electron/agent/opencode/agent-opencode-stream.ts` | 呈现 flush persist |
| `electron/agent/opencode/agent-opencode-complete.ts` | 终态 clear |
| `electron/agent/opencode/agent-opencode-types.ts` | session 切片字段 |

### 1.4 AGENTS.md

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/shared/AGENTS.md` | 补充 active-run-store / run-resume-notify / orchestrator 边界 |
| `electron/agent/claude-code/AGENTS.md` | 补充 cc-run-persist/recover 与主进程续接 |
| `electron/agent/codex/AGENTS.md` | 补充 codex-run-persist/recover |
| `electron/agent/opencode/AGENTS.md` | 补充 opencode-run-persist/recover |
| `electron/agent/cursor-sdk/AGENTS.md` | notify 迁至 shared 说明 |
| `electron/daemon/AGENTS.md` | init 挂接 `recoverAllActiveRuns` |

## 2、与设计差异

| 项 | 设计预期 | 实际 | 影响 |
|----|----------|------|------|
| Codex CLI 门禁 | 读盘 → skip/guard → 引擎续接 → 成功/失败 notify | `checkCodexCliAvailable()` 失败时直接返回 `{0,0,0}`，不遍历盘记录、无 IM | 低频边角（CLI 缺失/PATH 异常）；盘快照滞留；可选 T-FIX-01 |
| 三引擎终态探测 | 02 §8.1 已知风险「各 SDK resume 语义待验证」 | 无 Cursor 式 `Agent.getRun`；OpenCode 额外 `session.get` 探活 | 引擎侧已结束 Run 可能先计 resumed 再由 `complete*Run` 收尾 |
| resumed 计数时机 | Cursor S7 `await startSdkRun` 后计 resumed | 三引擎 `start*Run` fire-and-forget 后同步 `resumed++` | 续接后秒级 stream 失败走常规 complete 链而非 `notifyResumeFailure` |
| OpenCode 探活 | S6d 续跑 | `probeOpencodeRecoverTarget` 与 `startOpencodeRun` 内各调一次 `resolveOpencodeClient` | 性能冗余，不影响正确性 |

其余主路径（orchestrator 顺序、shared store/notify、daemon 单行替换、防双跑 `session_exists` skip、`lifecycle.resume` + `enterGuardWithLifecycle`、R5 dispatch 未改）与 `02-design.md` 一致。

## 3、影响范围

- **模块**：`electron/agent/shared/`、`claude-code/`、`codex/`、`opencode/`、`daemon/daemon-manager.ts`；Cursor 仅 `notifyResumeFailure` import 迁移。
- **接口**：无新增 HTTP/IPC；进程内新增 `recoverAllActiveRuns`、三引擎 `recover*ActiveRuns` / `persist*Snapshot` / `mark*UserStopped`。
- **数据**：`userData` 新增 `cc-active-runs.json`、`codex-active-runs.json`、`opencode-active-runs.json`；不迁移旧数据（无历史快照则 recover 空跑）。
- **用户可见**：Electron 主进程重启后 CC/Codex/OpenCode 活跃 Run 自动续接或一条失败 IM；成功路径无需用户重发触发消息；Cursor S7 行为不变。
- **测试**：`npx tsc --noEmit` 通过；四引擎重启续接手工 H1–H9 待实机（见 `06-automation-test.md`）。

### 3.1 Ponytail 技术债

无（本次变更相关 diff 无 `ponytail:` 注释）。

评审精简建议（非代码注释，见 `04-review.md` §3）：

| 位置 | 摘要 | 升级路径 |
|------|------|----------|
| 四份 `parseRecordChatType` | `sdk-run-recover.ts` + 三引擎 `*-run-recover.ts` 各一份 | 抽到 `agent-launcher` 或 shared 小函数（约 -12 行 ×3） |
| OpenCode recover 探活 | `probeOpencodeRecoverTarget` 与 `startOpencodeRun` 重复 `resolveOpencodeClient` | 探活成功后复用 client bundle 传入 session |

### 3.2 开放评审（accepted_debt 候选）

| ID | 状态 | 摘要 | 任务 |
|----|------|------|------|
| Codex CLI 早退 | accepted_debt | CLI 不可用时不遍历盘记录、无 IM | 可选 T-FIX-01 |
| 四引擎手工续接 | 待实机 | H1–H9 重启续接场景未在本期执行 | archive 后用户补测 |

## 4、知识库更新清单

### 4.1 必须更新（02 §10.1）

- [ ] `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md` — §二 resume/§九 移除「无主进程 recover」/§十 变更记录
- [ ] `knowledge/业务域/Agent调度/08-CodexSDK执行引擎.md` — §二 `codexSessionId` 续接与 §九
- [ ] `knowledge/业务域/Agent调度/09-OpenCodeSDK执行引擎.md` — §二 `opencodeSessionId` 与 §九
- [ ] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — §二 S7 扩展为四引擎 `recoverAllActiveRuns` 流程

### 4.2 可能更新（02 §10.2，本期已落地）

- [ ] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — §二/§九 补充 orchestrator 挂接、`notifyResumeFailure` 迁至 shared
- [ ] `knowledge/业务域/Agent调度/01-概览.md` — §五 关键约束、§三 续接 mermaid 扩展四引擎
- [ ] `knowledge/业务域/Agent调度/10-SDK上下文保护与失败归因.md` — §二 `notifyResumeFailure` 四引擎对称说明
- [ ] `knowledge/业务域/Agent调度/00-README.md` — 若子模块 §九 结构性变更则更新阅读路径

### 4.3 不需要更新（02 §10.3）

- [x] `knowledge/业务域/Agent调度/02-多会话模型.md`、`04-远程指令.md`、`05-定时任务.md` — 不在 01 范围
- [x] `knowledge/工程平台/**` — 无客户端/服务端工程结构变更
- [ ] `knowledge/知识地图.md` — 待 kb-librarian 核实 §五约束变更后决定是否同步 Agent 调度入口描述
