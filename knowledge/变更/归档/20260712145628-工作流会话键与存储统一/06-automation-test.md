# 工作流会话键与存储统一 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` §六验收 1–6、`03-tasks.md` T1–T6（ST-WF1～WF6）、`04-review.md`（通过；T6 契约待落盘已补齐）
> **评审结论**：无阻断项；§4.2 Daemon 侧遗留迁移仅 cwd 探测为已知偏差（评分 55），不阻断 test

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 轻量静态（grep/行数）+ **模块契约**（隔离 `APP_DATA_DIR` IO）+ `tsc`（`build:mcp`）；**不**启动 Electron、**不**新增单测目录 |
| **目标** | 验证存储 SSOT、`sessionKey` 落盘与 launch 复用接线、`session-routing` 无双写、非目标未扩面 |
| **与验收关系** | ST-WF1～WF6 对应 `03` T6；T1–T5 由静态/模块间接覆盖；01 §六实机项标 **待实机** |
| **本期执行** | `auto_test/run-workflow-session-storage-contract.sh` 全量（ST-WF1～WF6 + tsc）✅ |
| **构建** | 契约内含 `npm run build:mcp`；无需 bundle |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 01-1：Electron 重启后 resume Agent 同键 | 需 Electron + isolated 实例 + Agent 运行 | 引擎落盘 + launch 传键已契约；运行时待证 |
| 01-2：UI run 与 Daemon MCP run 同目录可见 | 需双进程实机对拍 | SSOT 路径与 runner 委托已静态 ✅ |
| 01-3：resume 三入口端到端 | 继承父变更 `06`；本变更仅底层增强 | 入口未改；实机仍建议 spot-check |
| 04 §4.2：纯 Daemon 冷启动 legacy 迁移 | 仅 Electron `seedBuiltins` 带 `legacyUserDataDir` | 常见「先开 Electron」部署可接受 |
| `workflow-engine.ts` 439 行 | 历史体量（04 遗留） | 非本变更引入 |

## 3、验收追溯表

| ID | 验收摘要（01/03/02·八·二） | 验证方式 | 证据类型 | 状态 |
|----|---------------------------|----------|----------|------|
| 01-1 | 重启可恢复 sessionKey 并用于续聊 | 模块 ST-WF1 + 实机 resume | 契约/E2E | ✅ 契约；E2E ⚠️ 待实机 |
| 01-2 | Daemon/Electron 同一存储真相 | ST-WF2 路径 + T1/T2 静态 | 契约/源码 | ✅ |
| 01-3 | resume 三入口仍通 | 继承父变更 + ST-WF3 静态 | 源码 | ✅ 静态；E2E ⚠️ 待实机 |
| 01-4 | 非目标未扩大 | ST-WF4 grep | 源码 | ✅ |
| 01-5 | 不与 Agent 标识双写 | ST-WF5 | 契约/源码 | ✅ |
| 01-6 | 运维可识别单一存储根 | ST-WF6 | 契约/日志 | ✅ |
| T1 | lazy 路径、`canUseStorage` no-op | 静态 + ST-WF2 | 源码/契约 | ✅ |
| T1 | 新文件 ≤300 行 | 行数 | wc -l | ✅ 136/24/131/39 |
| T2 | runner 不直 import store；file 委托 | 静态 ST-WF2 | grep | ✅ |
| T3 | isolated/resume 写 sessionKey | ST-WF1 + 引擎 grep | 契约/源码 | ✅ |
| T4 | launch/runner/emitLaunch 传持久键 | ST-WF3 静态 | grep | ✅ |
| T5 | 迁移幂等、WARN 日志 | 读 `workflow-path` | 源码 | ✅ 静态；迁移实机 ⚠️ |
| T6 | ST-WF1～WF6 + AGENTS | 契约脚本 | 脚本 | ✅ |
| 八·二-1 | runner/MCP/resume 路径一致 | ST-WF2 | grep | ✅ |
| 八·二-2 | 重启后 JSON sessionKey 一致 | ST-WF1 + 实机 | 契约/E2E | ✅ 契约；E2E ⚠️ |
| 八·二-3 | session-routing 无 `::wf_` | ST-WF5 | 契约 | ✅ |
| 八·二-4 | 模块顶 APP_DATA_DIR 空不静默写错根 | `canUseStorage` + ST-WF2 | 源码 | ✅ |
| tsc | TypeScript 编译 | `build:mcp` | 编译 | ✅ |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| 编译 | 契约脚本内执行 `npm run build:mcp`；全量构建非必须 |
| Daemon | 模块契约自管临时 `APP_DATA_DIR`；实机须常驻 Daemon |
| Electron | E2E 须主进程；`APP_DATA_DIR=userData` 由 `workflow-file` 注入 |
| 工作流数据 | `{APP_DATA_DIR}/workflows/instances/{id}.json` |
| 凭据 | **勿**写入本文 |

