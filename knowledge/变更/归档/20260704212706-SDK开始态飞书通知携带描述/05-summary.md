# SDK 开始态飞书通知携带描述 - 变更总结

> **变更 ID**：`20260704212706-SDK开始态飞书通知携带描述`
> **来源**：kb-propose · standard flow（合并 B+D）
> **阶段**：`tested` → archived
> **范围**：T1–T5；04-review S1 已在 archive commit 前剥离混入

---

## 1、实际变更

### 代码（与 manifest.files code 一致）

| 文件 | 关键改动 |
|------|----------|
| `src/shared/tool-presentation.ts` | 新增 `TOOL_MILESTONE_TEXT_MAX`、`formatToolMilestoneText`（shell started 命令摘要 + 无命令降级句） |
| `src/daemon/daemon.ts` | 飞书 tool 抑制里程碑改用 `formatToolMilestoneText`；飞书 thinking 抑制零出站；`buildTaskFallbackText` 与 Electron 映射对齐 |
| `electron/agent/cursor-sdk/sdk-run-stream.ts` | 扩展 `mapTaskMilestoneText(status,text,taskSeq)`；started 递增 `taskSeq`；长描述截断 |
| `electron/agent/cursor-sdk/sdk-session-types.ts` | `SdkSessionAgent.taskSeq?` |
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | `resetSdkRunPresentationState` 清零 `taskSeq` |
| `electron/agent/cursor-sdk/AGENTS.md` | task 映射、thinking 飞书零出站、未改 Rev2 声明 |
| `src/daemon/AGENTS.md` | 飞书 tool/thinking handler 行为更新 |
| `src/shared/AGENTS.md` | `formatToolMilestoneText` / `TOOL_MILESTONE_TEXT_MAX` 索引 |
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | §八推送：shell/task 文案 + thinking 零出站；supersede A·F8.1 |

**用户可见行为**：

- 飞书 shell 开始态里程碑携带具体命令摘要（或明确降级文案）。
- 飞书子任务开始态携带描述或 `#序号`，不再固定「子任务进行中…」。
- 飞书不再推送思考过程里程碑消息；桌面 `[thinking]` 日志保留。

**不变**：`sdk-run-presentation.ts` Rev2 end-only 链；`daemon-presentation-milestone.ts` 节流；silent 工具分级；微信非飞书 thinking CardKit。

### 变更文档

- `00-manifest.json`～`06-automation-test.md`、`05-summary.md`（本文件）

### 版本与 changelog

- `package.json`：`1.13.4` → **`1.13.5`**（patch）
- `changelog/1.13.5.json`（新建）

---

## 2、与设计的差异

与 `02-design` 主方案一致；W1（`truncateMilestoneText` 与 shared 重复）为 accepted 可选债，不阻断。

| 项 | 设计预期 | 实际 | 评估 |
|----|----------|------|------|
| shell 里程碑 SSOT（S5） | `formatToolMilestoneText` | 已落地 | ✅ |
| task 描述 + seq（S4） | `mapTaskMilestoneText` + `taskSeq` | 已落地 | ✅ |
| 飞书 thinking 零出站（S3） | 抑制分支 `return { ok: true }` | 已落地 | ✅ |
| Rev2 正交 | 未改 `sdk-run-presentation.ts` | grep 无 diff | ✅ |
| supersede A·F8.1 | 文档 + 行为 | `06` 引擎变更记录已写 | ✅ |

---

## 3、影响范围

- **Cursor SDK + 飞书**：开始态里程碑更可读；thinking 过程消息减少。
- **ordering / Rev2**：Electron 仍 POST thinking 并置 defer 闩；飞书侧无 thinking 里程碑 sent（与 A Rev2 债务 R-D1 兼容）。
- **非目标**：其他引擎、Electron 设置 UI、proto/DB 未改。

---

## 4、知识库影响清单

| 文件 | 状态 |
|------|------|
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | ✅ 已更新（T5） |
| `electron/agent/cursor-sdk/AGENTS.md` | ✅ 已更新 |
| `src/daemon/AGENTS.md` | ✅ 已更新 |
| `src/shared/AGENTS.md` | ✅ 已更新 |
| A·F8.1 supersede 交叉引用 | 已写入 `06` §十变更记录 |

---

## 5、测试与评审

- **04-review**：通过；S1 混入已在 archive 前剥离。
- **06-automation-test**：静态 + `build:mcp` 通过；E2E 待维护者手工（不阻断）。
