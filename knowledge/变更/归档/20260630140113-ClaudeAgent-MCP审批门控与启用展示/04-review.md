# ClaudeAgent MCP 审批门控与启用展示 - 代码评审报告

## 1、审查范围

- **变更类型**: apply 产出的未提交变更（工作区 diff，未 commit）
- **评审等级**: focused-review（跨端同仓库、无 proto/DB/资金/事务、6 文件改动逻辑集中、风险可收敛）
- **涉及文件**: 6 个文件
  - `electron/cc-mcp-loader.ts`（新增 `readCcProjectApproval`/`filterApprovedProjectMcp`/`loadApprovedInlineCcMcpServers` 三函数；`appendInlineMcpToCcOptions` 改调过滤后函数）
  - `electron/agent-claude-sdk.ts`（`buildQueryOptions` 注入点加注释，仍调 `appendInlineMcpToCcOptions`）
  - `electron/session-mcp-status.ts`（`toEntry` 增 `approved?` 入参；新增 `readProjectMcpNames`/`buildApprovedMap`/`appendDisabledPending`/`buildDiskStatusMap`；CC 三态路径读审批标记）
  - `electron/mcp-types.ts`（`McpServerEntry.enabled` 加三态语义中文注释）
  - `src/renderer/types/mcp.d.ts`（同上）
  - `src/renderer/components/SessionMcpPanel.tsx`（据 `s.enabled===false` 加灰化 + 「未启用」标签，与 `statusLabel` 协同去重）
- **设计文档**: `02-design.md`（对照基准）、`01-proposal.md`（§五 4 条验收）、`03-tasks.md`（T1-T4 验收）
- **AGENTS.md 沉淀段落**：`electron/AGENTS.md` `## CC MCP 审批门控函数` + `## MCP 启用状态类型语义`；`src/renderer/components/AGENTS.md` `## MCP 展示 enable/disable 标签`
- **评审方式**：CodeGraph 优先（`codegraph_context` 命中 cc-mcp-loader 三函数 + session-mcp-status 四函数 + SessionMcpPanel；`codegraph_impact` McpServerEntry 影响 6 符号/3 处定义）

## 2、严重（必须处理）

无。

## 3、警告（建议处理）

1. **审批数组多源——settings 源预置审批漏读**
   - 位置: `electron/cc-mcp-loader.ts:167` `readCcProjectApproval`
   - 状态: `accepted_debt`（用户于 2026-06-30 确认接受 settings 源漏读已知上限债务，归档 `archived_with_debt`）
   - 说明: `readCcProjectApproval` 只读 `~/.claude.json` `projects[ws]` 三字段（`enabledMcpjsonServers`/`disabledMcpjsonServers`/`enableAllProjectMcpServers`），未读 settings 源（`~/.claude/settings.json`、managed settings、`{ws}/.claude/settings.local.json`）的预置审批配置。T1 已核实确认只读 `~/.claude.json` 即可——技术理由：`strictMcpConfig:true` 下 SDK 忽略原生审批门控，cursor-claw 注入层复刻"用户交互审批意图"，settings 源预置审批对 inline 注入无直接语义（实现注释已记升级路径）。02 §八·（一）风险1 标"待确认"，T1 在 apply 阶段给出确认结论。用户在 `/kb-archive` 时明确确认接受此已知上限，归档为 `archived_with_debt`。
   - 评分: 75（已知上限债务，触发场景：用户经 `.claude/settings.json` 显式预置审批而非交互审批）

## 4、设计偏差

1. **`filterApprovedProjectMcp` 新增 `workspaceDir` 第三参数**
   - 设计预期: 02 §四签名 `filterApprovedProjectMcp(merged, approval): Record<string, RawMcpEntry>`（两参数）
   - 实际实现: `filterApprovedProjectMcp(merged, approval, workspaceDir): Record<string, RawMcpEntry>`（三参数）
   - 影响: 须读 `{ws}/.mcp.json` servers 键集合区分 project scope（`mergeMcpJsonEntries` 中 project 覆盖 user/local，project 条目即 `.mcp.json` 键集合），否则无法满足 02 §六步骤2"project scope 均未命中弃 + user/local 不过滤"验收。
   - 评估: **合理修正**。02 §四属设计文档签名遗漏；T1 状态说明已记录此偏差；`electron/AGENTS.md` `## CC MCP 审批门控函数` 已沉淀"须传 `workspaceDir` 第三参数用于读 `{ws}/.mcp.json` servers 键集合区分 project scope"。建议 archive 时回填 02 §四签名。

