# CC 路径 watchdog 超时对称收尾与用户通知 - 验收记录

> **变更 ID**：`20260630100827-CC路径watchdog超时对称收尾与用户通知`
> **阶段**：`/kb-test` 静态+编译 ✅；`04-review` ✅；**第 1 轮验收打回**（`08-verify-issue`）→ **T6 已落地**；台架 K1–K10 ⏳（含 K6/K10 打回复测）
> **输入**：`01-proposal.md`、`02-design.md` §八·（二）、`03-tasks.md`（T1–T6 均 `done`）、`04-review.md`、`05-summary.md`、`08-verify-issue.md`（第 1 轮）
> **manifest**：`stage=archived_with_debt`（T6 静态 ✅；K6/K10 台架 debt；由 `/kb-archive` 迁移）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（源码符号/分支/行数对照 02/03）+ **编译冒烟**（builder：`npm run build:mcp`、`npx electron-vite build`）+ **台架/IM 联调**（空闲/绝对超时、hook 静默防误杀、双路径对称、Stop/非超时回归）；**不新增**单元测试/集成测试 |
| **目标** | 覆盖 `01` 验收 1–10、`02` §八·（二）6 条工程补充项、`03` T1–T6 各条验收标准（**T6** 对齐 08 第 1 轮打回） |
| **通过口径** | **第 2 轮验收前**：T6 静态 ✅；**K6/K10 台架必跑**（08 打回复测）。其余 K1–K5/K7–K9 可与打回复测并行或归档后 debt |
| **与 review 分工** | `/kb-review` 偏实现与规范；本文负责验收追溯、台架清单与执行记录 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·1–3**：空闲/绝对超时后 Run 结束、IM 一条提示、进度结束 | 依赖 Electron + Daemon + IM 通道全链；须真实 CC Profile 与 watchdog 计时 |
| **01·4 / F5**：超时后同会话 dispatch 无需 Stop/Reset | 须 IM 发消息观测 phase idle→claim；自动化无稳定 mock |
| **01·5**：CC 与 Cursor SDK 双路径超时感知对称 | 须分别触发两条引擎超时并对比 IM 文案/进度 |
| **01·6–7**：子 Agent/tool hook 静默期不误杀 | 须构造长跑工具或 subagent 任务；可用缩短 `CC_IDLE_TIMEOUT_MS` 台架，无法 headless 稳定复现 |
| **01·9–10**：主动 Stop、非超时 error 回归 | 依赖用户操作与 SDK error 语义；静态可证分支分离，行为须手工 |
| **§8.2·2**：`lastActivityAt` 1s 内更新 | 须 runtime 观测 session 字段或 UI 日志时间戳 |
| **`auto_test/` 脚本** | 本期未新增；以编译 + 静态 + 台架清单为主 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** | 空闲/绝对超时后数秒内 Run 结束；不长期 processing | 静态 + 台架 K1/K2 | 代码 / 联调 | ✅ 静态；⏳ **台架待跑** |
| **01·2** | 两种超时 IM **各一条** 简体中文友好提示；无内部日志/重复 notify | 静态 + 台架 K3 | 代码 / IM | ✅ 静态；⏳ 台架 |
| **01·3** | 超时后「处理中/流式占位」结束 | 台架 K1/K3 | 联调 | ⏳ 台架 |
| **01·4** | 超时后同会话发新消息，无需 Stop/Reset | **台架 K4（核心）** | 联调 | ⏳ **必测待跑** |
| **01·5** | CC 与 SDK 路径超时用户感知对称（抽样） | 台架 K5 | 联调 | ⏳ 台架 |
| **01·6** | hook/工具活动下合理窗口内不误杀 idle | 静态 + 台架 K6/K10 | 代码 / 联调 | ✅ 静态 T6；⏳ **K6/K10 复测待跑** |
| **01·7** | hook 触发期间 `lastActivityAt` 持续刷新 | 静态 + 台架 K6/K7 | 代码 / 联调 | ✅ 静态；⏳ 台架 |
| **01·8** | UI 日志 CC 前缀含 `hook_event` 等；**无** hook 原文推 IM | 静态 + 台架 K7 | 代码 / 日志 | ✅ 静态；⏳ 台架 |
| **01·9** | 主动 Stop 无回归；不误走超时文案 | 静态 + 台架 K8 | 代码 / 手工 | ✅ 静态；⏳ 手工 |
| **01·10** | 非超时 error 仍通用失败路径；不误用超时句 | 静态 + 台架 K9 | 代码 / 联调 | ✅ 静态；⏳ 联调 |
| **§8.2·1** | `buildQueryOptions` 含 `hooks` + `includeHookEvents: true` | 静态 §4.2 | 源码 | ✅ 静态 |
| **§8.2·2** | hook 后 1s 内 `lastActivityAt` 更新；5min 内不误杀 | 台架 K6/K7 | 联调 | ⏳ 台架 |
| **§8.2·3** | UI 日志字段；IM 无 hook 原文 | 静态 + K7 | 代码 / 日志 | ✅ 静态；⏳ K7 |
| **§8.2·4** | 超时 IM 一条 + `stop_progress`；无 `failedCooldowns` | 静态 + K3/K4 | 代码 / 联调 | ✅ 静态；⏳ 联调 |
| **§8.2·5** | 超时后 dispatch/launch 成功 | 台架 K4 | 联调 | ⏳ **核心待跑** |
| **§8.2·6** | `stopClaudeCodeSession` 不走超时文案 | 静态 + K8 | 代码 / 手工 | ✅ 静态；⏳ K8 |
| **T1** | `watchdogTimedOut?: boolean`；可选不破坏构造 | 静态 | 源码 | ✅ 静态 |
| **T2** | `buildCcSdkHooks` 三项 hook；`markActivity` + UI 日志 | 静态 | 源码 | ✅ 静态 |
| **T3** | `buildQueryOptions` 注入 hooks | 静态 | 源码 | ✅ 静态 |
| **T4** | hook 流 subtype；`onTimeout` 置位后 close | 静态 | 源码 | ✅ 静态 |
| **T5** | `finalizeCcRunOnWatchdogTimeout`；跳过 cooldown | 静态 | 源码 | ✅ 静态 |
| **T6** | idle/absolute 解耦；`NEVER_CANCEL_ON_DURATION` 默认 true → guard L73 不硬杀 | 静态 + 台架 K10/K6 | 代码 / 联调 | ✅ 静态；⏳ **台架待跑** |
| **T6·08打回** | hook 持续活动 >5min 不因 guard `timeoutMs` 绝对分支强杀 | 台架 **K10** | 联调 | ⏳ **逻辑对齐 SDK，待 E2E** |
| **T6·idle** | 无 hook/assistant 活动仍 `CC_IDLE_TIMEOUT_MS` idle 超时 | 台架 **K6 复测** | 联调 | ⏳ **待用户台架** |
| **行数约束** | 改动文件均 ≤300 行 | wc | 命令 | ✅ 通过 |

