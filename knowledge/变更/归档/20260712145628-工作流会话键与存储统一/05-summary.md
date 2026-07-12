# 工作流会话键与存储统一 - 变更总结

> **变更 ID**：`20260712145628-工作流会话键与存储统一`  
> **来源**：kb-propose · standard flow · **父变更**：`20260712113344-工作流恢复入口与信号接口`  
> **阶段**：`tested`（步骤 5 完成；业务域知识正文待 librarian；迁移前 **勿** 标 `archived`）  
> **用户可见性**：间接 — isolated 节点续聊/resume 可复用持久 `sessionKey`；运维排障单一 `workflows/` 存储根

---

## 1、实际变更

### 代码

| 任务 | 文件 | 改动要点 |
|------|------|----------|
| T1 | `src/workflow/workflow-path.ts`（新建） | `resolveWorkflowRoot` 懒解析；`logWorkflowStorageRootOnce`；`migrateLegacyWorkflowDirIfNeeded` |
| T1 | `src/workflow/workflow-store.ts` | 删除模块顶 `WORKFLOW_DIR`；`beforeStorageIo` + `canUseStorage` 守卫；保留 `sessionKey` 序列化 |
| T2 | `electron/workflow/workflow-file.ts` | 薄封装 re-export `workflow-store`；`seedBuiltins` 带 `legacyUserDataDir` 触发迁移 |
| T2 | `electron/workflow/workflow-runner.ts` | 实例读写**仅**经 `workflow-file`；移除直 import `workflow-store` |
| T3 | `src/workflow/workflow-session-key.ts`（新建） | `buildWorkflowSessionKey` / `assignInstanceSessionKey` |
| T3 | `src/workflow/workflow-engine.ts` | isolated / `handleReject` / `resumeWorkflow` 路径写 `sessionKey` 后 `saveInstance` |
| T4 | `electron/session/session-dispatcher-launch.ts` | `launchWorkflowAgent` 增 `sessionKey?`，优先实例持久键 |
| T4 | `electron/workflow/workflow-runner.ts` | run/resume 调 launch 传 `fresh.sessionKey` |
| T4 | `src/workflow/server-workflow.ts` | `emitLaunch` payload 含 `sessionKey` |
| T4 | `electron/daemon/daemon-manager.ts` | `__WF_LAUNCH__` 整包 JSON 透传 `sessionKey` |
| T5 | `src/workflow/workflow-path.ts` | 幂等迁移：SSOT 空且 legacy 有数据时复制 instances/definitions + WARN |
| T6 | `src/workflow/AGENTS.md`、`electron/workflow/AGENTS.md` | 存储 SSOT、sessionKey 持久、与 `session-routing` 边界 |
| T6 | `auto_test/run-workflow-session-storage-contract.{sh,mts}` | ST-WF1～WF6 契约 + `build:mcp` |

**未纳入（显式）**：resume 三入口授权与 HTTP 契约；`manage_workflows` action 集合；分支 Gateway；YAML 引擎；`session-routing.json`（归档 `20260712113356` 职责）；`/workflow` create/update 扩面。

