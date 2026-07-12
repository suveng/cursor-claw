# 多引擎MCP设置实质化 - 变更总结

> **变更 ID**：`20260712145827-多引擎MCP设置实质化`  
> **来源**：kb-propose · standard flow · **前置依赖**：`20260712144931-斜杠执行模式稳态收尾`（已归档）  
> **阶段**：`tested`（步骤 5 完成；工程平台 KB 正文待 librarian；迁移前 **勿** 标 `archived`）  
> **用户可见性**：是 — Settings Codex/OpenCode MCP 只读实质化；健康列禁止静默「未知」；MCP Tab 顶部可复制 Daemon 指引

---

## 1、实际变更

### 代码

| 任务 | 文件 | 改动要点 |
|------|------|----------|
| T1 | `src/shared/mcp-health-label.ts` | 新建 `formatMcpHealthDisplay` / `formatMcpHealthDisplayIm` / `formatMcpPanelStatusLabel`；健康降级 SSOT |
| T1 | `src/daemon/daemon-http-mcp-admin.ts` | `buildMcpServerInfo` 引用 SSOT；`healthError` 优先于空 status |
| T1 | `src/daemon/daemon-slash-mcp.ts` | `/mcp ls|info` 对齐降级文案 |
| T1 | `electron/scheduling/command-handler.ts` | 飞书 `/mcp` 子命令对齐 SSOT |
| T2 | `electron/session/session-mcp-disk-fallback.ts` | 新建 `tryNoSessionDiskMcpFallback`；codex/opencode/cc 无 session 读盘 |
| T2 | `electron/session/session-mcp-status.ts` | 接入 fallback；292 行 ≤300 |
| T3 | `src/renderer/lib/mcp-view-strategy.ts` | codex `supported:true`；TOML/JSON 路径与「设置页不提供编辑」文案 |
| T3 | `src/renderer/components/SettingsMcpEngineBlock.tsx` | 统一 `SettingsMcpDiskReadonly`；移除 Codex/OpenCode Placeholder |
| T4 | `src/renderer/components/SettingsMcpDaemonGuide.tsx` | 新建可复制 `mcp.json` 片段（仅 `cursor-claw`→`/mcp`）；脚注 IM `/mcp` 或 `POST /api/mcp` |
| T4 | `src/renderer/pages/Settings.tsx` | MCP Tab 顶部挂载 `SettingsMcpDaemonGuide` |
| T5 | `src/renderer/components/SessionMcpPanel.tsx` | codex/opencode 经 `viewConfig.supported` 取数；disk 空 status 标「未探测」 |
| T6 | `src/renderer/components/AGENTS.md` | Settings MCP 多引擎只读、Daemon 指引口径 |
| T6 | `electron/session/AGENTS.md` | session-mcp 读盘 fallback 说明 |
| T6 | `src/daemon/AGENTS.md` | 健康降级 SSOT 与 admin/斜杠对齐 |
| T6 | `auto_test/run-mcp-settings-contract.sh`、`.mts` | ST-M1～M5 契约 + `tsc --noEmit` |

**未纳入（显式）**：Daemon MCP 协议（`createAdminMcpServer` / `POST /mcp` Agent 工具）；`SettingsMcpSdkSection` CRUD；微信通道；整页 Settings 布局；`workspace-injector` 自动注入（仍 no-op）。

