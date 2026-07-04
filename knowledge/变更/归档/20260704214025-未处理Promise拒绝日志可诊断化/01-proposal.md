# 未处理 Promise 拒绝日志可诊断化轻量变更说明

> **变更 ID**：`20260704214025-未处理Promise拒绝日志可诊断化`
> **来源**：kb-lite
> **lite 类型**：记录型 lite
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 变更说明

Electron 主进程与 daemon 的全局 `unhandledRejection` / `uncaughtException` 处理器对非标准 `Error` 对象（如 gRPC、`@cursor/sdk` 返回的含 `code`/`details`/`cause`/`metadata` 结构）仅打印 `[unknown]` 或 message 片段，导致日志无法定位来源与根因。

典型现象：

```
2026-07-04 21:38:32.791 [Electron] ERROR [Main] 未处理的 Promise 拒绝: [unknown] [unavailable] read ETIMEDOUT
```

**方案要点**：

1. 在 `src/shared/` 抽取共享 `formatUnknownError(reason: unknown): string`，供 electron 主进程与 daemon 复用（daemon 不依赖 electron）。
2. **标准 Error**：输出 `message` + `code`（若有）+ stack 首行。
3. **gRPC-like 对象**：提取 `code`、`details`、`message`、`cause`、`errno`、`syscall` 等可诊断字段。
4. **plain object**：安全 JSON 序列化（长度截断、敏感字段脱敏）。
5. `unhandledRejection` 日志补充 Promise 上下文（若 Node 运行时提供）。
6. **可选**：打印 handler 注册点 stack 若干帧（标注为非业务栈，便于区分全局捕获与业务抛出）。
7. `uncaughtException` 同步复用同一 formatter。
8. daemon 侧全局 handler 复用；scope 控制在全局 handler，不大范围改动 `broadcastLog`。

**涉及现状落点**（builder 实现前核对）：

- `electron/main.ts` L193–202：`unhandledRejection` 仅对 `Error` 打印 message
- `src/daemon/daemon.ts` L3537–3543：同类退化

## 验收标准

1. ETIMEDOUT / gRPC 类 rejection 日志包含 `code`、`details`、`errno` 等可诊断字段，不再退化为 `[unknown]` 无信息串。
2. electron main 与 daemon 均通过同一 `formatUnknownError` formatter 输出。
3. TypeScript 编译通过。

## 影响范围

| 范围 | 说明 |
|------|------|
| `src/shared/` | 新增共享错误格式化模块 |
| `electron/main.ts` | 全局 rejection/exception handler 改用 formatter |
| `src/daemon/daemon.ts` | 全局 handler 复用 formatter |
| 用户可见性 | 日志 UI / daemon.log 更易读；归档时 **patch bump + changelog** |

**不在范围**：proto/DB/权限变更；大范围改造 `broadcastLog`；飞书/IM 通道文案。

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、根因、方案与验收已明确 |
| 修改范围 | 少量强相关文件（shared + 两处全局 handler） |
| 接口契约 | 无 proto/HTTP/gRPC 契约变更 |
| 数据/权限 | 不变 |
| 跨端联动 | Electron + daemon 同仓复用 shared，非多端协作 |
| 知识库 | 记录型，05-summary 说明即可 |
| **总分** | **≤2**，可走 lite |
