# Claude引擎改走spawn - 验收记录

> **变更 ID**：`20260716163001-Claude引擎改走spawn`
> **来源**：`/kb-test`（kb-recorder；基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T6 done；`04-review` **通过**（阻断 0）；本轮默认不重跑定向命令

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态/代码侧**（`04-review` 已证路径齐全）+ **手工运行态冒烟**（进程生命周期 / 失败诊断 / legacy） |
| **目标** | 覆盖 `01` 验收 1–5、`02` 八·（二）、`03` T1–T6；归档前补齐 stop/watchdog/错误二进制/`CC_LEGACY_QUERY` 运行态证据 |
| **与验收关系** | 主路径 spawn、pid 可观测、默认可诊断失败、legacy 门控、它引擎隔离 → 静态已对齐；杀进程与冷启动体感 → 手工 |
| **默认行为** | **不新增**单测/集成测/`auto_test` 脚手架；**不执行**全量 build/重验证；维护者按 §4.1 清单本地点验 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| stop / watchdog 后无僵尸子进程 | 需 Electron 真机 + 存活 CLI 子进程 + `ps`/`kill` 观测 | 自定义 spawn 与 SDK 默认信号细微差异（Linux/Windows） |
| 错误/缺失二进制 → 明确失败、无长期 processing | 依赖人为改路径或临时挪二进制；难做无副作用契约 | 文案不友好或异步 `error` 路径反馈偏晚 |
| `CC_LEGACY_QUERY=1` 一轮跑通 | 需设 env 重启应用；非默认路径 | legacy 门控回归时误当主路径 |
| **01·2** 冷启动毫秒级改善 | `04` 明确阈值留给 test；propose 不锁死毫秒 | 仅有 `cc_spawn pid=` 证据时体感改善难量化 |
| 会话列表/广播 `pid ≠ 0`（存活期） | 须运行中读 Dashboard/API；headless 无夹具 | 静态已改 `childPid ?? 0`，运行态仍待点验 |
| Cursor / Codex / OpenCode 端到端 | 本变更 diff 未触及其它引擎；全链路需各自通道 | 低（范围已静态确认） |
| 单元/集成测试 | 仓库规范不写 | 以 review + 手工冒烟为准 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **T1** | `childPid` / `spawnedProcess` 可选；勿序列化注释 | `04-review` 静态 | 类型字段 | ✅ 代码侧 |
| **T2** | spawn 适配 + `cc_spawn_enoent`/`failed` + 日志 `cc_spawn pid=` + kill 辅助 | `04-review` 静态 | 源码/路径 | ✅ 代码侧 |
| **T3** | 默认注入 spawn；`CC_LEGACY_QUERY` 不注入且 `legacy_query` 日志 | 静态 + §4.1 **E4** | 源码 + 手工 | ✅ / 📋 E4 |
| **T4** | `startCcSpawn`；同步失败 `{ok:false,error}`；stop kill；recover 对齐 | 静态 + §4.1 **E1/E2/E3** | 源码 + 手工 | ✅ / 📋 |
| **T5** | 广播/列表 `pid = childPid ?? 0`；idle 可为 0 | 静态 + §4.1 **E1** | 源码 + 手工 | ✅ / 📋 |
| **T6** | watchdog `onTimeout` → `killCcSpawnedProcess`；策略数值未改 | 静态 + §4.1 **E3** | 源码 + 手工 | ✅ / 📋 |
| **01·1** | 主路径为 spawn（非默认裸 query） | 静态注入 + E1 日志 | `cc_spawn pid=` | ✅ / 📋 |
| **01·2** | 冷启动可感知改善 | 同环境对比说明（不锁毫秒） | 手工观感/时间戳 | 📋 待点验 |
| **01·3** | 中断/失败可控可诊断 | E2/E3 | 错误文案 + 进程退出 | 📋 待点验 |
| **01·4** | 失败可诊断或显式 legacy | E2 默认失败；E4 legacy | launch error / legacy 日志 | 📋 待点验 |
| **01·5** | 其它引擎不受影响 | `04` diff 范围 + §4.1 **E5** | 静态 + 冒烟 | ✅ / 📋 |
| **02 八·（二）** | 日志 pid、错误二进制、legacy、stop/watchdog、它引擎、无预热 | 合成上表 + E1–E5 | 混合 | ✅ 代码；📋 运行态 |
| **硬约束** | 未引入 `startup(`/`WarmQuery`；未改预热变更目录 | `04-review` | review | ✅ |
| **04 建议** | 归档前冒烟 stop/watchdog/错误二进制/`CC_LEGACY_QUERY` | §4.1 E2–E4 | 手工 | 📋 待用户 |

## 4、场景摘要

### 4.1 归档前手工冒烟清单

**前置（共用）**：本地 Electron + Daemon 可跑；Claude 通道可用（API Key / CLI 二进制已配置，**勿写入文档**）；可观察 UI/`daemon.log` 中 `[CC]` 日志与会话列表 `pid`。

