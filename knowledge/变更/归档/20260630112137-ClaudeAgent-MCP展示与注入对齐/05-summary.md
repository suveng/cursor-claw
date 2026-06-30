# ClaudeAgent-MCP展示与注入对齐 - 变更总结

> 回溯 `01-proposal.md` / `02-design.md` / `03-tasks.md` / `04-review.md`。本文件汇总实际变更、与设计差异、影响范围、Ponytail 技术债、知识库影响、遗留债务与归档状态，供 `/kb-archive` 消费。段落用阿拉伯数字编号。

## 1、实际变更

本变更 17 个代码/沉淀文件落地（14 modified + 3 untracked），全部归本变更。变更目录文档 `00`–`04` 不计入下表。

### 1.1 业务代码（15）

| 文件 | 任务 | 关键改动 |
|---|---|---|
| `electron/cc-mcp-loader.ts` | T1 | `mergeMcpJsonEntries` 改读 `~/.claude.json` + `{ws}/.mcp.json`（project 覆盖 user/local）；新增 `readClaudeJsonMcpServers(workspaceDir)`；stdio resolve/cwd/OAuth 保留（OAuth 暂留 Cursor store，stdio-only） |
| `electron/agent-cc-types.ts` | T2 | `CcSessionAgent` 加 `lastMcpServersSnapshot?: Array<{name,status,config?,scope?,tools?}>` |
| `electron/agent-cc-events.ts` | T2 / T-FIX-5 | init 分支缓存 `msg.mcp_servers` 到 `session.lastMcpServersSnapshot`；T-FIX-5 改为浅拷贝（数组 + config + tools 新引用），隔离 SDK mutate |
| `electron/agent-claude-sdk.ts` | T2 / T-FIX-6 | `buildQueryOptions` 设 `strictMcpConfig:true` + UI 日志 `[mcp] inline N servers`；T-FIX-6 抽 session 查询导出到 `agent-cc-session-registry.ts`，本文件回 291 行 ≤300 |
| `electron/agent-cc-session-registry.ts` | T-FIX-6（新建） | 承接 `CC_SESSIONS` Map 与 `getClaudeCodeSessionList`/`getCcSession`/`getCcActiveQuery` 导出；`agent-claude-sdk.ts` re-export 保持 `daemon-manager`/`session-dispatcher` 路径不变 |
| `electron/agent-sdk.ts` | T3 | `SdkSessionAgent` export interface + 加 `lastInjectedMcpServers?: Record<string,McpServerConfig>`；L703/727/754、L1224/1266/1381 三处注入点提取 `injected` 变量只读盘一次，注入后回写快照；`getSdkSession(sessionKey)` 导出 |
| `electron/mcp-status-map.ts` | T4 | `resolveWorkspaceKey(workspaceDir?, engineType?)` 缓存键改 `wsKey+"::"+(engineType??"sdk")`；`fetchMcpStatusMap` 加 `engineType?` 透传 |
| `electron/mcp-manager.ts` | T4 | `getMcpStatusMap(force, workspaceDir?, engineType?)` 透传 engineType |
| `electron/session-mcp-status.ts` | T5 / T-FIX-1/2/3/4（新建 186 行） | `getSessionMcpStatus(sessionKey, force?, engineType?)` 取数器：CC activeQuery→`mcpServerStatus()` / idle→snapshot 读盘补 config / 无 session+`engineType=claude-code`→读盘 fallback；SDK→注入快照 + `fetchMcpStatusMap`；`mapCcStatusToUi` 枚举映射；`toEntry` 防 undefined；force/engineType 透传 |
| `electron/main.ts` | T6 / T-FIX-3/4 | 注册 `agent:mcp-status(sessionKey, force?, engineType?)` IPC 四参 |
| `electron/preload.ts` | T6 / T-FIX-3/4 | `getAgentMcpStatus(sessionKey, force?, engineType?)` 四参暴露 |
| `src/renderer/env.d.ts` | T6 / T-FIX-7 | `ElectronAPI.getAgentMcpStatus` 签名；T-FIX-7 抽 MCP interface 到 `types/mcp.d.ts` 后 293 行 ≤300 |
| `src/renderer/components/SessionMcpPanel.tsx` | T6 / T-FIX-3/4 | `loadMcp(force)` 按 engineType dispatch 调 `getAgentMcpStatus`，force/engineType 四参透传；移除对 `listMcpForWorkspace`/`getMcpStatusMap` 直调 |
| `src/renderer/lib/mcp-view-strategy.ts` | T6 | CC emptyHint 改指 `~/.claude.json` / `{ws}/.mcp.json`；SDK 保持 `.cursor/mcp.json`；codex 占位不变 |
| `src/renderer/types/mcp.d.ts` | T-FIX-7（新建） | 承接 `McpServerEntry` / `AgentMcpStatusResult` interface；`env.d.ts` `/// <reference>` 引入 |