### 4.2 契约场景（ST-WF1～WF6）

| ID | 场景 | 前置 | 操作 | 期望 | 关联 |
|----|------|------|------|------|------|
| ST-WF1 | isolated sessionKey 落盘 | 临时 APP_DATA_DIR | `assignInstanceSessionKey` → `saveInstance` → `getInstance` | JSON 含正确 `sessionKey` | T3、01-1 |
| ST-WF2 | SSOT 路径双端一致 | 设 `APP_DATA_DIR` | `resolveWorkflowRoot()`；runner 不经 store 直读 | `{APP_DATA_DIR}/workflows` | T1、T2、01-2 |
| ST-WF3 | resume/run 复用持久键 | — | grep runner/launch/emitLaunch | 传 `fresh.sessionKey` / `sessionKey?` | T4、01-3 |
| ST-WF4 | 非目标未扩 | — | gateway grep；manage_workflows 无 resume；无 `/workflow create` 斜杠 | 0 命中 / 基线 action 仍在 | 01-4、R6 |
| ST-WF5 | 无双写 session-routing | 样例 routing JSON | 模块无 `::wf_` 写入；样例无工作流键 | 无 `::wf_` | 01-5、R5 |
| ST-WF6 | 存储根可观测 | 设 `APP_DATA_DIR` | `logWorkflowStorageRootOnce()` | `workflow_storage_root=` 日志 | T1、01-6 |

### 4.3 手工冒烟清单（04 §9 建议）

| # | 场景 | 前置 | 操作 | 期望 | 本期 |
|---|------|------|------|------|------|
| S1 | isolated 节点 JSON 含键 | Electron/Daemon run | 推进至 isolated 节点 | 磁盘 JSON 含 `sessionKey` | ⚠️ 待实机（ST-WF1 ✅） |
| S2 | Electron 重启 resume 同键 | paused + sessionKey | 重启 → UI/斜杠 resume | Agent 列表同键 | ⚠️ 待实机 |
| S3 | UI 与 MCP 实例同目录 | 双入口各创建实例 | `listInstances` 对拍 | 同 `instances/` | ⚠️ 待实机 |
| S4 | 遗留双目录迁移 | legacy 有数据、SSOT 空 | 启动 Electron | WARN 迁移日志 | ⚠️ 待实机 |
| S5 | session-routing 无 wf 键 | 正常运行后 | 检查 `session-routing.json` | 无 `::wf_` | ✅ ST-WF5 |

### 4.4 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| 契约 ST-WF1 失败 | `workflow-store` 未保留 `sessionKey` 序列化 |
| 双端实例不一致 | runner 仍直 import `workflow-store` 或 `APP_DATA_DIR` 未注入 |
| resume 换键 | `launchWorkflowAgent` 未传 `fresh.sessionKey` |
| `workflow_storage_root` 无日志 | 首次 IO 前未调 `logWorkflowStorageRootOnce` |
| tsc 失败 | 类型/import 路径回归 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/run-workflow-session-storage-contract.sh` | 入口；依赖归档 `electron-import-hook.mjs` + tsx |
| `auto_test/run-workflow-session-storage-contract.mts` | ST-WF1～WF6 实现 + `build:mcp` |
| 前置命令 | 无（脚本内跑 tsc） |
| 环境变量 | 契约自管临时 `APP_DATA_DIR`；无额外开关 |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端输出；§7 备注列仅用结论性短语。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地静态 | ST-WF2/ST-WF3/ST-WF4/ST-WF5 grep | 通过 | runner 委托、launch 传键、无 gateway |
| 2026-07-12 | 本地静态 | 新文件行数 wc -l | 通过 | path 136 / key 24 / store 131 / file 39 |
| 2026-07-12 | 模块契约 | ST-WF1 sessionKey 落盘 | 通过 | 临时 APP_DATA_DIR IO |
| 2026-07-12 | 模块契约 | ST-WF2/ST-WF6 路径与日志 | 通过 | `workflow_storage_root=` 可观测 |
| 2026-07-12 | 模块契约 | ST-WF5 session-routing 无双写 | 通过 | 样例 + persist 模块 grep |
| 2026-07-12 | 编译 | `npm run build:mcp` | 通过 | tsc 全绿 |
| 2026-07-12 | 契约脚本 | `run-workflow-session-storage-contract.sh` 全量 | 通过 | ALL PASS |
| 2026-07-12 | — | S1–S4 实机冒烟 | 待用户执行 | 需 Electron + 可选飞书 |
