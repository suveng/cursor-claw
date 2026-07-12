# 斜杠执行模式稳态收尾 - 变更总结

> **变更 ID**：`20260712144931-斜杠执行模式稳态收尾`  
> **来源**：kb-propose · standard flow · **父变更**：`20260712113307-控制层HTTP化与斜杠去Electron依赖`  
> **阶段**：`tested`（archive 步骤 5 完成；知识库正文待 librarian；迁移前 **勿** 标 `archived`）  
> **用户可见性**：是 — 开箱默认 `SLASH_EXEC_MODE=daemon` 稳态；`/mcp-admin` 移除；dual/electron 仅显式兼容

---

## 1、实际变更

### 代码

| 任务 | 文件 | 改动要点 |
|------|------|----------|
| T1 | `src/daemon/daemon.ts` | `getSlashExecMode` 默认与非法回退 `dual`→`daemon`；启动日志文案 |
| T1 | `electron/daemon/daemon-manager.ts` | `resolveSlashExecMode` 与 Daemon 侧语义同步 |
| T2 | `src/daemon/daemon.ts` | `handleCommand` dual 分支、skip-check 包装注释标 **仅 dual\|electron** |
| T2 | `src/daemon/daemon-http-non-api-routes.ts` | `/commands*` 路由注释 dual\|electron 兼容 |
| T2 | `electron/daemon/daemon-manager.ts` | poll/skip-check 相关注释；`wireSlashPollSkipChecker` daemon 清除 checker（逻辑既有） |
| T3 | `src/daemon/daemon-http-server.ts` | 移除 `/mcp-admin` MCP session；`GET /mcp-admin` 返回 410 + JSON 指引 |
| T3 | `src/daemon/daemon.ts` | 启动日志改为 `/mcp` Agent 工具 + 管理走 `/api/mcp` 或 IM `/mcp` |
| T4 | `electron/agent/shared/workspace-injector.ts` | `buildMcpServers` 仅注入 `cursor-claw`→`/mcp`；`CLAW_MCP_KEYS` 保留 admin cleanup |
| T5 | `src/daemon/AGENTS.md` | 默认 `daemon`；poll/skip-check dual-only；`/mcp-admin` 移除 |
| T6 | `auto_test/run-slash-steady-state-contract.sh`、`.mts` | ST-S1～S7 契约冒烟 + mock + `tsc --noEmit` |

**未纳入（显式）**：`executeSlashCommand` / `command-handler` 业务语义；`file-queue` 拆分；HTTP dispatch retry（#1 `20260712144755` 已合入，本 diff **未触及** `handleLaunchFailure` 接线）；`daemon-http-mcp.ts` 中 `createAdminMcpServer` 函数体保留但未再监听。