2. **T2 实现路径与 03-tasks.md 状态描述不符（文档滞后，非代码偏差）**
   - 设计预期: 02 §六步骤3 + 03 T2"`appendInlineMcpToCcOptions` 改调 `loadApprovedInlineCcMcpServers`，签名不变"
   - 实际实现: 与设计预期一致——`appendInlineMcpToCcOptions` 内部改调 `loadApprovedInlineCcMcpServers`（方案 A，`agent-claude-sdk.ts` `buildQueryOptions` 仍调 `appendInlineMcpToCcOptions`，仅加注释）
   - 03-tasks.md T2 状态描述: 写"`buildQueryOptions` 注入点改调 `loadApprovedInlineCcMcpServers`（内联 spread+mcpServers，绕过 `appendInlineMcpToCcOptions`）……`appendInlineMcpToCcOptions` 暂成死代码，待 kb-admin 收尾定夺"——**与实际 diff 不符**（实际未绕过，死代码已消除）
   - 影响: 文档滞后，非代码问题。apply 阶段已切换为方案 A（内部改调），03-tasks.md T2 状态描述未同步更新。archive 前需更正为"方案 A 内部改调，死代码已消除"。

## 5、验收标准检查

| 任务 | 验收条件 | 状态 |
|------|---------|------|
| 01 §五.1 | Claude Code 会话启用集合 = Dashboard `enabled` 集合（数量与名称对齐） | ✅ 注入用 `loadApprovedInlineCcMcpServers`（过滤后），展示用 `approvedMap` 标记，审批逻辑一致 |
| 01 §五.2 | Dashboard 展示 4 个含 1 个 `disabled` 标签，正确反映 `projects[ws]` 审批 | ✅ `appendDisabledPending` 补全 Pending approval 条目 + `SessionMcpPanel` `enabled:false` 灰化 + 「未启用」标签 |
| 01 §五.3 | 切换 ws 后 enabled/disabled 集合刷新，无跨 ws 串台 | ✅ `mcp-status-map` 缓存键含 workspaceDir（既有）+ `readCcProjectApproval`/`approvedMap` 按 ws 构建 |
| 01 §五.4 | inline 注入数 = Dashboard `enabled` 数 = Claude Code 实际加载数 | ✅ 注入与展示审批判定逻辑一致（均基于 `readCcProjectApproval` + project scope 判定） |
| 02 §八·（二）300 行 | 六文件均 <300，无需抽设计模式 | ✅ 258/292/296/26/27/215（`session-mcp-status` 296、`agent-claude-sdk` 292 逼近上限，遗留债务） |
| 02 §八·（二）审批数组多源 | 核实 cursor-claw 场景下交互审批是否只落 `~/.claude.json` projects[ws] | ⚠️ T1 已核实确认只读 `~/.claude.json` 即可；settings 源漏读列 R1 open 待用户 archive 确认 |
| 02 §八·（二）缺省默认 | 未在两数组且未 `enableAll` 的 project server 标 `disabled`（Pending approval） | ✅ `buildApprovedMap`/`filterApprovedProjectMcp` 均实现"均未命中→false/弃" |
| 02 §八·（二）跨 ws 串台 | `mcp-status-map` 缓存键含 workspaceDir，验证切换 ws 后 disabled 集合刷新 | ✅ 既有机制 + `readCcProjectApproval` 按 ws |
| 02 §八·（二）user/local scope | 不受审批门控，始终 `enabled:true` | ✅ `buildApprovedMap`/`filterApprovedProjectMcp` 均实现 user/local 不过滤 |
| T1 | 缺失 projects[ws] 容错空/false | ✅ `readCcProjectApproval` try/catch + `Array.isArray` + `=== true` 收敛 |
| T1 | enableAll 全留；disabled 弃、enabled 留、均未命中弃；user/local 不过滤 | ✅ `filterApprovedProjectMcp` 实现完整 |
| T1 | <300 行，无未要求抽象/新依赖 | ✅ 258 行；三函数 inline 并入，未抽策略类 |
| T2 | inline 注入数 = Dashboard enabled 数 = 实际加载数 | ✅ `appendInlineMcpToCcOptions` 改调 `loadApprovedInlineCcMcpServers` |
| T2 | `strictMcpConfig:true` 不变，SDK 路径不受影响 | ✅ `buildQueryOptions` 未改 `strictMcpConfig` |
| T2 | <300 行，无未要求抽象/新依赖 | ✅ 292 行；死代码已消除（方案 A 内部改调） |
| T3 | disk/snapshot 补全 disabled 条目 | ✅ `appendDisabledPending` + `buildDiskStatusMap` |
| T3 | runtime 透传 disabled；user/local 始终 `enabled:true` | ✅ `mapStatusToEntries` 透传 `approvedMap`；`buildApprovedMap` user/local=true |
| T3 | 切换 ws 无串台；<300 行 | ✅ 296 行 <300 |
| T4 | Dashboard 展示 4 个含 1 个 disabled 标签 | ✅ `SessionMcpPanel` `enabled:false` 灰化 + 「未启用」标签 |
| T4 | 切换 ws 刷新无串台 | ✅ |
| T4 | 三文件 <300，无未要求抽象/新依赖 | ✅ 26/27/215；标签复用现有 `statusLabel`/`statusColor` 体系，未抽策略类 |

