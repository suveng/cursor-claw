# SDK 流 ETIMEDOUT 未处理 Promise 拒绝修复 — 验收记录

> **变更 ID**：`20260704222750-SDK-ETIMEDOUT未处理Promise拒绝修复`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`05-summary.md`、`LITE-01`）
> **阶段**：静态契约 + 编译冒烟 + 手工/运行时（SDK 网络超时场景）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（`sdk-async-guard` 挂接 + fire-and-forget 补 catch）+ **编译冒烟**（`npm run build`）+ **手工/运行时**（SDK Run + 断网/弱网触发 ETIMEDOUT） |
| **目标** | SDK stream 生命周期链 rejection 由业务 `.catch`/`guardSdkPromise` 消化；ConnectError 日志不含误导性 `[unknown]` 前缀；正常 SDK Run 不受影响 |
| **通过口径** | 静态项 ✅；编译 exit 0；超时场景 UI 日志见 `SDK 异步链异常`，**不出现**周期性 `[Main] 未处理的 Promise 拒绝`；若仍冒泡全局 handler，formatter 输出为 `UNAVAILABLE read ETIMEDOUT` 形态 |
| **与 review 分工** | review 偏实现规范；本文偏验收追溯与执行证据 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **真实 gRPC ETIMEDOUT（约 73s 周期）** | 依赖 SDK 远端与网络环境，复现不稳定、耗时长 |
| **Electron UI 日志面板** | 须启动完整 Electron + Daemon + 飞书/IM 通道 |
| **断网/弱网模拟** | 系统级网络切换须手工操作，无 headless 契约 |
| **`auto_test/` 脚本** | 本期未新增；fire-and-forget 链为进程级副作用，轻量脚本难以无侵入覆盖 |
| **单元/集成测试** | 仓库规范不写单测；由静态 + 手工冒烟覆盖 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** | SDK stream 生命周期链 rejection 被业务 `.catch` 消化，不冒泡 `unhandledRejection`（或显著减少） | 运行时 S1–S2 | UI 日志摘要 | ⏳ 待手工 |
| **01·2** | 若仍触发全局 handler，日志不含 `[unknown]` 前缀，含 `UNAVAILABLE`/gRPC code 映射 | 运行时 S1/S3 | 日志摘要 | ⏳ 待手工 |
| **01·3** | TypeScript 编译通过 | `npm run build` | 编译 exit 0 | ✅ |
| **LITE-01** | `sdk-async-guard` + lifecycle/watchdog/stream/presentation 补 catch | 静态 grep/精读 | 代码 | ✅ 静态 |
| **05·行为摘要** | 超时类 rejection 记 `SDK 异步链异常` 而非全局 rejection | S1 | UI 日志 | ⏳ 待手工 |
| **05·回归** | 正常 SDK Run 完成、IM 回复不受影响 | S4 | E2E 摘要 | ⏳ 待手工 |

## 4、场景摘要

### 4.1 预期日志形态

| 场景 | 应出现 | 不应出现 |
|------|--------|----------|
| **SDK 异步链 catch（主路径）** | `[{sessionKey}] SDK 异步链异常 ({phase}): …`；`phase` 如 `stream→complete`、`watchdog`、`notifySdkFailure`、`finalizeSdkRunOnTimeout:status` 等；detail 含 `UNAVAILABLE read ETIMEDOUT` 或 `code=14`/`code=2` | `[Main] 未处理的 Promise 拒绝`（约每 73s 重复） |
| **ConnectError 格式化** | `UNAVAILABLE read ETIMEDOUT \| code=14 \| …`（或 `code=2`） | `[unknown] [unavailable] read ETIMEDOUT` |
| **全局 handler（兜底）** | 若极少数路径仍冒泡：`[Main] 未处理的 Promise 拒绝:` + formatter 输出，**无** `[unknown]` 前缀 | 裸 `read ETIMEDOUT` 无 code/details |

**日志通道**：SDK 链错误经 `pushUiLog("SDK", …)` → Electron 应用内 **SDK** 分类 UI 日志；全局 rejection 经 `broadcastLog` → **Main** 前缀。

### 4.2 手工/运行时步骤

**前置条件**（S1–S4 共用）：

| 项 | 要求 |
|----|------|
| **运行形态** | 打包版 **或** dev Electron（`npm run dev` 或等价）+ **Daemon 已启动** |
| **通道** | 已配置飞书/IM 通道，Agent 资源类型为 **Cursor SDK** |
| **会话** | 至少一条可用 SDK 会话（`sessionKey` 可在 UI 日志中识别） |
| **日志查看** | Electron 应用内日志面板，筛选 **SDK** / **Main** 分类 |