### 1.2 配置/沉淀（2）

| 文件 | 任务 | 关键改动 |
|---|---|---|
| `electron/AGENTS.md` | T1–T6 | builder 沉淀：CC MCP 源（Claude 原生）、strictMcpConfig、session 缓存、取数器、IPC 四参契约、审批门控 known limitation |
| `src/AGENTS.md` | T6 | 渲染层 dispatch 规范：SessionMcpPanel 按 engineType 走 `agent:mcp-status` |

### 1.3 任务完成度

`00-manifest.json` tasks[]：T1–T6 + T-FIX-1..7 共 13 条全部 `done`。reviews[] R1–R7 共 7 条全部 `fixed`（复评验证生效，见 `04-review.md` §10.2）。

## 2、与设计的差异

| 差异 | 设计预期 | 实际实现 | 处理 |
|---|---|---|---|
| D1 审批门控 | T1 后应在 `02`/`03` 标 known limitation（`projects[ws].enabledMcpjsonServers`/`disabledMcpjsonServers` 未过滤） | T1 未实现该过滤；`02` 设计文档未补 known limitation | 已在 `electron/AGENTS.md` 沉淀段标注。提示级，不阻断 archive。建议后续补 `02` known limitation |
| D2 优先级 | `02` §5 设计 project>local>user | 实现与 `02` 一致；与官方 Claude Code（`local>project>user`）相反 | 系 `02` 本身设计选择（团队 `.mcp.json` 权威），非实现偏差。记录为设计风险，后续若与官方对齐需重新评审 |
| R4 mermaid 对齐 | `02` 一·(一) mermaid `Q -->|无session| FB[cc-mcp-loader读盘]` | 首轮实现把读盘分支放 `if (ccSession)` 块内，无 session 跳过 | 已由 T-FIX-4 修复：`getSessionMcpStatus` 加 engineType hint，CC 无 session + `engineType=claude-code` 走读盘 fallback `source:"disk"`，与 mermaid 对齐 |

## 3、影响范围

**模块**

- **注入层**：`cc-mcp-loader`（CC 配置源改 Claude 原生）、`agent-claude-sdk`（strictMcpConfig + session 缓存）、`agent-sdk`（SDK 注入快照回写）
- **缓存键**：`mcp-status-map` / `mcp-manager` 加 engineType 后缀防 SDK/CC 串台
- **取数器**：`session-mcp-status`（新建，聚合 CC runtime/snapshot/disk + SDK 注入快照）
- **端点层**：`main` / `preload` 新增 `agent:mcp-status` IPC
- **渲染层**：`SessionMcpPanel` 按 engineType dispatch；`mcp-view-strategy` CC emptyHint 改源；`types/mcp.d.ts`（新建）+ `env.d.ts` 签名
- **沉淀**：`electron/AGENTS.md` / `src/AGENTS.md`

**接口**

