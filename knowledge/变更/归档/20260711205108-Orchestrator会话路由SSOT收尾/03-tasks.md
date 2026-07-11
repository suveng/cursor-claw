# Orchestrator 会话路由 SSOT 收尾 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 一、执行计划

### （一）依赖图

```
T1 ──→ T2 ──→ T3
T4（可选，依赖 T1，与 T2/T3 独立）
```

### （二）分组调度

- **第一轮**：T1（Daemon 回退栈 + HTTP API）
- **第二轮**：T2（Electron 改调 Daemon API，删除 Electron 内存 Map）
- **第三轮**：T3（dead code 清理 + 知识库同步）
- **可选并行（deferred）**：T4 — 仅当 T1 完成后评估行数/复杂度，不阻塞 T2/T3

## 二、任务清单

## T1: Daemon 持有回退栈与 session-fallback API

### 背景

01 R1/R3 要求回退关系 SSOT 在 Daemon。本任务在 Daemon 侧新增 `fallbackSessionMap` 及 HTTP 路由，为 Electron 提供读写契约；是 T2 的前置依赖。

### 上下文文件

- CodeGraph: `activeSessionMap` `daemon-http-routes` `setActiveSession` — 并列状态与路由模式
- 必读: `src/daemon/daemon.ts` — `activeSessionMap`（约 L309）、deps 注入模式
- 必读: `src/daemon/daemon-http-routes.ts` — `/api/active-session`（L280-305）路由风格
- 参考: `src/daemon/daemon-http-admin-crud.ts` — `activeSessionMap` 管理端用法

### 实现范围

- 新建（可选，当 `daemon.ts` 行数紧张时）: `src/daemon/daemon-session-routing.ts` — `fallbackSessionMap` 及 `set/get/clear` helper（≤300 行）
- 修改: `src/daemon/daemon.ts` — 声明/导出 `fallbackSessionMap` 或 import routing 模块；启动时注入 `daemon-http-routes` deps
- 修改: `src/daemon/daemon-http-routes.ts` — 新增：
  - `POST /api/session-fallback` body `{ sessionKey, fallbackSessionKey }`
  - `GET /api/session-fallback?sessionKey=`
  - `DELETE /api/session-fallback?sessionKey=`
- 修改: `src/daemon/daemon-http-routes.ts` — `RouteDeps` 类型扩展 `fallbackSessionMap` 与 helper（若未拆文件）

### 接口契约

- `fallbackSessionMap: Map<string, string>` — key=临时 sessionKey，value=回退目标 sessionKey
- `POST /api/session-fallback` → `{ ok: true }` | 400
- `GET /api/session-fallback` → `{ fallbackSessionKey: string | null }`
- `DELETE /api/session-fallback` → `{ ok: true }`（幂等）

### 验收标准

- [ ] 三个路由行为与 02 §四 契约一致
- [ ] `activeSessionMap` 既有行为无回归
- [ ] 新增/修改 Daemon 文件均 ≤300 行
- [ ] 中文注释说明 Map 语义与 API 用途
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: 无
- 后续任务: T2, T4（可选）

---

## T2: Electron 改调 Daemon fallback API

### 背景

现网 `previousActiveSessionMap` 在 Electron 内存（`session-dispatcher.ts:85`），导致 Electron 重启后 01 场景 B 失败。本任务在 client 封装 API，并改 `/chat new`、`handleSessionClosed`、`__IND_LAUNCH__` 三处读写路径。

### 上下文文件

- CodeGraph: `previousActiveSessionMap` `handleSessionClosed` `syncActiveSession` — 现网回退链
- 必读: `electron/daemon/daemon-client.ts` — `syncActiveSession`/`getCurrentActiveSession` 模式
- 必读: `electron/session/session-dispatcher.ts` — L85/L122-123/L599、`handleSessionClosed` L113-137、`/chat new` L583-618
- 必读: `electron/daemon/daemon-manager.ts` — `__IND_LAUNCH__` L603-616、import L49

### 实现范围

- 修改: `electron/daemon/daemon-client.ts` — 新增 `setSessionFallback` / `getSessionFallback` / `clearSessionFallback`（GET 需 query；DELETE 可用 `http.request` 或扩展现有 helper）
- 修改: `electron/session/session-dispatcher.ts` —
  - 删除 `export const previousActiveSessionMap`
  - `/chat new` 成功分支：`setSessionFallback(port, taskId, currentActive)` 替代 Map.set
  - `handleSessionClosed`：`getSessionFallback` → 回退逻辑 → `clearSessionFallback`