**统计**：2 新建源模块（path 136 行 / session-key 24 行）+ 8 修改 + 2 AGENTS + 2 验收脚本；`run-workflow-session-storage-contract.sh` **ALL PASS**（见 `06-automation-test.md` §7）；Electron 重启 resume 同键、双入口实例对拍、遗留迁移实机项为 **待实机**，不阻断本步骤。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`、`05-summary.md`（本文件）

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **sessionKey 辅助函数命名** | `02` §1.3 `persistInstanceSessionKey` | `assignInstanceSessionKey`（不可变返回新对象） | **无行为偏差** — 纯命名；与 `03` T3 契约一致 |
| **Daemon 侧遗留迁移** | `03` T5：Electron `seedBuiltins` 带 `legacyUserDataDir`；Daemon store 首次 IO 亦触发 | store `beforeStorageIo` 无参迁移仅探测 `cwd/workflows`；Electron 路径由 `workflow-file.seedBuiltins` 带参覆盖 | **已知偏差**（04 §4.2，评分 ~55）— 纯 Daemon 冷启动且数据仅在历史 Electron userData 时需等 Electron 侧迁移；常见「先开 Electron」部署可接受 |
| **父债双路径存储** | 父变 `05-summary` §3.1「Daemon/Electron 工作流存储双路径」 | 统一经 `workflow-store` + `workflow-path` lazy SSOT | **已清偿** — 父变 `05-summary` §3.1 该行应标 `closed_by: 20260712145628`（librarian archive 步骤同步） |
| **其余 M1/W1** | 与 `02`/`03` 逐步对照 | 实现一致 | **无功能偏差** |

---

## 3、影响范围

- **模块**：`src/workflow/*`（path/store/session-key/engine/server-workflow）、`electron/workflow/*`（file/runner）、`electron/session/session-dispatcher-launch.ts`、`electron/daemon/daemon-manager.ts`（`__WF_LAUNCH__`）。
- **用户可见**：isolated 节点推进后实例 JSON 含 `sessionKey`；resume/run 复用同键续聊；Electron 与 Daemon 读写 `{APP_DATA_DIR}/workflows` 单一真相；首次 IO 日志 `workflow_storage_root=` 便于排障。
- **接口**：无对外 HTTP/MCP/IPC 破坏性变更；`launchWorkflowAgent` / `emitLaunch` 增可选 `sessionKey` 字段（向后兼容）。
- **数据**：实例 JSON 可能新增/更新 `sessionKey`；可选一次性 legacy→SSOT 目录复制（不删 legacy）。
- **与 Agent 标识划界**：工作流键 `{chatId}::wf_*` **不**写入 `session-routing.json`；IM 续聊路由仍归归档 `20260712113356`。

### 3.1 Ponytail 技术债

本变更 diff 中 **无** `ponytail:` 注释。

| 位置 | 注释/评审摘要 | 升级路径 |
|------|---------------|----------|
| `workflow-engine.ts` ~439 行 | 历史超限（04 遗留）；本变更未扩 scope 拆分 | 归工作流引擎专责拆分变更 |
| `createAdminMcpServer` 等 | **不适用** | — |

`04-review` Ponytail 结论：**Lean already. Ship.** — 仅两个小模块，无 Repository/LaunchOrchestrator/新 npm 依赖。

### 3.2 开放评审

| ID | 状态 | 摘要 | 处置 |
|----|------|------|------|
| — | — | `reviews[]` 零 open | — |

**无开放代码债** — 本变更 **不得** `archived_with_debt`。

### 父债清偿（不写入本 manifest `reviews[]`）

| ID | 父变更 | 原 status | 本变更处置 |
|----|--------|-----------|------------|
| 双路径存储 | `20260712113344` | `05-summary` §3.1「Daemon/Electron 工作流存储双路径」 | **closed_by: `20260712145628`** — SSOT `APP_DATA_DIR/workflows` + runner 委托统一 |

---

## 4、知识库影响清单

> 来源：`02-design.md` §九、§十；T6 已落盘 AGENTS 标 `[x]`；业务域正文由 **kb-librarian** 在 archive 步骤 6 补全。

### （一）必须更新

- [ ] `knowledge/业务域/工作流/02-定义与实例.md` — §二存储 SSOT、§六实例字段含 `sessionKey`、§九移除「未持久化」限制
- [ ] `knowledge/业务域/工作流/03-节点执行与流转.md` — §六 isolated 落盘键、§九 resume 复用持久键
- [x] `src/workflow/AGENTS.md` — 已更新 path/store/session-key 分工与存储约定
- [x] `electron/workflow/AGENTS.md` — 已更新 file 薄封装、runner 禁止直 import store

### （二）可能更新（视 librarian 合并结果）

- [ ] `knowledge/业务域/工作流/01-概览.md` — §五关键约束补「单一 `workflows/` 存储根」一句
- [ ] `knowledge/业务域/工作流/04-触发与管理入口.md` — 若补充运维排障「存储根」指引
- [ ] `knowledge/变更/归档/20260712113344-工作流恢复入口与信号接口/05-summary.md` §3.1 — 标 `closed_by: 20260712145628`（双路径存储债清偿）

### （三）不需要更新

- [x] `knowledge/业务域/Agent调度/*` — resume 入口已归档；本变更不改授权/斜杠契约
- [x] `knowledge/业务域/消息桥接/*` — 队列/路由无变更
- [x] #6「多引擎MCP设置实质化」相关文档 — 无文件交叉
- [x] `knowledge/知识地图.md` — 入口未变

---

## 5、验收与债务状态

| 维度 | 状态 |
|------|------|
| **T1～T6** | done（manifest `tasks[]`；T6 证据：`run-workflow-session-storage-contract.sh` ALL PASS） |
| **04-review** | ✅ 通过；严重 0；警告 0 |
| **06 契约** | ✅ ST-WF1～WF6 + `build:mcp` |
| **06 实机冒烟** | ⏳ S1～S4 待用户执行（Electron 重启 resume 同键、双入口对拍、遗留迁移）— 不阻断本步骤；契约已覆盖路径/落盘/无双写 |
| **01 §六** | ✅ 契约 + 静态覆盖 1/2/4/5/6；1/3 实机项 ⚠️ 待 spot-check |
| **`reviews[]`** | **全 closed** — **不得** `archived_with_debt` |

### 对照 01 验收摘要

| # | 01 验收项 | 结论 |
|---|-----------|------|
| 1 | 重启可恢复 `sessionKey` 并用于续聊/路由 | ✅ 引擎落盘 + launch 复用（契约 ST-WF1/WF3）；E2E ⚠️ 待实机 |
| 2 | Daemon/Electron 同一存储真相 | ✅ ST-WF2 + T1/T2 静态 |
| 3 | resume 三入口仍通 | ✅ 入口未改；底层读盘/launch 增强；E2E ⚠️ 待实机 |
| 4 | 非目标未扩大 | ✅ ST-WF4 |
| 5 | 不与 Agent 标识双写 | ✅ ST-WF5 |
| 6 | 运维可识别单一存储根 | ✅ ST-WF6 `workflow_storage_root=` |

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并登记 `manifest.files`；**保持 `stage=tested`**。
- **暂勿** `mv` 至归档、**暂勿** `commit`、**暂勿** 标 `archived` / `archived_with_debt`（迁移与 stage 收尾归 release/librarian）。
- inspector 预期：本变更无开放代码债；父债「双路径存储」由本变更清偿后，父变 `05-summary` §3.1 须同步 `closed_by` 字段；§4·（一）业务域工作流正文待 librarian archive 补全。