## 4、场景摘要

### 4.1 台架/IM 必测清单（优先）

| 场景 ID | 前置 | 步骤摘要 | 期望 | 关联 |
|---------|------|----------|------|------|
| **K1 空闲超时收尾** | Claude Profile IM 通道；可选 `CC_IDLE_TIMEOUT_MS=60000` | 发起任务后 **抑制 assistant 输出**（或等待无 IM 可见活动 ≥ idle 阈值） | 数秒内 Query close；UI WARN「watchdog 超时」；通道「处理中」结束 | 01·1/3、T4 |
| **K2 绝对时长超时** | 同上；默认 idle=absolute=300s（或同步缩短 env） | 持续有 hook/assistant 活动至 absolute 上限 | 同样走超时专分支（非 generic error） | 01·1、T5 |
| **K3 IM 超时文案** | K1 或 K2 触发 | 查 IM notify 条数与文案 | **一条**「会话因等待超时已退出…」类句；`stop_progress`；无 stack/内部字段 | 01·2、§8.2·4 |
| **K4 稍后发消息（核心）** | K3 完成后 | **不** Stop/Reset；同会话发新消息 | 新 Run 正常；无 `dispatch_failed`/冷却拒绝 | 01·4、§8.2·5、F5 |
| **K5 双路径对称（抽样）** | 可对照 Cursor SDK Profile | 各触发一次超时 | 均有友好说明 + 进度结束 + 可续聊 | 01·5 |
| **K6 hook 静默不误杀** | 含 subagent 或多步 tool 的长任务 | 通道长时间无 assistant 输出但 hook 持续 | 默认 5min（或缩短 env 后等效窗口）内 **不** idle 误杀 | 01·6/7、§8.2·2 |
| **K7 hook UI 日志** | K6 或任意含 tool/subagent 任务 | 查 Agent 面板 CC 日志 | 含 `hook_event=`；回调路径另含 `agent_type=` 或 `tool_name=`；IM **无** hook 原文 | 01·8、§8.2·3 |
| **K8 主动 Stop 回归** | processing 中 | 用户 Stop | 行为与变更前一致；**未**置 `watchdogTimedOut`；**无**超时专用 IM | 01·9、§8.2·6 |
| **K9 非超时 error 回归** | 故意触发 tool/权限类失败 | 观察 notify 与 cooldown | 通用失败文案 + `setFailedCooldown`；**非**超时句 | 01·10、§8.2·6 |

