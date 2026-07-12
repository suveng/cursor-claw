# cursor-claw规则SDK-only对齐轻量变更说明

> **变更 ID**：`20260711233412-cursor-claw规则SDK-only对齐`
> **来源**：kb-lite
> **类型**：文档
> **优先级**：P3
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无
> **lite 类型**：知识同步型 lite（规则模板 + README + 可选 KB 一句指针；**不改** Daemon/Electron 代码）

---

## 背景

IM 主路径已收敛为 **SDK 长驻 Agent + Daemon dispatch 入站 + Presentation/`send_text` 出站**（见 [`knowledge/业务域/Agent调度/03-启动与自动重连.md`](../../../业务域/Agent调度/03-启动与自动重连.md)）。归档设计 [`20260627162620-飞书作为Cursor展示与控制层/02-design.md`](../../归档/20260627162620-飞书作为Cursor展示与控制层/02-design.md) 明确：

- `workspace-injector` 自动写盘已废弃为 **no-op**；
- `resources/template/rule/cursor-claw.mdc` **不注入、不维护** 于 SDK 主路径；
- `GET /api/poll-message`、阶段 4 Shell 保活轮询随 CLI spawn 删除。

现网 `cursor-claw.mdc` 仍以 poll-message / 五阶段状态机 / Shell 保活为核心；根 `README.md` L46–57 架构图仍暗示「自动注入 Rules」与 `.cursor/rules/cursor-claw.mdc`，与 `electron/agent/shared/AGENTS.md` L22（`workspace-injector` no-op）及 [`knowledge/工程平台/Electron桌面应用/04-配置与更新.md`](../../../工程平台/Electron桌面应用/04-配置与更新.md) 不一致。

## 变更说明

### LITE-01：规则模板与文档对齐 SDK-only

#### 1. `resources/template/rule/cursor-claw.mdc`（必改）

**顶部**：增加 **Legacy 废弃说明**——本文件为历史 CLI/poll 时代参考模板；SDK 长驻 IM 路径**不依赖**本 rule 注入；`workspace-injector` 不再自动复制；手动放入工作区 `.cursor/rules/` 仅为可选参考。

**改写主体**为 **SDK 长驻 Agent 通信约定**：

| 维度 | 目标表述 |
|------|----------|
| **入站** | Daemon `POST /api/agent/dispatch`（或 launch 首条）→ Electron agent-api → SDK `agent.send`；用户消息经 Prompt/任务正文到达 Agent，**非** HTTP poll |
| **出站** | 主路径：Presentation Pipeline 流式/卡片出站；降级/补充：`send_text` MCP（及既有 `send_image`/`send_file`） |
| **长驻** | Run 结束后保持 resident Agent 实例，等待下一条 dispatch；由 Daemon 编排，**非** Agent 侧 Shell 轮询 |

**删除**（或整节移除，不得残留为主路径）：

- `GET /api/poll-message` 及 Shell/curl 拉取说明；
- 五阶段状态机中的 **阶段 4 保活轮询**（`wait=false` + `sleep` 循环）及冷启动 poll 检查；
- 「禁止发呆退出 → 进入保活轮询」等与 poll 绑定的禁令；
- HTTP API 退避表中 poll-message 行（若保留 send-text 退避须标注为 MCP 不可用时的例外）。

**保留并修订**（语义对齐 dispatch/Presentation 上下文）：

- **`send_text` 回复规则**：`message_id` + `session_key` 必填；多条合并回复取最新 `message_id`；禁止静默吞消息。
- **群内 @ 协作（飞书）**：`<at user_id="ou_xxx">` 格式与防循环禁令保留；**meta 来源**改为 dispatch 入站/Presentation 附带的会话上下文（`chatType`、`senderOpenId`、`botRoster` 等），**不再**写「poll-message 返回的 meta」。
- **工作流节点**（若保留）：与 `workflow_next`/`workflow_reject` 的交互说明可保留，但去掉 poll 拉取用户消息的主路径描述。

**frontmatter**：评估是否保留 `alwaysApply: true`——若文件仅作模板参考，可改为 `alwaysApply: false` 或于 Legacy 段说明「手动复制时自行决定」；实现时以「不误导 SDK 主路径」为准。

#### 2. `README.md` L46–57（必改）

修正 Electron / `.cursor/` 架构图区块，**移除**：

- 「自动注入 .cursor/mcp.json、**Rules** 和 Skills」中 **Rules**（及暗示自动注入 `cursor-claw.mdc`）的表述；
- `.cursor/rules/cursor-claw.mdc` 作为运行时必备节点的图示暗示。

**对齐** `workspace-injector` no-op 现状：

- launch / Daemon 就绪**不写盘** rules/MCP；
- 可选：用户经 Settings **`workspace:inject`** 仅写入项目 `cursor-claw-admin` Skill，或**手动**从 `resources/template/` 复制；
- MCP Server 能力描述保持与 SDK-only 一致（dispatch 入站 + `send_text` 出站等），**不**恢复 poll-message 拉取。

