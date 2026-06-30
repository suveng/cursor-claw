# ClaudeAgent-MCP展示与注入对齐 - 代码评审报告

## 1、审查范围

- **变更类型**: apply 产出的未提交变更（`git diff` + 未跟踪新文件 `electron/session-mcp-status.ts`）
- **评审等级**: full-review（六角并行：规范合规 / Bug 扫描 / 设计偏差+Ponytail / 多端一致性 / 性能安全 / Ponytail 精简轴）
- **涉及文件**: 13 业务文件 + 新建 `electron/session-mcp-status.ts` + 2 `AGENTS.md`
  - 新建: `electron/session-mcp-status.ts`
  - 修改: `electron/cc-mcp-loader.ts`、`electron/agent-cc-events.ts`、`electron/agent-cc-types.ts`、`electron/agent-claude-sdk.ts`、`electron/cc-mcp-loader.ts`、`electron/main.ts`、`electron/mcp-manager.ts`、`electron/mcp-status-map.ts`、`electron/preload.ts`、`electron/agent-sdk.ts`、`src/renderer/env.d.ts`、`src/renderer/components/SessionMcpPanel.tsx`、`src/renderer/lib/mcp-view-strategy.ts`、`electron/AGENTS.md`、`src/AGENTS.md`
- **设计文档**: `02-design.md`（对照基准）；任务: `03-tasks.md` T1–T6
- **CodeGraph**: 已索引；调用链以 `codegraph_context` / `codegraph_impact` + diff 核实

## 2、严重（必须处理）

无

## 3、警告（建议处理）

1. **R1【警告 85】CC idle snapshot 缺 config，渲染 "undefined" 空壳**
   - 位置: `electron/agent-cc-events.ts:106` + `electron/session-mcp-status.ts:64-66` + `src/renderer/components/SessionMcpPanel.tsx:169`
   - 说明: `SDKSystemMessage.mcp_servers` 类型是 `{name,status}[]` 不含 `config`。T2 直接赋值给 `lastMcpServersSnapshot`。CC idle 时 T5 走 `mapSnapshotToEntries` → `toEntry(s.name, s.config ?? {}, ...)` → `cfg={}` → command/args=`undefined`。UI L169 渲染 `"undefined "`。触发场景：CC 会话 idle + 展开 MCP 面板（常见）。
   - 修改方向: T5 snapshot 路径用 `loadInlineCcMcpServers(ccSession.workspaceDir)` 读盘补 config，按 name 匹配合并；或退化只显示 name+status 不渲染 command 行。
   - 关联任务: T-FIX-1

2. **R2【警告 85】CC status 枚举与 UI 期望不匹配，needs-auth 不显示授权按钮**
   - 位置: `electron/session-mcp-status.ts:91-92,99` + `src/renderer/components/SessionMcpPanel.tsx:149-151,172`
   - 说明: CC runtime/snapshot status 枚举为 `connected/failed/needs-auth/pending/disabled`，UI 期望 `ready/enabled/disabled/needs_login`。`connected` 不命中 `isReady` 走红色；`needs-auth`（连字符）不匹配 `needs_login` → CC URL 型 MCP 缺授权时**永远不显示授权按钮**。触发场景：任何 CC 会话展开 MCP 面板。
   - 修改方向: T5 `buildStatusMap` / `mapStatusToEntries` 增加 CC 枚举→UI 词汇映射（`connected→ready`、`needs-auth→needs_login`、`failed→原错误`、`pending→加载中`）。
   - 关联任务: T-FIX-2

3. **R3【警告 78】刷新按钮 force 被丢弃，SDK 刷新命中 30s 缓存失效**
   - 位置: `src/renderer/components/SessionMcpPanel.tsx:64,107,125` + `electron/session-mcp-status.ts:112`
   - 说明: `loadMcp(_force=false)` 参数未使用，IPC `agent:mcp-status` 也无 force。刷新按钮 / `loginMcp` 后 `loadMcp(true)` 的 `true` 被丢弃。SDK 路径 `fetchMcpStatusMap(false,...)` 永远 `force=false` → 30s 内刷新无效。CC runtime 路径无缓存刷新有效，故只影响 SDK。
   - 修改方向: `getSessionMcpStatus(sessionKey, force?)` 加 force 透传给 `fetchMcpStatusMap`；IPC `agent:mcp-status(sessionKey, force?)`、preload `getAgentMcpStatus(sessionKey, force?)`、`env.d.ts` 签名、`SessionMcpPanel` `loadMcp(force)` 透传同步。
   - 关联任务: T-FIX-3

