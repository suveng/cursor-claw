# 未处理 Promise 拒绝日志可诊断化 - 验收记录

> **变更 ID**：`20260704214025-未处理Promise拒绝日志可诊断化`
> **阶段**：`/kb-test`（静态契约 + 编译冒烟 + 手工/运行时日志验收）
> **追溯来源**：`01-proposal` 验收 1–3、`LITE-01`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（formatter 与两处全局 handler 挂接）+ **编译冒烟**（`npm run build:mcp`、`npx electron-vite build`）+ **手工/运行时**（触发 `unhandledRejection` / `uncaughtException`，核对日志字段） |
| **目标** | 确认 gRPC/ETIMEDOUT 类 rejection 不再退化为 `[unknown]`；electron 主进程与 daemon 共用 `formatUnknownError`；TypeScript 编译通过 |
| **通过口径** | 静态项 ✅；编译 exit 0；运行时日志含约定诊断字段且含 `注册点` hint（启用时） |
| **与 review 分工** | review 偏实现规范；本文偏验收追溯与执行证据 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **真实 gRPC ETIMEDOUT** | 依赖网络/SDK 远端不可达，复现不稳定、耗时长 |
| **Electron `broadcastLog` 落盘路径** | 须启动完整 Electron 应用并打开日志 UI 或读日志文件 |
| **daemon `log()` 输出** | 须独立启动 daemon 进程并 tail 控制台或 daemon 日志文件 |
| **`auto_test/` 脚本** | 本期未新增；全局 handler 为进程级副作用，轻量脚本难以无侵入覆盖双进程 |
| **敏感字段脱敏** | 须构造含 `token`/`password` 等键的对象手工核对，无默认自动化 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** | ETIMEDOUT/gRPC rejection 含 `code`、`details`、`errno` 等，非 `[unknown]` | 运行时 S1–S3 | 日志摘要 | ⏳ 待手工 |
| **01·2** | electron main 与 daemon 均经同一 `formatUnknownError` | 静态挂接 + S1/S3 对比格式 | 代码 / 日志 | ✅ 静态；⏳ 运行时 |
| **01·3** | TypeScript 编译通过 | `build:mcp` + `electron-vite build` | 编译 exit 0 | ✅ |
| **LITE-01** | 实现 formatter 并改进全局 rejection/exception 日志 | `format-unknown-error.ts` + `main.ts` L194–208 + `daemon.ts` L3521–3528 | 代码 | ✅ 静态 |
| **提案·5** | `unhandledRejection` 补充 Promise 上下文 | 日志含 `promise=[object Promise]` | 日志 | ⏳ 待手工 |
| **提案·6** | handler 注册点 stack hint | 日志含 `注册点:` 帧 | 日志 | ⏳ 待手工 |
| **提案·7** | `uncaughtException` 同步复用 formatter | S4 抛同步异常 | 日志 | ⏳ 待手工 |

## 4、场景摘要

### 4.1 预期日志字段（`formatUnknownError` 契约）

| 类别 | 应出现字段/片段 | 不应出现 |
|------|-----------------|----------|
| **标准 Error** | `message`；若有则 `code=`、`errno=`、`syscall=`；stack 首条 `at …` 行 | 单独 `[unknown]` |
| **gRPC-like 对象** | `code=`、`details=`、`message=`；可选 `errno=`、`syscall=`、`status=`、`metadata=` | 仅 message 片段无 code |
| **cause 链** | `cause=…`（嵌套 ≤2 层） | 无限递归展开 |
| **plain object（无已知键）** | 脱敏后 JSON；敏感键值为 `[redacted]` | 明文 token/password |
| **handler 选项** | 后缀 `| 注册点:` + 2–4 帧 stack（`main.ts`/`daemon.ts` 均 `includeRegistrationHint: true`） | — |
| **Promise 上下文** | 后缀 `| promise=[object Promise]` | — |

**日志前缀**：

| 进程 | `unhandledRejection` 前缀 | `uncaughtException` 前缀 |
|------|----------------------------|--------------------------|
| Electron 主进程 | `[Main] 未处理的 Promise 拒绝:`（经 `broadcastLog`，级别 ERROR） | `[Main] 未捕获异常:` |
| daemon | `未处理的 Promise 拒绝:`（`log("ERROR", …)`） | `未捕获异常:` |

### 4.2 手工/运行时触发步骤