**统计**：2 新建源模块 + 11 修改 + 3 AGENTS + 2 验收脚本；`tsc --noEmit` 通过；`run-mcp-settings-contract.sh` **ALL PASS**（见 `06-automation-test.md` §7）；Settings 实机 Codex/OpenCode 列表渲染为可选补证，不阻断 archive。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`、`05-summary.md`（本文件）

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **健康 SSOT** | 可选 `src/shared/mcp-health-label.ts` | 已建纯函数模块，三处 + Session 面板共用 | **符合设计** |
| **session-mcp-status 拆分** | 近 300 行则拆 `session-mcp-disk-fallback.ts` | status 292 行 + fallback 127 行 | **符合设计** |
| **Codex Settings 编辑** | 首版只读 + TOML 文件引导 | `supported:true` 仅展示；文案标明「请直接编辑文件」 | **符合设计** — 非静默「不支持」 |
| **可选 KB** | `02` §十·（二）`Daemon守护进程/02-HTTP与MCP服务.md` | 健康降级字段可在 archive 视合并范围补充 | **待 librarian 裁量** — 不阻断本变更 archive |
| **工程平台 KB** | `02` §十·（一）`04-配置与更新`、`03-渲染端界面` | 正文仍为占位口径（codex/opencode 占位） | **待 librarian** — §4·（一）必更 |
| **其余 T1–T6** | 与 `02`/`03` 逐步对照 | 实现一致 | **无功能偏差** |

---

## 3、影响范围

- **模块**：Electron session/mcp 读盘、`renderer` Settings/Session MCP UI、Daemon admin/slash 健康展示、scheduling command-handler。
- **用户可见**：Settings 绑定 codex/opencode 时 MCP Tab 展示磁盘只读列表或空态路径引导；agent-api 未就绪时健康列显示「暂不可查（…）」而非裸「未知」；MCP Tab 顶部可复制 `cursor-claw` Daemon 片段。
- **接口**：`agent:mcp-status` IPC 扩展 `engineType=codex|opencode` 无 session 读盘（`source:"disk"`）；无新 HTTP 路由；无 proto 变更。
- **数据**：无持久化 schema 变更；读 `~/.codex/config.toml`、`opencode.json` 等既有路径。
- **与稳态收尾衔接**：指引仅 `cursor-claw`→`/mcp`；不含 `/mcp-admin`；与 `buildMcpServers` SSOT 一致。

### 3.1 Ponytail 技术债

本变更 **diff** 中 **无** 新增 `ponytail:` 注释。

| 位置 | 注释/评审摘要 | 升级路径 |
|------|---------------|----------|
| — | 无 | — |

`04-review` Ponytail 结论：**无新抽象/中间层**；仅可选 shared 纯函数与 disk fallback 模块拆分。

**产品已知边界**（非 `reviews[]` 债务）：`daemonPort` 与实跑 Daemon 不一致时，指引脚注说明以 Settings 配置为准（`02` §八·（一））。

### 3.2 开放评审

| ID | 状态 | 摘要 | 处置 |
|----|------|------|------|
| — | — | `04-review` 严重 0、警告 0 | **archive_ready** |

**无开放代码债** — 本变更 **不得** `archived_with_debt`。

---

## 4、知识库影响清单

> 来源：`02-design.md` §九、§十；AGENTS 已随 apply 标 `[x]`；§十·（一）**必须更新**由 **kb-librarian** 在 archive 步骤 6 补全（**KB 必更**）。

### （一）必须更新

- [ ] `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` — §四「工作区注入」补 **手动 MCP 指引**（`SettingsMcpDaemonGuide` / `buildMcpServers` 口径）；§二/§九 多引擎 Settings 能力：SDK CRUD、CC/Codex/OpenCode 只读、自动注入仍 no-op
- [ ] `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md` — §四 Settings MCP：`SettingsMcpEngineBlock` 引擎分块（sdk CRUD / `SettingsMcpDiskReadonly`）；MCP Tab 顶部 `SettingsMcpDaemonGuide`；Dashboard `SessionMcpPanel` disk 空 status「未探测」

### （二）可能更新（视 librarian 合并结果）

- [ ] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — `/mcp` 与 `POST /api/mcp` 健康列降级字段（`healthError` / `formatMcpHealthDisplay`）
- [ ] `knowledge/业务域/Agent调度/` 各引擎 MCP 子模块 — Codex TOML / OpenCode JSON 配置路径（若 archive 范围纳入）

### （三）不需要更新

- [x] `knowledge/知识索引.md` — 无新领域入口（`02` §十·（三））
- [x] Daemon MCP 协议专文 — 无协议变更
- [x] 微信通道相关文档 — 非目标范围
- [x] `knowledge/知识地图.md` — 入口未变

### （四）代码侧 AGENTS（已随 apply）

- [x] `src/renderer/components/AGENTS.md` — Settings MCP 多引擎只读、Daemon 指引
- [x] `electron/session/AGENTS.md` — session-mcp disk fallback
- [x] `src/daemon/AGENTS.md` — 健康降级 SSOT

---

## 5、验收与债务状态

| 维度 | 状态 |
|------|------|
| **T1～T6** | done（manifest `tasks[]`；T6 证据：`run-mcp-settings-contract.sh` ALL PASS） |
| **04-review** | ✅ 通过；`archive_ready: true`；严重 0；警告 0 |
| **06 契约** | ✅ ST-M1～M5、`tsc --noEmit` |
| **06 实机 UI** | ⏳ 可选未执行（Settings Codex/OpenCode 列表、剪贴板复制）— 不阻断本步骤 |
| **01 §6.1（R1–R3）** | ✅ 契约 + 静态 + `04-review` 走查 |
| **01 §6.2（边界）** | ✅ 无整页重做、无协议变更、无微信 |
| **`reviews[]`** | **FR1 pass** — **不得** `archived_with_debt` |

---

## 6、阶段说明（步骤 5）

- 本轮 **仅** 写 `05-summary.md` 并登记 `manifest.files`；**保持 `stage=tested`**。
- **暂勿** `mv` 至归档、**暂勿** `commit`、**暂勿** 标 `archived` / `archived_with_debt`（迁移与 KB 合并归 release/librarian）。
- 下一步：`/kb-archive` → librarian 按 §4·（一）合并 `04-配置与更新`、`03-渲染端界面` 后迁移目录。
