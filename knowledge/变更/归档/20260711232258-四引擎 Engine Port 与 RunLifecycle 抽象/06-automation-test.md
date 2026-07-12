# 四引擎 Engine Port 与 RunLifecycle 抽象 - 验收记录

> **变更 ID**：`20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象`
> **来源**：`/kb-test`（一期 T1～T8；二期 T9～T11；三期 T12～T14；基于 `01-proposal.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1～T14 `done`（静态+build）；T15～T16 `pending`；T17 `deferred`；`stage=tested`（四引擎全矩阵静态验收完成，运行态 IM 待手工）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（源码路径 / grep / `npm run build`）+ **手工冒烟**（S1～S8 × 四引擎；无真机飞书时仅记静态 pass） |
| **目标** | 追溯 `01` 场景矩阵 **S1～S8 × 四引擎**；T14 全矩阵；对照 `03` T1～T14 与 `04-review` warning |
| **与验收关系** | 静态项由 kb-test 记入 §7；运行态 IM 为**维护者手工**，步骤见 §4.1～4.6 |
| **分期边界** | 一期骨架 + Daemon 对称（T1～T8）；二期 Cursor+Claude adapter（T9～T11）；三期 Codex+OpenCode + 全矩阵（T12～T14）；四期清理归 T15～T16 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 归类 |
|----------|------|------|
| **S1～S6 运行态 IM**（四引擎） | T9～T13 adapter 已接线；无真机飞书环境 | **T14 静态通过**；运行态 **待手工** §4.6 |
| **S7** Electron 重启续接 | `RunLifecycle.resume()` 仍为 stub；`sdk-run-recover` 仅 Cursor 侧续接，未与 Lifecycle 全量挂接 | **静态部分通过**（recover 路径存在）；运行态 **待手工** |
| **S8** CC/Codex/OpenCode guard busy IM | 仅 Cursor 经 `enterGuardWithLifecycle`；其余引擎仍 `acquireRunGuard` 无 busy notify | **Cursor 静态通过**；其余引擎 **accepted_debt**，不阻断 archive |
| **S5 / S8 运行态** | 须 Daemon + 飞书真机 | **待手工** §4.1、§4.2、§4.6 |
| **单元/集成测试** | 仓库规范不写单测 | review 静态 + 手工冒烟 |
| **真实飞书 IM** | 须已配置通道凭据；知识库不写 token | 手工冒烟前置 |

## 3、验收追溯表

### 3.1 场景矩阵 S1～S8 × 四引擎（T14 状态）

图例：**✅ 静态通过**（源码接线 + build）｜**📋 待手工 IM**｜**⏸ 部分静态**（stub 或引擎差异）

| 场景 | 验收要点 | Cursor | Claude | Codex | OpenCode | 任务 |
|------|----------|--------|--------|-------|----------|------|
| **S1** 成功完成 | 一次收尾 IM，无重复轰炸 | ✅ | ✅ | ✅ | ✅ | T9～T13 |
| **S2** 用户取消 | 可区分取消类 IM | ✅ | ✅ | ✅ | ✅ | T9～T13 |
| **S3** 超时/看门狗 | 超时说明 IM | ✅ | ✅ | ✅ | ✅ | T9～T13 |
| **S4** 运行期失败 | `errorNotified` 闩；不重复 notify | ✅ | ✅ | ✅ | ✅ | T8 + T9～T13 |
| **S5** dispatch 失败对称 | 未进运行态仍有失败 IM；busy 无多余 orchestrator 文案 | ✅ | ✅ | ✅ | ✅ | T7（Daemon 层引擎无关） |
| **S6** stale/aborted | 不误导性成功/失败卡 | ✅ | ✅ | ✅ | ✅ | T5 + T9～T13 |
| **S7** Electron 重启续接 | 续接后终态 notify 合规 | ⏸ | ⏸ | ⏸ | ⏸ | `resume()` stub；Cursor `sdk-run-recover` |
| **S8** 并发/锁冲突 | guard busy 不静默 | ✅ | ⏸ | ⏸ | ⏸ | T8 Cursor；其余 acquireRunGuard only |

> **S5**：`daemon-http-routes-orchestrator` dispatch `!ok` 且非 `agent_busy` → `notifySessionUser` + ack，四引擎调度路径一致。  
> **S7**：静态确认 `run-lifecycle.ts` `resume()` 为 stub；`sdk-run-recover.ts` 存在 Cursor 续接逻辑，`errorNotified` 重置与 Lifecycle 挂接待运行态验证。  
> **S8**：`enterGuardWithLifecycle` + `notifySdkProcessingBusy` 仅 Cursor；CC/Codex/OpenCode busy 静默为已知债务（T15 可收敛）。

### 3.2 任务 T1～T14 ↔ 验证方式

| 任务 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **T1** | `RunFailureReason` 含 `dispatch_failed` | 读 `run-lifecycle-types.ts` + build | 类型导出 | ✅ 静态通过 |
| **T2** | `run-notify.ts` 唯一实现；re-export | grep import 图 | re-export 路径 | ✅ 静态通过 |
| **T3** | 各 reason 非空文案 | 读 formatter | SSOT（T-FIX） | ✅ 静态通过 |
| **T4** | 幂等闩；f41 防双写 | 读 `run-complete-template.ts` | 闩逻辑 | ✅ 静态通过 |
| **T5** | 阶段转移；`notifying` 查 `errorNotified` | 读 `run-lifecycle.ts` | API | ✅ 静态通过 |
| **T6** | 无 adapter 时 legacy fallback | 读 `agent-engine-port.ts` | registry | ✅ 静态通过 |
| **T7** | dispatch 非 busy 失败 IM + ack | 读 orchestrator 路由 | 接线 | ✅ 静态通过 |
| **T8** | guard busy IM；SDK 失败经 shared | 读 guard + finalize | 接线 | ✅ 静态通过 |
| **T9** | Cursor Port 六方法 | 读 `cursor-sdk/engine-port-adapter.ts` | adapter | ✅ 静态通过 |
| **T10** | Claude Port；Lifecycle 收尾 | 读 `claude-code/engine-port-adapter.ts` | adapter | ✅ 静态通过 |
| **T11** | Cursor+Claude × S1～S6 | §3.4 + §4.5 | 矩阵记录 | ✅ 静态通过；📋 IM 待手工 |
| **T12** | Codex Port；notify 薄包装 | 读 `codex/engine-port-adapter.ts` + stream re-export | adapter | ✅ 静态通过 |
| **T13** | OpenCode Port；SSE→RunEvent | 读 `opencode/engine-port-adapter.ts` | adapter | ✅ 静态通过 |
| **T14** | 四引擎 × S1～S8 全矩阵 | §3.5 + §4.6 + §4.7；build | 全矩阵记录 | ✅ 静态通过；📋 IM 待手工 |

### 3.3 04-review warning 对照

| ID | 摘要 | 06 处置 |
|----|------|---------|
| R1 | `completeSdkRun` 未委托 template | **fixed**（T9） |
| R2 | formatter 双份 SSOT | **fixed**（T-FIX） |
| R3 | Cursor+Claude S1～S6 运行冒烟 | **accepted_debt**（T11）：静态+build pass；§4.5 |
| R4 | `isSdkSessionProcessing` busy 无 IM | **fixed**（T9 `notifySdkProcessingBusy`） |
| R5 | 四引擎全矩阵运行态 IM | **accepted_debt**（T14）：静态+build **pass**；§4.6；**不阻断 archive** |

### 3.4 T11 追溯矩阵：Cursor + Claude × S1～S6（T9/T10）

图例：**✅ 静态通过**｜**📋 待手工 IM**｜**—** Daemon 层引擎无关

| 场景 | Cursor（T9）静态指针 | Claude（T10）静态指针 | 静态 | 运行态 IM |
|------|----------------------|----------------------|------|-----------|
| **S1** | `completeSdkRunViaPort` → template | `completeCcViaLifecycle` source:`success` | ✅ | 📋 |
| **S2** | `run_cancelled` → `completeSdkFailureViaTemplate` | `emitCcQueryTerminalRunEvent` cancel | ✅ | 📋 |
| **S3** | `finalizeSdkRunOnTimeout` / watchdog | `cc-watchdog-finalize` → `notifyCcWatchdogTimeout` | ✅ | 📋 |
| **S4** | `notifySdkFailure` → `enterNotifying` | `notifyCcRunFailure` → lifecycle | ✅ | 📋 |
| **S5** | —（`daemon-http-routes-orchestrator.ts` L122–136） | — | ✅ | 📋 |
| **S6** | `enterNotifying` 查 `errorNotified` | 同左 `toLifecycleSlice` | ✅ | 📋 |

### 3.5 T14 追溯矩阵：四引擎 × S1～S8（T9～T13）

图例：**✅ 静态通过**｜**📋 待手工 IM**｜**⏸ 部分静态**

| 场景 | Cursor | Claude | Codex | OpenCode | 静态指针（共性） |
|------|--------|--------|-------|----------|------------------|
| **S1** | ✅ | ✅ | ✅ | ✅ | `complete*ViaLifecycle` → `createRunLifecycle` → `completeRunFromTemplate` |
| **S2** | ✅ | ✅ | ✅ | ✅ | cancel 分支 → `enterNotifying` source:`cancelled` |
| **S3** | ✅ | ✅ | ✅ | ✅ | `notify*WatchdogTimeout` → source:`watchdog` |
| **S4** | ✅ | ✅ | ✅ | ✅ | `notify*RunFailure` / `errorNotified` 闩 |
| **S5** | ✅ | ✅ | ✅ | ✅ | Daemon `notifySessionUser`（引擎无关） |
| **S6** | ✅ | ✅ | ✅ | ✅ | `run-lifecycle.ts` 幂等闩 + adapter `complete` |
| **S7** | ⏸ | ⏸ | ⏸ | ⏸ | `resume()` stub；Cursor `sdk-run-recover.ts` |
| **S8** | ✅ | ⏸ | ⏸ | ⏸ | Cursor `enterGuardWithLifecycle`；其余 `acquireRunGuard` |

**引擎静态指针摘要**

| 引擎 | Port 注册 | 终态收尾 | notify 出口 | RunEvent 映射 |
|------|-----------|----------|-------------|---------------|
| **Cursor** | `registerCursorEnginePort` | `sdk-run-port-lifecycle.ts` | `run-notify`（经 template） | `sdk-run-stream.ts` |
| **Claude** | `registerCcEnginePort` | `completeCcViaLifecycle` | re-export `run-notify` | `mapCcSdkMessageToRunEvent` |
| **Codex** | `registerCodexEnginePort` | `completeCodexViaLifecycle` | `notifyCodexSessionChat` re-export | `mapCodex*ToRunEvent` |
| **OpenCode** | `registerOpencodeEnginePort` | `completeOpencodeViaLifecycle` | `notifyOpencodeSessionChat` re-export | `mapOpencodeSseToRunEvent` |

**Port 注册**：`agent-sdk-http.ts` 模块级已注册四引擎 adapter（`registerCc/Codex/OpencodeEnginePort` + `ensureAgentSdkHttpServer` 内 `registerCursorEnginePort`）。

## 4、场景摘要

### 4.1 手工冒烟：S5 Daemon dispatch 失败对称

**前置**：Electron + Daemon 运行；飞书通道已连接；任选一会话 `session_key`；可检索 `dispatch_failed`。

| 步骤 | 操作 | 期望 | 失败判责 |
|------|------|------|----------|
| 1 | 制造 **非 busy** dispatch 失败（停 Agent HTTP 或未 launch 会话 dispatch） | HTTP `ok: false`；日志含 `dispatch_failed` | 环境 / Daemon 路由 |
| 2 | 观察飞书 IM | orchestrator 失败文案；`stop_progress` | 无 IM → T7 |
| 3 | 制造 **agent_busy** 重排 | **无** orchestrator 失败 IM；`agent_busy_requeue` | 误发文案 → T7 busy 分支 |
| 4 | 四引擎各测一次（换 Profile 资源类型） | S5 行为一致 | 某引擎例外 → registry 路由 |

### 4.2 手工冒烟：S8 guard busy（Cursor SDK）

**前置**：Cursor SDK Profile；可快速连续触发两次 launch/dispatch。

| 步骤 | 操作 | 期望 | 失败判责 |
|------|------|------|----------|
| 1 | 占住 guard（长任务） | 会话 processing | 环境 |
| 2 | 再次 launch/dispatch | busy 类失败 IM；`stop_progress` | 静默 → T8 |
| 3 | 确认 `errorNotified` 闩 | 同 Run 不重复 busy IM | 重复轰炸 → T4 |
| 4 | processing 早退 | `notifySdkProcessingBusy` 一次 IM | 静默 → T9 R4 |

### 4.3 手工冒烟：S4 errorNotified（SDK 子集）

**前置**：Cursor SDK；可触发可恢复失败。

| 步骤 | 操作 | 期望 | 失败判责 |
|------|------|------|----------|
| 1 | 触发运行期失败 | 飞书一次失败 IM | 无 IM → notify 路径 |
| 2 | 同 Run 重复 finalize | **无**第二次 IM | 闩失效 → T4/T5 |
| 3 | 新 Run 启动 | `errorNotified` 已重置 | 闩泄漏 → reset 路径 |

### 4.4 静态契约核对（T11 已执行）

| 检查项 | 指针 | 结果 |
|--------|------|------|
| `npm run build` | 仓库根 | ✅ 2026-07-12 |
| T9 Cursor Port | `engine-port-adapter.ts` + `sdk-run-port-lifecycle.ts` | ✅ |
| T10 Claude Port | `claude-code/engine-port-adapter.ts` | ✅ |
| dispatch 非 busy notify | `daemon-http-routes-orchestrator.ts` L122–136 | ✅ |
| guard busy IM | `agent-run-guard.ts` `notifyGuardBusy` | ✅ |

### 4.5 手工冒烟：T11 Cursor + Claude × S1～S6

**前置**：Electron + Daemon；飞书已连接；Cursor 与 Claude 各一会话。

**执行顺序**：每场景先在 Cursor 执行，再 Claude；对照「是否收到 IM」与「语义类别」一致（01 §6.2-1）。

| 场景 | 期望（两引擎一致） | 失败判责 |
|------|-------------------|----------|
| **S1** | 一次 assistant 收尾；无重复轰炸 | complete 路径 |
| **S2** | 取消类 IM 可区分 | Lifecycle cancel |
| **S3** | 超时说明 IM | watchdog finalize |
| **S4** | 一次失败 IM | `errorNotified` 闩 |
| **S5** | 非 busy 有 IM；busy 无多余 IM | T7 |
| **S6** | 不误导性成功卡 | stale 门控 |

**T11 口径**：无真机飞书 → 静态+build **pass**；运行态 **待手工**，不阻断 archive。

### 4.6 手工冒烟：T14 四引擎 × S1～S8

**前置**：Electron + Daemon；飞书已连接；准备 **Cursor / Claude / Codex / OpenCode** 各一会话（Profile 绑定对应资源类型）；可检索 `notifySessionChat`、`dispatch_failed`、`complete*ViaLifecycle`。

**执行顺序**：按场景 S1→S8，每场景在四引擎各执行一次并记录；S5/S8 可共用 §4.1/§4.2 步骤。

| 场景 | 步骤摘要 | 期望（四引擎一致） | 失败判责 |
|------|----------|-------------------|----------|
| **S1** | 下发可完成任务，等待正常结束 | 一次收尾 IM；无重复轰炸 | T9～T13 complete |
| **S2** | Run 中停止/取消 | 取消类 IM；与 S1 可区分 | cancel 分支 |
| **S3** | 触发 watchdog 超时 | 超时说明 IM | watchdog finalize |
| **S4** | 触发运行期失败 | 一次失败 IM；同 Run 不重复 | `errorNotified` 闩 |
| **S5** | 非 busy dispatch 失败 + busy 对照 | 非 busy 有 orchestrator IM；busy 无多余 IM | T7 |
| **S6** | 会话过期/abort 后收尾 | 不误导性成功卡 | stale 门控 |
| **S7** | Electron 重启后续接 Run | 续接终态符合 S1～S4；`errorNotified` 无残留 | `sdk-run-recover` + `resume` |
| **S8** | 并发 dispatch（Cursor 必测） | Cursor：busy IM 不静默；其余记录现状 | T8 / accepted_debt |

**可观测摘要**：`completeSdkRunViaPort`｜`completeCcViaLifecycle`｜`completeCodexViaLifecycle`｜`completeOpencodeViaLifecycle`｜`errorNotified`｜`dispatch_failed`

**T14 完成口径**：本轮无真机飞书 → **静态+build 标 pass**（§3.5、§4.7、§7）；上表运行态 IM 标 **待维护者手工**，不阻断 archive。

### 4.7 静态契约核对（T12～T14 已执行）

| 检查项 | 指针 | 期望 | 结果 |
|--------|------|------|------|
| `npm run build`（T14 回归） | 仓库根 | exit 0 | ✅ 2026-07-12 |
| T12 Codex Port 注册 | `codex/engine-port-adapter.ts` `registerCodexEnginePort` | registry 含 `codex` | ✅ |
| T12 终态 notify | `completeCodexViaLifecycle`；`agent-codex-complete.ts` | 经 Lifecycle + template | ✅ |
| T12 notify 薄包装 | `agent-codex-stream.ts` re-export `run-notify` | 无平行 send-text 实现 | ✅ |
| T12 RunEvent 映射 | `mapCodexItem*ToRunEvent` | 发射 `RunEvent` | ✅ |
| T13 OpenCode Port 注册 | `opencode/engine-port-adapter.ts` `registerOpencodeEnginePort` | registry 含 `opencode` | ✅ |
| T13 终态 notify | `completeOpencodeViaLifecycle`；`agent-opencode-complete.ts` | 经 Lifecycle + template | ✅ |
| T13 notify 薄包装 | `agent-opencode-stream.ts` re-export `run-notify` | 无平行 send-text 实现 | ✅ |
| T13 SSE→RunEvent | `mapOpencodeSseToRunEvent` | 联合类型映射 | ✅ |
| 四引擎 Port 同注册 | `agent-sdk-http.ts` L33–35 + L187 | 四 adapter 可查表 | ✅ |
| S7 resume stub | `run-lifecycle.ts` L78–80 | stub 存在；运行态 deferred | ⏸ |
| S8 引擎差异 | Cursor `enterGuardWithLifecycle` vs CC/Codex/OpenCode `acquireRunGuard` | 文档记录 accepted_debt | ⏸ |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无（本变更不扩单元测试/E2E 脚手架） |
| **运行依赖** | Electron 桌面应用 + Daemon；飞书通道已配置 |
| **测试数据** | 四引擎各一 `session_key`；可选临时停 Agent HTTP 制造 dispatch 失败 |
| **环境变量** | 无本变更专属开关 |

## 6、输出与记录规范

会话与本文**禁止**粘贴完整终端日志、IM 正文原文或 apiKey。执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。失败时区分 **环境/配置** vs **Daemon 实现** vs **Electron/shared 实现**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-11 | 本地 dev | `npm run build` | 通过 | exit 0 |
| 2026-07-11 | 本地 dev | 静态：T1～T8 shared + Daemon 对称 | 通过 | 04-review 对齐 |
| 2026-07-12 | 本地 dev | `npm run build`（T11 回归） | 通过 | exit 0 |
| 2026-07-12 | 本地 dev | 静态：T9/T10 Cursor+Claude adapter | 通过 | §3.4 |
| 2026-07-12 | — | **T11** Cursor+Claude S1～S6 运行态 IM | 待手工 | §4.5 |
| 2026-07-12 | 本地 dev | `npm run build`（T14 回归） | 通过 | exit 0 |
| 2026-07-12 | 本地 dev | 静态：T12 Codex adapter + re-export notify | 通过 | §4.7 |
| 2026-07-12 | 本地 dev | 静态：T13 OpenCode adapter + SSE 映射 | 通过 | §4.7 |
| 2026-07-12 | 本地 dev | 静态：四引擎 Port 注册表（`agent-sdk-http.ts`） | 通过 | §3.5 |
| 2026-07-12 | 本地 dev | 静态：T14 矩阵 S1～S6 四引擎 | 通过 | §3.5 |
| 2026-07-12 | 本地 dev | 静态：S7 resume stub / S8 引擎差异记录 | 部分通过 | accepted_debt |
| 2026-07-12 | — | **T14** 四引擎 S1～S8 运行态 IM | 待手工 | §4.6；不阻断 archive |
| 2026-07-11 | — | **S5** dispatch 非 busy / busy 对照 | 待手工 | §4.1 |
| 2026-07-11 | — | **S8** guard busy IM（Cursor） | 待手工 | §4.2 |
