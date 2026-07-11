# Agent注入群聊名提示词 - 变更总结

> **变更 ID**：`20260711095806-Agent注入群聊名提示词`
> **来源**：kb-lite
> **lite 类型**：知识同步型 lite
> **阶段**：`applied`（LITE-01 done；归档前已 bump 版本与 changelog）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/shared/agent-launcher.ts` | **公共注入点** `buildPrompt`：有群名时首行 `group_name: <名>\n` + 原文；无群名**省略该行**（不写空占位）。群名优先显式 `chatName`，否则 `resolveSessionChatName(sessionKey)`（chatNameCache） |
| `electron/agent/cursor-sdk/agent-sdk.ts` | 经 `buildPrompt` 传入 `chatName`，四引擎路径一致 |
| `electron/agent/claude-code/agent-claude-sdk.ts` | 同上 |
| `electron/agent/codex/agent-codex-sdk.ts` | 同上 |
| `electron/agent/opencode/agent-opencode-sdk.ts` | 同上 |
| `electron/agent/shared/AGENTS.md` | 沉淀 `buildPrompt` 群名首行注入与无群名省略约定 |
| `package.json` | version bump `1.13.16` → `1.14.0`（用户可见新能力，minor） |
| `changelog/1.14.0.json` | 新建：Agent 提示词首行注入当前群聊名 `group_name` |

**变更文档**：`00-manifest.json`、`01-proposal.md`、`05-summary.md`（本文件）。

**知识**：`knowledge/业务域/Agent调度/03-启动与自动重连.md` — 已补 `buildPrompt` 群名首行注入约定。

**未改**：proto/DB、IM 发送协议、执行引擎生命周期、会话隔离。

**外部 integrations**：未启用 registry/notifications，跳过 external 登记与通知。

## 2、与设计的差异

无。lite 无 `02-design.md`；实现与 `01-proposal.md` 一致。无群名降级已定为「省略该行」（01 允许空串或省略二选一，实现取省略）。

## 3、影响范围

- **模块**：Electron 主进程 agent 提示词组装（`agent-launcher.buildPrompt`）；四引擎 launch/dispatch 均经此函数。
- **行为**：Agent 收到的任务 Prompt 在有群聊名时首行带 `group_name:`；无群名时与改前正文一致（无额外行）。
- **接口/数据**：无对外 HTTP/proto/持久化变更。
- **用户可见**：群聊场景下 Agent 可感知当前群名；已 **minor** bump 至 `1.14.0` 并写 changelog。

### 3.1 Ponytail 技术债

无。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| — | 无 | — |

### 3.2 债务与评审

- **债务**：无
- **open review**：无（lite 无强制 `04-review.md`）

## 4、知识库影响清单

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/Agent调度/03-启动与自动重连.md` | **已更新** | `buildPrompt` 有群名首行注入 `group_name:`，无则省略；来源显式 `chatName` / `resolveSessionChatName` |
| `knowledge/业务域/Agent调度/01-概览.md` | 无需更新 | 术语表无需新增 |
| `knowledge/业务域/Agent调度/00-README.md` | 无需更新 | 无新增/重命名子模块，阅读路径不变 |
| `knowledge/工程平台/**` | 不优先 | 公共组装已在业务域启动文档与 `electron/agent/shared/AGENTS.md` |
| `knowledge/知识索引.md` | 无需更新 | 无领域/分区入口增删或总入口失真 |

- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — 已补 `buildPrompt` 群名首行注入约定
- [x] `knowledge/业务域/Agent调度/00-README.md` — 两级索引：子模块清单/阅读路径未变，无需更新
- [x] `knowledge/知识索引.md` — 总入口未变，无需更新

## 5、验收结论（对照 01）

| # | 01 验收项 | 结论 |
|---|-----------|------|
| 1 | 有群聊名时，组装后提示词**首行**为 `group_name: <当前群聊名>`，其后为原有内容 | ✅ `buildPrompt` 返回 `` `group_name: ${name}\n${body}` `` |
| 2 | 无群聊名时不注入无效占位；行为可预期 | ✅ 约定为**省略该行**；`!name` 时直接返回 `body` |
| 3 | 仅影响提示词组装，不改引擎/会话隔离/IM 协议 | ✅ 改动限于 `buildPrompt` 与四引擎传参；无协议/引擎契约变更 |

## 6、归档待办（`/kb-archive`）

- **知识合并**：✅ 已更新 `03-启动与自动重连.md`
- **版本/changelog**：✅ `1.14.0` + `changelog/1.14.0.json`
- **迁移**：`stage` → `archived`，目录 `mv` 至 `knowledge/变更/归档/`
- **external**：integrations 未启用，archive 步骤 10 跳过
