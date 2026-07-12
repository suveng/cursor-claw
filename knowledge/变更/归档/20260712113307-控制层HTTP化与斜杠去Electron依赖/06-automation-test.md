# 控制层HTTP化与斜杠去Electron依赖 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` AC1–AC5、`03-tasks.md` T1–T6 + T-FIX-01～03、`04-review.md` R1–R3（均已 fixed）
> **评审结论**：focused-review 无严重项；R1/R2/R3 债务已修复，静态复验通过

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 手工冒烟（飞书 IM + 菜单）为主；HTTP 契约 curl 为辅；**不**跑全量单测/集成测 |
| **目标** | 验证 Daemon 斜杠 SSOT、Electron 同步转发、MCP HTTP 对齐及 T8 `/merge` 划界 |
| **与验收关系** | 每条场景对应 `03` 任务验收或 `01` AC；`04` 重点项单独标 **重点** |
| **本期执行** | T-FIX 静态 grep + `tsc`；S1–S11 运行时因无飞书/Electron 实例标 **待实机** |
| **轻量静态** | 新文件行数 ≤300；调用链与 R1/R2/R3 修复点已核对 ✅ |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 飞书真实 IM 端到端（S1/S2/S7/S11） | 无已配置飞书 Bot 凭据；Daemon 未运行 | G1 门控与 dual dedup 仅静态接线 |
| Electron 主进程启停时序（S3/S10） | 本地无 Electron 进程；`agent-api-port.json` 不存在 | AC3/AC4 失败文案须实机确认 |
| `dual` 模式 poll 竞态（S7） | 需 dual + 飞书 + Electron poll 联调 | R3 skip-check 已静态接线，运行时待证 |
| MCP 健康列运行时（S4/S5） | agent-api 未监听；无 MCP 测试配置 | R2 status-map 路由已注册，健康列待 curl |
| 卡片 / Agent dispatch 回归（AC5） | 非斜杠主路径 | 静态划界 ✅；spot-check 待实机 |
| `daemon`/`electron` 模式全矩阵（S5/S8/S9） | 场景多、需全链路 | 冒烟以 `daemon` + `dual` 为主 |

## 3、验收追溯表

| ID | 验收摘要（03/01/02·八·二） | 验证方式 | 证据类型 | 状态 |
|----|---------------------------|----------|----------|------|
| T1 | `executeFileCommand` 覆盖原 poll 分支 | 静态 + Electron `POST /api/command/execute` `/help` | 响应 `{ok,message}` | ✅ 静态 |
| T1 | poll `shouldSkipCommand` / dedup 钩子 | `dual` 下同 messageId 观察回复次数 | 飞书条数 / 日志 | ✅ 静态（R3 接线） |
| T2 | `POST /api/command/execute` 3s 内返回 | curl 或飞书 `/help`（Electron 运行） | HTTP 200 + body | ⚠️ 待实机 S10 |
| T2 | Electron 未监听 503/等价错误 | 停 Electron 后 Daemon 转发 `/stop` | 中文 `message` | ⚠️ 待实机 S3 |
| T3 | `/api/mcp` enable/disable/info | `POST /api/mcp` 或 `/mcp ls` | JSON + 飞书文案 | ⚠️ 待实机 S4/S5 |
| T3 | `manage_mcp` HTTP 对齐 | admin MCP 工具 list/enable | 工具返回 | ⚠️ 待实机 |
| T3 | 健康转发闭环 | `/mcp ls` 健康列 | status-map 对接 | ✅ 静态 R2；运行时待 S4 |
| T4 | `daemon` 模式 `/status` 不经 claim | `SLASH_EXEC_MODE=daemon`，Electron 未 claim | 3s 内飞书回复 | ⚠️ 待实机 S1 **重点** |
| T4 | Electron 退出 `/help` 可回、`/stop` 中文 | 停 Electron | 文案含「应用未运行」类 | ⚠️ 待实机 S3 **重点** |
| T4 | 不处理 `/merge` | 与 `/status` 同会话连发 | 各一条、无交叉 | ✅ 静态 S6 **重点** |
| T4 | `slash_exec` 日志 | Daemon 日志 | JSON 含 source+exec_path | ✅ 静态 R1 |
| T5 | `SLASH_EXEC_MODE` 三态 | env 切换 smoke | 行为符合模式表 | ⚠️ 待实机 |
| T5 | `dual` 同 messageId 不双回复 | 单条斜杠 | 仅 1 条回复 | ⚠️ 待实机 S7 **重点** |
| T5 | 未授权 G1 拒绝 | 未 @Bot 发斜杠 | 与现网一致拒绝 | ⚠️ 待实机 S11 |
| T6 | 菜单 `cmd_status` 等价斜杠 | 点菜单 | 不经 5s poll | ⚠️ 待实机 S8 |
| T6 | admin stop/restart/reset 同步 | `POST /api/agent` | 非仅 queued | ⚠️ 待实机 S9 |
| AC1 | 主路径 Electron 未 claim 仍可完成 | 合成 T4/T5 | 飞书 | ⚠️ 待实机 S1/S2 |
| AC2 | `/mcp` 经 Daemon HTTP 可比现网 | 合成 T3/T4 | HTTP+飞书 | ⚠️ 待实机 |
| AC3 | Electron 重启窗口不静默丢失 | 重启 Electron 期间发斜杠 | 有回复或明确错误 | ⚠️ 待实机 |
| AC4 | 未授权可理解拒绝 | G1 + Electron 未就绪文案 | 飞书/HTTP | ⚠️ 待实机 S3/S11 |
| AC5 | 卡片与 Agent 无回归 | `/merge` 不动；dispatch spot-check | 人工 | ✅ 静态 |
| T-FIX-01 | `channelSource` + `source`/`exec_path` 日志 | grep + 签名 | 源码 | ✅ |
| T-FIX-02 | `POST /api/mcp/status-map` 注册 | grep + 路由 | 源码 | ✅ |
| T-FIX-03 | claim 前 `GET /commands/skip-check` | grep + 路由 | 源码 | ✅ |

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

