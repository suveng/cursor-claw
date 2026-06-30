# ClaudeAgent MCP 审批门控与启用展示 产品需求文档

> **变更 ID**：`20260630140113-ClaudeAgent-MCP审批门控与启用展示`
> **来源**：kb-propose
> **类型**：缺陷修复 + 展示升级
> **优先级**：P1
> **外部 PRD**：无（kb.project.json 未配置 integrations，external SKIP）
> **Figma 设计图**：无（auto-none，按现有 SessionMcpPanel 样式直接加 enable/disable 标签）
> **任务记录**：无（未配置 integrations）

## 一、背景

上一变更 `ClaudeAgent-MCP展示与注入对齐`（已归档 `20260630112137-...`）已把 ClaudeAgent（CC 路径）MCP 配置源改读 Claude 原生（`{ws}/.mcp.json` + `~/.claude.json` user/local scope）并启用 `strictMcpConfig: true`，但**未应用** project scope 审批门控过滤——这是该归档 §2 D1 显式标注的 known limitation，并在 `electron/AGENTS.md`、`cc-mcp-loader.ts:37` ponytail 沉淀「首版信任全量加载，升级路径：按两数组过滤」。

实际使用中，Claude Code 运行时只加载 3 个审批启用的 MCP，而 cursor-claw Dashboard 展示 4 个（含 1 个未启用），两者不一致，用户无法从 Dashboard 直观判断哪个 MCP 未被审批启用。

## 二、现状根因

经回读代码核实（本轮仅核实不修改）：

- 注入层 `cc-mcp-loader.ts`：`readClaudeJsonMcpServers` 只读 user/local scope 的 `mcpServers`，**未读** `projects[ws].enabledMcpjsonServers`/`disabledMcpjsonServers` 审批数组，`mergeMcpJsonEntries` 未对 project 条目过滤——inline 注入为全量。
- 取数层 `session-mcp-status.ts`：`toEntry` 将 `enabled` 硬编码 `true`，runtime/snapshot/disk 三态均未区分启用/禁用；`mapCcStatusToUi` 的 `disabled` 分支仅映射 SDK status 枚举，非审批门控语义。
- 类型层 `mcp.d.ts`：`McpServerEntry` 仅有 `enabled?: boolean`，无显式 `disabled` 状态枚举区分「未审批/被禁用」。

根因：inline 注入与展示取数均为全量，未对齐 Claude Code project scope 审批门控语义，导致注入数与实际加载数不一致、展示无法标识未启用项。

## 三、目标

- **注入层对齐**：inline 注入给 Claude Code 的 MCP 应与其实际运行时一致——只传审批启用的，消除「注入 4 个但实际加载 3 个」的差异。
- **展示层区分**：Dashboard MCP 面板展示全量（4 个），但状态区分——未审批/被禁用标记 `disabled`，启用标记 `enabled`/运行时 status；用户一眼可见哪个未启用。

## 四、目标条目

- **G1 注入层审批门控对齐**：inline 注入过滤 `disabledMcpjsonServers`、只保留 `enabledMcpjsonServers` 审批启用的 project scope 条目（user/local scope 维持现有加载语义），注入集合 = Claude Code 实际加载集合。
- **G2 展示层 enable/disable 状态区分**：Dashboard MCP 面板对全量条目标识启用/禁用状态，未审批或被禁用项标记 `disabled`，启用项标记 `enabled`（或运行时 status）。
- **G3 取数策略补全 disabled 条目**：取数层读盘/snapshot 路径下补全被审批禁用的条目及其 disabled 标记，避免展示侧漏掉 disabled 项。

## 五、验收标准

1. rclone Claude Code 会话内询问「当前项目配置了哪些 MCP」，Claude Code 回答的启用集合与 Dashboard MCP 面板 `enabled` 状态集合**完全一致**（数量与名称对齐）。
2. Dashboard MCP 面板展示 4 个，其中 1 个标记 `disabled`、3 个标记 `enabled`/运行时 status；disabled 标记正确反映 `~/.claude.json` 中 `projects[ws]` 审批状态。
3. 切换 workspace（不同审批配置）后，Dashboard 展示的 enabled/disabled 集合随之刷新，无跨 workspace 串台。
4. inline 注入数量 = Dashboard `enabled` 集合数量 = Claude Code 实际加载数量，三者一致。

## 六、非目标

- 不改 Claude Code 原生审批流程本身（不替用户审批/撤销）。
- 不改 user/local scope 加载语义（审批门控只作用于 project scope `.mcp.json`）。
- 不新增/删除 MCP server，不改 `strictMcpConfig: true`。
- 不改 SDK（Cursor 路径）MCP 注入与展示（本轮只针对 ClaudeAgent/CC 路径）。

## 七、风险

- **300 行约束**：`cc-mcp-loader.ts`(161)、`session-mcp-status.ts`(186)、`SessionMcpPanel.tsx` 接近上限；apply 阶段若新增过滤/状态逻辑超 300 行，须按 `AGENTS.md` 用设计模式重构（如抽取审批过滤策略、状态映射器）。
- **审批门控官方行为**：`enabledMcpjsonServers`/`disabledMcpjsonServers` 实际语义（白名单 vs 黑名单、缺省默认）需 design 阶段回 `mcp.d.ts` 与官方文档核实，避免过滤逻辑与官方运行时偏差。
- **取数复杂度**：idle/snapshot 路径补全 disabled 条目需读审批数组与读盘/snapshot 合并，须控制不破坏现有三态容错。
- **跨 workspace 串台**：审批数组按 `projects[ws]` 区分，须确认 `mcp-status-map` 缓存键不被审批状态污染导致 workspace 间 disabled 标记泄漏。