## 6、调用链与回归风险

**CodeGraph 发现**（`codegraph_context` + `codegraph_impact`）：

- `cc-mcp-loader` 三函数（`readCcProjectApproval`:167、`filterApprovedProjectMcp`:207、`appendInlineMcpToCcOptions`:251）与 `session-mcp-status` 四函数（`readProjectMcpNames`:150、`buildApprovedMap`:169、`buildDiskStatusMap`:211、`appendDisabledPending`）均命中，签名与 diff 一致。
- `SessionMcpPanel`(46) + `AgentMcpStatusResult`(26) + `SessionMcpPanelProps`(15) + `getMcpViewConfig` 命中，展示层经 `window.electronAPI.getAgentMcpStatus` 取数，`enabled` 字段经 `McpServerEntry` 透传。
- `codegraph_impact McpServerEntry`：影响 6 符号，3 处定义（`electron/mcp-types.ts:2`、`src/renderer/types/mcp.d.ts:3`、`electron/preload.ts:181`）。

**观察项（非阻断）**：

- `electron/preload.ts:181` 第三处 `McpServerEntry` 定义 `enabled?: boolean` **未加三态语义注释**（`mcp-types.ts`/`mcp.d.ts` 已加）。02 §五只要求 `mcp-types.ts` 与 `mcp.d.ts` 两处一致，`preload.ts` 不在 02 §五 design 范围——属既有代码原样搬运且不在本次 design 范围内，评审排除；但展示层经 preload 取 `McpServerEntry`，若未来 preload 侧需独立维护语义注释，建议同步。

**回归风险**：

- `appendInlineMcpToCcOptions` 改调 `loadApprovedInlineCcMcpServers` 后，inline 注入数减少（过滤掉 Pending approval/disabled 的 project scope 条目）。若既有用户依赖"全量注入"行为，切换后会感知 MCP 减载——这是 01 目标 G1 预期行为（注入对齐审批后实际加载），非回归。
- `session-mcp-status` 三态路径新增 `readCcProjectApproval` + `loadInlineCcMcpServers` 读盘调用（runtime/snapshot 路径每次取数多读一次 `~/.claude.json` + `.mcp.json`）。`readCcProjectApproval` 与 `loadInlineCcMcpServers` 均为同步 fs 读，小文件可接受；runtime 路径原已 async，新增同步读不阻塞事件循环上限。

## 7、遗留债务

1. **知识库对齐（archive 前必须落地，02 §十·（一））**：
   - `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md` §九 line 65「未实现 project scope 审批门控，首版全量加载 `.mcp.json`」限制需移除
   - 07 §二（MCP inline）/§五（`getSessionMcpStatus`）/§七（三态取数）补审批门控过滤与 disabled 标记语义
   - 02 §四回填 `filterApprovedProjectMcp` 第三参数 `workspaceDir` 签名