**禁止扩散**：不改 README 其他章节（除非与 L46–57 同图不可分割的连线/图例）。

#### 3. 可选 KB 一句指针（知识同步）

实现后视需要**择一**补一句（勿重复展开）：

| 候选 | 建议落点 |
|------|----------|
| `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` | 「工作区注入」表或 `resources/template/rule/cursor-claw.mdc` 一句：模板仅供手动参考，SDK IM 不注入 |
| `electron/agent/shared/AGENTS.md` | `workspace-injector` 条目下增链至 `resources/template/rule/cursor-claw.mdc` Legacy 说明 |

若两处均已准确覆盖，可只在 `05-summary.md` 记录「KB 已一致，无需改」。

## 验收标准

1. `cursor-claw.mdc` 顶部含 Legacy 废弃说明；正文以 **dispatch 入站 + send_text/Presentation 出站** 为核心；**无** poll-message、阶段 4 Shell 保活、blocking poll 为主路径的表述。
2. 保留的 `send_text` 回复规则与群内 @ 协作条款仍完整可用；@ 协作的 meta 来源描述指向 dispatch/Presentation，**非** poll。
3. `README.md` L46–57 区域**不再**暗示自动注入 Rules 或运行时依赖 `cursor-claw.mdc`；与 no-op injector、`cursor-claw-admin`/手动 inject 可选口径一致。
4. **未修改** `src/`、`electron/` 业务代码（`AGENTS.md` 仅允许可选一句指针）。
5. **未触碰**进行中变更 `20260711232258-*`、`20260711232817-*` 目录与其实现范围。
6. （若执行 KB 同步）目标知识文件一句指针与模板/README 语义一致。

## 影响范围

| 范围 | 说明 |
|------|------|
| `resources/template/rule/cursor-claw.mdc` | Legacy 头 + SDK 通信约定改写 |
| `README.md` | L46–57 架构图区块 |
| `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` 或 `electron/agent/shared/AGENTS.md` | 可选一句指针（知识同步型） |

**明确不在范围**：

- Daemon / Electron **业务代码**（含 `workspace-injector.ts` 实现）
- `knowledge/变更/进行中/20260711232258-*`、`20260711232817-*`
- `knowledge/知识地图.md`、`knowledge/知识索引.md`（无入口变化则不更新）
- proto、数据库、权限、接口契约变更

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 三处文件边界与删除/保留清单明确（+0） |
| 修改范围 | 2 必改 + 0～1 可选 KB/AGENTS 指针（+0） |
| 接口契约 | 不变，仅文档对齐现网（+0） |
| 数据/权限 | 不变（+0） |
| 跨端联动 | 无（+0） |
| 知识库 | 知识同步型，0～1 处一句指针（+1） |
| 风险回滚 | 文档/模板回滚即可（+0） |
| **总分** | **1**，知识同步型 lite |

## 依据

| 文档 | 要点 |
|------|------|
| [`20260627162620-飞书作为Cursor展示与控制层/02-design.md`](../../归档/20260627162620-飞书作为Cursor展示与控制层/02-design.md) | S1.7 删除 poll/规则驱动；`cursor-claw.mdc` **不注入、不维护**；阶段 4 poll 保活由 Daemon 代码替代 |
| [`knowledge/业务域/Agent调度/03-启动与自动重连.md`](../../../业务域/Agent调度/03-启动与自动重连.md) | 长驻 Agent、dispatch/launch、Presentation 出站 |
| [`electron/agent/shared/AGENTS.md`](../../../../electron/agent/shared/AGENTS.md) L22 | `workspace-injector` no-op；禁止 launch 路径自动 inject |
| [`knowledge/工程平台/Electron桌面应用/04-配置与更新.md`](../../../工程平台/Electron桌面应用/04-配置与更新.md) | 自动注入废弃；`workspace:inject` 仅 admin Skill |

## 实现要点（供 kb-builder）

1. 改前读现网 `cursor-claw.mdc` 全文与 `README.md` L40–70；用 `codegraph_context` 核对 dispatch/`send_text`/Presentation 符号，**禁止**改代码。
2. 改写 `cursor-claw.mdc` 时控制单文件 ≤300 行（AGENTS.md 规矩）；超长则拆 Legacy 附录或精简重复禁令。
3. README 最小 diff，保持 ASCII 图宽度风格；可参考已归档 [`20260711232319-README架构图对齐SDK-only`](../../归档/20260711232319-README架构图对齐SDK-only/)。
4. KB 指针二选一或跳过，须在 `05-summary.md` 说明结论。
5. 验收后更新 manifest `tasks[0].status`、`files[]`。

## 外部登记

`kb.project.json` 未启用 `integrations.registry`，**跳过**外部登记。
