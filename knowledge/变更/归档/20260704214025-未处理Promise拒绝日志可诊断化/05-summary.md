# 未处理 Promise 拒绝日志可诊断化 — 变更总结

> **变更 ID**：`20260704214025-未处理Promise拒绝日志可诊断化`
> **来源**：kb-lite
> **lite 类型**：记录型
> **阶段**：`applied`（归档由 kb-release 执行）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `src/shared/format-unknown-error.ts` | **新建**：`formatUnknownError(reason, options?)` 共享诊断格式化 SSOT；覆盖 Error、gRPC-like plain object、原始值；敏感键脱敏、JSON 截断、cause 递归（≤2 层）、可选 handler 注册点 stack hint |
| `electron/main.ts` | `uncaughtException` / `unhandledRejection` 改用 `formatUnknownError(..., { includeRegistrationHint: true })`；rejection 日志追加 `promise=[object Promise]` 上下文 |
| `src/daemon/daemon.ts` | 全局 handler 与 electron 对称复用同一 formatter |
| `src/shared/AGENTS.md` | 目录职责表新增 `format-unknown-error.ts`；约定全局 handler **须**调用 `formatUnknownError`，禁止 `[unknown]` 退化 |
| `electron/AGENTS.md` | 跨模块规矩补充「全局异常日志」：`main.ts` handler **须**经 shared formatter |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

### 行为摘要（`formatUnknownError`）

| 输入类型 | 输出形态 |
|----------|----------|
| **标准 `Error`** | `message` + 可选 `code` / `errno` / `syscall` + stack 首条 `at …` 行 + 可选 `cause=…` |
| **gRPC-like / SDK 对象** | 按 `code`、`details`、`message`、`errno`、`syscall`、`name`、`status`、`errorCode`、`metadata`、`cause` 顺序提取已知诊断字段，`|` 拼接；`metadata` 单独 JSON（512 字符上限）；`cause` 递归格式化 |
| **plain object** | 有诊断字段时同上；否则脱敏后 `safeJsonStringify`（2048 字符上限，循环引用标记 `[Circular]`） |
| **原始值** | `String(reason)` |
| **选项 `includeRegistrationHint`** | 追加 `注册点: at … ⏎ at …`（handler 注册栈帧，便于区分全局捕获与业务抛出） |

**用户可见行为**：Electron UI 日志与 `daemon.log` 中未处理 rejection/exception 行由 `[unknown]` 或无结构片段，变为含 `code`/`errno`/`syscall`/`details` 等可检索字段的单行诊断串。

**不变**：`broadcastLog` 大范围改造、飞书/IM 通道文案、proto/DB、业务 catch 路径。

---

## 2、日志输出示例

### ETIMEDOUT（`Error` + Node 网络字段）

变更前（01 典型现象）：

```
[Electron] ERROR [Main] 未处理的 Promise 拒绝: [unknown] [unavailable] read ETIMEDOUT
```

变更后（示意）：

```
[Electron] ERROR [Main] 未处理的 Promise 拒绝: read ETIMEDOUT | code=ETIMEDOUT | errno=-60 | syscall=read | at TCP.onStreamRead (node:internal/stream_base_commons:190:23) | promise=[object Promise] | 注册点: at process.<anonymous> (electron/main.ts:202:9) ⏎ at process.emit (node:events:518:28)
```

### gRPC `UNAVAILABLE`（plain object / SDK 结构）

变更后（示意）：

```
[Daemon] ERROR 未处理的 Promise 拒绝: 14 UNAVAILABLE: No connection established | code=14 | details=No connection established | message=14 UNAVAILABLE: No connection established | metadata={"grpc-status":"14"} | promise=[object Promise] | 注册点: at process.<anonymous> (daemon.ts:3524:11) ⏎ …
```

> 示例字段组合随 rejection 实际结构略有差异；核心验收为不再退化为无字段的 `[unknown]` 串。

---

## 3、根因与修复摘要

| 项 | 说明 |
|----|------|
| **现象** | 全局 handler 仅 `instanceof Error` 分支取 `message`，gRPC/SDK 含 `code`/`details`/`cause` 的对象被压成 `[unknown]` 或碎片 |
| **根因** | `electron/main.ts` 与 `daemon.ts` 各自内联退化逻辑，无共享诊断提取 |
| **修复** | `src/shared/format-unknown-error.ts` 单点 SSOT；两处全局 handler 统一调用 |
| **与设计差异** | 无。lite 无 `02-design.md`；实现与 `01-proposal.md` LITE-01 一致 |

---

## 4、影响范围

| 范围 | 说明 |
|------|------|
| **Electron 主进程** | `uncaughtException` / `unhandledRejection` 日志可诊断化 |
| **Daemon** | 同上，经 `log("ERROR", …)` 写入 daemon.log |
| **用户可见** | **是** — 日志 UI / daemon.log 排障可读性提升；无 IM 文案或功能行为变更 |
| **不涉及** | `broadcastLog` 全链路、飞书 presentation、proto/HTTP 契约 |

### 4.1 Ponytail 技术债

无。

---

## 5、知识库影响清单

**记录型 lite** — 编码约定已在 `AGENTS.md` 落地；工程平台可观测正文 **待 kb-librarian 同步**。

| 文件/分区 | 结论 | 说明 |
|-----------|------|------|
| `src/shared/AGENTS.md` | **已更新**（LITE-01） | `format-unknown-error.ts` 职责与强制调用约定 |
| `electron/AGENTS.md` | **已更新**（LITE-01） | 全局异常日志须经 shared formatter |
| `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` | **待 kb-librarian** | §七 非功能与可观测：补充 `formatUnknownError` 与 rejection 日志字段约定 |
| `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` 或 `03-进程模型与部署.md` | **待 kb-librarian** | 全局 handler 诊断日志与 electron 对称说明 |
| `knowledge/业务域/**` | 不需要 | 无业务语义或接口契约变更 |

---

## 6、验证结果

| 项 | 结果 |
|----|------|
| LITE-01 实现 | done — 五文件已落地 |
| TypeScript 编译 | **待 kb-release 或人工确认**（01 验收项 3） |
| ETIMEDOUT / gRPC rejection 日志含诊断字段 | **待人工或联调确认**（01 验收项 1–2） |

---

## 7、归档待办（`/kb-archive`，归 kb-release）

| # | 项 | 说明 |
|---|-----|------|
| 1 | **版本 bump** | `package.json`：`1.13.5` → `1.13.6`（patch） |
| 2 | **Changelog** | 新建 `changelog/1.13.6.json`，建议条目：未处理 Promise 拒绝与未捕获异常日志输出可诊断字段，便于排障 |
| 3 | **manifest.files** | 归档轮次将 `package.json`、`changelog/1.13.6.json` 写入 `files[]` |
| 4 | **目录迁移** | `mv` 至 `knowledge/变更/归档/`（本步骤不由 kb-scribe 执行） |
| 5 | **知识库同步** | kb-librarian 按 §5 待办补充工程平台可观测说明 |