4. **R4【警告 80】CC 无 session 时 T5 不走读盘 fallback，与设计 mermaid 不符**
   - 位置: `electron/session-mcp-status.ts:84-117`
   - 说明: `02-design.md` 一·(一) mermaid 标注 `Q -->|无session| FB[cc-mcp-loader读盘]`，意图 CC 会话无 session 也读盘展示。实现把读盘分支放在 `if (ccSession)` 块内，`ccSession===undefined` 时跳过整个 CC 块落到空态。UI `engineType=claude-code` 但 session 销毁竞态时显示空列表而非已配置 MCP。
   - 修改方向: `getSessionMcpStatus` 增加 `engineType` 提示参数（或 CC 块前加 `if (!ccSession && !sdkSession && hint==="claude-code")` 读盘分支），IPC 透传 engineType。
   - 关联任务: T-FIX-4

5. **R5【警告 75】T2 init 快照浅引用赋值，SDK mutate 污染风险**
   - 位置: `electron/agent-cc-events.ts:104`
   - 说明: `session.lastMcpServersSnapshot = msg.mcp_servers` 直接引用 SDK 数组，未浅拷贝。SDK 内部若复用 message buffer 会污染 idle 面板展示。
   - 修改方向: `msg.mcp_servers.map(s => ({ ...s, config: s.config ? { ...s.config } : s.config, tools: s.tools ? [...s.tools] : s.tools }))`。
   - 关联任务: T-FIX-5

6. **R6【警告 78】agent-claude-sdk.ts 本次新引入超 300 行**
   - 位置: `electron/agent-claude-sdk.ts:1-313`（297→313，本次 +16）
   - AGENTS.md: "代码文件不得超过300行"、"超过300必须用设计模式重构"
   - 说明: 本次新增 `strictMcpConfig` + UI 日志 + `getCcSession`/`getCcActiveQuery` 把文件推过 300，属本次新引入超限。
   - 修改方向: 把 session 查询导出（`getClaudeCodeSessionList`/`getCcSession`/`getCcActiveQuery`）抽到 `electron/agent-cc-session-registry.ts`，与既有 `agent-cc-types`/`events`/`stream`/`http` 拆分风格一致。
   - 关联任务: T-FIX-6

7. **R7【警告 75】env.d.ts 本次新引入超 300 行**
   - 位置: `src/renderer/env.d.ts:1-306`（297→306，本次 +9）
   - AGENTS.md: "代码文件不得超过300行"
   - 说明: 本次新增 `AgentMcpStatusResult` interface + `getAgentMcpStatus` 签名把 `.d.ts` 推过 300。
   - 修改方向: 把 MCP 相关 interface（`McpServerEntry`/`AgentMcpStatusResult`）抽到 `src/renderer/types/mcp.d.ts`，`env.d.ts` 顶部 `/// <reference path="./types/mcp.d.ts" />` 引入。
   - 关联任务: T-FIX-7

## 4、设计偏差

1. **D1 审批门控未在 02/03 标 known limitation**（72 分，提示）
   - 设计预期: T1 实现后应在 `02-design.md` / `03-tasks.md` 显式标注「未实现 `projects[ws].enabledMcpjsonServers` / `disabledMcpjsonServers` 过滤」的 known limitation。
   - 实际实现: T1 未实现该过滤；`electron/AGENTS.md` 沉淀段已标，但 `02` 设计文档未补。
   - 影响: 用户在 Claude Code reject 过某 project server 时本注入层仍加载，行为与官方 Claude Code 不一致。属提示级，不阻断 archive，但建议补 02 known limitation。

2. **D2 优先级 project>local>user 与官方不一致**（0 分，设计风险非偏差）
   - 设计预期: `02-design.md` §5 写 project 最高，实现一致。
   - 实际实现: 与 02 一致；与官方 Claude Code（`local>project>user`）相反。
   - 影响: 属 02 本身设计选择（团队 `.mcp.json` 权威），非实现偏差。记录为**设计风险**，后续若与官方对齐需重新评审。

3. **R4 即 §3 R4**：CC 无 session 读盘 fallback 与 mermaid 不符
   - 设计预期: `02-design.md` 一·(一) mermaid `Q -->|无session| FB[cc-mcp-loader读盘]`。
   - 实际实现: 读盘分支位于 `if (ccSession)` 块内，`ccSession===undefined` 跳过。
   - 影响: 已列入 §3 警告 R4，关联 T-FIX-4。

