# 修复IM通道ClaudeCodeLaunch路由 轻量变更说明

> **变更 ID**：`20260629233840-修复IM通道ClaudeCodeLaunch路由`
> **来源**：kb-lite
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 变更说明

飞书 IM 通道绑定 Claude Code Profile 后发送消息报错「请配置 SDK 资源（设置 → Agent）」。

**根因**：Daemon orchestrator 固定调用 `/api/agent/launch`，而 `launchSdkAgentFromHttp` 仅接受 `resource.type === "sdk"`，未按 Agent 资源类型委托 Claude Code 引擎；长驻二次调度 `/api/agent/dispatch` 存在同类问题。

**修复方向**：在 Electron 侧统一 Daemon HTTP 入口，根据 `getAgentResource(channel?.agentResourceId).type` 路由：

| 资源类型 | launch | dispatch |
|----------|--------|----------|
| `sdk` | 现有 SDK 逻辑 | 现有 SDK dispatch |
| `claude-code` | 委托 `launchCcAgentFromHttp` | 委托 `dispatchToClaudeCodeAgent` |
| `cli` | 明确错误，引导用户改绑 | 同上 |

**预期改动文件**：

- `electron/agent-cc-http.ts`：export `launchCcAgentFromHttp`
- `electron/agent-sdk.ts`：`launchSdkAgentFromHttp` 与 dispatch handler 按 type 委托

## 验收标准

1. 飞书通道绑 Claude Code Profile 时 IM 消息能正常 launch，不再报「请配置 SDK 资源」
2. SDK 通道 IM 路径回归不受影响
3. 长驻二次 dispatch（`/api/agent/dispatch`）对 CC 通道同样正确路由

## 影响范围

- **端**：Electron 主进程（Daemon HTTP Agent 入口）
- **模块**：`electron/agent-sdk.ts`、`electron/agent-cc-http.ts`
- **不涉及**：proto、数据库、权限、跨端接口契约变更
- **知识库**：记录型 lite，实现后于 `05-summary.md` 说明是否需同步知识文件
