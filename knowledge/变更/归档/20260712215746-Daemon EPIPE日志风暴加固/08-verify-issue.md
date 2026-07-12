# 验收问题报告

> **变更 ID**：`20260712215746-Daemon EPIPE日志风暴加固`
> **manifest 阶段**：`acceptance_reopened`（第 1 轮验收打回，归因 code）
> **flow**：lite（hotfix-lite）

## 第 1 轮

### 反馈问题

产品验收反馈（2026-07-12 21:52+）：

1. `daemon.log` / `log/daemon.log.old` 在 **21:55:31** 出现约 **3600 条**相同 ERROR：`未捕获异常: write EPIPE | code=EPIPE | errno=-32 | syscall=write`，形成**日志风暴**。
2. **触发场景**：Electron 父进程重启或退出时，Daemon 子进程 **stderr 管道读端关闭**，后续写 stderr 持续失败。
3. 前序修复 commit `8a3055e`（20:29）已在 `daemon-logging.ts` 对 `process.stderr.write` 加 `try/catch`，并在 `daemon.ts` 的 `uncaughtException` / `unhandledRejection` 中对 `code === "EPIPE"` 早退；**21:45 重建的 App bundle 已含该修复代码**，用户仍见风暴。
4. **疑因**：① 未重启的**旧 Daemon 子进程**仍在运行旧逻辑；② 现有防御**不完整**（异步 EPIPE、无 stderr error 监听、断管后仍写 stderr、裸 `stderr.write` 绕过日志器）。

### 归因结论

**code**（代码实现问题：EPIPE 防御不完整，非 PRD 口径缺失）

### 判定依据

| 维度 | 前序修复（8a3055e） | 缺口 | 本轮加固（已读盘确认） |
|------|---------------------|------|------------------------|
| **同步 EPIPE** | `daemon-logging.ts` `try/catch` 包裹 `stderr.write` | 仅捕 sync 抛错 | 保留；断管后 `stderrBroken` 永久跳过 stderr |
| **异步 EPIPE** | 无 | `stderr.on('error')` 未注册，异步 EPIPE 进 `uncaughtException` | `createDaemonLogger` 注册 `process.stderr.on('error')` + `markDaemonStderrBroken()` |
| **断管后递归** | uncaught 内 `log("ERROR",…)` 再次写 stderr | 未标记断管，处理器内再触发 EPIPE → 递归风暴 | `stderrBroken` 标志 + uncaught/unhandled 早退时 `markDaemonStderrBroken()` |
| **EPIPE 判定** | 硬编码 `err.code === "EPIPE"` | 未覆盖 errno/message/syscall 形态 | 新增 `src/shared/is-broken-pipe-error.ts` 统一 SSOT |
| **uncaught 重入** | 无深度防护 | `loggingUncaught` finally 过早清零，重入可再次写 stderr | `loggingUncaughtDepth` 计数 + 重入短路 |
| **裸 stderr.write** | 未覆盖 | `daemon-entry.ts` 启动失败路径、`daemon-session-routing-persist.ts` WARN 路径可绕过日志器 | entry 双层 try/catch；persist 改 `safeStderrWrite` + `isBrokenPipeError` |

**源码链路（已核实）**：

| 步骤 | 位置 | 说明 |
|------|------|------|
| 1 | `src/shared/is-broken-pipe-error.ts` | `isBrokenPipeError`：code / errno(-32) / message / syscall=write |
| 2 | `src/daemon/daemon-logging.ts` L20–40、L84–90 | `stderrBroken`、`stderr.on('error')`、`markDaemonStderrBroken()`、断管后跳过 stderr |
| 3 | `src/daemon/daemon.ts` L160–190 | uncaught/unhandled 早退 + `loggingUncaughtDepth` 防重入 |
| 4 | `src/daemon-entry.ts` L4–10 | 启动失败路径 try/catch 静默断管写失败 |
| 5 | `src/daemon/daemon-session-routing-persist.ts` L62–73 | `safeStderrWrite` 替代裸 `process.stderr.write` |
| 6 | `package.json` / `changelog/1.14.7.json` | 版本 **1.14.7**，changelog 已记录修复摘要 |

**运行证据**：`log/daemon.log.old` 约 3600 条同秒（21:55:31）重复行，符合 uncaught 处理器内 `log()` 再写 stderr 的**递归风暴**特征；与「父进程退出、stderr 读者关闭」触发条件一致。

**旧进程假说**：App bundle 21:45 已含 8a3055e，但 Daemon 为 Electron spawn 的**独立子进程**；若用户未完全退出/重启应用，旧 Daemon 可能仍运行不完整防御逻辑——**不能单独解释 3600 条风暴**，根因仍以代码防御缺口为主。

### 影响范围

| 模块 | 影响 |
|------|------|
| `src/shared/is-broken-pipe-error.ts` | 新增，EPIPE 判定 SSOT |
| `src/daemon/daemon-logging.ts` | stderr error 监听、断管标志、断管后仅写文件 |
| `src/daemon/daemon.ts` | uncaught/unhandled 早退、重入防护 |
| `src/daemon-entry.ts` | 启动失败路径防 EPIPE |
| `src/daemon/daemon-session-routing-persist.ts` | 写盘 WARN 安全 stderr |
| **可观测性** | 断管场景下磁盘日志风暴、磁盘占用、ERROR 噪声；stderr 断管后文件日志仍应正常 |
| **用户侧** | Electron 重启/退出、Daemon 热更新未杀旧进程时易复现 |
| **版本** | `1.14.6` → **`1.14.7`**（patch） |

### 后续处理路径

| 项 | 状态 | 动作 |
|----|------|------|
| lite 代码加固 | **已实施**（builder 完成，见上表） | 无需再开 `/kb-apply` |
| 用户侧重验 | **待执行** | **完全退出并重启 App**（或重装 **≥1.14.7** bundle），确保新 Daemon 子进程加载加固逻辑 |
| 断管场景验收 | **待执行** | 模拟 Electron 重启/退出后观察 `daemon.log`：**不得**再出现数千条 `write EPIPE` 递归风暴；断管后 INFO/WARN 仍写入文件 |
| KB 闭环 | **待执行** | `/kb-test` 补 `06-automation-test.md` → `/kb-archive` 归档并发布 1.14.7 |

**说明**：integration 未启用（`kb.project.json` 无 registry），本轮仅本地 `08` 履历，无外部 sync。
