# CC spawn --verbose 参数修复 - 变更总结

> **变更 ID**：`20260630000313-CC-spawn-verbose参数修复`
> **来源**：kb-lite
> **lite 类型**：hotfix-lite
> **阶段**：`superseded` / `cancelled`（LITE-01 曾完成，但 spawn 路径已在 SDK 迁移中删除，本 hotfix 未独立生效）

---

## 1、根因确认

| # | 根因 | 说明 |
|---|------|------|
| 1 | **`buildSpawnArgs` 缺少 `--verbose`** | CC CLI 要求 `--print` + `--output-format stream-json` 时必须传 `--verbose`；缺失导致 spawn 即失败（code=1） |

> 根因在本变更提出时成立；后续 Claude 执行引擎已迁移至官方 SDK，spawn 路径整体移除，该根因随架构变更一并消除。

## 2、实际变更

| 项 | 状态 | 说明 |
|----|------|------|
| LITE-01 | **曾 done** | manifest 记录 `buildSpawnArgs` 添加 `--verbose` 已完成 |
| 独立生效 | **否** | spawn 路径在 `20260630002838-ClaudeAgentSDK落地` 迁移中被删除，改用 `@anthropic-ai/claude-agent-sdk` 的 `query()`；`--verbose` 修复未以 hotfix 形式长期留存于代码库 |
| 当前代码 | **无残留** | 无需合并本 hotfix 的 spawn 参数改动；Claude 引擎问题由 SDK 落地变更统一解决 |

| 文件 | 原计划改动 | 实际结果 |
|------|------------|----------|
| `electron/agent-claude-sdk.ts` | `buildSpawnArgs` 增加 `--verbose` | LITE-01 曾修改；SDK 迁移后 spawn/buildSpawnArgs 路径已删除 |
| `electron/AGENTS.md` | CC spawn 参数约定（若有） | 随 spawn 路径移除，约定由 SDK 落地变更覆盖 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

## 3、被取代

| 项 | 内容 |
|----|------|
| **superseded by** | [`20260630002838-ClaudeAgentSDK落地`](../20260630002838-ClaudeAgentSDK落地/) |
| **取代原因** | Claude 执行引擎从「外部 CLI spawn + 自研流式解析」迁移为「官方 Claude Agent SDK 库调用」；`buildSpawnArgs` / spawn 子进程路径整体删除 |
| **与本变更关系** | 本 hotfix 针对的 `--verbose` 约束仅存在于旧 spawn 路径；SDK 路径不经过 CLI `--print` + `stream-json`，原问题不再适用 |
| **结论** | 本变更标记为 **superseded / cancelled**，不单独发布、不单独验收 |

## 4、与设计的差异

无独立设计文档（hotfix-lite）。实现曾按 `01-proposal.md` 完成 LITE-01，但最终效果被 SDK 迁移吸收，**未以本变更 ID 独立交付**。

## 5、影响范围

- **涉及模块（历史）**：Electron CC Agent spawn（`agent-claude-sdk.ts` 的 `buildSpawnArgs`）。
- **当前状态**：spawn 模块已移除；用户可见行为由 SDK 落地变更负责。
- **接口/数据**：无 HTTP/proto/持久化变更。
- **关联变更**：
  - 补全缺口来源：`knowledge/变更/归档/20260629164130-执行引擎扩展接入ClaudeCode/`
  - **取代方**：`20260630002838-ClaudeAgentSDK落地`

## 6、知识库影响清单

**无需更新** — 被 `20260630002838-ClaudeAgentSDK落地` 大变更覆盖；本 hotfix 为记录型，无独立业务域/工程平台正文需维护。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/**` | 不需要 | SDK 落地变更统一更新 |
| `knowledge/工程平台/**` | 不需要 | SDK 落地变更统一更新 |
| `electron/AGENTS.md` | 不需要 | spawn 约定已随路径删除，由 SDK 变更文档化 |

## 7、验收与复测建议

本变更 **已取消独立验收**；原 spawn 相关项由 SDK 落地变更验收替代。

| # | 项 | 操作 | 状态 |
|---|-----|------|------|
| 1 | CC spawn 无 verbose 报错 | — | ❌ 已取消（spawn 路径已删除） |
| 2 | stream-json 解析 | — | ❌ 已取消（改由 SDK 事件流验收） |
| 3 | SDK 路径回归 | 见 `20260630002838-ClaudeAgentSDK落地` | ➡️ 移交 |
| 4 | 编译 | 见 SDK 落地变更 | ➡️ 移交 |

## 8、归档待办（`/kb-archive`）

- **stage**：`applied` → **`archived`**（superseded，无独立 release）
- **目录**：`mv` 至 `knowledge/变更/归档/`
- **代码合并**：**无** — 无需合并的 hotfix 代码残留
- **技术债**：**无 accepted debt**
- **版本 / changelog**：无需为本变更单独 patch bump
- **知识库同步**：**跳过** — 由 `20260630002838-ClaudeAgentSDK落地` 归档时统一处理
