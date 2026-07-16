---
type: ChangeSummary
title: Claude引擎改走spawn
description: Claude 主路径改 SDK spawnClaudeCodeProcess 显式拉起 CLI；query 作消息桥；stop/watchdog 可 kill；可诊断失败与 CC_LEGACY_QUERY 降级
timestamp: 2026-07-16T18:36:00+0800
related: []
depends_on: []
---

# Claude引擎改走spawn - 变更总结

> **变更 ID**：`20260716163001-Claude引擎改走spawn`
> **flow**：standard · **stage**：`tested`（待 kb-release 迁移时改 `archived`）
> **用户可见**：是（Claude 引擎主路径与可诊断失败）→ 归档需 **minor** bump

---

## 1、实际变更

### 1.1 代码（与 `manifest.files` 一致）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/claude-code/agent-cc-types.ts` | `CcSessionAgent` 增 `childPid` / `spawnedProcess`（内存 only，勿序列化） |
| `electron/agent/claude-code/cc-spawn-process.ts` | **新增**：`createCcSpawnClaudeCodeProcess` / `killCcSpawnedProcess`；`cc_spawn_enoent` / `cc_spawn_failed`；日志 `cc_spawn pid=` |
| `electron/agent/claude-code/cc-query-options.ts` | 默认注入 `spawnClaudeCodeProcess`；`CC_LEGACY_QUERY=1/true/yes` 不注入并打 `legacy_query` |
| `electron/agent/claude-code/agent-claude-sdk.ts` | `startCcSpawn` 主入口；`startCcQuery` 弃用转发；stop 挂接 `killCcSpawnedProcess` |
| `electron/agent/claude-code/cc-run-recover.ts` | recover 对齐 `startCcSpawn` / kill |
| `electron/agent/claude-code/agent-cc-stream.ts` | 广播状态输出真实 `childPid` |
| `electron/agent/claude-code/agent-cc-session-registry.ts` | 会话列表 `childPid ?? 0`；`completeCcRun` 清句柄 |
| `electron/agent/claude-code/agent-cc-events.ts` | watchdog `onTimeout` 挂接 `killCcSpawnedProcess` |
| `electron/agent/claude-code/AGENTS.md` | apply 已同步：spawn 主路径、门控、kill、禁止预热 API |

### 1.2 变更文档

- `00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `05-summary.md`（本文件）

### 1.3 版本与 Changelog（归档由 kb-release 落盘，此处预列）

| 文件 | 动作 |
|------|------|
| `package.json` | version **`1.15.1` → `1.16.0`**（minor：Claude 引擎行为变更） |
| `changelog/1.16.0.json` | 新建用户可见变更摘要 |

**未纳入本变更**：Cursor / Codex / OpenCode；预热变更目录 `20260714000128`；`.mcp.json` / `.codegraph/.gitignore`。

## 2、与设计的差异

引用 `04-review.md` §4 可接受偏差（阻断 0，评审通过）：

1. **`spawnedProcess` 类型**：设计写 SDK `SpawnedProcess`；实现为最小子集 `{ kill; pid? }`（运行时仍为 `ChildProcess`）。职责满足 stop/watchdog；后续可对齐 SDK 类型或补 `killed`。
2. **S11 notify 路径**：未改 `engine-port-adapter.ts`；同步失败在 launch/dispatch 返回 `{ ok:false, error }`（含 `cc_spawn_*`），且发生在 `NOTIFY_PROCESSING` 之前；与既有 launch 失败口径一致，无默认静默回退裸 query。
3. **`engine-port-adapter.ts` 注释**仍写 `startCcQuery`：Port 已委托 spawn 链路，仅注释遗留（非阻断）。

其余（默认注入 spawn、`CC_LEGACY_QUERY`、`startCcSpawn`+recover、stop/watchdog kill、真实 `childPid`、未接入预热 API）与 `02-design` 一致。

## 3、影响范围

- **模块**：仅 `electron/agent/claude-code/`（Claude 引擎进程生命周期、query options、会话列表/广播 pid、watchdog）。
- **接口**：无 proto / 跨端契约变更；HTTP Port 行为仍经既有 launch/dispatch，错误串可含 `cc_spawn_*`。
- **用户可见**：Claude 通道默认显式 spawn CLI（可观测 pid、可 kill、失败可诊断）；`CC_LEGACY_QUERY` 可回退裸 query；其它引擎无回归预期。

### 3.1 Ponytail 技术债

无（本变更 diff 文件集中无新增 `ponytail:` 注释）。

## 4、知识库影响清单

继承 `02-design.md` §十，按实际实现修正。勾选表示**已完成合并 / 无需更新**（kb-librarian 已合并业务域正文）：

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/07-ClaudeCodeSDK执行引擎.md` — 主路径改为显式 `spawnClaudeCodeProcess` + `query` 消息桥；流程/接口/可观测（pid、`cc_spawn_*`、`CC_LEGACY_QUERY`）；**librarian 已合并**
- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — Claude 启动表述由「`query()`」改为 spawn 主路径口径，并与四引擎对照对齐；**librarian 已合并**
- [x] `knowledge/业务域/Agent调度/log.md` — **librarian 已追加变更记录**

### （二）可能更新（视实现结果）

- [x] `knowledge/业务域/Agent调度/01-概览.md` — 核对后总述未写「CC=`query()`」，**无需更新**
- [x] `knowledge/业务域/Agent调度/10-SDK上下文保护与失败归因.md` — 补充可检索错误码 `cc_spawn_enoent` / `cc_spawn_failed`（launch 同步失败文案）；非新 ResumeFailureCategory；**librarian 已合并**
- [x] `electron/agent/claude-code/AGENTS.md` — **apply 已更新**（spawn 适配器、门控、kill、入口）

### （三）不需要更新

- [x] Cursor / Codex / OpenCode 引擎文档（`06`/`08`/`09`）— 本期不改行为
- [x] 预热变更 `20260714000128` — **不在本变更 archive 范围**；勿改写
- [x] 消息桥接 / 工作流域正文 — 无契约变更
- [x] `knowledge/知识地图.md` / 总 `index.md` / `Agent调度/index.md` — 无新叶子或入口变化

## 5、遗留与后续

1. `engine-port-adapter.ts` 注释改 `startCcSpawn`（非阻断）。
2. `spawnedProcess` 类型与 SDK `SpawnedProcess` / `killed` 对齐（非阻断）。
3. 运行时冒烟：错误二进制、`CC_LEGACY_QUERY=1`、stop/watchdog 无僵尸、它引擎不回归（见 `06-automation-test.md`）。
4. kb-release：bump `1.16.0` + `changelog/1.16.0.json`；目录迁移至 `knowledge/变更/归档/` 后再将 `manifest.stage` 置 `archived`。
