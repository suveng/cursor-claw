# ClaudeAgent MCP 审批门控与启用展示 - 变更总结

## 一、实际变更

| 文件路径 | 改动摘要 |
|---------|---------|
| `electron/cc-mcp-loader.ts` | 新增 `readCcProjectApproval`/`filterApprovedProjectMcp`/`loadApprovedInlineCcMcpServers` 三函数；`appendInlineMcpToCcOptions` 函数体改调过滤后函数（方案 A，消除死代码） |
| `electron/agent-claude-sdk.ts` | `buildQueryOptions` 注入点加注释，仍调 `appendInlineMcpToCcOptions`（签名不变） |
| `electron/session-mcp-status.ts` | `toEntry` 增 `approved?` 入参置 `enabled`；新增 `readProjectMcpNames`/`buildApprovedMap`/`appendDisabledPending`/`buildDiskStatusMap`；CC 三态路径读审批标记 |
| `electron/mcp-types.ts` | `McpServerEntry.enabled` 加三态语义中文注释 |
| `src/renderer/types/mcp.d.ts` | 同上 |
| `src/renderer/components/SessionMcpPanel.tsx` | 据 `s.enabled===false` 加灰化 + 「未启用」标签，与 `statusLabel` 协同去重 |
| `electron/AGENTS.md` | 沉淀 `## CC MCP 审批门控函数` + `## MCP 启用状态类型语义` |
| `src/renderer/components/AGENTS.md` | 沉淀 `## MCP 展示 enable/disable 标签` |
| `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md` | §九 移除「未实现 project scope 审批门控」限制；§二/§五/§七 补审批门控过滤与 disabled 标记语义；§十 变更记录（kb-librarian 落地） |
| `knowledge/业务域/Agent调度/00-README.md` | 变更记录追加一条（kb-librarian 落地） |

## 二、与设计的差异

1. **`filterApprovedProjectMcp` 新增 `workspaceDir` 第三参数**：02 §四原设计签名为两参数 `(merged, approval)`，实际实现为三参数 `(merged, approval, workspaceDir)`。原因：须读 `{ws}/.mcp.json` servers 键集合区分 project scope，否则无法满足 §六步骤2「project scope 均未命中弃 + user/local 不过滤」验收。属合理修正，已回填 02 §四签名并附设计偏差记录，`electron/AGENTS.md` 已沉淀。
2. **T2 首次绕过 `appendInlineMcpToCcOptions` 致死代码**：apply 阶段首版按硬约束「不改 `cc-mcp-loader.ts`」在 `buildQueryOptions` 调用方绕过 `appendInlineMcpToCcOptions` 内联 spread，致 `appendInlineMcpToCcOptions` 成死代码。后续切换为方案 A：在 `cc-mcp-loader.ts:250-258` `appendInlineMcpToCcOptions` 函数体内部改调 `loadApprovedInlineCcMcpServers`，`buildQueryOptions` 恢复调用 `appendInlineMcpToCcOptions`（仅加注释），死代码消除。03-tasks.md T2 状态已更正。

## 三、影响范围

- **涉及模块**：`cc-mcp-loader`（注入层审批门控）、`session-mcp-status`（取数层 disabled 标记）、`agent-claude-sdk`（注入入口）、`SessionMcpPanel`（展示层标签）、`mcp-types`/`mcp.d.ts`（类型语义注释）
- **接口变更**：`toEntry` 增可选 `approved` 入参（向后兼容，未参 `enabled` 维持原行为）；`appendInlineMcpToCcOptions` 内部改调 `loadApprovedInlineCcMcpServers`（签名不变）；新增 3 个内部函数（不跨进程，无 IPC/proto）
- **数据变更**：只读 `~/.claude.json` `projects[ws]` 三字段 + `{ws}/.mcp.json` servers 键集合，不写

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `electron/cc-mcp-loader.ts` `readProjectMcpNames` 与 `filterApprovedProjectMcp` | 两者均读 `.mcp.json` project names，逻辑重复 | 抽公共 `readProjectMcpNameSet(workspaceDir)` 复用 |
| `electron/session-mcp-status.ts` `buildApprovedMap` 与 `cc-mcp-loader.ts` `filterApprovedProjectMcp` | 审批判定逻辑（enableAll/disabled/enabled/均未命中）重复 | 抽审批判定纯函数模块复用 |

> 首版可接受：注入层与取数层为不同调用链，重复逻辑便于独立维护；后续扩展时按 `AGENTS.md` 设计模式重构抽离。

## 四、知识库影响清单

- [x] `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md` — §九 移除「未实现 project scope 审批门控」限制；§二/§五/§七 补审批门控过滤与 disabled 标记语义；§十 变更记录
- [x] `knowledge/业务域/Agent调度/00-README.md` — 变更记录追加一条
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新
- 两级索引：`知识索引.md` 无需更新（仅目录入口变化；Agent调度 README 引用不变）；Agent调度 README 文件清单不变

## 五、遗留债务

1. **R1 审批数组多源（accepted_debt）**：`readCcProjectApproval` 只读 `~/.claude.json` `projects[ws]` 三字段，未读 settings 源（`~/.claude/settings.json`/managed/`{ws}/.claude/settings.local.json`）预置审批配置。技术理由：`strictMcpConfig:true` 下 SDK 忽略原生审批门控，cursor-claw 复刻交互审批意图，settings 源预置审批对 inline 注入无直接语义。用户于 2026-06-30 确认接受。**升级路径**：扩大读取范围，按同名 server 合并 settings 源与 `~/.claude.json` 审批判定。
2. **行数逼近 300**：`session-mcp-status.ts` 296 行、`agent-claude-sdk.ts` 292 行——后续扩展需按 `AGENTS.md`「代码文件超过300必须用设计模式重构」抽离（如审批判定纯函数独立模块、状态映射器）。
3. **`preload.ts` McpServerEntry 第三处定义未加三态语义注释**：既有代码，非本变更范围；建议后续同步。

## 六、归档状态

`archived_with_debt`（R1 审批数组多源债务用户已确认接受，归档为 `archived_with_debt`）

## 七、提交说明

建议 commit message：

```
docs(kb): 归档 ClaudeAgent-MCP审批门控与启用展示 变更（archived_with_debt，R1 审批多源债务），同步知识库与业务代码
```
