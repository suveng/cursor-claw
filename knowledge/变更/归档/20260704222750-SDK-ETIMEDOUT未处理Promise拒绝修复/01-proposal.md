# SDK 流 ETIMEDOUT 未处理 Promise 拒绝修复轻量变更说明

> **变更 ID**：`20260704222750-SDK-ETIMEDOUT未处理Promise拒绝修复`
> **来源**：kb-lite
> **lite 类型**：记录型 lite
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

用户报告打包版 1.13.6 Electron 主进程出现未处理 Promise 拒绝，约每 73 秒重复：

```
[unknown] [unavailable] read ETIMEDOUT | code=2 | ... | cause=[unavailable] read ETIMEDOUT | code=14 | ... | cause=read ETIMEDOUT
```

上一变更 `20260704214025-未处理Promise拒绝日志可诊断化` 已改善 `formatUnknownError`，但未消除 rejection 冒泡；ConnectError message 仍含误导性 `[unknown]` 前缀。

## 变更说明

**优先**：为 `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` L47 `streamRunEvents(...).then(() => completeSdkRun(...))` 补 `.catch()`，将 ETIMEDOUT/网络错误记入 SDK UI 日志，而非全局 `unhandledRejection`。

**同步**：

- `sdk-run-watchdog.ts` 中 `watchRunGuard` 的 `.then()` 补 `.catch()`
- `sdk-run-stream.ts` 中 `void finalizeSdkRunOnTimeout`、`void notifySdkFailure` 等 fire-and-forget 调用补 `.catch()`

**次要**：增强 `src/shared/format-unknown-error.ts`，识别 ConnectError/gRPC code，输出 `UNAVAILABLE read ETIMEDOUT` 而非 `[unknown] [unavailable]...`；映射 code `2`/`14` → `UNAVAILABLE`。

**不扩 scope**：不改 SDK 内部实现、不新增单元测试；单文件 ≤300 行；中文注释。

## 验收标准

1. SDK stream 生命周期链 rejection 被业务 `.catch()` 消化，不冒泡到 main `unhandledRejection`（或显著减少）。
2. 若仍触发全局 handler，日志不含误导性 `[unknown]` 前缀，含 `UNAVAILABLE`/gRPC code 映射。
3. TypeScript 编译通过。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/agent/cursor-sdk/*` | `sdk-run-lifecycle.ts`、`sdk-run-watchdog.ts`、`sdk-run-stream.ts` 等 fire-and-forget 补 catch |
| `src/shared/format-unknown-error.ts` | ConnectError/gRPC code 识别与格式化 |
| 相关 `AGENTS.md` | 沉淀 fire-and-forget 与 ConnectError 日志约定 |
| 知识库 | 记录型 lite，知识库无需更新（约定已在 AGENTS.md） |

**不在范围**：proto/DB/权限变更；SDK 包内部修改；新增单元测试。

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、落点文件与验收已明确 |
| 修改范围 | 少量强相关文件（cursor-sdk + shared formatter） |
| 接口契约 | 无 proto/HTTP/gRPC 契约变更 |
| 数据/权限 | 不变 |
| 跨端联动 | 仅 Electron 主进程 SDK 路径 |
| 知识库 | 记录型，05-summary 说明「知识库无需更新」即可 |
| **总分** | **≤2**，可走 lite |
