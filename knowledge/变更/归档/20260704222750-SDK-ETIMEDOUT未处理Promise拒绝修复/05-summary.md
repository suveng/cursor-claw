# SDK 流 ETIMEDOUT 未处理 Promise 拒绝修复 — 变更总结

> **变更 ID**：`20260704222750-SDK-ETIMEDOUT未处理Promise拒绝修复`
> **来源**：kb-lite
> **lite 类型**：记录型
> **阶段**：`archived`

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/sdk-async-guard.ts` | **新建**：`logSdkRunChainError`、`guardSdkPromise`、`isSdkNetworkOrTimeoutError`；fire-and-forget 统一消化 rejection |
| `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` | `streamRunEvents→completeSdkRun` 补 `.catch`；网络/超时类错误记 ERROR 并可选 `notifySdkFailure` |
| `electron/agent/cursor-sdk/sdk-run-watchdog.ts` | `watchRunGuard` 链 `.catch` 记 WARN |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | `finalizeSdkRunOnTimeout` / `notifySdkFailure` / `postPresentationEvent` 改 `guardSdkPromise` |
| `electron/agent/cursor-sdk/sdk-run-presentation.ts` | `flushDeferredStreamPost` / thinking final `postPresentationEvent` 改 `guardSdkPromise` |
| `src/shared/format-unknown-error.ts` | ConnectError 识别；去 `[unknown]` 前缀；gRPC code `2`/`14` → `UNAVAILABLE` 展示 |
| `electron/agent/cursor-sdk/AGENTS.md` | 沉淀 fire-and-forget 须 `.catch` / `guardSdkPromise` 规矩 |
| `src/shared/AGENTS.md` | ConnectError 格式化约定 |
| `package.json` | `1.13.6` → **`1.13.7`**（patch） |
| `changelog/1.13.7.json` | **新建** |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）、`06-automation-test.md`。

### 行为摘要

| 项 | 变更前 | 变更后 |
|----|--------|--------|
| SDK stream 生命周期链 rejection | 冒泡至 main `unhandledRejection` | 业务 `.catch` / `guardSdkPromise` 记 SDK UI 日志 |
| ConnectError 全局日志 | `[unknown] [unavailable] read ETIMEDOUT \| code=2 …` | `UNAVAILABLE read ETIMEDOUT \| code=14 \| …` |

**不变**：`@cursor/sdk` 内部、proto/DB、单元测试；飞书 tool 里程碑展示路径。

---

## 2、与 01-proposal / 设计差异

| 项 | 01 预期 | 实际 | 评估 |
|----|---------|------|------|
| ETIMEDOUT rejection 消化 | lifecycle/watchdog/stream 补 catch | 另建 `sdk-async-guard.ts` 统一守卫 | 实现细化，行为一致 |
| ConnectError 格式化 | `format-unknown-error` 增强 | 已落地 | 一致 |
| Task 工具飞书描述 | 01 未列（验收补发现） | 未纳入本 commit | **已拆至独立变更** `20260704223914-SDK飞书Tool开始态与Watchdog误杀修复` |
| 单元测试 | 不新增 | 未新增 | 一致 |

lite 无 `02-design.md`；主修复与 `01-proposal.md` 一致。

---

## 3、影响范围

| 范围 | 说明 |
|------|------|
| **Electron 主进程 SDK** | `sdk-run-*` fire-and-forget 链、ConnectError 日志 |
| **shared** | `format-unknown-error` |
| **用户可见** | **是** — 打包版不再周期性 `unhandledRejection` |
| **不涉及** | proto/HTTP 契约、业务域语义、SDK 包内部、Daemon 飞书 tool 里程碑 |

### 3.1 Ponytail 技术债

无。

---

## 4、知识库影响

**记录型 lite** — 编码约定已写入 `electron/agent/cursor-sdk/AGENTS.md`、`src/shared/AGENTS.md`；**业务域知识库无需更新**。

| 文件 | 结论 |
|------|------|
| `electron/agent/cursor-sdk/AGENTS.md` | **已更新** |
| `src/shared/AGENTS.md` | **已更新** |
| `knowledge/业务域/**` | 不需要 |

---

## 5、验证结果

| 项 | 结果 |
|----|------|
| LITE-01 实现 | done |
| TypeScript 编译 | **通过**（`npx tsc --noEmit` exit 0） |
| 单文件 ≤300 行 | **通过** |
| ETIMEDOUT rejection 不再 unhandled | 待打包/联调确认 |