| # | 场景 | 前置 | 操作 | 期望 | 关联 | 本期 |
|---|------|------|------|------|------|------|
| S1 | Daemon 本地斜杠 | `SLASH_EXEC_MODE=daemon`；Electron **未** claim/未运行 | 飞书发 `/status` | ≤3s 收到状态文案 | AC1、T4 **重点** | 待实机 |
| S2 | 本地 help | 同上 | `/help` | 帮助文本；不依赖 Electron | AC1、T4 **重点** | 待实机 |
| S3 | Electron 依赖失败文案 | Electron 退出 | `/stop` | `{ok:false}` 或飞书「应用未运行」类中文；非挂死 | AC4、T2/T4 **重点** | 待实机 |
| S4 | MCP 列表 | Electron 运行/退出各一次 | `/mcp ls` | 列表可读；健康列非「未知」（R2 修复后） | AC2、T3 | 待实机 |
| S5 | MCP enable | 测试 MCP 名 | `/mcp enable <名>` | 与现网配置语义一致 | AC2、T3 | 待实机 |
| S6 | merge 划界 | T8 分支已存在 | 同会话 `/merge`（若可用）再 `/status` | 各独立回复、无状态交叉 | T4、T8 **重点** | ✅ 静态 |
| S7 | dual 去重 | `SLASH_EXEC_MODE=dual` | 单条 `/status` | 仅 1 条回复；日志无重复 `reportCommandResult` | T5、R3 **重点** | 待实机 |
| S8 | 菜单等价 | `dual` 或 `daemon` | 点 `cmd_status` | 与 S1 同类文案；无 5s 延迟 | T6、AC5 | 待实机 |
| S9 | admin agent | Daemon admin | `POST /api/agent` action=stop（Electron 退出） | 同步中文错误非 queued | T6、AC2 | 待实机 |
| S10 | HTTP 契约 | Electron 运行 | `curl -X POST …/api/command/execute` body `/help` | 3s 内 `{ok,message}` | T2 | 待实机 |
| S11 | 未授权 | 未 @Bot | 发 `/status` | 拒绝；提示可理解 | AC4、T5 | 待实机 |

**S6 静态证据**：`daemon.ts` `tryHandleMergeSlashCommand` 前置分支（T8）；`daemon-slash-executor.ts` `shouldSkipSlashCommand` double-guard 忽略 `/merge` 与 `merge_*`。

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| 完全无回复 | Daemon 未跑 / 飞书门控 / 网络 |
| 60s 后才有回复 | 仍走 poll-only（检查 `SLASH_EXEC_MODE=electron`） |
| 双条相同内容 | `dual` + dedup 未生效；查 skip-check 日志 |
| MCP 健康全未知 | R2 已修复；若仍未知查 Electron 是否运行 |
| `/merge` 被通用执行器处理 | T8 回归，属阻断缺陷 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/` | **本期未新增**；冒烟依赖 §4.2 手工步骤 |
| 可选 curl | `POST {agent-api}/api/command/execute`；`POST {agent-api}/api/mcp/status-map`；`POST {daemon}/api/mcp` |
| 环境变量名 | `SLASH_EXEC_MODE`、`DAEMON_HTTP_PORT`（以项目实际为准） |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端日志；§7 备注列仅用结论性短语（如「S1 通过」「R2 静态通过」）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地静态 | 新文件行数 + `04` 调用链核对 | 通过 | 初版静态 |
| 2026-07-12 | 本地静态 | T-FIX-01 R1：grep `channelSource`/`exec_path`/`source` | 通过 | slash-executor + daemon.ts 下传 im\|menu |
| 2026-07-12 | 本地静态 | T-FIX-02 R2：grep `/api/mcp/status-map` + `getMcpStatusMap` | 通过 | agent-sdk-http L221-233 |
| 2026-07-12 | 本地静态 | T-FIX-03 R3：grep `skip-check` claim 前调用 | 通过 | daemon-manager L963-968；路由 daemon L1716-1720 |
| 2026-07-12 | 本地静态 | `tsc --noEmit -p tsconfig.json` | 通过 | src 域无编译错误 |
| 2026-07-12 | 本地静态 | S6 merge 划界 double-guard | 通过 | T8 前置 + executor shouldSkipSlashCommand |
| 2026-07-12 | 无服务 | S1 daemon `/status` 飞书 | 待实机 | 无飞书 Bot + Daemon 未运行 |
| 2026-07-12 | 无服务 | S2 daemon `/help` 飞书 | 待实机 | 同上 |
| 2026-07-12 | 无服务 | S3 Electron 退出 `/stop` 文案 | 待实机 | Electron 未启动；无 agent-api-port.json |
| 2026-07-12 | 无服务 | S7 dual 单条去重 | 待实机 | 需 dual+飞书+Electron poll 联调 |
| 2026-07-12 | 无服务 | S10 curl command/execute | 待实机 | agent-api 未监听（curl 000） |
| 2026-07-12 | 无服务 | S4/S5/S8/S9/S11 | 待实机 | 需飞书+Daemon+Electron 全链路 |
