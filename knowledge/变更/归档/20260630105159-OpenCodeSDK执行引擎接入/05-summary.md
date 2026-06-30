# OpenCode SDK 执行引擎接入 - 变更总结

## 1、实际变更

### 依赖与类型

- `package.json`：新增 `@opencode-ai/sdk`
- `src/shared/channel-types.ts`：`AgentResource.type` 扩 `"opencode"` 及 Profile 字段
- `electron/preload.ts`、`src/renderer/env.d.ts`：type/`engineType` 同步

### OpenCode 引擎（electron）

- `electron/agent-opencode-{types,utils,events,stream,session-registry,watchdog,complete,sdk,http}.ts`：HTTP server、launch/dispatch、SSE 映射、会话表、看门狗、收尾
- `electron/opencode-mcp-loader.ts`、`electron/opencode-failure-messages.ts`：MCP 加载与失败脱敏
- `electron/session-dispatcher.ts`：`launchAgent` 四引擎分支；stop/isRunning/list 对称
- `electron/agent-sdk.ts`：`resolveBoundAgentRoute` 扩 `opencode`/`opencode-missing`
- `electron/config-store.ts`：`newOpencodeResourceId`/`isOpencodeResourceId`/`findFirstRunnableResource` 兜底
- `electron/daemon-manager.ts`、`electron/ui-logger.ts`：运行态合并与日志
- `electron/main.ts`：`before-quit` → `closeAllEmbeddedOpencodeServers()`（T-FIX-02）

### 配置 UI（renderer）

- `src/renderer/components/AgentResourceModals.tsx`：`OpenCodeEditModal`
- `src/renderer/components/AgentOpencodeProfileSection.tsx`：Profile CRUD 区块
- `src/renderer/components/AgentProfilePanels.tsx`、`ChannelModelSection.tsx`：四引擎 Profile 分组
- `src/renderer/lib/mcp-view-strategy.ts`：`opencode` 展示策略

### 约定文档

- `electron/AGENTS.md`、`src/renderer/components/AGENTS.md`：四引擎约定补充

## 2、与设计的差异

1. **外部探活**：设计写 `global.health()`；实现用 `client.config.get()`（`agent-opencode-utils.ts`，SDK 无 health API）。行为等价性依赖 config 端点，T8 文案链仍覆盖。
2. **HTTP 注册落点**：设计写 `main.ts` init；实际 `initSessionDispatcher` 注册 `ensureOpencodeHttpServer`（与 Codex/CC 一致）；退出清理确在 `main.ts`。
3. **评审修复**：T-FIX-01 补 `resolveOpencodeContextLimit` 写入 `contextLimitTokens`，满足 01 验收 #6。

其余与 `02-design.md` 一致。

## 3、影响范围

- **路由**：IM（Daemon→agent-api→agent-sdk）与任务/工作流（session-dispatcher→各 agent-api）均支持 `type=opencode`
- **数据**：`OpencodeSessionAgent.opencodeSessionId` 续接；`AgentResource` 持久化 OpenCode Profile
- **运行期**：`userData/opencode-agent-api-port.json`；内嵌模式 per-Profile OpenCode server
- **回归**：四引擎分支独立，不改 SDK/CC/Codex 既有路径

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `electron/agent-opencode-utils.ts:28` | SDK 无 `global.health`，外部探活用 `config.get` | SDK 提供 health API 后切换 |
| `electron/opencode-mcp-loader.ts:42` | 用户级路径兼容 XDG 与 `~/.opencode` | 对齐官方配置路径规范后收敛 |

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/09-OpenCodeSDK执行引擎.md` — 新增十段式子模块
- [x] `knowledge/业务域/Agent调度/00-README.md` — 清单加 09、关键源码加 `agent-opencode-*`/`opencode-mcp-loader.ts`
- [x] `knowledge/业务域/Agent调度/01-概览.md` — 四引擎措辞、架构图加 OpenCode、子模块加 09、约束补 `opencodeSessionId`
- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — 四引擎 IM 路径、`engineType`/`opencodeSessionId`
- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — OpenCode 长驻/轮转/端口对称 Codex
- [x] `knowledge/业务域/Agent调度/08-CodexSDK执行引擎.md` — 与 OpenCode 并列交叉引用
- [x] `knowledge/业务域/Agent调度/00-README.md` — 领域局部索引（无需更新 `knowledge/知识索引.md`，总入口仍指向领域 README）