## 5、验收标准检查

### 03-tasks 任务验收

| 任务 | 验收条件 | 状态 |
|------|---------|------|
| T1 | `mergeMcpJsonEntries` 不再读任何 `.cursor/mcp.json` 路径 | ✅ |
| T1 | `loadInlineMcpServers` 返回 codegraph args=`["serve","--mcp"]` 无 `--path` | ✅ 已验证 |
| T1 | `~/.claude.json` user/local `mcpServers` 合并（local 覆盖 user） | ✅ |
| T1 | `{ws}/.mcp.json` 覆盖 `~/.claude.json` 同名 server | ✅ |
| T1 | 文件缺失/解析失败返回 `{}`（沿用 `readMcpServersBlock` 容错） | ✅ |
| T1 | OAuth known limitation 有注释 | ✅ |
| T1 | 无 02/03 未要求抽象/依赖（Ponytail） | ✅ |
| T2 | `buildQueryOptions` 含 `strictMcpConfig: true` | ✅ |
| T2 | CC Run 启动 UI 日志含 `[mcp] inline N servers` | ✅ |
| T2 | init 后 `lastMcpServersSnapshot` 含 `msg.mcp_servers` 全部条目 | ✅ 代码层 — ⚠ R5 浅引用隐患 |
| T2 | idle 会话 `lastMcpServersSnapshot` 保留不清空 | ✅ |
| T2 | `getCcSession`/`getCcActiveQuery` 可 import | ✅ |
| T2 | 无 Ponytail 违规 | ✅ |
| T3 | `SdkSessionAgent` interface 已 export | ✅ |
| T3 | 三处注入点回写 `lastInjectedMcpServers` | ✅ |
| T3 | `lastInjectedMcpServers` 与 `loadInlineMcpServers(ws)` 一致 | ✅ |
| T3 | 注入源仍 `.cursor/mcp.json`（不改 mcp-sdk-loader） | ✅ |
| T3 | `getSdkSession` 可 import | ✅ |
| T3 | 无 Ponytail 违规 | ✅ |
| T4 | 同 ws 不同 engineType 缓存键不同（`ws::sdk` vs `ws::claude-code`） | ✅ |
| T4 | 不传 engineType 默认 `sdk`，现网行为不变 | ✅ |
| T4 | `invalidateMcpStatusCache()` 仍清空全部 | ✅ |
| T4 | 无 Ponytail 违规 | ✅ |
| T5 | CC activeQuery 时 `source:"runtime"` | ✅ 代码层 — ⚠ R2 status 枚举不匹配 |
| T5 | CC idle 时 `source:"snapshot"` | ✅ 代码层 — ⚠ R1 渲染 undefined |
| T5 | CC 无 session 时 `source:"disk"` | ❌ R4 读盘分支位于 `if (ccSession)` 内，无 session 跳过 |
| T5 | SDK 会话 `source:"runtime"` | ✅ 代码层 — ⚠ R3 force 丢弃影响刷新 |
| T5 | `mcpServerStatus()` 抛错优雅降级 | ✅ |
| T5 | 文件 ≤ 200 行 | ✅ 118 行 |
| T5 | 无 Ponytail 违规 | ✅ |
| T6 | CC 会话展开调 `agent:mcp-status`，列表来自运行时/snapshot/disk | ✅ 代码层 — 形式满足，展示缺陷见 R1/R2/R4 |
| T6 | SDK 会话展开调 `agent:mcp-status`，列表来自注入快照 | ✅ 代码层 — ⚠ R3 force 丢失 |
| T6 | codex 占位不 crash | ✅ |
| T6 | CC emptyHint 显示 `~/.claude.json`/`.mcp.json` 不含 `.cursor` | ✅ |
| T6 | SDK emptyHint 保持 `.cursor/mcp.json` 不变 | ✅ |
| T6 | `npm run build` 通过 | ✅ |
| T6 | 无 Ponytail 违规 | ✅ |

### 关联缺陷汇总

| 缺陷 | 影响任务 | 影响 |
|------|---------|------|
| R1 | T2/T5/T6 | CC idle 面板渲染 `"undefined"` |
| R2 | T5/T6 | CC status 枚举与 UI 词汇失配，授权按钮不显示 |
| R3 | T5/T6 | SDK 刷新 30s 内无效 |
| R4 | T5/T6 | CC 无 session 不读盘 fallback，与设计 mermaid 不符 |
| R5 | T2 | 快照浅引用，SDK mutate 污染风险 |