2. **行数逼近 300**：`session-mcp-status.ts` 296、`agent-claude-sdk.ts` 292——后续扩展需按 `AGENTS.md`「代码文件超过300必须用设计模式重构」抽离（如审批判定纯函数独立模块、状态映射器）
3. **03-tasks.md T2 状态描述与实际实现不符（文档滞后）**：archive 前更新为"方案 A 内部改调 `loadApprovedInlineCcMcpServers`，`buildQueryOptions` 仍调 `appendInlineMcpToCcOptions`（仅加注释），死代码已消除"
4. **`preload.ts` McpServerEntry 第三处定义未加三态语义注释**：既有代码，非本变更范围；建议后续同步

## 8、修复任务建议

| 问题 ID | 建议动作 | 关联任务 |
|---------|----------|----------|
| R1 | 用户在 `/kb-archive` 时明确确认接受 settings 源漏读已知上限（archive 为 `archived_with_debt`）；或派 `T-FIX-01` 补读 settings 源（`~/.claude/settings.json` + `{ws}/.claude/settings.local.json` 的 `enabledMcpjsonServers`/`disabledMcpjsonServers`/`enableAllProjectMcpServers` 按同名 server 合并审批判定）后重新 review | T-FIX-01（按需） |
| R2 | 已修复（apply 阶段方案 A：`appendInlineMcpToCcOptions` 内部改调 `loadApprovedInlineCcMcpServers`，`buildQueryOptions` 仍调 `appendInlineMcpToCcOptions` 仅加注释，死代码已消除）；03-tasks.md T2 状态描述待 archive 前更正 | T2 |
| 知识库 | `/kb-archive` 时落地 02 §十·（一）必须更新清单（07 §九 移除限制 + §二/§五/§七 补语义 + 02 §四回填签名 + 03 T2 状态更正） | archive |

## 9、结论

**通过（archived_with_debt）**，R1 审批数组多源债务用户已确认接受，可进入 `/kb-archive` 归档为 `archived_with_debt`；R2 T2 死代码已消除（fixed）。

代码逻辑正确，01 §五 4 条验收 + 02 §八·（二）工程补充验收项 + 03 T1-T4 各 T 验收均满足，T2 死代码已由 apply 阶段方案 A 修正消除（`R2` 标 fixed）；`filterApprovedProjectMcp` 第三参数 `workspaceDir` 为合理设计修正并已沉淀（§4 设计偏差，archive 已回填 02 §四签名）。唯一债务项为 `R1` 审批数组多源已知上限（settings 源预置审批漏读）——02 §八·（一）风险1 标"待确认"，T1 已核实给出技术理由，用户于 2026-06-30 在 `/kb-archive` 时明确确认接受此已知上限债务，归档为 `archived_with_debt`，`R1` status → `accepted_debt`。知识库对齐（07 §九 移除限制等）属 archive 前必须落地清单，由 kb-scribe + kb-librarian 在 archive 阶段落地。

## 10、复评记录

- **复评时间**：2026-06-30
- **复评触发**：用户确认接受 R1 审批数组多源债务
- **复评结论**：通过（archived_with_debt）
- **R1 处理**：用户于 2026-06-30 确认接受 R1 审批数组多源债务（settings 源 `~/.claude/settings.json`/managed/`{ws}/.claude/settings.local.json` 预置审批漏读，作为未来扩展项），R1 `status` 由 `open` 改 `accepted_debt`，归档 `archived_with_debt`
- **R2 处理**：保持 `fixed`（apply 阶段方案 A 已修正消除死代码，03-tasks.md T2 状态描述已 archive 前更正）
- **archive 前必须落地清单**（kb-scribe + kb-librarian）：
  - 02 §四回填 `filterApprovedProjectMcp` 第三参数 `workspaceDir` 签名（kb-scribe，已完成）
  - 03-tasks.md T2 状态更正为方案 A 内部改调、死代码消除（kb-scribe，已完成）
  - 04-review.md R1 status → `accepted_debt`、§9 结论更新、追加 §10 复评记录（kb-scribe，已完成）
  - 05-summary.md 产出七段总结（kb-scribe，已完成）
  - 00-manifest.json stage → `archived_with_debt`、reviews R1 status → `accepted_debt`、files 补全白名单（kb-scribe，已完成）
  - 07-ClaudeCodeSDK执行引擎.md §九 移除限制 + §二/§五/§七 补语义 + §十 变更记录；00-README.md 变更记录（kb-librarian）
