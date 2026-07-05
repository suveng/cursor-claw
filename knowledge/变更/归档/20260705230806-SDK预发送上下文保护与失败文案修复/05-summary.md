# SDK 预发送上下文保护与失败文案修复 - 变更总结

> **变更 ID**：`20260705230806-SDK预发送上下文保护与失败文案修复`
> **来源**：kb-propose · standard flow（缺陷修复 P1）
> **阶段**：`tested`（04-review 通过；06 静态+编译通过；E2E 待手工）
> **范围**：T1–T6 done

---

## 1、实际变更

### 代码（8 个 cursor-sdk 文件 + manifest + AGENTS.md）

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/cursor-sdk/sdk-session-types.ts` | `SdkSessionAgent` 增 `lastPreSendUsedTokens` / `lastPreSendUsageRatio` 快照字段（JSDoc：每次 pre-send 覆盖，轮转清零 peak 后仍供归因） |
| `electron/agent/cursor-sdk/context-rotation-lite.ts` | `FULL_ROTATION_RATIO = 1.0`；ratio≥100% 跳过 `ROTATION_HITS` 与冷却，首轮即 `rotated: true` |
| `electron/agent/cursor-sdk/sdk-run-dispatch.ts` | `maybeRotateSessionForPressure` 写入 pre-send 快照；`sendWithRetry` 在 ratio≥100% 且 `!rotated` 时返回 `context_blocked`，不调用 `agent.send` |
| `electron/agent/cursor-sdk/sdk-failure-messages.ts` | `SdkFailureContext` 扩展 pre-send 字段；新增 `isContextExhaustedByPreSend`（≥95%）；归因链 timeout → context_exhausted（peak 或 pre-send）→ … |
| `electron/agent/cursor-sdk/sdk-run-finalize.ts` | `notifySdkFailure` 传入 pre-send 快照；新增 `notifyPreSendContextFailure`（`context_blocked` 即时 IM，复用文案器 + footer） |
| `electron/agent/cursor-sdk/agent-sdk.ts` | launch/dispatch 入口调用 `warnIfSharedWorkspaceDir`；`context_blocked` 时删 session 前 `notifyPreSendContextFailure`（各 1 处）；281 行 |
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | 新增 `warnIfSharedWorkspaceDir`：多活跃 session 共用 `workspaceDir` 时 WARN（Set 去重，每目录每进程至多 1 条） |
| `electron/agent/cursor-sdk/AGENTS.md` | SDK 错误 notify / 自动压缩段同步 pre-send 快照、`context_blocked` 阻断与失败归因优先级 |

**不变**：`othersWorkspaceMode` 默认隔离；`sdk-run-presentation.ts` Rev2 end-only 链；`sdk-run-stream.ts` / `completeSdkRun` 主链；通道类型与飞书 CardKit 呈现；无新增单元测试。

### 变更文档

- `00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`、`05-summary.md`（本文件）

### 版本与 changelog

- `package.json` **1.13.15 → 1.13.16**（patch）
- `changelog/1.13.16.json`：失败文案改进、pre-send 上下文保护、ratio≥100% 快拒

---

## 2、与设计的差异

与 `02-design.md` / `03-tasks.md` 主链路**一致**；`04-review.md` 判定无阻断性设计偏差。

| 项 | 设计预期 | 实际 | 评估 |
|----|----------|------|------|
| S4 pre-send 快照 | session 字段 + dispatch 写入 | 已落地 | ✅ |
| S5 ratio≥100% 强制轮转 + bypass 冷却 | `FULL_ROTATION_RATIO` | 已落地 | ✅ |
| S6 `context_blocked` 阻断 send | `preSendRatio >= 1.0 && !rotated` | 已落地 | ✅ |
| S6 阻断 notify | `notifyPreSendContextFailure` + launch/dispatch 各 1 处 | 已落地 | ✅ |
| S8/S9 失败归因 | `notifySdkFailure` 传 pre-send；`isContextExhaustedByPreSend` | 已落地 | ✅ |
| S10 共享 workspaceDir WARN | `warnIfSharedWorkspaceDir` + 入口调用 | 已落地 | ✅ |
| S11 非目标 | 未改通道配置 / presentation | diff 未触及 | ✅ |

**可选债务（04-review §7，不阻断 archive）**：

| ID | 说明 |
|----|------|
| **D1** | `notifyPreSendContextFailure` 未调用 `archiveAgentFailureLogs`（`notifySdkFailure` 有）；仅影响故障归档 |
| **D2** | `02·八·（二）` ratio=150% 端到端时延、crash_log 回放、飞书 IM 目检 — 待归档前手动 smoke |

---

## 3、影响范围

- **Cursor SDK 执行层**：pre-send 压力评估 → 快照 → 强制轮转 / send 阻断 → 失败归因全链路；各 session 独立字段，无跨 session 读写。
- **飞书 / IM 用户**：上下文已满时收到明确「上下文窗口已接近或达到上限」类提示；ratio≥100% 且无法轮转时不再无意义等待 `agent.send`。
- **运维日志**：pre-send 阻断时 UI 日志 `[compression] pre-send context_blocked`；多 session 共用目录时 `[shared-workspace]` WARN（用户 IM 不变）。
- **阈值分工**：**100%** 用于强制轮转与 send 阻断；**95%**（`CONTEXT_EXHAUSTED_RATIO`）用于失败文案「上下文已满」归因 — 与设计一致。
- **非目标**：Claude/Codex/OpenCode 引擎；Daemon 路由契约；proto/DB；通道 `othersWorkspaceMode` 默认值；飞书 CardKit 布局。

### 3.1 Ponytail 技术债

| 位置 | 注释 | 与本变更关系 |
|------|------|--------------|
| `context-rotation-lite.ts` L57 | `ponytail: 先用固定摘要模板，后续可接真实 summary 生成` | **既有**（轮转 summary 模板）；本变更仅扩展 ratio≥100% 强制轮转逻辑，未改 summary 生成 |
| T6 `warnIfSharedWorkspaceDir` | — | 无 `ponytail:` 注释 |

04-review 口径：**Lean already. Ship.** — 无本变更新增 Ponytail 项需登记。

---

## 4、知识库更新计划执行情况

> 来源：`02-design.md` §十；正文落盘由 **kb-librarian** 在 `/kb-archive` 消费。

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — pre-send 快照、`FULL_ROTATION_RATIO`、`context_blocked` 阻断、`notifyPreSendContextFailure`、失败归因含 pre-send≥95%
- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — 多群并发失败产品说明；`warnIfSharedWorkspaceDir` 与 workspaceDir 配置关系
- [x] `knowledge/业务域/Agent调度/10-SDK上下文保护与失败归因.md` — 新增专题子模块

### （二）可能更新（视 archive 细化）

- [x] `electron/agent/cursor-sdk/AGENTS.md` — **已更新**（T5 同步 pre-send / context_blocked）
- [x] `knowledge/业务域/Agent调度/01-概览.md` — 「关键约束」补失败提示口径
- [x] `knowledge/业务域/Agent调度/00-README.md` — 子模块清单与阅读路径

### （三）不需要更新

- 通道类型定义、`othersWorkspaceMode` 默认值
- Proto、Flutter/Quasar 客户端知识库
- `sdk-run-presentation.ts` / 飞书 CardKit 呈现链
- `knowledge/知识索引.md` — 待 librarian 归档时评估是否补检索词（「上下文已满」「pre-send」）

---

## 5、验证结论

依据 `06-automation-test.md`：

| 项 | 结果 | 备注 |
|----|------|------|
| T1–T6 静态代码追溯 | **通过** | 关键符号与 02/03 设计一致 |
| `npx tsc --noEmit` | **通过** | 退出码 0（2026-07-05） |
| `agent-sdk.ts` ≤300 行 | **通过** | 281 行 |
| 01 验收 1–4 / 6 | **静态已覆盖** | 文案、快拒、轮转后归因、多群独立、非目标未破坏 |
| 01 验收 5（T6 WARN 实跑） | **静态已覆盖，实跑待补** | 未构造双 session 同目录 |
| 02·八·（二）ratio=150% 时延 | **待手动** | 04-review §7 D2；非阻断 archive |
| 飞书 IM / crash_log 回放 | **待用户执行** | 06 §4.3 |

**结论**：静态验收与编译冒烟通过；E2E / 手动 smoke 为归档前建议项，不阻断 `/kb-archive`。

---

## 6、用户可见变更

### 失败文案（F1 / 验收 1、3）

| 场景 | 变更前 | 变更后 |
|------|--------|--------|
| 上下文已超限（peak 或 pre-send≥95%） | 常退化为「⚠️ Agent 处理失败，建议精简输入后重新发送…」 | 「⚠️ 上下文窗口已接近或达到上限，请精简需求或开启新话题后重新发送。」 |
| 轮转成功 peak 清零后再失败 | 误报通用兜底句 | 仍读 pre-send 快照，走上下文已满句 |
| 超时 / busy / 其他失败 | 现网分支不变 | 不变 |

### pre-send 保护（F2 / 验收 2）

| 行为 | 说明 |
|------|------|
| ratio≥100% 首轮强制轮转 | 跳过「90%+ 连续 2 次」与冷却，尽快 `Agent.create` 换新 |
| ratio≥100% 且轮转失败 | **立即** `context_blocked`，不进入 `agent.send`；launch/dispatch 删 session 前即时 IM |
| 各群独立 | 每 session 独立快照与检测；多群同时报错为同类问题并发，非串扰 |

### 运维可见（F4，用户 IM 不变）

- 多活跃 session 共用 `workspaceDir`：SDK UI 日志 WARN `[shared-workspace] …`（每目录每进程至多 1 条）