| 场景 ID | 前置 | 触发 | 期望现象 | 失败判责 |
|---------|------|------|----------|----------|
| **E1** 主路径 spawn + pid | 默认**未**设 `CC_LEGACY_QUERY`；新 Claude 会话 | launch/dispatch 一轮 | 日志含 `cc_spawn pid=`；进程存活期会话列表/广播 `pid ≠ 0`；终态后可为 0 | 无 pid 日志 → T2/T3/T4；列表恒 0 → T5 |
| **E2** 错误/缺失二进制 | 临时指向不存在路径或挪走二进制（测完恢复） | Claude launch | 返回明确 `error`（可含 `cc_spawn_enoent`/`cc_spawn_failed`）；用户侧有失败提示；**无**长期 processing 卡死；**不**静默走裸 query | 卡死/无反馈 → T4；静默成功 → legacy/门控回归 |
| **E3** stop / watchdog 杀进程 | E1 成功且记下 `childPid` | 用户 stop；或拉长空闲触发 watchdog | 子进程退出（无僵尸）；Query 关闭；会话可再启 | 僵尸残留 → T4/T6 kill；仅 close 未 kill |
| **E4** `CC_LEGACY_QUERY` | 设 `CC_LEGACY_QUERY=1` 后重启应用 | 跑通一轮 Claude | 日志含 `legacy_query`；**无**自定义 `cc_spawn pid=`（或等价「非主路径」标注）；对话可完成 | 仍强制自定义 spawn → T3 |
| **E5** 它引擎 spot | Cursor / Codex / OpenCode 各一轻量场景 | 各引擎一次 launch/短对话 | 行为与现网一致、无本变更连带失败 | 其它引擎目录被改 → 范围破坏（静态应已排除） |
| **E6** 冷启动观感（可选） | 同机同模型；可对比 `CC_LEGACY_QUERY=1` 与默认 spawn | 新会话首轮 | 有可说明的等待改善或至少 spawn 路径证据充分 | 仅体感争议 → 不阻断（01 未锁毫秒） |

### 4.2 静态已证路径（指针，不重跑）

| 检查项 | 指针 | 依据 |
|--------|------|------|
| 默认 `spawnClaudeCodeProcess` | `cc-query-options.ts` | `04` §5 T3 |
| `startCcSpawn` + recover | `agent-claude-sdk.ts` / `cc-run-recover.ts` | `04` §5 T4 |
| stop / watchdog kill | `stopClaudeCodeSession` / `armCcWatchdog.onTimeout` | `04` §5 T4/T6 |
| 广播/列表 pid | `broadcastCcSessionStatus` / `getClaudeCodeSessionList` | `04` §5 T5 |
| 无预热 API / 它引擎未改 | diff + 符号扫描 | `04` §1、§5 |

### 4.3 失败判责速查

| 现象 | 优先怀疑 |
|------|----------|
| 默认路径无 `cc_spawn pid=` | T3 未注入或误开 legacy |
| 错误二进制仍长期 processing | T4 同步失败未返回 / 通知过晚 |
| stop 后 CLI 仍存活 | T4 未调 `killCcSpawnedProcess` |
| watchdog 后僵尸 | T6 未挂接 kill |
| `CC_LEGACY_QUERY=1` 仍打 `cc_spawn` | T3 门控失效 |
| 它引擎异常 | 非本变更范围则查环境；若 diff 触及他引擎则范围回归 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | **无**（本期不新增契约脚本；进程杀灭与 CLI 依赖真机） |
| **运行依赖** | Electron 桌面 + Daemon；Claude Code CLI 二进制可解析（`resolveCcAgentBinaryPath`） |
| **环境变量名** | `CC_LEGACY_QUERY`（`1`/`true`/`yes` 开 legacy；默认关闭） |
| **清理** | E2 测完恢复二进制/路径；E4 测完取消 legacy 并重启；无库表写入 |

## 6、输出与记录规范

会话与本文**禁止**粘贴完整终端日志、token 或长段 JSON。§7 仅表格摘要：日期、环境、场景 ID、结果、备注（一词/短语）。失败时区分 **环境/CLI 缺失** vs **实现回归**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-16 | review | `04-review` 代码侧验收勾选 T1–T6 / 01·1·5 | 通过 | 阻断 0 |
| 2026-07-16 | — | E1 主路径 spawn + pid≠0 | 待用户 | 归档前建议 |
| 2026-07-16 | — | E2 错误二进制可诊断 | 待用户 | 归档前建议 |
| 2026-07-16 | — | E3 stop/watchdog 无僵尸 | 待用户 | 归档前建议 |
| 2026-07-16 | — | E4 `CC_LEGACY_QUERY=1` | 待用户 | 归档前建议 |
| 2026-07-16 | — | E5 它引擎 spot | 待用户 | 可选 spot |
| 2026-07-16 | — | E6 冷启动观感 | 待用户 | 不锁毫秒 |
