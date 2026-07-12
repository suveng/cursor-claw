# 验收问题报告

> **变更 ID**：`20260711232258-四引擎 Engine Port 与 RunLifecycle 抽象`
> **manifest 阶段**：`acceptance_reopened`（第 1 轮验收打回）

## 第 1 轮

### 反馈问题

用户**明确不接受债务**，拒绝原 `accepted_debt` / `archived_with_debt` 归档口径。须清偿以下未达验收项：

1. **R3 / R5（T11 / T14）**：Cursor+Claude 与四引擎全矩阵的运行态飞书 IM 仅以「待维护者手工」记录即归档，**无可重复、可断言的自动化验收**。
2. **S7**：`RunLifecycle.resume()` 仍为 stub（仅 `setPhase("guarding")`），`sdk-run-recover.ts` 续接路径未与 Lifecycle 全量挂接；Electron 重启后续接终态 notify 合规无法验证。
3. **S8**：Claude Code / Codex / OpenCode 仍使用裸 `acquireRunGuard`，guard busy 时**无** busy IM；仅 Cursor 经 `enterGuardWithLifecycle` + `notifyGuardBusy` 通知用户。

### 归因结论

code

### 判定依据

| 问题 | PRD / 验收要求 | 代码现状 | 偏差 |
|------|----------------|----------|------|
| **R3 / T11 运行态 IM** | `01-proposal.md` 场景矩阵 S1～S6 须可验证 IM 语义与次数 | `06-automation-test.md` §4.5 记「静态+build pass；运行态待手工，不阻断 archive」；R3 标 `accepted_debt` | **实现未提供可重复验收手段**，以债务替代验收 |
| **R5 / T14 运行态 IM** | 四引擎 × S1～S8 全矩阵须可验证 | `06-automation-test.md` §3.5 S7/S8 为 ⏸；§4.6 运行态 IM 待手工；R5 标 `accepted_debt` | 同上；**用户拒绝以债务归档** |
| **S7 续接** | 场景 S7：Electron 重启后续接，终态 notify 合规 | `run-lifecycle.ts` L78–80 `resume()` 注释为 stub，仅 `setPhase("guarding")`；`sdk-run-recover.ts` 仍 `acquireRunGuard` 直连，未经 `resume()` 重置 `errorNotified` 与阶段 | **续接与 Lifecycle 未实装** |
| **S8 guard busy** | 并发/锁冲突时 guard busy **不静默** | `agent-sdk.ts` 使用 `enterGuardWithLifecycle`；`agent-claude-sdk.ts` / `agent-codex-sdk.ts` / `agent-opencode-sdk.ts` 仍 `acquireRunGuard`，busy 无 `notifyGuardBusy` | **三引擎 S8 未达 01 验收** |

**源码链路（已核实）**：

| 步骤 | 位置 | 说明 |
|------|------|------|
| 1 | `electron/agent/shared/run-lifecycle.ts` L78–80 | `resume()` stub，注释「S7 续接 stub：二～三期完善」 |
| 2 | `electron/agent/cursor-sdk/sdk-run-recover.ts` L7、L123 | 导入并调用 `acquireRunGuard`，未挂接 `createRunLifecycle().resume()` |
| 3 | `electron/agent/cursor-sdk/agent-sdk.ts` L198、L264 | Cursor 使用 `enterGuardWithLifecycle(session, lifecycle)` |
| 4 | `electron/agent/claude-code/agent-claude-sdk.ts` L104、L182 | 裸 `acquireRunGuard`，busy 静默返回 |
| 5 | `electron/agent/codex/agent-codex-sdk.ts` L146、L231 | 同上 |
| 6 | `electron/agent/opencode/agent-opencode-sdk.ts` L187、L231 | 同上 |
| 7 | `electron/agent/shared/agent-run-guard.ts` L66–79 | `enterGuardWithLifecycle` 在 busy 时调用 `notifyGuardBusy`；**仅调用方接入后生效** |
| 8 | `06-automation-test.md` §2、§3.5 | 已记录 S7 stub、S8 三引擎 ⏸；归档时以 `accepted_debt` 放行 |

**评审口径说明**：`04-review.md` 全量评审将 R3/R5 标为 `accepted_debt`（运行态 IM 待手工），与用户本轮「不得再 accepted_debt / archived_with_debt」冲突；本轮为**验收打回**，非 PRD 口径变更。

### 影响范围

| 模块 | 影响 |
|------|------|
| `electron/agent/shared/run-lifecycle.ts` | S7 `resume()` 须实装阶段恢复与 `errorNotified` 重置 |
| `electron/agent/cursor-sdk/sdk-run-recover.ts` | 续接路径须挂接 Lifecycle |
| `electron/agent/claude-code/agent-claude-sdk.ts` | S8 busy IM |
| `electron/agent/codex/agent-codex-sdk.ts` | S8 busy IM |
| `electron/agent/opencode/agent-opencode-sdk.ts` | S8 busy IM |
| T11 / T14 验收 | R3/R5 运行态飞书 IM 须契约冒烟（mock notify）可重复断言 |
| 01 场景 **S7、S8** | **不通过** |
| 01 场景 **S1～S6** 运行态 | 静态通过；运行态 IM **待 D3 自动化后可复验** |

### 后续处理路径

| 问题 | 建议路径 | manifest 任务 |
|------|----------|---------------|
| S8 三引擎 guard busy 无 IM | **`/kb-apply`**：CC/Codex/OpenCode 改 `enterGuardWithLifecycle` | **D1** |
| S7 `resume()` stub + recover 未挂接 | **`/kb-apply`**：实装 `resume()` 并与 `sdk-run-recover` 挂接 | **D2** |
| R3/R5 运行态 IM 无自动化验收 | **`/kb-apply`**：契约冒烟脚本（mock notify，可重复断言 S1～S8） | **D3**（依赖 D1、D2） |

清偿顺序：**D1 → D2 → D3**；完成后重跑 `06-automation-test` 并 `/kb-test` → `/kb-archive`。