- 修改: `electron/daemon/daemon-manager.ts` — 移除 `previousActiveSessionMap` import；`__IND_LAUNCH__` 改调 `setSessionFallback`

### 接口契约

- `setSessionFallback(port, sessionKey, fallbackSessionKey): Promise<void>`
- `getSessionFallback(port, sessionKey): Promise<string | undefined>`
- `clearSessionFallback(port, sessionKey): Promise<void>`
- 失败 catch 策略与 `syncActiveSession` 对齐（不阻断 launch）

### 验收标准

- [ ] `rg previousActiveSessionMap` 全仓零命中
- [ ] 01 验收 1：/chat new 结束后自动回退
- [ ] 01 验收 2：Electron 重启后临时会话结束仍可回退（Daemon 未重启）
- [ ] 01 验收 3：`__IND_LAUNCH__` 路径与 /chat new 语义一致
- [ ] 01 验收 4：无回退/目标已停/手动切换时不错误覆盖 active
- [ ] IM 主路径无 Electron 队列扫描回归
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: T3

---

## T3: 清理 dead code 与知识库同步

### 背景

收尾变更 `20260711203953-巨型单体拆分` ponytail：`dispatchSessionAgents` 空实现（L479-480）及 KB 过时描述。本任务删除 dead code 并更新 Agent 调度知识库，满足 01 R5 与验收 5。

### 上下文文件

- CodeGraph: `dispatchSessionAgents` — 确认无调用方
- 必读: `electron/session/session-dispatcher.ts` — L479-480 空实现
- 必读: `knowledge/业务域/Agent调度/02-多会话模型.md` — §二 活跃会话栈
- 必读: `knowledge/业务域/Agent调度/05-定时任务.md` — §四 流程图
- 参考: `knowledge/变更/进行中/20260711203953-巨型单体拆分/02-design.md` — P5-a ponytail 上下文

### 实现范围

- 删除: `electron/session/session-dispatcher.ts` — `dispatchSessionAgents` 函数及 ponytail 注释
- 修改: 全仓 — 移除对 `dispatchSessionAgents` 的 export/import（若有）
- 修改: `knowledge/业务域/Agent调度/02-多会话模型.md` — 活跃会话栈 SSOT 在 Daemon（含 active + fallback）
- 修改: `knowledge/业务域/Agent调度/05-定时任务.md` — 流程图 `dispatchSessionAgents` → Daemon `runAgentDispatchLoop`（enqueue 后调度）

### 接口契约

- 无新增接口；删除 `dispatchSessionAgents` export

### 验收标准

- [ ] `rg dispatchSessionAgents` 源码零命中（变更文档历史引用除外）
- [ ] `02-多会话模型.md` 不再引用 `previousActiveSessionMap`
- [ ] `05-定时任务.md` 调度节点指向 Daemon orchestrator
- [ ] `npm run build` 通过
- [ ] 01 验收 5、6 满足
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T2
- 后续任务: 无（archive 由 `/kb-archive` 执行）

---

## T4: 可选 session-routing 持久化（ponytail）

### 背景

02 §二 ponytail：若 T1 后行数/复杂度允许，将 `activeSessionMap` + `fallbackSessionMap` 持久化到 `~/.cursor-claw/session-routing.json`，Daemon 启动加载、变更写盘。01 未将 Daemon 重启恢复列为必达验收；本任务 **deferred**，implement 阶段评估后决定是否执行。

### 上下文文件

- 必读: `src/daemon/daemon.ts` — `activeSessionMap` 生命周期
- 必读: `02-design.md` §五 持久化 JSON 结构
- 参考: `electron/scheduling/cron-scheduler.ts` — `scheduled-tasks.json` 读写模式

### 实现范围

- 新建（可选）: `src/daemon/daemon-session-routing-persist.ts` — load/save/debounce（≤300 行）
- 修改: `src/daemon/daemon.ts` — 启动 load；active/fallback 变更时 trigger save

### 接口契约

- 文件路径: `{userHome}/.cursor-claw/session-routing.json`
- Schema: `{ activeSessions: Record<string,string>, fallbackSessions: Record<string,string> }`

### 验收标准

- [ ] Daemon 重启后 active + fallback Map 从 JSON 恢复
- [ ] 写盘 debounce，不阻塞 HTTP 热路径
- [ ] 文件损坏时 WARN + 空 Map 启动，不 crash
- [ ] 无 02/03 未要求的抽象层、trait/mixin 中间层或未批准的新依赖（Ponytail 口径）

### 依赖

- 前置任务: T1
- 后续任务: 无
