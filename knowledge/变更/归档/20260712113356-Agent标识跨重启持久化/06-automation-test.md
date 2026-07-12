# Agent标识跨重启持久化 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` §六验收 1–5、`03-tasks.md` T1–T4、`04-review.md`（通过；R1/R2 accepted_debt；E2E 待点验）
> **评审结论**：无阻断项；`daemon.ts` 行数（R1）与写盘全量 touch `lastTouchedAt`（R2）已记债务

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 轻量静态（grep/行数）+ **persist 模块契约**（隔离 `APP_DATA_DIR`）+ 可选临时 Daemon HTTP（C6） |
| **目标** | 验证 T11 映射 load/save/prune/debounce、损坏降级、HTTP helper 统一写路径；不启动 Electron、不新增单测目录 |
| **与验收关系** | 每条场景对应 `03` 任务验收或 `01` §六；跨进程续聊（kill Daemon + IM）标 **待实机** |
| **本期执行** | `auto_test/run-session-routing-persist-contract.sh` 静态 + C1–C5；C6 须 `build:bundle` 后执行 |
| **构建** | 契约前建议 `npm run build`（04 已通过）；模块契约可直接 tsx import，不依赖 bundle |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 01 验收 1：仅 kill Daemon 后 IM 续聊路由 | 需飞书 Bot + Electron Agent 运行 | 核心用户路径须实机 |
| 01 验收 2：无静默换 workspace | 需多工作区实机会话 | C6 仅证 sessionKey 含路径片段 |
| 损坏后 launch 失败 notify（01 验收 3 用户可见） | 需 orchestrator + Electron 未就绪 | 降级启动已契约；notify 待实机 |
| 运行期 6h prune（T4） | 间隔过长 | load prune + `pruneExpiredEntries` 已契约；6h 可手工缩短 interval 点验 |
| R2 写盘全量 touch | 设计粒度偏差 | 重启 load prune 仍正确；运行期 TTL 精度弱化 |
| debounce 窗口内崩溃丢末次映射 | 02 §8.1 已接受 P2 | 低概率丢映射 |
| `sessionAgentPhaseMap` 重启为空 | 设计非目标 | F1 仅 `.qmsg` 须 spot-check |

## 3、验收追溯表

| ID | 验收摘要（01/03/02·八·二） | 验证方式 | 证据类型 | 状态 |
|----|---------------------------|----------|----------|------|
| 01-1 | 仅重启 Daemon 后同 chat 路由原 Agent/工作区 | 实机 IM + kill Daemon | E2E | ⚠️ 待实机；C6 HTTP 部分 ✅ |
| 01-2 | 无静默换 workspace | 实机多工作区 | E2E | ⚠️ 待实机 |
| 01-3 | 损坏持久化降级 + 可理解提示 | 模块 C3 + Daemon 启动日志 | 契约/日志 | ✅ C3；notify 待实机 |
| 01-4 | TTL 过期不误用旧映射 | 模块 C2/C5 | 契约 | ✅ |
| 01-5 | 不涉及 IM/全量会话库 | grep diff | 源码 | ✅ |
| T1 | v1 schema load/save/prune/debounce/原子写 | C1–C5 | 契约 | ✅ |
| T1 | 损坏/非法 schema 不抛、Maps 空 | C3 | 契约 | ✅ |
| T1 | 单文件 ≤300、无 Service 类、无新 npm | 静态 | 行数/grep | ✅ 251 行 |
| T2 | `daemonMain` wire 前 load | 静态 grep | 源码 | ✅ |
| T2 | load 失败 `session_routing_load_failed` | 静态 + 实机 | 源码/日志 | ✅ 静态；WARN 待实机 |
| T2 | `setActiveSession` 末尾 schedule | 静态 grep | 源码 | ✅ |
| T2 | `sessionAgentPhaseMap` 不持久化 | 读实现 | 源码 | ✅ |
| T2 | `daemon.ts` ≤300 | wc -l | 行数 | ⚠️ accepted_debt R1 |
| T3 | HTTP 改调 helper；无 Map 直写 | 静态 rg | 源码 | ✅ 0 命中 |
| T3 | POST/DELETE fallback + active persist | C6 HTTP | HTTP/磁盘 | ✅ C6（bundle 后） |
| T3 | HTTP 契约不变 | 读 routes | 源码 | ✅ |
| T4 | 6h `startSessionRoutingPruneTimer` + `.unref()` | 静态 grep | 源码 | ✅ |
| T4 | load prune 日志 `session_routing_pruned` | 静态 grep | 源码 | ✅ |
| T4 | 02 §8.2 范围内项 | 混合 | 契约+待实机 | ✅ 代码层；E2E 待实机 |
| R1 | daemon.ts 行数债务 | manifest | 债务 | accepted_debt |
| R2 | 写盘全量 touch lastTouchedAt | 读 buildSnapshot | 债务 | accepted_debt |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| 编译 | 全量 `npm run build`；HTTP C6 至少 `npm run build:bundle` |
| Daemon | C6 脚本自启临时实例；实机须常驻 Daemon + `APP_DATA_DIR` |
| Electron | 续聊 E2E 须主进程；本变更不改 Electron 契约 |
| 数据文件 | `{APP_DATA_DIR}/session-routing.json` v1 schema |
| 凭据 | **勿**写入本文；飞书用「已配置」描述 |