| 接口 | 契约 |
|---|---|
| IPC `agent:mcp-status` | `(sessionKey: string, force?: boolean, engineType?: string) => Promise<AgentMcpStatusResult>` |
| `session-mcp-status.getSessionMcpStatus` | `(sessionKey, force?, engineType?) => Promise<AgentMcpStatusResult>` |
| `agent-cc-session-registry.getCcSession` / `getCcActiveQuery` | `(sessionKey) => CcSessionAgent \| undefined` / `Query \| null`（T-FIX-6 迁移落点，签名不变） |
| `agent-sdk.getSdkSession` | `(sessionKey) => SdkSessionAgent \| undefined` |
| `mcp-status-map.resolveWorkspaceKey` / `fetchMcpStatusMap` | 加 `engineType?` 参数，缓存键 `wsKey+"::"+(engineType??"sdk")` |
| `mcp-manager.getMcpStatusMap` | 加 `engineType?` 透传（IPC/preload/env.d.ts 未同步，renderer 无调用方，无运行时 bug，见 L2） |

**数据结构**

- `CcSessionAgent.lastMcpServersSnapshot?: Array<{name,status,config?,scope?,tools?}>`（T2）
- `SdkSessionAgent.lastInjectedMcpServers?: Record<string, McpServerConfig>`（T3，interface export）
- `AgentMcpStatusResult = { servers: McpServerEntry[]; statusMap: Record<string,string>; source: "runtime"|"snapshot"|"disk" }`（T5，落点 `types/mcp.d.ts`）
- `McpServerEntry`（T-FIX-7 抽到 `types/mcp.d.ts`，ambient 全局可见）
- 无 DB/proto 变更；`~/.claude.json` 只读

### 3.1 Ponytail 技术债（12 处注释）

| # | 位置 | 说明 | 性质 |
|---|---|---|---|
| 1 | `agent-sdk.ts:703` | SDK 无 MCP list/status API，缓存注入快照供展示侧读取 | 本变更新增 |
| 2 | `agent-sdk.ts:727` | 提取注入变量只读盘一次，供 Agent.create 与回写复用 | 本变更新增 |
| 3 | `agent-sdk.ts:754` | 轮转成功后同步注入快照，失败保留旧快照 | 本变更新增 |
| 4 | `agent-sdk.ts:1224` | 提取注入变量只读盘一次，供 Agent.create 与 session 初始化复用 | 本变更新增 |
| 5 | `agent-sdk.ts:1266` | 创建即带注入快照，首次 send 前可读 | 本变更新增 |
| 6 | `agent-sdk.ts:1381` | Electron 侧 agent API 端口写入 userData，T7 后仍可直连 | **既有代码**，非本变更新增 |
| 7 | `agent-cc-events.ts:106` | `msg.mcp_servers` 浅拷贝后赋给更宽快照类型 | 本变更新增 |
| 8 | `session-mcp-status.ts:63` | `toEntry` 兼容 stdio/http/sse，不区分 CC/SDK 配置源，authenticated 首版不处理 OAuth | 本变更新增 |
| 9 | `session-mcp-status.ts:142` | `mcpServerStatus()` 抛错时降级 snapshot 不 crash | 本变更新增 |
| 10 | `cc-mcp-loader.ts:34` | 优先级 project>local>user 与官方 local>project>user 不一致，团队 `.mcp.json` 权威 | 本变更新增（D2 设计选择） |
| 11 | `cc-mcp-loader.ts:37` | 未实现 project scope 审批门控，首版信任全量加载 | 本变更新增（D1 known limitation） |
| 12 | `cc-mcp-loader.ts:75` | HTTP/sse OAuth token 暂留 Cursor store，首版 CC MCP stdio-only | 本变更新增 |

## 4、知识库影响清单

与 `02-design.md` §十对齐，并按实际实现修正：

- [x] `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md` — CC MCP 源改 Claude 原生 + strictMcpConfig + session 缓存 + 取数器
- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — 新增 `agent:mcp-status` IPC + 四参契约
- [x] `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md` — SessionMcpPanel engineType dispatch + emptyHint
- [x] `electron/AGENTS.md` — builder 沉淀（已更新）
- [x] `src/AGENTS.md` — dispatch 规范（已更新）
- [ ] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — 可选对比，本轮未更新（SDK 注入点回写属实现细节，07 已含取数对称描述）
- [ ] `knowledge/业务域/Agent调度/02-多会话模型.md` — 不需要更新（MCP 分源不改变多会话模型）
- [ ] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — 不需要更新（MCP 不涉启动重连）
- [x] `knowledge/知识索引.md` — 领域 README 引用不变，无需更新

