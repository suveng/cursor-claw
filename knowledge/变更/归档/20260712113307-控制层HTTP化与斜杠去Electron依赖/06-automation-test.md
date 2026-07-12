# 控制层HTTP化与斜杠去Electron依赖 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` AC1–AC5、`03-tasks.md` T1–T6、`04-review.md` R1–R3
> **评审结论**：focused-review 无严重项；警告 R1/R2、信息 R3 仍 open

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 手工冒烟（飞书 IM + 菜单）为主；HTTP 契约 curl 为辅；**不**跑全量单测/集成测 |
| **目标** | 验证 Daemon 斜杠 SSOT、Electron 同步转发、MCP HTTP 对齐及 T8 `/merge` 划界 |
| **与验收关系** | 每条场景对应 `03` 任务验收或 `01` AC；`04` 重点项单独标 **重点** |
| **默认执行** | 本文仅写策略与清单；**执行记录待维护者本地补行**（见 §7） |
| **轻量静态** | 已核对 5 个新文件行数均 ≤300（`command-executor` 245、`daemon-slash-executor` 155 等）；`04` 调用链静态 ✅ |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 飞书真实 IM 端到端 | 需已配置飞书 Bot、授权通道；无 CI 凭据 | 路由/门控 G1 仅静态核对 |
| Electron 主进程启停时序 | 需本地桌面进程与 `agent-api-port.json` | AC3 重启窗口须手工 |
| `dual` 模式 5s poll 竞态 | 需刻意压测 claim 与 HTTP 执行交错 | R3：短窗口双回复（迁移期） |
| MCP 健康列与现网一致 | Electron 缺 `POST /api/mcp/status-map` | R2：健康恒「未知」+ `healthError` |
| `slash_exec.source` 字段 | 实现缺口 | R1：排障可观测性降级 |
| `daemon`/`electron` 模式全矩阵 | 场景多、副作用大 | 冒烟以 `daemon` + `dual` 为主 |
| 卡片 / Agent dispatch 回归 | 非斜杠主路径 | AC5 依赖人工 spot-check |

## 3、验收追溯表

| ID | 验收摘要（03/01/02·八·二） | 验证方式 | 证据类型 | 04 状态 |
|----|---------------------------|----------|----------|---------|
| T1 | `executeFileCommand` 覆盖原 poll 分支 | 静态 + Electron 运行 `POST /api/command/execute` `/help` | 响应 `{ok,message}` | ✅ 静态 |
| T1 | poll `shouldSkipCommand` / dedup 钩子 | `dual` 下同 messageId 观察回复次数 | 飞书条数 / 日志 | ⚠️ R3 |
| T2 | `POST /api/command/execute` 3s 内返回 | curl 或飞书 `/help`（Electron 运行） | HTTP 200 + body | 待执行 |
| T2 | Electron 未监听 503/等价错误 | 停 Electron 后 Daemon 转发 `/stop` | 中文 `message` | **重点** 待执行 |
| T3 | `/api/mcp` enable/disable/info | `POST /api/mcp` 或 `/mcp ls` | JSON + 飞书文案 | 待执行 |
| T3 | `manage_mcp` HTTP 对齐 | admin MCP 工具 list/enable | 工具返回 | 待执行 |
| T3 | 健康转发失败非静默 | `/mcp ls` 健康列 | 含 `healthError` 中文 | ⚠️ R2 降级 |
| T4 | `daemon` 模式 `/status` 不经 claim | `SLASH_EXEC_MODE=daemon`，Electron 未 claim | 3s 内飞书回复 | **重点** 待执行 |
| T4 | Electron 退出 `/help` 可回、`/stop` 中文 | 停 Electron | 文案含「应用未运行」类 | **重点** 待执行 |
| T4 | 不处理 `/merge` | 与 `/status` 同会话连发 | 各一条、无交叉 | **重点** 待执行 |
| T4 | `slash_exec` 日志 | Daemon 日志 | JSON 含 command/message_id/mode/ok | ⚠️ R1 缺 source |
| T5 | `SLASH_EXEC_MODE` 三态 | env 切换 smoke | 行为符合模式表 | 待执行 |
| T5 | `dual` 同 messageId 不双回复 | 单条斜杠 | 仅 1 条回复 | **重点** 待执行 |
| T5 | 未授权 G1 拒绝 | 未 @Bot 发斜杠 | 与现网一致拒绝 | 待执行 |
| T6 | 菜单 `cmd_status` 等价斜杠 | 点菜单 | 不经 5s poll | 待执行 |
| T6 | admin stop/restart/reset 同步 | `POST /api/agent` | 非仅 queued | 待执行 |
| AC1 | 主路径 Electron 未 claim 仍可完成 | 合成 T4/T5 | 飞书 | **重点** |
| AC2 | `/mcp` 经 Daemon HTTP 可比现网 | 合成 T3/T4 | HTTP+飞书 | ⚠️ 健康列 |
| AC3 | Electron 重启窗口不静默丢失 | 重启 Electron 期间发斜杠 | 有回复或明确错误 | 待执行 |
| AC4 | 未授权可理解拒绝 | G1 + Electron 未就绪文案 | 飞书/HTTP | **重点** |
| AC5 | 卡片与 Agent 无回归 | `/merge` 不动；dispatch spot-check | 人工 | 静态 ✅ |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| Daemon | 已启动；`localDaemonUrl` 可访问 admin HTTP |
| 飞书 | Bot 已授权测试群/私聊；可 @Bot 发斜杠 |
| Electron | 可独立启停；`agent-api-port.json` 可读 |
| 环境变量 | `SLASH_EXEC_MODE`：`daemon`（重点）、`dual`（dedup）、可选 `electron`（回滚） |
| 凭据 | **勿**写入本文；用「已配置」描述 |