| 场景 ID | 前置 | 触发方式（任选其一） | 期望（摘要） | 关联 |
|---------|------|----------------------|--------------|------|
| **S1 Electron·gRPC-like** | 本地 dev 启动 Electron（`npm run dev` 或等价） | 主进程 DevTools / 临时 dev 片段：`Promise.reject({ code: 14, details: 'read ETIMEDOUT', message: '14 UNAVAILABLE: read ETIMEDOUT', errno: -60, syscall: 'read' })` | UI 日志或控制台见 `code=14`、`details=read ETIMEDOUT`、`errno=-60`、`syscall=read`、`注册点:`、`promise=[object Promise]` | 01·1/2 |
| **S2 Electron·Error+code** | 同上 | `Promise.reject(Object.assign(new Error('read ETIMEDOUT'), { code: 'UNAVAILABLE', errno: -60, syscall: 'read' }))` | 含 message、`code=UNAVAILABLE`、`errno`、`syscall`、stack `at` 行 | 01·1 |
| **S3 daemon·同类** | 独立启动 daemon（`node` 入口或项目既有启动命令） | 在 daemon 进程上下文执行与 S1 相同 `Promise.reject(…)`（dev 临时注入或复现真实 SDK/gRPC 超时） | daemon 日志行格式与 S1 字段一致，前缀为 daemon 口径 | 01·1/2 |
| **S4 uncaughtException** | Electron 或 daemon 任一 | `throw Object.assign(new Error('sync fail'), { code: 'TEST' })`（非 Promise） | `未捕获异常:` 行含 formatter 输出 + `注册点:` | 提案·7 |
| **S5 脱敏** | Electron 或 daemon | `Promise.reject({ message: 'fail', authorization: 'secret-value' })` | JSON 或字段中 `authorization=[redacted]` | formatter 脱敏 |
| **S6 真实 ETIMEDOUT（可选）** | SDK/gRPC 远端不可达 | 正常发起会超时的 Agent/SDK 调用，等待自然 rejection | 日志含 `ETIMEDOUT` 且带 `code`/`details`/`errno` 等，**非** `[unknown] [unavailable] read ETIMEDOUT` 无字段形态 | 01·1 |

**判责**：若字段齐全但前缀/通道不对 → 查 `broadcastLog` / daemon `log` 路由；若仍 `[unknown]` → 查 `formatUnknownError` 入参类型是否落入未覆盖分支。

### 4.3 静态/编译冒烟（已执行）

| 检查 | 操作指针 | 期望 |
|------|----------|------|
| 共享 formatter | `src/shared/format-unknown-error.ts` | `DIAGNOSTIC_KEYS` 含 code/details/errno/syscall/cause；`includeRegistrationHint` |
| Electron 挂接 | `electron/main.ts` L194–208 | `uncaughtException` / `unhandledRejection` 均调用 `formatUnknownError(…, { includeRegistrationHint: true })` |
| daemon 挂接 | `src/daemon/daemon.ts` L3521–3528 | 与 main 对称；`promise` 上下文拼接 |
| MCP 构建 | 项目根 `npm run build:mcp` | exit 0 |
| Electron 构建 | 项目根 `npx electron-vite build` | exit 0 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **脚本目录** | 本期无 `auto_test/` 新增 |
| **运行依赖** | Node 18+；Electron dev 或打包产物；daemon 独立进程 |
| **环境变量** | 无新增；通道/SDK 凭据沿用既有配置（勿写入本文） |
| **日志查看** | Electron：应用内日志面板或主进程控制台；daemon：启动终端或项目约定 daemon 日志路径 |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 运行时失败时区分：**触发方式错误** vs **formatter/handler 回归**（记备注列）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-04 | 本地 dev | 静态挂接（formatter + main + daemon） | 通过 | LITE-01 |
| 2026-07-04 | 本地 dev | `npm run build:mcp` | 通过 | exit 0 |
| 2026-07-04 | 本地 dev | `npx electron-vite build` | 通过 | exit 0 |
| 2026-07-04 | — | S1 Electron gRPC-like | 待执行 | 手工 |
| 2026-07-04 | — | S2 Electron Error+code | 待执行 | 手工 |
| 2026-07-04 | — | S3 daemon 同类 | 待执行 | 手工 |
| 2026-07-04 | — | S4 uncaughtException | 待执行 | 手工 |
| 2026-07-04 | — | S5 脱敏 | 待执行 | 可选 |
| 2026-07-04 | — | S6 真实 ETIMEDOUT | 待执行 | 可选 |