### 4.2 契约场景（脚本 C1–C6）

| ID | 场景 | 前置 | 操作 | 期望 | 关联 |
|----|------|------|------|------|------|
| C1 | 合法 load | 临时 APP_DATA_DIR | 写 v1 JSON → `loadSessionRoutingInto` | ok:true；Maps 一致；onActiveSet 回调 | T1 |
| C2 | load TTL prune | 含过期/未过期条目 | load | pruned=2；仅未过期保留 | 01-4、T1 |
| C3 | 损坏降级 | 非法 JSON / schema / 缺失 | load | ok:false；Maps 空；不抛 | 01-3、T1 |
| C4 | flush 落盘 | 内存 Maps | `flushSessionRoutingPersist` | 磁盘 v1 一致；无 `.tmp` 残留 | T1、T3 |
| C5 | 运行期 prune | load 后内存 | `pruneExpiredEntries` | 计数正确 | T4 |
| C6 | HTTP 跨重启 | bundle 已构建 | POST active-session → kill → 重启 Daemon → GET active-sessions | 同 sessionKey | 01-1、T2/T3 |

### 4.3 手工冒烟清单（04 §7 E2E）

| # | 场景 | 前置 | 操作 | 期望 | 本期 |
|---|------|------|------|------|------|
| S1 | kill Daemon 续聊 | 飞书私聊；活跃 Agent | 记 chatId → kill Daemon → 重启 → 续聊 | `resolveRoutingKey` 原 sessionKey | 待实机 |
| S2 | 损坏 JSON 启动 | 篡改 session-routing.json | 重启 Daemon | WARN `session_routing_load_failed`；不崩溃 | 待实机 |
| S3 | TTL 磁盘篡改 | `lastTouchedAt` 超 30 天 | 重启 Daemon | 不命中旧映射 | C2 ✅；实机待证 |
| S4 | fallback 跨重启 | `/chat new` 建 fallback | kill Daemon → 重启 → 临时会话结束 | 回退栈仍有效 | 待实机 |
| S5 | DELETE 映射持久化 | POST 后 DELETE active/fallback | flush 后重启 | 映射已删 | C6 部分；DELETE 待实机 |

### 4.4 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| C6 SKIP | 未 `build:bundle` |
| load ok:false 但 Maps 非空 | persist 模块回归 |
| HTTP 200 但磁盘无文件 | debounce 未等 700ms |
| 重启后 GET 空 | load 顺序或 APP_DATA_DIR 不一致 |
| 实机续聊像新会话 | Electron 侧 agentId 与 routing 双轨（设计边界） |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/run-session-routing-persist-contract.sh` | 入口；依赖归档 `electron-import-hook.mjs` + tsx |
| `auto_test/run-session-routing-persist-contract.mts` | C1–C6 实现 |
| 前置命令 | `npm run build`（推荐）；C6 须 `npm run build:bundle` |
| 环境变量名 | `APP_DATA_DIR`（脚本自设临时目录）；`KB_SESSION_ROUTING_TEST_PORT`（可选） |
| 副作用 | 仅 `/tmp/kb-session-routing-*`；无生产数据写入 |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端输出；§7 备注列仅用结论性短语（如「C1–C5 通过」「C6 通过」「S1 待实机」）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地 | `npm run build` | 通过 | exit 0 |
| 2026-07-12 | 本地静态 | T1–T4 符号 grep + persist ≤300 行 | 通过 | 契约脚本静态段 |
| 2026-07-12 | 模块契约 | C1 合法 load + onActiveSet | 通过 | |
| 2026-07-12 | 模块契约 | C2 load TTL prune | 通过 | pruned=2 |
| 2026-07-12 | 模块契约 | C3 损坏/缺失降级 | 通过 | |
| 2026-07-12 | 模块契约 | C4 flush + schedule | 通过 | 无 .tmp 残留 |
| 2026-07-12 | 模块契约 | C5 runtime prune | 通过 | |
| 2026-07-12 | 契约 HTTP | C6 Daemon 跨重启 active-sessions | 通过 | build:bundle 后 |
| 2026-07-12 | 契约脚本 | `run-session-routing-persist-contract.sh` 全量 | 通过 | ALL PASS |
| 2026-07-12 | — | S1–S5 实机 E2E | 待用户执行 | 需飞书 + Electron |