## 6、调用链与回归风险

`getSessionMcpStatus` 经 `agent:mcp-status` IPC 被 `SessionMcpPanel.loadMcp` 调用（面板展开 / 刷新 / `loginMcp` 后）。`getCcSession` / `getSdkSession` 仅 `session-mcp-status.ts` 消费。

| 符号 | 调用方 | 风险 |
|------|--------|------|
| `getSessionMcpStatus` | `agent:mcp-status` IPC → `SessionMcpPanel.loadMcp` | 主路径，R1/R2/R3/R4 直接影响展示 |
| `getCcSession` / `getCcActiveQuery` | `session-mcp-status.ts` | 单消费者，改动可控 |
| `getSdkSession` | `session-mcp-status.ts` | 单消费者，改动可控 |
| `readClaudeJsonMcpServers` export | 无外部消费者（T5 用 `loadInlineCcMcpServers`） | yagni 信息项 |
| `getMcpStatusMap` engineType 参数 | `main.ts` / `command-handler` 不传；T5 直接调底层 `fetchMcpStatusMap` | yagni 信息项，无运行时 bug |
| `mcp:list-for-workspace` / `mcp:status-map` IPC | SessionMcpPanel 移除直调后 renderer 无其他调用方（CodeGraph 确认） | 旧 IPC 保留，无回归 |

**回归点**：

| 回归点 | 风险 | 说明 |
|--------|------|------|
| Cursor SDK 路径 | 中 | R3 force 丢失影响 SDK 刷新；其余注入逻辑未变 |
| CC HTTP / Daemon | 低 | 未改 `agent-cc-http.ts` |
| 主动 Stop | 低 | 未改 stop 路径 |
| codex 占位 | 低 | T6 保持 `viewConfig.supported=false` |
| 跨主→渲染 IPC 令牌 | 中 | L5：T5 `toEntry` rawConfig 携带 OAuth Bearer（见 §7） |

## 7、遗留债务

<75 分不阻断 archive，但记录：

- **L1**: `main.ts`(408) / `preload.ts`(400) / `agent-sdk.ts`(1659) 先存超 300 行，本次 +3 / +9 / +17 未显著膨胀，属既有债务，建议后续独立 refactor。
- **L2**: `getMcpStatusMap` engineType 参数 IPC/preload/env.d.ts 未同步透传（四端签名分歧，当前 renderer 无调用方无运行时 bug）。
- **L3**: T1 per-query 同步 `readFileSync` + `JSON.parse` 整个 `~/.claude.json` 无缓存（重用户 1–10MB 文件阻塞主进程），建议加 mtime + TTL 缓存。
- **L4**: T5 `query.mcpServerStatus()` 无超时，UI 面板可能挂起，建议 `Promise.race` 超时降级。
- **L5**: T5 `toEntry` rawConfig 携带 OAuth Bearer（`headers.Authorization`）跨主→渲染 IPC，旧路径不含。当前 UI 不渲染 rawConfig/headers 无视觉泄露，但令牌进渲染内存。建议 `toEntry` 写 rawConfig 前剥离 `headers.Authorization` / `authorization`。
- **L6**: CC disk fallback 无 statusMap 全显「—」（设计取舍可接受）。
- **L7**: IPC handler 缺 try/catch（`getSessionMcpStatus` 内部已 catch，`fetchMcpStatusMap` 实际不 reject，防御性缺口）。
- **L8**: `readClaudeJsonMcpServers` 对非对象 `mcpServers` spread 容错不足（罕见数据场景）。

**Ponytail 信息项**：

- `mapStatusToEntries` / `mapSnapshotToEntries` 函数体相同可合并省 ~4 行（`shrink:`）。
- `readClaudeJsonMcpServers` export 无消费者（`yagni:`）。
- `getMcpStatusMap` engineType 参数无消费者（`yagni:`）。

## 8、修复任务建议

| 问题 ID | 建议动作 | 关联任务 |
|---------|----------|----------|
| R1 | T5 snapshot 路径读盘补 config 或只显 name+status | T-FIX-1 |
| R2 | T5 加 CC status 枚举→UI 词汇映射 | T-FIX-2 |
| R3 | `getSessionMcpStatus` + IPC + preload + env.d.ts + SessionMcpPanel 透传 force | T-FIX-3 |
| R4 | `getSessionMcpStatus` 加 engineType hint 参数，CC 无 session 读盘 fallback | T-FIX-4 |
| R5 | T2 init 快照浅拷贝 | T-FIX-5 |
| R6 | `agent-claude-sdk.ts` 抽 `agent-cc-session-registry.ts` | T-FIX-6 |
| R7 | `env.d.ts` 抽 `src/renderer/types/mcp.d.ts` | T-FIX-7 |