**统计**：0 新建源模块 + 6 修改 + 2 验收脚本 + 3 KB 文件（T5）；`tsc --noEmit` 通过；`run-slash-steady-state-contract.sh` **ALL PASS**（见 `06-automation-test.md` §7）；飞书 IM 端到端 ST-S2/S3/S7 为可选补证，不阻断 archive。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`、`05-summary.md`（本文件）

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **父债步骤 9（默认 dual）** | 父变 `05-summary` §2：设计步骤 9 稳态 `daemon` 未做，现网默认 `dual` | 双侧 `getSlashExecMode` / `resolveSlashExecMode` 默认与非法回退均为 `daemon` | **已清偿** — 父变 `05-summary` §2「默认 dual」行应标 `closed_by: 20260712144931`（librarian archive 步骤同步） |
| **A0 `/mcp-admin`** | 删除或 404/410 + 指引 | 返回 **410** JSON `{ error, hint }`；不再注册 `createAdminMcpServer` | **符合设计** — `02` §四 二选一已选 410 |
| **可选 KB** | `02` §十·（二）`Electron桌面应用/04-配置与更新.md` | 仍写「`/mcp-admin` 待 T10 废弃」 | **待 librarian** — 不阻断本变更 archive |
| **其余 M1/W1/P1/A1/DOC** | 与 `02`/`03` 逐步对照 | 实现一致 | **无功能偏差** |

---

## 3、影响范围

- **模块**：Daemon 斜杠控制层（`handleCommand` 默认不写 `.fcmd`）、HTTP 暴露层（移除 `/mcp-admin`）、Electron poll 兼容层（dual/electron 保留）、workspace MCP 注入。
- **用户可见**：新装/未设 env 开箱即 Daemon SSOT 斜杠；无默认双写重复执行风险；旧 `/mcp-admin` MCP 客户端须改连 `POST /api/mcp` 或 IM `/mcp`；显式 `SLASH_EXEC_MODE=dual|electron` 行为与父变更归档后一致。
- **接口**：删除 `/mcp-admin` StreamableHTTP；`SLASH_EXEC_MODE` 默认语义变更（**非 breaking**：显式 `dual` 行为不变）。
- **环境变量**：`SLASH_EXEC_MODE=daemon|dual|electron`（**默认 `daemon`**）。
- **数据**：无持久化变更；daemon 默认减少斜杠 `.fcmd` 写入。
- **与 #1 划界**：本变更未修改 `daemon-http-routes-orchestrator` 或 `handleLaunchFailure` 接线；HTTP dispatch 失败语义仍由 #1 清偿（见 §4·（一）`10-SDK…` §三）。

### 3.1 Ponytail 技术债

本变更 diff 中 **无** `ponytail:` 注释。

| 位置 | 注释/评审摘要 | 升级路径 |
|------|---------------|----------|
| `src/daemon/daemon.ts` ~1888 行 | 历史超限；`02` Ponytail 明确本变更不扩 scope 拆分 | 归巨型单体拆分或 `daemon.ts` 专责变更 |
| `daemon-http-admin-crud.ts` `?? "dual"` | manifest R-01 **false_positive** — `getSlashExecMode` 已注入；daemon/dual 均 HTTP 转发 | 可选后续统一缺省字面量为 `daemon`（非功能偏差） |

`04-review` Ponytail 结论：**无新抽象/中间层**；仅 env 默认、删端点、注释与 KB。

**非阻断精简建议**（不写入 `reviews[]`）：`createAdminMcpServer` 若长期无引用可后续删除死代码（当前保留函数体、仅停监听）。

### 3.2 开放评审

| ID | 状态 | 摘要 | 处置 |
|----|------|------|------|
| R-01 | **closed**（`false_positive`） | `daemon-http-admin-crud` 缺省 `?? "dual"` 与默认 daemon 字面不一致 | `getSlashExecMode` 已注入；仅 electron 走入队分支，无功能偏差 |

**无开放代码债** — 本变更 **不得** `archived_with_debt`。

---

## 4、知识库影响清单

> 来源：`02-design.md` §九、§十；T5 已落盘项标 `[x]`；其余由 **kb-librarian** 在 archive 步骤 6 补全。

### （一）必须更新

- [x] `knowledge/工程平台/Daemon守护进程/01-概览.md` — §五/§六/§九：默认 `SLASH_EXEC_MODE=daemon`；dual 显式兼容；poll 非默认主路径
- [x] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — §二/§五/§九：移除 `/mcp-admin`；`POST /api/mcp` + 斜杠 `/mcp` 为管理 SSOT；`/commands*` skip-check **仅 dual**
- [x] `knowledge/业务域/Agent调度/04-远程指令.md` — §一/§二/§九：默认稳态 daemon；poll 降级为 dual\|electron 兼容
- [ ] `knowledge/业务域/Agent调度/10-SDK上下文保护与失败归因.md` — **§三**「Daemon dispatch 对称」：同步 HTTP `POST /api/agent/dispatch` 失败语义须与 #1 `20260712144755` 对齐 — **`handleLaunchFailure`（release + 有限重试 + 耗尽停试 ack）**，**非**旧旁路「失败即 `notifySessionUser`+`stop_progress` 并 ack」。本变更未改 dispatch 路由；librarian 归档时以代码为准修正 §三表述，避免与 `daemon-http-routes-orchestrator` 现网行为矛盾

### （二）可能更新（视 librarian 合并结果）

- [ ] `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` — T10 `/mcp-admin` 废弃表述由「待废弃」改为「已移除」
- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md` — 若 help/运维文案仍提及默认 `dual`
- [ ] `knowledge/变更/归档/20260712113307-控制层HTTP化与斜杠去Electron依赖/05-summary.md` §2 — 标 `closed_by: 20260712144931`（默认 dual 迁移收尾）

### （三）不需要更新

- [x] `knowledge/知识地图.md` — 入口未变
- [x] IM 协议、MergeBatch、Presentation 专文 — 无行为变更
- [x] `file-queue` / 消息队列拆分方案 — 归变更 `20260712145152`
- [x] Engine Port / RunLifecycle 终态契约正文 — 本变更不触及 SDK Run 路径

### （四）代码侧 AGENTS（已随 apply）

- [x] `src/daemon/AGENTS.md` — 已更新；librarian 写知识正文时须与代码约定对齐

---

## 5、验收与债务状态

| 维度 | 状态 |
|------|------|
| **T1～T6** | done（manifest `tasks[]`；T6 证据：`run-slash-steady-state-contract.sh` ALL PASS） |
| **04-review** | ✅ 通过；严重 0；警告 0 |
| **06 契约** | ✅ ST-S1～S7、`tsc --noEmit` |
| **06 飞书实机** | ⏳ 可选未执行（ST-S2/S3/S7 IM 观测）— 不阻断本步骤；默认 daemon 已静态 + 契约证队列空 |
| **01 §6.1（行为）** | ✅ 契约 + mock 覆盖默认 daemon、`/mcp-admin` 410、dual skip-check 保留 |
| **`reviews[]`** | **全 closed**（R-01=`false_positive`）— **不得** `archived_with_debt` |

### 父债清偿（不写入本 manifest `reviews[]`）

| ID | 父变更 | 原 status | 本变更处置 |
|----|--------|-----------|------------|
| 步骤 9 默认 dual | `20260712113307` | `05-summary` §2 差异行「现网默认仍为 dual」 | **closed_by: `20260712144931`** — 开箱默认 `daemon`；poll 标 dual-only 兼容 |

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并登记 `manifest.files`；**保持 `stage=tested`**。
- **暂勿** `mv` 至归档、**暂勿** `commit`、**暂勿** 标 `archived` / `archived_with_debt`（迁移与 stage 收尾归 release/librarian）。
- inspector 预期：本变更无开放代码债；父债「默认 dual」由本变更清偿后，父变 `05-summary` §2 须同步 `closed_by` 字段。