### 4.2 手工冒烟清单（按 04 建议排序）

| # | 场景 | 前置 | 操作 | 期望 | 关联 |
|---|------|------|------|------|------|
| S1 | Daemon 本地斜杠 | `SLASH_EXEC_MODE=daemon`；Electron **未** claim/未运行 | 飞书发 `/status` | ≤3s 收到状态文案 | AC1、T4 **重点** |
| S2 | 本地 help | 同上 | `/help` | 帮助文本；不依赖 Electron | AC1、T4 **重点** |
| S3 | Electron 依赖失败文案 | Electron 退出 | `/stop` | `{ok:false}` 或飞书「应用未运行」类中文；非挂死 | AC4、T2/T4 **重点** |
| S4 | MCP 列表 | Electron 运行/退出各一次 | `/mcp ls` | 列表可读；健康列：运行时为「未知」+ 错误提示（R2）或修复后正常 | AC2、T3、R2 |
| S5 | MCP enable | 测试 MCP 名 | `/mcp enable <名>` | 与现网配置语义一致 | AC2、T3 |
| S6 | merge 划界 | T8 分支已存在 | 同会话 `/merge`（若可用）再 `/status` | 各独立回复、无状态交叉 | T4、T8 **重点** |
| S7 | dual 去重 | `SLASH_EXEC_MODE=dual` | 单条 `/status` | 仅 1 条回复；日志无重复 `reportCommandResult` | T5、R3 **重点** |
| S8 | 菜单等价 | `dual` 或 `daemon` | 点 `cmd_status` | 与 S1 同类文案；无 5s 延迟 | T6、AC5 |
| S9 | admin agent | Daemon admin | `POST /api/agent` action=stop（Electron 退出） | 同步中文错误非 queued | T6、AC2 |
| S10 | HTTP 契约 | Electron 运行 | `curl -X POST …/api/command/execute` body `/help` | 3s 内 `{ok,message}` | T2 |
| S11 | 未授权 | 未 @Bot | 发 `/status` | 拒绝；提示可理解 | AC4、T5 |

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| 完全无回复 | Daemon 未跑 / 飞书门控 / 网络 |
| 60s 后才有回复 | 仍走 poll-only（检查 `SLASH_EXEC_MODE=electron`） |
| 双条相同内容 | `dual` + R3 竞态；或 dedup 未生效 |
| MCP 健康全未知 | R2 已知缺口，非配置 CRUD 失败 |
| `/merge` 被通用执行器处理 | T8 回归，属阻断缺陷 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/` | **本期未新增**；冒烟依赖 §4.2 手工步骤 |
| 可选 curl | `POST {agent-api}/api/command/execute`；`POST {daemon}/api/mcp` |
| 环境变量名 | `SLASH_EXEC_MODE`、`DAEMON_HTTP_PORT`（以项目实际为准） |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端日志；§7 备注列仅用结论性短语（如「S1 通过」「R2 健康未知符合预期」）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地静态 | 新文件行数 + `04` 调用链核对 | 通过 | 未跑运行时冒烟 |
| — | — | S1–S11 手工清单 | 待执行 | 维护者补行 |