## 9、结论

**未通过**，需修复 7 条警告后再归档。修复后重新运行 `/kb-review` 复评。

必修清单：

- R1 / T-FIX-1：CC idle snapshot 路径读盘补 config，消除 `"undefined"` 渲染。
- R2 / T-FIX-2：CC status 枚举→UI 词汇映射，恢复 `needs_login` 授权按钮。
- R3 / T-FIX-3：force 参数端到端透传，SDK 刷新生效。
- R4 / T-FIX-4：`getSessionMcpStatus` 加 engineType hint，CC 无 session 读盘 fallback 与设计 mermaid 对齐。
- R5 / T-FIX-5：T2 init 快照浅拷贝，隔离 SDK mutate 污染。
- R6 / T-FIX-6：`agent-claude-sdk.ts` 抽 `agent-cc-session-registry.ts` 控行数回 300 以内。
- R7 / T-FIX-7：`env.d.ts` 抽 `src/renderer/types/mcp.d.ts` 控行数回 300 以内。

建议下一步执行 `/kb-apply ClaudeAgent-MCP展示与注入对齐` 落实 T-FIX-1..7。

## 10、复评结论（kb-review 第二轮）

### 10.1 复评范围与等级

- **复评等级**: focused-review（复评轮，2 个只读子 Agent 并行）
  - 子 Agent A：修复有效性 + Bug 扫描 + Ponytail
  - 子 Agent B：规范合规 + 多端一致性 + 性能安全
- **复评基准**: 首轮 §3 R1–R7 修复 diff（T-FIX-1..7 已 apply）+ 首轮 §7 L1–L8 遗留债务
- **首轮 §9 结论**: 未通过，需修复 7 条警告后复评 → 已由 T-FIX-1..7 全部修复，复评通过

### 10.2 R1–R7 修复有效性验证

| 修复 | 任务 | 验证结论 |
|------|------|----------|
| R1 | T-FIX-1 | ✅ snapshot 路径读盘补 config + `toEntry` 空串兜底，不再渲染 "undefined" |
| R2 | T-FIX-2 | ✅ `mapCcStatusToUi` connected→ready / needs-auth→needs_login，授权按钮可显示；SDK 路径不二次映射 |
| R3 | T-FIX-3 | ✅ force 四参 IPC 链透传至 `fetchMcpStatusMap(force ?? false)`，SDK 刷新绕过 30s 缓存 |
| R4 | T-FIX-4 | ✅ CC 无 session + `engineType=claude-code` + `workspaceDir` → 读盘 fallback `source:"disk"`，与 02 mermaid FB 对齐 |
| R5 | T-FIX-5 | ✅ init 快照浅拷贝（数组 + config + tools 新引用），非同一引用 |
| R6 | T-FIX-6 | ✅ 抽 `agent-cc-session-registry.ts`（40 行），`agent-claude-sdk.ts` 291 行 ≤300，re-export 保持 `daemon-manager`/`session-dispatcher` 路径不变 |
| R7 | T-FIX-7 | ✅ 抽 `types/mcp.d.ts`（21 行），`env.d.ts` 293 行 ≤300，`/// <reference>` ambient 全局可见 |

R1–R7 全部修复有效，首轮 §3 警告全部清零。

### 10.3 新增问题（全部 <75，债务级，不阻断归档）

复评新发现 8 条问题，全部 <75 分债务级，不进 §2/§3 阻断清单，仅作记录与后续优化建议：

| ID | 分值 | 说明 | 复评建议 |
|----|------|------|----------|
| NB1 | 55 | R1 snapshot 分支每次展开同步读盘 `~/.claude.json`，加剧 L3 | user-initiated 可接受，建议加 mtime+TTL 缓存 |
| NB2 | 40 | CC disk 读盘分支 L161/L178 未包 try/catch，加剧 L7 | `loadInlineCcMcpServers` 实际不抛错，防御性缺口，建议加外层 try/catch |
| NB3 | 30 | `SessionMcpPanel` 移除 `!effectiveWs` early return，空 ws 仍发 IPC | 无 crash，UX 等价 |
| P1 | 58 | 与 NB1 同一问题（同步读盘 `~/.claude.json`） | 同 NB1 |
| P2 | 52 | R1 snapshot 合并 `diskCfgs` 使 OAuth Bearer 流入 snapshot 路径 `rawConfig`，加剧 L5 | UI 不渲染 headers 无视觉泄露，建议 `toEntry` 写 `rawConfig` 前剥离 `headers.Authorization` |
| P3 | 40 | R3 force 透传无节流 | `fetchMcpStatusMap` 有 in-flight 去重，非新引入 |
| P4 | 30 | 四参 IPC `workspaceDir` 扩大读盘入口 | 非 IM 用户输入，沿用既有模式，非新攻击面 |
| P5 | 30 | R6 `CC_SESSIONS` export mutate 风险 | R6 前已 export，仅迁移落点，非新引入 |

