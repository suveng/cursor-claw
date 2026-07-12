# 会话路由TTL脏键修复 - 变更总结

## 1、实际变更

### 1.1 修改代码

| 文件 | 关键改动 |
|------|----------|
| `src/daemon/daemon-session-routing-persist.ts` | `buildSnapshot` 保真旁路 `lastTouchedAt`（缺失才补 now）；导出 `mark*Touched` / `clear*Touched`；注释定案禁止全量刷新与历史同戳不 load 纠偏 |
| `src/daemon/daemon-session-maps.ts` | `setActiveSession` / `clearActiveSession` 接线 mark/clear；`opts.touch`（默认 true；`false` 仅写双 Map、不 mark/schedule） |
| `src/daemon/daemon-session-routing.ts` | `setSessionFallback` / `clearSessionFallback` 接线 mark/clear |
| `src/daemon/daemon.ts` | 冷启动 `loadSessionRoutingInto` 的 `onActiveSet` 传 `{ touch: false }` |
| `src/daemon/AGENTS.md` | session-routing：触达接线、禁止全量刷新、冷启动解耦 |

### 1.2 自动化契约

| 文件 | 关键改动 |
|------|----------|
| `auto_test/run-session-routing-ttl-dirty-key-contract.mts` | 脏键保真 / prune 不续命 / C2 / mark 续期 / onActiveSet 不误 mark / 静态回归 |
| `auto_test/run-session-routing-ttl-dirty-key-contract.sh` | 静态 grep + 契约入口 |

## 2、与设计的差异

| 项 | 设计预期 | 实际 | 影响 |
|----|----------|------|------|
| 冷启动解耦 | 02 初稿未单列 `opts.touch`；R1 要求 load 不抬升戳 | `setActiveSession(..., { touch: false })` + 契约锁路径 | 与 01 R1 / T-FIX-01 一致；优于初稿「裸复用 set」 |
| 历史同戳 | 02 S10 不 load 纠偏、forward 消化 | 同口径；**不**记 debt | 一次性残差，见 §3 |

其余（TTL/schema/debounce/写盘触发点集合、无新文件/Service 类）与 02 一致。

## 3、影响范围

- **模块**：Daemon 会话路由 persist / maps / routing；枢纽冷启动接线。
- **接口**：无 HTTP/MCP/proto 变更。
- **数据**：无 schema 字段增删；`lastTouchedAt` 语义 = 该键最后一次映射触达/变更。
- **用户可见**：续聊主路径不变；运行期 TTL 不再因他键写盘连带续命。
- **测试**：`auto_test/run-session-routing-ttl-dirty-key-contract.sh` ALL PASS（含冷启动不误 mark）。

### 3.1 Ponytail 技术债

无（本变更 diff 无 `ponytail:` 注释）。

### 3.2 残差说明（非 debt）

修复前磁盘已膨胀的同戳条目不在 load 纠偏；按原戳+TTL forward 消化，最长多一段虚增空闲窗口。open 评审 = 0；R1 = fixed。

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — §六 写盘 per-entry 触达 + 冷启动 `touch:false`；§九 勾销 T11-R2，改历史同戳残差；§十 变更记录
- [x] `src/daemon/AGENTS.md` — 触达/禁止全量刷新/冷启动解耦（实现已落，archive 核对一致）
- [x] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — 仅有「TTL 30d」一句、无脏键误述，**不需要更新**（02 §十·（二））
- [x] `knowledge/工程平台/Daemon守护进程/00-README.md` — 无新子模块，**不需要更新**
- [x] `knowledge/知识地图.md` / 领域 README — 入口未变，**不需要更新**
