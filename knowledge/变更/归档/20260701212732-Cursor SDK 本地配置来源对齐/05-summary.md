# Cursor SDK 本地配置来源对齐 - 变更总结

## 1、实际变更

### 代码（与 manifest.files code 一致）

| 文件 | 关键改动 |
|------|----------|
| `electron/mcp-sdk-loader.ts` | `loadInlineMcpServersForSdk` + `needsInlineInjection`：HTTP/sse/OAuth inline，stdio 默认 settingSources；`SDK_MCP_STDIO_INLINE` 回滚 |
| `electron/agent-sdk.ts` | 入口编排；`launchSdkAgent` 统一 settingSources + inline + `[config]` 日志 + `lastInjectedMcpServers` |
| `electron/sdk-run-dispatch.ts` | `buildSendOptions` / `maybeRotateSessionForPressure` 三处注入与 `logSdkConfigSources`（T2 从 agent-sdk 拆出） |
| `electron/session-mcp-sdk-path.ts` | **新增** `buildSdkRuntimeEntries`：inline/settingSources/插件层 `__sdkLoadVia` 标注 |
| `electron/session-mcp-status.ts` | SDK 路径改调 `buildSdkRuntimeEntries` |
| `electron/main.ts` | `rules:*` 无主工作区错误文案；Skills IPC 不变 |
| `electron/AGENTS.md` | T-FIX-01：移除越界 persistence 段落，保留 MCP 分层与 session-mcp-sdk-path |
| `src/renderer/pages/Settings.tsx` | Rules/Skills 来源说明；挂载 MCP Tab；Plugin 只读说明区 |
| `src/renderer/components/SettingsMcpPanel.tsx` | **新增** global/project MCP CRUD（218 行） |
| `src/renderer/components/SessionMcpPanel.tsx` | SDK 来源标签（inline/settingSources/插件层） |
| `src/renderer/lib/mcp-view-strategy.ts` | `getMcpPluginNotice`、`formatMcpScopeLabel`、`resolveSdkMcpLoadVia` |
| `src/renderer/components/AGENTS.md` | SessionMcpPanel / mcp-view-strategy 约定 |

### 变更文档

- `01-proposal.md`（Rev1 验收 11–14）
- `02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`、`07-prd-revisions.md`
- `00-manifest.json`（stage=tested；R1/R2 closed；R3 accepted_debt）

## 2、与设计的差异

1. **T-FIX-01 范围修复（已关闭 R1/R2）**：初评 `agent-sdk.ts` 混入 `sdk-run-persistence`/续接逻辑；复评已剥离，T2 注入落 `sdk-run-dispatch.ts`，`agent-sdk.ts` 仅 launch/dispatch 编排（271 行）。
2. **其余 in-scope 与 design S4–S13 一致**：MCP 分层、Settings 四 Tab、SessionMcp 展示、`[config]` 可观测均已落地。
3. **W1（非阻断）**：`buildSendOptions` 内 `logSdkConfigSources` 与 `appendInlineMcpToSendOptions` 各读盘一次 inline MCP，可后续合并为单次变量（04-review §3）。

## 3、影响范围

- **Cursor SDK 执行引擎**：MCP 合并/去重、settingSources、三处 inline 注入、配置日志、Dashboard MCP 来源语义。
- **Settings**：Rules（主工作区 `.cursor/rules/`）、Skills（`~/.cursor/skills`）、MCP Tab（global/project）、Plugin 只读说明。
- **IPC**：无新 handler；`rules:*`/`skills:*`/`mcp:*`/`agent:mcp-status` 行为与文案对齐。
- **非目标**：Claude/Codex/OpenCode 引擎、`workspace-injector`（仍 no-op）、Daemon/IM 路由。

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `electron/mcp-sdk-loader.ts:48` | `SDK_MCP_STDIO_INLINE=1` 回滚 stdio inline | settingSources 无法加载某 stdio 时临时开启；验收 10 回归后移除依赖 |
| 其余变更文件 | 无新增 ponytail | — |

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — 官方配置来源表、MCP 分层、Settings 四 Tab 与执行引擎关系、验收 11–14 行为
- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — Settings MCP Tab、`rules:*` 主工作区说明（精简 §四/§七 以 ≤3000 字）
- [x] `knowledge/业务域/Agent调度/01-概览.md` — §五 配置来源摘要
- [x] `knowledge/业务域/Agent调度/00-README.md` — §关键源码 补 `mcp-sdk-loader`/`session-mcp-sdk-path`
- [x] `knowledge/知识索引.md` — 总入口未变，无需更新

## 5、评审结论摘要

- **04-review 复评：通过**（stage reviewed→tested）；无 open blocking。
- **R1/R2**：T-FIX-01 已关闭（agent-sdk/AGENTS 越界剥离）。
- **R3 accepted_debt**：`daemon-manager.ts` 仍 `import { recoverSdkActiveRuns } from "./agent-sdk"`，函数已迁至 `sdk-run-recover.ts`；归属并行变更 `20260701212827-CursorSDK执行引擎事件流消费`，**不阻断本变更 archive**。
- **06-automation-test**：静态项（T1–T3、Rev1、T-FIX-01）通过；01 验收 1–10 与 E1–E8 运行时项待用户手工冒烟（§4.1 S1–S15）。

## 6、版本建议（供 kb-release 步骤 8–10）

- **类型**：patch（用户可见：Settings MCP Tab 恢复、配置来源对齐、MCP 去重策略）
- **建议版本**：`1.9.1` → **`1.9.2`**
- **changelog 要点**（`changelog/1.9.2.json`）：
  - Cursor SDK 会话 MCP 按官方优先级加载，HTTP/sse 内联、stdio 默认经 settingSources，减少重复注册
  - 设置页恢复 MCP 管理（区分用户级/项目级），Rules/Skills 说明与 SDK 配置来源对齐
  - 设置页 Plugin 说明与 Dashboard MCP 面板标注「插件层」来源
  - SDK 启动/send 日志输出 `[config]` 行便于对照 cwd 与 inline MCP
