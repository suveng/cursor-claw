# Orchestrator 会话路由 SSOT 收尾 - 变更总结

> **变更 ID**：`20260711205108-Orchestrator会话路由SSOT收尾`  
> **来源**：kb-propose · standard flow  
> **阶段**：`reviewed`（待 kb-release 迁移至 `归档/`）  
> **用户可见性**：无 — **跳过** `changelog/` 与 `package.json` version bump（内部架构 SSOT 收尾）

---

## 1、实际变更

### 代码

| 文件 | 改动 |
|------|------|
| `src/daemon/daemon-session-routing.ts` | **新建**：`fallbackSessionMap` 与 set/get/clear helper（21 行） |
| `src/daemon/daemon-http-routes.ts` | 新增 `POST|GET|DELETE /api/session-fallback` 三路由 |
| `src/daemon/daemon.ts` | 注入 `fallbackSessionMap` 至 HTTP deps |
| `electron/daemon/daemon-client.ts` | 新增 `setSessionFallback` / `getSessionFallback` / `clearSessionFallback` |
| `electron/session/session-dispatcher.ts` | 删除 `previousActiveSessionMap` 与 `dispatchSessionAgents`；`/chat new`、`handleSessionClosed` 改调 Daemon API |
| `electron/daemon/daemon-manager.ts` | `__IND_LAUNCH__` 分支改调 `setSessionFallback` |

**静态验收**：`rg previousActiveSessionMap`、`rg dispatchSessionAgents` 源码零命中；`npm run build` 通过（见 `06-automation-test.md`）。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`（T1～T3 `done`，T4 `deferred`；stage=`reviewed`）

---

## 2、与设计的差异

1. **HTTP 路由 bypass `daemon-session-routing` helper**（04-review §4）：路由 handler 直接操作 `deps.fallbackSessionMap`，模块内 set/get/clear 未被 HTTP 层引用；功能等价，T4 持久化 hook 时需统一写路径。
2. **`daemon-http-routes.ts` 仍 461 行**：历史「巨型单体拆分」债务，本次仅 +42 行 session-fallback，未恶化结构。
3. **T4 持久化**：按 design 标 `deferred`，未实现 `~/.cursor-claw/session-routing.json`。

其余与 `02-design.md` F1～F6、`03` T1～T3 一致。

---

## 3、影响范围

- **会话路由 SSOT**：`activeSessionMap` 与 `fallbackSessionMap` 均在 Daemon 进程内存；Electron 仅经 `daemon-client` 读写。
- **用户可见**：`/chat new` 临时会话结束自动回退、定时任务独立触发回退语义不变；跨 **Electron 重启**（Daemon 未重启）可读回退关系（01 验收 2）。
- **IM 主路径**：`runAgentDispatchLoop` / orchestrator 调度 **不变**；无 Electron 队列扫描回归。
- **非目标未做**：Daemon 重启后路由全量持久化（T4）；`daemon-manager.ts` / `session-dispatcher.ts` 历史行数拆分。

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| — | 本次 diff **无** 新增 `ponytail:` 注释 | — |
| **T4（manifest `deferred`）** | `session-routing.json` 持久化：`activeSessionMap` + `fallbackSessionMap` 写盘；Daemon 启动 load、变更 debounce save | 独立变更或 T4 任务；路由层宜改调 `daemon-session-routing` helper 以便写路径 hook（04-review shrink 建议） |
| `src/daemon/daemon.ts:691` | **既有** `ponytail: T7 单条顺序 dispatch…` | 非本变更新增 |

---

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — §二 活跃会话栈 SSOT 迁至 Daemon；§五 补 session-fallback API；§十 变更记录
- [x] `knowledge/业务域/Agent调度/05-定时任务.md` — §四 非独立 enqueue 后调度节点改为 `runAgentDispatchLoop`；§十 变更记录
- [x] `knowledge/业务域/Agent调度/00-README.md` — 关键源码补「会话路由 SSOT」与 orchestrator 行
- [x] `src/daemon/AGENTS.md` — builder 已补 `daemon-session-routing.ts` 目录职责（非 manifest knowledge 项）
- [x] `knowledge/业务域/Agent调度/01-概览.md` — 术语/架构未变，无需更新
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新

---

## 5、遗留债务（归档可接受）

| 项 | 说明 | 建议消化时机 |
|----|------|--------------|
| 手动 E2E | 01 §六 验收 1～4（含 Electron 重启场景 B）| 发布 checklist 或发布前点验 |
| T4 持久化 | Daemon 重启丢失回退栈（01 非目标） | 后续独立变更 |
| `daemon-http-routes.ts` 行数 | 461 行历史超限 | 关联「巨型单体拆分」后续批次 |