**台架加速**：设置 `CC_IDLE_TIMEOUT_MS`（或 `SDK_IDLE_TIMEOUT_MS`）为 30s–120s 可缩短 K1/K6 等待；**勿**在生产通道使用。

### 4.2 静态/编译（已执行或 kb-test 复核）

| 检查 | 落点 | 期望 | 结果 |
|------|------|------|------|
| 超时标记字段 | `agent-cc-types.ts` `watchdogTimedOut?` | 可选布尔；JSDoc 注明置位/消费 | ✅ |
| hooks 工厂 | `cc-sdk-hooks.ts` | SubagentStart/PreToolUse/PostToolUse；`return { continue: true }` | ✅ |
| hook 无 IM | `cc-sdk-hooks.ts` | 无 `notifySessionChat` | ✅ |
| query options | `agent-claude-sdk.ts` `buildQueryOptions` | `hooks` + `includeHookEvents: true` | ✅ |
| hook 流事件 | `agent-cc-events.ts` `handleSdkMessage` | `hook_started/progress/response` → `markActivity` + UI 日志 | ✅ |
| watchdog 置位 | `agent-cc-events.ts` `armCcWatchdog.onTimeout` | 先 `watchdogTimedOut=true` 再 `close()` | ✅ |
| 超时收尾 | `agent-cc-stream.ts` + `cc-watchdog-finalize.ts` | 超时分支调用 finalizer；error 分支仍 `setFailedCooldown` | ✅ |
| 超时文案复用 | `cc-watchdog-finalize.ts` | `formatUserSdkFailureMessage({ isTimeoutFailure: true })` | ✅ |
| 幂等 notify | `finalizeCcRunOnWatchdogTimeout` | `errorNotified` 闩；仅一次 notify | ✅ |
| Stop 路径 | `stopClaudeCodeSession` | 不置 `watchdogTimedOut`；直接 abort/删 session | ✅ |
| HTTP 契约 | `agent-cc-http.ts` | 本变更无 diff | ✅（静态） |
| 行数 | 改动 6 文件 wc -l | 均 ≤300 | ✅（61/246/292/17/277/86） |
| TS 类型检查 | `npx tsc --noEmit` | exit 0 | ✅ 04-review；✅ T6 builder 复跑 |
| MCP 编译 | `npm run build:mcp` | exit 0 | ✅ builder |
| Electron 构建 | `npx electron-vite build` | exit 0 | ✅ builder |

### 4.3 第 1 轮验收打回修复（T6）

> **背景**：`08-verify-issue` 第 1 轮 — hook 活动下 Run 仍约 5min 被 `agent-run-guard` L73–75 绝对时长硬杀（`timeoutMs=absoluteTimeoutMs` 与 idle 同值 300s）。kb-builder 已落地 T6：CC 对齐 SDK `NEVER_CANCEL_ON_DURATION`（默认 true）；`armCcWatchdog` 在 never-cancel 时 `timeoutMs=Number.MAX_SAFE_INTEGER`；absolute 独立 env（`CC_ABSOLUTE_TIMEOUT_MS` 等，默认 7min，**≠ idle**）。

| 场景 ID | 前置 | 步骤摘要 | 期望 | 关联 | 状态 |
|---------|------|----------|------|------|------|
| **K10 hook+guard L73（T6 专项）** | Claude Profile；`NEVER_CANCEL_ON_DURATION` 默认或未设；含 subagent/多步 tool 长跑 | 持续 hook/工具活动 **>5min**（或缩短 idle env 后等效窗口，但 **满 5min 总时长**） | Run **不**因 guard L73 `startedAt` 绝对分支终止；UI **无**「watchdog 超时」WARN（除非 idle 真触发） | 08 打回、`01·6/7`、场景 D、T6 | ⏳ **逻辑对齐 SDK，待 E2E** |
| **K6 复测 idle 仍超时** | 同上；可选 `CC_IDLE_TIMEOUT_MS=60000` | **抑制** hook 与 assistant 输出，等待 ≥ idle 阈值 | 仍走 idle 分支 → draining → timeout 专收尾；IM 一条超时提示 | `01·6`（负例）、T6 idle 路径 | ⏳ **待用户台架** |

**编号说明**：§4.1 已占用 **K8**（主动 Stop 回归）；T6 打回专项 hook+guard 场景续编为 **K10**（等价于打回描述之 hook 持续活动验收）。

**静态已验（T6）**：

