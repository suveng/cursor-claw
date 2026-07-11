# Agent 启动路径收敛 — 变更总结

> **变更 ID**：`20260711205819-Agent启动路径收敛`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested` → `archived_with_debt`  
> **用户可见性**：无 — **跳过** `changelog/` 与 `package.json` version bump（内部架构 SSOT 收敛）

---

## 1、实际变更

### 代码

| 文件 | 改动 |
|------|------|
| `electron/session/session-dispatcher.ts` | `launchAgent` 删除四引擎分叉（含 SDK Daemon 三角跳转、CC/Codex/OpenCode 独立端口 POST），统一 `return launchSdkAgentFromHttp(launchBody)`；`initSessionDispatcher` 移除三行 `ensureClaudeCode/Codex/OpencodeHttpServer`，仅注册 resolver/observability |

**静态验收**：grep `getCc/Codex/OpencodeAgentApiPort` @ session-dispatcher 零命中；grep `ensureClaudeCode/Codex/OpencodeHttpServer` @ initSessionDispatcher 零命中；`daemon-manager.ts` 仍 `ensureAgentSdkHttpServer()`；`npm run build` 通过（见 `06-automation-test.md`）。

### 工程约定（AGENTS）

| 文件 | 改动 |
|------|------|
| `electron/session/AGENTS.md` | 任务/工作流/`/chat` 经 `launchSdkAgentFromHttp` 统一网关，不按引擎直 POST 独立端口 |
| `electron/AGENTS.md` | 四入口 + init 懒加载口径 |
| `electron/agent/cursor-sdk/AGENTS.md` | IM 与本地入口汇入统一网关 SSOT |
| `electron/daemon/AGENTS.md` | Daemon 桥接一句对齐 |

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`（T1/T2/T4/T5 `done`，T3 `deferred`；stage=`tested`）

---

## 2、与设计的差异

1. **T3 `shared/launch-request` 解析收敛**：按 design YAGNI 标 `deferred`，未新建 `launch-request` 文件；`launchBody` 组装与网关内二次解析保持现网形态。
2. **`session-dispatcher.ts` 仍 637 行**（R-DEBT-01）：本期仅删直连分支未拆分，与 Orchestrator 变更同类 accepted_debt。
3. **四引擎 × 四入口手动 E2E**：代码路径已收敛，跨引擎行为回归须在发布 checklist 点验（不阻断 archive）。

其余与 `02-design.md` F1～F6、`03` T1/T2/T4/T5 一致。

---

## 3、影响范围

- **全路径统一网关 SSOT**：IM（Daemon `POST /api/agent/launch`）、定时任务、工作流、`/chat new` 均经 `launchSdkAgentFromHttp` → `resolveBoundAgentResourceType` → 各引擎 handler。
- **按需懒加载**：应用启动时仅 `ensureAgentSdkHttpServer` 常驻统一网关；非 SDK 引擎服务不在 init 阶段无条件拉起。
- **仅 SDK Profile**：冷启动进程内 Agent HTTP 服务实例数逻辑上为 1（仅 `agent-api-port.json`）。
- **用户可见**：四引擎启动、调度、流式输出、失败文案语义保持；无 UI/指令语法变更。
- **非目标未做**：`session-dispatcher.ts` 行数拆分（关联「巨型单体拆分」）；T3 launch-request 收敛。

---

## 4、知识库更新清单

- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — §二 全路径统一网关；§四/§五/§十 同步
- [x] `knowledge/业务域/Agent调度/00-README.md` — 关键源码与统一网关描述
- [x] `knowledge/业务域/Agent调度/01-概览.md` — 架构未变，无需更新
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新

---

## 5、遗留债务（归档可接受）

| 项 | 说明 | 建议消化时机 |
|----|------|--------------|
| **R-DEBT-01** | `session-dispatcher.ts` 637 行，超 AGENTS ≤300 规范 | 后续「巨型单体拆分」变更 |
| **T3 deferred** | `shared/launch-request` 解析收敛未实现 | 独立变更或网关二次解析需重构时 |
| **手动 E2E S1** | 仅 SDK Profile 冷启动后 `userData` 仅 `agent-api-port.json` | 发布 checklist |
| **手动 E2E S2–S5** | 四引擎 × IM/定时任务/工作流/chat new 行为不回归 | 发布 checklist（不阻断 archive） |
