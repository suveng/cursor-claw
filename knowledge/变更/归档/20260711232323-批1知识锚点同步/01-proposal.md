# 批1知识锚点同步轻量变更说明

> **变更 ID**：`20260711232323-批1知识锚点同步`
> **来源**：kb-lite
> **类型**：文档
> **优先级**：P3
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无
> **lite 类型**：知识同步型 lite（纯知识库，无代码变更）

---

## 背景

巨型单体拆分批1（[`20260711203953-巨型单体拆分`](../../归档/20260711203953-巨型单体拆分/)）已将 orchestrator、presentation、HTTP/MCP 等逻辑自 `daemon.ts` 扩散至 `src/daemon/daemon-*.ts` 子模块；`knowledge/业务域/消息桥接/00-README.md` 与 `knowledge/业务域/Agent调度/00-README.md` 已更新薄组装锚点。

消息桥接、工作流部分**叶子知识文件**仍残留裸 `daemon.ts` 或未精确到批1 落点的表述，与当前源码不一致，影响 Agent 检索与 CodeGraph 对照。

## 变更说明

### LITE-01：批1 知识锚点同步（不扩批2 代码拆分）

**必改**：

| 文件 | 行/锚点 | 现状 | 目标（实现前须 grep/`codegraph_context` 核实） |
|------|---------|------|-----------------------------------------------|
| `knowledge/业务域/消息桥接/03-微信通道.md` | L14 `daemon.ts` | 「首条私聊不入队」锚点裸 `daemon.ts` | 精确至批1 实际落点，如 `src/daemon/daemon.ts`（首条 p2p context 绑定逻辑仍驻薄组装，见 `daemon.ts` 约 L287–296） |
| `knowledge/业务域/工作流/04-触发与管理入口.md` | L11 `daemon.ts` | 「定义 CRUD 在 admin MCP；流转在 agent MCP（`daemon.ts`）」 | 拆分为批1 实际路径：`daemon-http-mcp.ts`（admin/agent MCP 工厂）、`src/workflow/server-workflow.ts`（`manage_workflows` 工具定义）等；**禁止**继续裸写 `daemon.ts` |

**核对一致**（与 `src/daemon/daemon-*.ts` 对照，仅修正失准表述，不改产品语义）：

| 文件 | 核对要点 |
|------|----------|
| `knowledge/业务域/消息桥接/02-飞书通道.md` | presentation 门控、`stream-text`、`sendMilestoneText` 等 daemon 侧描述是否对应 `daemon-presentation-*` / `daemon-presentation-stream.ts` |
| `knowledge/业务域/消息桥接/04-消息队列与路由.md` | dispatch loop、`handleStreamText` final ack、MergeBatch 路由是否对应 `daemon-orchestrator.ts`、`daemon-http-routes-orchestrator.ts`、`daemon-presentation-stream.ts` 等 |

**可选**：

| 文件 | 说明 |
|------|------|
| `knowledge/变更/归档/20260711203953-巨型单体拆分/05-summary.md` | 追加「批1 知识锚点同步」备注，链至本变更；**不得**将 T16 标为 `done` |

**明确不在范围**：

- 不改业务代码、proto、配置实现
- 不展开批2（T8～T16）queue/channel/logging 仍驻 `daemon.ts` 的拆分说明
- 不改 `knowledge/知识地图.md`、`knowledge/知识索引.md`（入口未变）
- 不写 `02-design.md`、`03-tasks.md`（lite 流程）

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 批1 锚点清单明确，验收可 grep 核对 |
| 修改范围 | 2 必改 + 2 核对知识叶子文件（+0 代码） |
| 接口契约 | 不变（+0） |
| 数据/权限 | 不变（+0） |
| 跨端联动 | 无（+0） |
| 知识库 | 知识同步型，局部叶子锚点（+1） |
| **总分** | **≤2**，可走 lite；纯文档无代码 |

## 验收标准

1. **`03-微信通道.md`**：L14 及全文无与批1 矛盾的裸 `daemon.ts` 锚点；首条 p2p 不入队逻辑可回 `src/daemon/daemon.ts` 核实。
2. **`04-触发与管理入口.md`**：L11 admin/agent MCP 表述精确至 `daemon-http-mcp.ts` 与 workflow 工具落点，无裸 `daemon.ts`。
3. **`02-飞书通道.md`、`04-消息队列与路由.md`**：daemon 相关段落与 `src/daemon/daemon-*.ts` 批1 模块边界一致；失准处已修正或标「（待确认）」。
4. **消息桥接、工作流叶子文件**：无裸 `daemon.ts` 与 README/源码锚点矛盾（允许 README 已声明的 `src/daemon/daemon.ts` 薄组装说明）。
5. **可选备注**：若更新巨型单体拆分 summary，T16 状态保持 `deferred`，不改为 `done`。
6. **以代码为准**：结论须 grep 或 CodeGraph 回 `src/daemon/`、`src/workflow/` 核实；禁止编造路径。

## 影响范围

| 范围 | 说明 |
|------|------|
| `knowledge/业务域/消息桥接/03-微信通道.md` | 修正首条 p2p 锚点 |
| `knowledge/业务域/工作流/04-触发与管理入口.md` | 修正 MCP 入口锚点 |
| `knowledge/业务域/消息桥接/02-飞书通道.md` | 核对 presentation/stream 表述 |
| `knowledge/业务域/消息桥接/04-消息队列与路由.md` | 核对 dispatch/ack 表述 |
| `knowledge/变更/归档/20260711203953-巨型单体拆分/05-summary.md` | 可选追加备注 |

**不在范围**：业务代码、批2 拆分、知识地图/总索引、其他业务域叶子正文。

## 实现要点（供 kb-librarian）

- 写盘前用 `codegraph_context` 或 grep 核对：`daemon-http-mcp.ts`、`daemon-orchestrator.ts`、`daemon-presentation-stream.ts`、`daemon-http-routes-orchestrator.ts`、`server-workflow.ts`。
- 保留产品语义，只改源码锚点与模块名；各文件「十、变更记录」按日期追加一句。
- 单文件仍遵守 `knowledge/AGENTS.md` ≤3000 字符。

## 待后续事项

- kb-librarian 写盘后将 manifest `tasks[0].status` 更新为 `done`，`files[]` 补全实际变更
- 轮末：kb-scribe 补写 `05-summary.md` 并归档