| 检查 | 落点 | 期望 | 结果 |
|------|------|------|------|
| never-cancel 常量 | `agent-claude-sdk.ts` | 与 SDK 同源 env；默认 true | ✅ |
| absolute 与 idle 解耦 | `agent-claude-sdk.ts` | `WATCHDOG_ABSOLUTE_TIMEOUT_MS` ≠ idle 默认；独立 env 链 | ✅ |
| guard timeoutMs | `agent-cc-events.ts` `armCcWatchdog` | never-cancel → `Number.MAX_SAFE_INTEGER`；关闭时在 onTick 判 absolute | ✅ |
| TS 类型检查 | `npx tsc --noEmit` | exit 0 | ✅ builder |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **脚本目录** | 本期无 `auto_test/` 新增 |
| **运行依赖** | Electron dev/打包 + `src/daemon`；Claude Profile（`ANTHROPIC_API_KEY`）；IM 通道 |
| **环境变量** | `CC_IDLE_TIMEOUT_MS` / `SDK_IDLE_TIMEOUT_MS`（台架缩短 idle）；`CC_RESIDENT_AGENT`（resident 续跑 K4）；`DAEMON_PORT`；通道 `LARK_*` / `WECHAT_*` — **勿写入真实密钥** |
| **观测点** | Agent 面板 CC 日志（hook_event）；IM notify 条数；Daemon phase idle |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 台架失败区分：**env/操作** vs **watchdog 阈值** vs **SDK hook 未触发**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-06-30 | 本地 dev | `npm run build:mcp` | 通过 | builder |
| 2026-06-30 | 本地 dev | `npx electron-vite build` | 通过 | builder |
| 2026-06-30 | 本地 dev | 静态 §4.2（T1–T5 符号/分支/行数） | 通过 | kb-test |
| 2026-06-30 | 本地 dev | `npx tsc --noEmit` | 通过 | 04-review |
| 2026-06-30 | — | archive 决策 | `accepted_debt` | 静态+编译完成；K1–K9 不阻塞归档 |
| 2026-06-30 | — | **T6 归档决策** | `accepted_debt` | T6 静态闭环；K6/K10 台架 debt 不阻塞 mv |
| 2026-06-30 | — | K1 空闲超时收尾 | 待执行 | **台架 debt** |
| 2026-06-30 | — | K2 绝对时长超时 | 待执行 | 台架 debt |
| 2026-06-30 | — | **K3 IM 超时文案** | 待执行 | 台架 debt |
| 2026-06-30 | — | **K4 稍后发消息** | 待执行 | **核心 debt** |
| 2026-06-30 | — | K5 双路径对称 | 待执行 | 抽样 debt |
| 2026-06-30 | — | **K6 hook 静默不误杀** | 待执行 | **台架 debt** |
| 2026-06-30 | — | K7 hook UI 日志 | 待执行 | 台架 debt |
| 2026-06-30 | — | K8 主动 Stop 回归 | 待执行 | 手工 debt |
| 2026-06-30 | — | K9 非超时 error 回归 | 待执行 | 联调 debt |
| 2026-06-30 | 本地 dev | `npx tsc --noEmit`（T6 修复后） | 通过 | builder；exit 0 |
| 2026-06-30 | 本地 dev | 静态 §4.3（T6 never-cancel / absolute 解耦） | 通过 | kb-recorder |
| 2026-06-30 | — | **K10** hook+guard L73 >5min 不误杀 | 待执行 | **逻辑对齐 SDK，待 E2E** |
| 2026-06-30 | — | **K6 复测** idle 无活动仍超时 | 待执行 | **待用户台架** |

## 8、归档结论

| 项 | 结论 |
|----|------|
| **04-review** | ✅ 通过（T1–T5；见 `04-review.md` §9） |
| **08 第 1 轮** | ❌ 打回（hook+absolute 未解耦）→ **T6 已修复**（静态 ✅） |
| **静态契约** | ✅ T1–T6、§8.2·1/3/4/6、行数约束（§3、§4.2–4.3） |
| **编译冒烟** | ✅ `npx tsc --noEmit`（含 T6 复跑）、`npm run build:mcp`、`npx electron-vite build`（§7） |
| **台架 K6/K10（打回复测）** | ⏳ **阻塞第 2 轮验收** — K10（guard L73 不误杀）、K6（idle 仍超时）须 Electron + Daemon 补跑 |
| **台架 K1–K5/K7–K9** | ⏳ debt — 与 T6 正交；可并行或归档后补跑 |
| **manifest stage** | `archived_with_debt`（T6 静态闭环；K1–K10 台架 debt，见 05 §5） |

**债务说明**：第 1 轮打回根因已静态闭环（T6）；**K10** 验证 hook 持续活动不因 guard L73 硬杀；**K6 复测**验证 idle 负例仍超时。其余 K1–K9 覆盖 01·1–8 运行时 IM 行为、§8.2·2/5 与 F5 同会话续聊。

**归档准入**：**accepted_debt** — 静态 + T6 编译已就绪；K6/K10 及 K1–K9 台架不阻塞 `/kb-archive` 迁移（由 kb-release 执行 mv/commit）。