> archive 主消费清单：前 4 条 `[x]`（07 / 02-主进程与IPC / 03-渲染端界面 / electron AGENTS.md）。`src/AGENTS.md` 为工程沉淀已同步。其余 `[ ]` 项确认不需要更新。

## 5、遗留债务

复评 `04-review.md` §10.5 确认 L1–L9 全部 <75 分债务级，不阻断 archive。L3 / L5 / L7 因 R1/R4 修复轻微恶化但仍 <75。

| 债务 | 状态 | 说明 | 后续建议 |
|---|---|---|---|
| L1 | 仍为债务 | `main.ts`(412) / `preload.ts`(405) / `agent-sdk.ts`(1659) 先存超 300 行；T-FIX-3/4 四参透传 +7/+14 向先存超限文件追加，非本次新引入违规 | 独立 refactor |
| L3 | 轻微恶化 | per-query 同步 `readFileSync` `~/.claude.json` 无缓存；R1 snapshot 分支新增同步读盘 | 加 mtime + TTL 缓存 |
| L4 | 仍为债务 | `query.mcpServerStatus()` 无超时，UI 面板可能挂起 | `Promise.race` 超时降级 |
| L5 | 轻微恶化 | `toEntry` rawConfig 携 OAuth Bearer 跨主→渲染 IPC；R1 snapshot 合并 `diskCfgs` 使 Bearer 流入 snapshot 路径（UI 不渲染 headers 无视觉泄露，但令牌进渲染内存） | `toEntry` 写 rawConfig 前剥离 `headers.Authorization` / `authorization` |
| L6 | 仍为债务 | CC disk fallback 无 statusMap 全显「—」（设计取舍可接受） | — |
| L7 | 轻微恶化 | IPC handler 缺 try/catch；NB2: L161/L178 disk 读盘未包 try/catch（`loadInlineCcMcpServers` 实际不抛错，防御性缺口） | 加外层 try/catch |
| L8 | 仍为债务 | `readClaudeJsonMcpServers` 对非对象 `mcpServers` spread 容错不足（罕见数据场景） | 加类型守卫 |
| L9 | 新增债务 | CC 工具探针 / OAuth 源未对齐 — `SessionMcpPanel` `getMcpTools`/`loginMcp` 仍走 `mcp:tools`/`mcp:login` IPC（Cursor store 源），而 CC 列表已改 Claude 原生源。CC 会话展开工具折叠 / 授权按钮可能对 Claude-native server 找不到条目。非本次修复 diff 引入（首轮 T1/T6 apply 引入） | 单独建任务对齐 CC 工具探针 / OAuth 源 |

后续加固优先级建议：L5 剥离 rawConfig Bearer → L3 加 mtime 缓存 → L4 加 `mcpServerStatus` 超时 → L9 对齐 CC 工具探针源。

## 6、归档状态

- **当前 stage**：`reviewed`（`00-manifest.json`）
- **复评结论**：通过（`04-review.md` §10.6），可进入 `/kb-archive`
- **阻断债务**：无。R1–R7 全部 fixed 且复评验证生效；新增 NB1–NB3 / P1–P5 全部 <75 分债务级，不进阻断清单
- **external_sync**：`SKIP`（`kb.project.json` 无 integrations.registry / notifications 配置，无外部同步步骤）
- **建议下一步**：执行 `/kb-archive ClaudeAgent-MCP展示与注入对齐`，迁移变更目录至 `knowledge/变更/archived/`，并由 kb-librarian 落实 §4 archive 主消费清单（07 / 02-主进程与IPC / 03-渲染端界面 知识文件更新）
