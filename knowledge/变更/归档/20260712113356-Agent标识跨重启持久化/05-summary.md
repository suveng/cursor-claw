# Agent标识跨重启持久化 - 变更总结

## 1、实际变更

### 1.1 新增代码

| 文件 | 关键改动 |
|------|----------|
| `src/daemon/daemon-session-routing-persist.ts` | `loadSessionRoutingInto` / `scheduleSessionRoutingPersist` / `flushSessionRoutingPersist`；`session-routing.json` v1 schema；debounce 500ms、原子写 tmp→rename、TTL prune、`pruneExpiredEntries`；损坏读容错 |

### 1.2 修改代码

| 文件 | 关键改动 |
|------|----------|
| `src/daemon/daemon.ts` | `daemonMain` 在 `wireDaemonSubmodules` 前 load + `startSessionRoutingPruneTimer`（6h）；`setActiveSession` 末尾 schedule persist；`clearActiveSession` + DELETE persist hook |
| `src/daemon/daemon-session-routing.ts` | `wireSessionRoutingPersist` 注入；`setSessionFallback` / `clearSessionFallback` 统一写路径 |
| `src/daemon/daemon-http-routes-session.ts` | HTTP 回退栈改调 routing helper（零 `fallbackSessionMap` 直写） |
| `src/daemon/daemon-http-routes-types.ts` | 路由 deps 补充 `clearActiveSession` |
| `src/daemon/AGENTS.md` | session-routing 持久化模块边界与 `APP_DATA_DIR/session-routing.json` 说明 |

### 1.3 自动化契约

| 文件 | 关键改动 |
|------|----------|
| `auto_test/run-session-routing-persist-contract.mts` | C1–C6：load/save/prune/debounce/损坏降级/HTTP 跨重启 |
| `auto_test/run-session-routing-persist-contract.sh` | 静态 grep + 契约入口 |

## 2、与设计的差异

| 项 | 设计预期 | 实际 | 影响 |
|----|----------|------|------|
| TTL `lastTouchedAt` 粒度 | 02 §5「写映射时更新」per-entry | `buildSnapshot` 每次 persist 为**全部**在册条目写入同一 `now` | 运行期 6h prune 对「无活动但同进程其他 chat 有写盘」的条目可能延迟过期；重启 load prune 不受影响（accepted_debt R2） |
| 冷启动 load 回调 | 02 §6 遍历 active 调用 `setActiveSession` | 一致；副作用为每条恢复映射打 INFO 并 debounce 一次写盘 | 可观测性略噪、多余 I/O；功能正确 |
| E2E 场景 | 02 §8.2 kill Daemon / 损坏 notify / TTL 篡改 | 契约 C1–C6 + 静态通过；飞书+Electron 续聊待实机 | 核心用户路径 S1–S5 待 archive checklist 点验 |

其余主路径（`session-routing.json` 落盘、`APP_DATA_DIR` 与 `scheduled-tasks.json` 同级、HTTP 契约不变、`sessionAgentPhaseMap` 不持久化、与 `sdk-active-runs.json` 边界）与设计一致。

## 3、影响范围

- **模块**：Daemon 会话路由（`daemon-session-routing-persist.ts`、`daemon-session-routing.ts`、`daemon.ts`、HTTP session 路由）。
- **接口**：无新增/变更 HTTP 路径与请求体；`GET/POST/DELETE` active-sessions / fallback 语义不变。
- **数据**：新增 `{APP_DATA_DIR}/session-routing.json`（active + fallback 映射 + `lastTouchedAt`）；TTL 默认 30 天；debounce 500ms。
- **用户可见**：Daemon 单独重启后同 chat 续聊可恢复 `sessionKey`（含 `::workspaceDir`）；损坏 JSON 空映射启动 + WARN；launch 失败沿用 orchestrator notify。
- **测试**：`auto_test/run-session-routing-persist-contract.sh` ALL PASS；`npm run build` 通过。

### 3.1 Ponytail 技术债

无（本次 diff 无 `ponytail:` 注释）。

评审精简建议（非代码注释，见 `04-review.md` §3）：

| 位置 | 摘要 | 升级路径 |
|------|------|----------|
| `daemon-session-routing-persist.ts` `buildSnapshot` | `shrink:` 写盘仅 touch 脏键，保留磁盘 per-entry 时间 | 脏集追踪 + 仅更新变更键 `lastTouchedAt`（约 -8 行，非本变更必做） |

### 3.2 开放评审（accepted_debt）

| ID | 状态 | 摘要 | 升级路径 |
|----|------|------|----------|
| R1 | accepted_debt | `daemon.ts` 1885 行超 AGENTS 300 行上限；属批2 queue/channel/logging 遗留；本变更持久化已拆至 `daemon-session-routing-persist.ts` | 批2 拆分独立变更跟进 |
| R2 | accepted_debt | `buildSnapshot` 写盘时全量刷新所有条目 `lastTouchedAt`，弱化运行期 per-entry TTL | P2 可接受；升级路径为脏键 touch 或 persist 前仅更新变更键（T-FIX-01 可选） |
| E2E 手动 | 待实机 | 01 §六、02 §8.2 kill-Daemon / 损坏 JSON / TTL 篡改 | archive checklist 点验 |

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — §六 持久化补充；§九 T11 闭环与 `session-routing.json` / TTL / 与 `sdk-active-runs` 边界
- [x] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — §六 数据增加 `session-routing.json` 清单
- [x] `knowledge/工程平台/Daemon守护进程/01-概览.md` — 调度态持久化与重启恢复总述
- [x] `knowledge/业务域/Agent调度/01-概览.md` — §九 全局限制移除 T11 未持久化表述
- [x] `knowledge/业务域/Agent调度/00-README.md` — 阅读路径与 T11 状态
- [x] `knowledge/工程平台/Daemon守护进程/00-README.md` — 分区索引与持久化文件入口
- [x] `knowledge/知识地图.md` — 入口未变，无需更新
