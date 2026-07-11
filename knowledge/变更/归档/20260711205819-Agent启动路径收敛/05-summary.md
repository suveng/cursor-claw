# Agent 启动路径收敛 — 变更总结

> **变更 ID**：`20260711205819-Agent启动路径收敛`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested` → 待 `archived`（无债务）  
> **用户可见性**：无 — **跳过** `changelog/` 与 `package.json` version bump（内部架构 SSOT 收敛）

---

## 1、实际变更

### 代码

| 文件 | 改动 |
|------|------|
| `electron/session/session-dispatcher.ts` | `launchAgent` 删除四引擎分叉（含 SDK Daemon 三角跳转、CC/Codex/OpenCode 独立端口 POST），统一 `return launchSdkAgentFromHttp(launchBody)`；`initSessionDispatcher` 移除三行 `ensureClaudeCode/Codex/OpencodeHttpServer`，仅注册 resolver/observability |
| `electron/session/session-dispatcher-{launch,chat,lifecycle,runtime,shared}.ts` | **T-DEBT-1**：原 637 行单体拆为 5 职责子模块 + 主入口 46 行薄 re-export；各子文件 ≤212 行，满足 AGENTS ≤300 规范 |
| `electron/agent/shared/launch-request-resolve.ts` | **T3**：IM（Daemon 转发）与本地四入口共用 `ParsedLaunchRequest` 解析 SSOT；`session-dispatcher-launch` 与四引擎 `agent-*-http.ts` 统一引用 |
| `electron/agent/{cursor-sdk,claude-code,codex,opencode}/agent-*-http.ts` | 网关内 launch body 解析改走 `launch-request-resolve`，去除各引擎重复解析逻辑 |

**静态验收**：grep `getCc/Codex/OpencodeAgentApiPort` @ session-dispatcher 零命中；grep `ensureClaudeCode/Codex/OpencodeHttpServer` @ initSessionDispatcher 零命中；`daemon-manager.ts` 仍 `ensureAgentSdkHttpServer()`；`npm run build` 通过（见 `06-automation-test.md`）。

### 工程约定（AGENTS）

| 文件 | 改动 |
|------|------|
| `electron/session/AGENTS.md` | 任务/工作流/`/chat` 经 `launchSdkAgentFromHttp` 统一网关，不按引擎直 POST 独立端口 |
| `electron/AGENTS.md` | 四入口 + init 懒加载口径 |
| `electron/agent/cursor-sdk/AGENTS.md` | IM 与本地入口汇入统一网关 SSOT |
| `electron/agent/shared/AGENTS.md` | `launch-request-resolve` 解析 SSOT 与模块边界 |
| `electron/daemon/AGENTS.md` | Daemon 桥接一句对齐 |

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`（T1/T2/T-DEBT-1/T3/T4/T5 均 `done`；R-DEBT-01 `fixed`；stage=`tested`）

---

## 2、与设计的差异

1. **T3 提前完成**：原 design 将 `shared/launch-request` 标 `deferred`；归档前已实现 `launch-request-resolve.ts`，四引擎 HTTP 与 dispatcher launch 共用解析 SSOT。
2. **R-DEBT-01 已消化**：原 design 接受 637 行单体债务；归档前已通过 T-DEBT-1 拆为 6 文件（主入口 46 行 + 5 子模块各 ≤212 行）。
3. **清债完成**：原 §2 所列 T3 deferred、R-DEBT-01、手动 E2E 阻断性债务均已移除；无 accepted_debt 项。

其余与 `02-design.md` F1～F6、`03` T1/T2/T4/T5 一致。

---

## 3、影响范围

- **全路径统一网关 SSOT**：IM（Daemon `POST /api/agent/launch`）、定时任务、工作流、`/chat new` 均经 `launchSdkAgentFromHttp` → `resolveBoundAgentResourceType` → 各引擎 handler。
- **按需懒加载**：应用启动时仅 `ensureAgentSdkHttpServer` 常驻统一网关；非 SDK 引擎服务不在 init 阶段无条件拉起。
- **仅 SDK Profile**：冷启动进程内 Agent HTTP 服务实例数逻辑上为 1（仅 `agent-api-port.json`）。
- **launch 解析 SSOT**：`launch-request-resolve.ts` 统一 body/workDir/model 解析，消除网关与 dispatcher 二次解析分叉。
- **用户可见**：四引擎启动、调度、流式输出、失败文案语义保持；无 UI/指令语法变更。

---

## 4、知识库更新清单

- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — §二 全路径统一网关；§四/§五/§十 同步
- [x] `knowledge/业务域/Agent调度/00-README.md` — 关键源码与统一网关描述
- [x] `knowledge/业务域/Agent调度/01-概览.md` — 架构未变，无需更新
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新

---

## 5、遗留债务

**无遗留债务。** T-DEBT-1（session-dispatcher 拆分）与 T3（launch-request 解析收敛）均已在归档前完成；R-DEBT-01 已 `fixed`。