| 场景 ID | 操作 | 期望（摘要） | 关联 |
|---------|------|--------------|------|
| **S1 ETIMEDOUT 主路径** | ① 飞书/IM 向已绑定 SDK 的会话 **dispatch** 一条会触发 Run 的消息；② Run 进行中 **断网**（或弱网/阻断 SDK 远端），等待 stream 超时（原现象约 73s 周期）；③ 观察 UI 日志 ≥2 分钟 | 出现 `SDK 异步链异常 (stream→complete)` 或相关 `phase`；detail 含 `ETIMEDOUT`/`UNAVAILABLE`；**无** 周期性 `[Main] 未处理的 Promise 拒绝` | 01·1、05 |
| **S2 全局 handler 兜底（可选）** | S1 期间若仍见 Main 级 rejection，记录该行摘要 | 单行含 `UNAVAILABLE read ETIMEDOUT` 或 `code=14`/`code=2`；**不含** `[unknown]` 前缀 | 01·2 |
| **S3 watchdog 链（可选）** | 长 Run + 断网至 idle/absolute watchdog 触发 | 可能出现 `SDK 异步链异常 (watchdog)`，级别 WARN；仍无 Main 周期性 rejection | LITE-01 |
| **S4 正常 Run 回归** | 网络正常下 dispatch 简单任务（如「回复 ok」），等待 Run **正常结束** | IM 收到完整回复；UI 有 `completeSdkRun` 收尾日志；**无** 误报 `SDK 异步链异常`；会话可继续 dispatch | 05·回归 |

**判责**：若仍见 `[Main] 未处理的 Promise 拒绝` 且含 `[unknown]` → 查遗漏的 fire-and-forget 路径或 `formatUnknownError` 分支；若仅有 `SDK 异步链异常` → 主修复生效。

### 4.3 静态/编译冒烟（已执行）

| 检查 | 操作指针 | 期望 |
|------|----------|------|
| 异步守卫模块 | `electron/agent/cursor-sdk/sdk-async-guard.ts` | `logSdkRunChainError`、`guardSdkPromise`、`isSdkNetworkOrTimeoutError` |
| 生命周期 catch | `sdk-run-lifecycle.ts` L53–66 | `streamRunEvents→completeSdkRun` `.catch` + 网络类 `notifySdkFailure` |
| watchdog catch | `sdk-run-watchdog.ts` | `watchRunGuard` 链 `.catch` → `logSdkRunChainError(..., "watchdog", ..., "WARN")` |
| stream/presentation | `sdk-run-stream.ts`、`sdk-run-presentation.ts` | fire-and-forget 改 `guardSdkPromise` |
| ConnectError 格式化 | `src/shared/format-unknown-error.ts` | ConnectError 识别；gRPC `2`/`14` → `UNAVAILABLE`；去 `[unknown]` |
| AGENTS 约定 | `electron/agent/cursor-sdk/AGENTS.md`、`src/shared/AGENTS.md` | fire-and-forget 须 catch 文档化 |
| 全量构建 | 项目根 `npm run build` | exit 0 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **脚本目录** | 本期无 `auto_test/` 新增 |
| **运行依赖** | Node 18+；Electron dev 或打包产物；Daemon 独立进程；飞书/IM 凭据沿用既有配置 |
| **环境变量** | 无新增 |
| **网络模拟** | macOS：系统设置断网 / `networksetup`；或路由器/防火墙阻断 SDK 出站（勿写入凭据） |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 运行时失败时区分：**触发条件不足**（未断网/未达超时） vs **修复回归**（仍见 `[unknown]` 或周期性 Main rejection）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-04 | 本地 dev | 静态挂接（sdk-async-guard + lifecycle/watchdog/stream/presentation） | 通过 | LITE-01 |
| 2026-07-04 | 本地 dev | `npm run build` | 通过 | exit 0 |
| 2026-07-04 | — | S1 ETIMEDOUT 主路径 | 待执行 | 须打包/dev + Daemon + 断网 |
| 2026-07-04 | — | S2 全局 handler 兜底 | 待执行 | 可选 |
| 2026-07-04 | — | S3 watchdog 链 | 待执行 | 可选 |
| 2026-07-04 | — | S4 正常 Run 回归 | 待执行 | 手工 |
