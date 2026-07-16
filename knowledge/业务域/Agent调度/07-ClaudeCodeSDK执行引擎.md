---
type: DomainModule
title: Claude Code SDK 执行引擎
description: spawnClaudeCodeProcess + query 消息桥；pid；stop/watchdog kill
timestamp: 2026-07-16T18:35:00+08:00
related:
  - 业务域/Agent调度/03-启动与自动重连
  - 业务域/Agent调度/10-SDK上下文保护与失败归因
depends_on:
  - 业务域/Agent调度/01-概览
---

# Claude Code SDK 执行引擎

## 一、能力范围

Claude Agent SDK：默认 `spawnClaudeCodeProcess` 显式拉起 CLI，`query()` 作消息桥；launch/dispatch/recover、Presentation、`cc-agent-api`、MCP 内联与 `ccSessionId` 续接。经 `engine-port-adapter` 实现 `AgentEnginePort`，终态经 `RunLifecycle`+`completeRunFromTemplate`。不负责 Cursor（[[06-CursorSDK执行引擎]]）、Daemon IM 编排。

## 二、设计决策与取舍

- **spawn 主路径**：`startCcSpawn`→`buildQueryOptions` 注入 `createCcSpawnClaudeCodeProcess`；写 `childPid`/`spawnedProcess`（内存 only）。`CC_LEGACY_QUERY=1|true|yes` 不注入（`legacy_query`）。
- **Engine Port / 终态**：`registerCcEnginePort`；`completeCcViaLifecycle`/`notifyCcRunFailure`/`notifyCcWatchdogTimeout`→`completeRunFromTemplate`。
- **续接（S7）**：`recoverCcActiveRuns`→probe→resume→guard→`startCcSpawn`；失败 `classifyResumeFailure`→`notifyResumeFailure`。
- **进程回收**：stop 与 watchdog `onTimeout` 在 close query 后 `killCcSpawnedProcess`。
- **MCP**：`cc-mcp-loader`+审批；`strictMcpConfig:true`。

## 三、服务端规则

1. `type === "claude-code"` 且配 API Key；默认 `claude-sonnet-4-6`。
2. `activeQuery` 非空时 launch→dispatch；`enterGuardWithLifecycle` 单飞。
3. spawn 同步失败（`cc_spawn_enoent`/`cc_spawn_failed`）返回 `{ ok:false, error }`，在 `NOTIFY_PROCESSING` 前。
4. 超时：close+kill→`finalizeCcRunOnWatchdogTimeout`；用户 stop 不 notify。
5. ContextRotation 命中清 `ccSessionId`。

## 四、客户端流程

```mermaid
sequenceDiagram
  GW["agent-sdk-http"]->>Port["engine-port-adapter"]
  Port->>Spawn["startCcSpawn"]
  Spawn->>CLI["spawnClaudeCodeProcess"]
  Spawn->>Q["query 消息桥"]
  Q-->>EV["agent-cc-events"]
  EV->>LC["RunLifecycle"]
```

IM 委托 `launchCcAgentFromHttp`。

## 五、接口

| 入口 | 说明 |
|------|------|
| `AgentEnginePort` | `engine-port-adapter.ts` |
| `startCcSpawn` / launch / dispatch | spawn+query；`startCcQuery` 弃用转发 |
| `createCcSpawnClaudeCodeProcess` / `killCcSpawnedProcess` | `cc-spawn-process.ts` |
| `POST /api/cc/agent/launch\|dispatch` | 直连 |
| `POST /api/agent/launch\|dispatch` | Daemon 网关 |

## 六、数据

`CcSessionAgent`：`childPid`、`spawnedProcess`、`ccSessionId`、`activeQuery`、闩字段等；`cc-active-runs.json`。见 [[10-SDK上下文保护与失败归因]]。

## 七、非功能与可观测

`cc_spawn pid=`、`legacy_query`、`cc_spawn_*`、`[recover]`；广播 `pid: childPid ?? 0`；`completeCcRun` 清句柄。

## 八、推送

无独立推送；IM 对称 Cursor；f41 plain 经 `flushFeishuPlainAssistantIfNeeded`。

## 九、已知限制与 TODO

审批多源未并读；probe 仅校验会话文件；`spawnedProcess` 最小子集；Port 注释仍写 `startCcQuery`。

## 十、相关

- [[01-概览]]
- [[03-启动与自动重连]]
- [[06-CursorSDK执行引擎]]
- [[10-SDK上下文保护与失败归因]]
