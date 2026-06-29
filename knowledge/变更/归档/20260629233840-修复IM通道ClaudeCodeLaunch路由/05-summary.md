# 修复IM通道ClaudeCodeLaunch路由 - 变更总结

> **变更 ID**：`20260629233840-修复IM通道ClaudeCodeLaunch路由`
> **来源**：kb-lite
> **lite 类型**：记录型 lite
> **阶段**：`archived`（LITE-01 done；用户确认归档 2026-06-30）

---

## 1、变更摘要

飞书 IM 通道绑定 Claude Code Profile 后，Daemon orchestrator 固定调用 `POST /api/agent/launch`，而 `launchSdkAgentFromHttp` 仅接受 `resource.type === "sdk"`，导致误报「请配置 SDK 资源（设置 → Agent）」。

本次在 Electron Daemon 统一 HTTP 入口按通道绑定的 Agent 资源类型路由：`sdk` 走现有 SDK 逻辑，`claude-code` 委托 CC 引擎，`cli` 返回明确引导错误。launch 与长驻二次 dispatch 口径一致。

## 2、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/agent-cc-http.ts` | **export** `launchCcAgentFromHttp`，供 `agent-sdk` 统一 launch 入口委托 |
| `electron/agent-sdk.ts` | 新增 `resolveBoundAgentResourceType`（解析 `sdk` / `claude-code` / legacy `cli`）；`launchSdkAgentFromHttp` 在 SDK 校验前按类型委托 `launchCcAgentFromHttp`；`dispatchAgentFromHttp` 按类型委托 `dispatchToClaudeCodeAgent` 或 `dispatchToSdkAgent`；legacy `cli` 绑定返回 `LEGACY_CLI_BIND_ERROR` |
| `electron/AGENTS.md` | 补充 Daemon 统一入口双引擎路由约定（与 `session-dispatcher.launchAgent` 口径对齐）；IM 调度描述由「SDK-only」更正为「双引擎」 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入**：proto/DB、渲染层、changelog；CC 引擎本体（`agent-claude-sdk.ts` 等）无改动。

### 路由表（实现后）

| 资源类型 | `POST /api/agent/launch` | `POST /api/agent/dispatch` |
|----------|--------------------------|----------------------------|
| `sdk` | 现有 `launchSdkAgent` 路径 | 现有 `dispatchToSdkAgent` |
| `claude-code` | `launchCcAgentFromHttp` | `dispatchToClaudeCodeAgent` |
| `cli`（legacy） | 明确错误，引导改绑 SDK 或 CC | 同上 |

## 3、与设计的差异

无。与 `01-proposal.md` 修复方向一致，未引入额外 HTTP 端点或端口变更。

## 4、影响范围

- **端**：Electron 主进程（Daemon HTTP Agent 入口）
- **模块**：`agent-sdk.ts`、`agent-cc-http.ts`；间接影响 IM → Daemon → `/api/agent/launch|dispatch` 全链路
- **不涉及**：proto、数据库、权限、跨端接口契约、CC 引擎内部实现
- **用户可见性**：飞书/CC 通道 IM 消息可正常 launch；SDK 通道行为不变；legacy CLI 绑定获可读错误而非 SDK 配置误报

### 4.1 Ponytail 技术债

本次 diff 无新增 `ponytail:` 注释。

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| — | 无 | — |

## 5、验收对照

| # | 验收项（来源 `01-proposal.md`） | 状态 |
|---|--------------------------------|------|
| 1 | 飞书通道绑 Claude Code Profile 时 IM 消息能正常 launch，不再报「请配置 SDK 资源」 | ✅ 用户确认归档 |
| 2 | SDK 通道 IM 路径回归不受影响 | ✅ 用户确认归档 |
| 3 | 长驻二次 dispatch（`/api/agent/dispatch`）对 CC 通道同样正确路由 | ✅ 用户确认归档 |

**建议手测步骤**：

1. 重启应用，飞书通道绑定 Claude Code Profile，私聊发一条消息 → 应进入 CC 处理，无 SDK 配置报错。
2. 另一通道绑定 SDK 资源，同样发消息 → 行为与修复前一致。
3. CC 长驻会话 idle 后再发第二条 → 应走 dispatch 而非误报 SDK 错误。

## 6、知识库影响清单

记录型 lite：**已同步 Agent 调度 IM 入口一句**。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/Agent调度/03-启动与自动重连.md` | **已更新** | 补充 IM 路径 Daemon 统一 `/api/agent/launch|dispatch` 经 `agent-sdk` 内部分委托口径 |
| `knowledge/工程平台/**` | 无需更新 | 无 IPC/渲染层/打包变更 |
| `knowledge/知识索引.md` | 无需更新 | 无新领域/分区入口 |
| `electron/AGENTS.md` | 已更新（代码仓 AGENTS，非 KB） | Daemon 双引擎路由约定 |

- [x] 业务域 — `03-启动与自动重连.md` IM 入口路由已同步
- [x] 工程平台 — 无变更
- [x] 知识索引 — 总入口未变化

## 7、后续待办

无。代码已合入 `be3cdf7`；变更目录已迁移至 `knowledge/变更/归档/`。