### 10.4 Ponytail 精简

复评对修复 diff 做 Ponytail 复核，2 条可选 `shrink:`（无过度工程，非阻断）：

1. `shrink:` `session-mcp-status.ts` `mapCcStatusToUi` switch case `"failed"`/`"pending"`/`"disabled"` 与 `default` 等价，冗余 3 行可删
2. `shrink:` `isEmptyConfig` 仅被 `resolveSnapshotConfig` 调用一次，可内联（~2 行）

补充判定：
- registry / types 拆分为 lean 必要（行数硬约束），非 bloat
- 四参 IPC 为契约要求，非 yagni
- net: -5 lines possible（可选，不强制）

### 10.5 遗留债务复核

首轮 §7 L1–L8 仍为债务，其中 L3 / L5 / L7 因修复轻微恶化，但仍 <75 不阻断；新增 L9：

| 债务 | 状态 | 复评说明 |
|------|------|----------|
| L1 | 仍为债务 | `main.ts`(412) / `preload.ts`(405) / `agent-sdk.ts`(1659) 先存超限，T-FIX-3/4 四参透传 +7/+14 worsened，但向先存超限文件追加，非本次新引入违规，建议独立 refactor |
| L3 | **轻微恶化** | per-query 同步 `readFileSync` `~/.claude.json` 无缓存；R1 snapshot 分支新增同步读盘，建议加 mtime+TTL 缓存 |
| L4 | 仍为债务 | `query.mcpServerStatus()` 无超时（未触及） |
| L5 | **轻微恶化** | `toEntry` rawConfig 携 OAuth Bearer 跨 IPC；R1 snapshot 合并 `diskCfgs` 使 Bearer 流入 snapshot 路径，建议 `toEntry` 写 `rawConfig` 前剥离 `headers.Authorization` |
| L6 | 仍为债务 | CC disk fallback 无 statusMap 全显「—」（设计取舍） |
| L7 | **轻微恶化** | IPC handler 缺 try/catch；NB2: L161/L178 disk 读盘未包 try/catch，建议加外层 try/catch |
| L8 | 仍为债务 | `readClaudeJsonMcpServers` 对非对象 `mcpServers` spread 容错（罕见） |
| L9 | **新增债务** | CC 工具探针 / OAuth 源未对齐 — `SessionMcpPanel` `getMcpTools`/`loginMcp` 仍走 `mcp:tools`/`mcp:login` IPC（Cursor store 源），而 CC 列表已改 Claude 原生源（`.mcp.json`/`~/.claude.json`）。CC 会话展开工具折叠 / 授权按钮可能对 Claude-native server 找不到条目。非本次修复 diff 引入（首轮 T1/T6 apply 引入），建议单独建任务对齐 CC 工具探针 / OAuth 源 |

后续加固优先级建议：L5 剥离 `rawConfig` Bearer → L3 加 mtime 缓存 → L4 加 `mcpServerStatus` 超时 → L9 对齐 CC 工具探针源。

### 10.6 复评结论

**通过**，可进入 `/kb-archive`。

判定依据：

- R1–R7 全部修复有效，首轮 §3 警告清零
- 新增 NB1–NB3 / P1–P5 全部 <75 分债务级，不进 §2/§3 阻断清单
- 验收标准（§5）全部满足（首轮 ❌ 项已由 T-FIX-1..7 转为 ✅）
- L1 / L3–L9 为遗留债务（L3 / L5 / L7 因修复轻微恶化但仍 <75），建议后续独立 refactor / 加固

manifest `reviews[]` R1–R7 保持 `fixed`（已复评验证生效，不改）；NB1–NB3 / P1–P5 均 <75 不作为 open review；L9 作债务记录在本节 §10.5，不进 manifest `reviews[]`。

建议下一步执行 `/kb-archive ClaudeAgent-MCP展示与注入对齐`。
