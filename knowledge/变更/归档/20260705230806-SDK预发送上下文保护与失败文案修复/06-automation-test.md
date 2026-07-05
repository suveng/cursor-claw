# SDK 预发送上下文保护与失败文案修复 - 验收记录

## 1、测试策略与范围

| 维度 | 说明 |
|---|---|
| 验收目标 | 对齐 `01-proposal.md` 验收 1～6 与 `03-tasks.md` T1～T6，确认 pre-send 快照、ratio≥100% 快拒/快轮转、失败文案归因、可选 workspaceDir WARN 已落地且可编译。 |
| 验收层级 | **静态代码追溯** + **TypeScript 编译冒烟**；不新增单元测试/集成测试。 |
| 本次覆盖 | T1 快照字段；T2 强制首轮轮转；T3 `context_blocked` 阻断；T4/T5 失败文案与即时 IM；T6 共享目录 WARN；`npx tsc --noEmit`。 |
| 证据来源 | 源码路径核对、`04-review.md` 评审结论、编译命令退出码。 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 | 风险 |
|---|---|---|
| `crash_log/20260705225838～20260705230040` 同类场景回放 | 需真实飞书多群 + 高压上下文会话，仓库无稳定回放 harness | ratio≥100% 端到端时延（<3s IM）仅静态推断，未实机计时 |
| launch/dispatch 双路径飞书 IM 正文目检 | 依赖 Daemon + 飞书通道在线 | 文案格式/ footer 拼接需归档前手动 smoke |
| ratio∈[95%,100%) 连续 2 次轮转行为 | 需可控 mock usage 或长会话压测 | 现网 90%+2 次规则保留，逻辑已静态确认 |
| T6 共享 workspaceDir WARN | 需刻意配置多群同目录 | WARN 仅日志可观测，本次未构造双 session 实跑 |

## 3、验收追溯表

| 验收点（01/03） | 覆盖方式 | 证据类型 | 结论 |
|---|---|---|---|
| 01-§七.1 准确文案（T4/T5） | 追溯 `isContextExhaustedByPreSend` + `notifyPreSendContextFailure` / `notifySdkFailure` 传 `lastPreSend*` | 静态 | 已覆盖 |
| 01-§七.2 快速响应 ratio≥100%（T2/T3） | 追溯 `FULL_ROTATION_RATIO` 首轮轮转；`sendWithRetry` `preSendRatio>=1.0 && !rotated` 不调用 `agent.send` | 静态 | 已覆盖 |
| 01-§七.3 轮转后归因（T1/T4） | 追溯 `maybeRotateSessionForPressure` 写快照后轮转清零 peak；`formatUserSdkFailureMessage` pre-send 分支 | 静态 | 已覆盖 |
| 01-§七.4 多群独立（T5） | 快照为 session 级字段，无跨 session 读写 | 静态 | 已覆盖 |
| 01-§七.5 共享目录 WARN（T6） | 追溯 `warnIfSharedWorkspaceDir` + launch/dispatch 入口 | 静态 | 已覆盖（未实跑 WARN） |
| 01-§七.6 非目标未破坏 | diff 未触及通道 `othersWorkspaceMode`、飞书 CardKit | 评审 + 静态 | 已覆盖 |
| T1 `lastPreSend*` 字段与 JSDoc | `sdk-session-types.ts` L65–71 | 静态 | 通过 |
| T2 ratio≥100% bypass 冷却/ hits | `context-rotation-lite.ts` L27–52 `forceRotate` 分支 | 静态 | 通过 |
| T3 `context_blocked` 返回值 | `sdk-run-dispatch.ts` L128–133 | 静态 | 通过 |
| T5 launch/dispatch notify 删 session 前 | `agent-sdk.ts` L196–197、L259–260 | 静态 | 通过 |
| 02·八·（二）编译 | `npx tsc --noEmit` | 命令摘要 | 通过 |
| `agent-sdk.ts` ≤300 行 | `wc -l` → 281 | 静态 | 通过 |

## 4、场景摘要

### 4.1 最低验收场景清单

| 场景 | 前置 | 触发 | 期望 | 判定口径 |
|---|---|---|---|---|
| S1 ratio≥100% 强制轮转 | session usage ratio≥1.0 | 首次 `maybeRotateContext` | `rotated: true`，bypass 冷却与 2 次命中 | 不进入第二次 pre-send 才轮转 |
| S2 ratio≥100% 轮转失败快拒 | ratio≥1.0 且 `Agent.create` 失败 | `sendWithRetry` attempt=1 | 返回 `context_blocked`，**不**调用 `agent.send` | UI 日志含 `pre-send context_blocked` |
| S3 context_blocked 即时 IM | S2 触发 | launch 或 dispatch | 用户 IM 含「上下文窗口已接近或达到上限」 | `notifyPreSendContextFailure` 在删 session 前调用 |
| S4 轮转后 Run 再失败归因 | 轮转成功 peak 清零，pre-send≥95% | Run error → `notifySdkFailure` | IM 仍走上下文已满句，非「建议精简输入」兜底 | `isContextExhaustedByPreSend` 为 true |
| S5 多 session 同 workspaceDir | ≥2 活跃 session 同目录 | launch/dispatch 入口 | WARN `[shared-workspace]` 每目录每进程 1 条 | 用户 IM 行为不变 |
| S6 编译冒烟 | 本地依赖可用 | `npx tsc --noEmit` | 退出码 0 | 无 TS 类型错误 |

### 4.2 静态验收关键路径

| 模块 | 符号/分支 | 核对要点 |
|---|---|---|
| `context-rotation-lite.ts` | `FULL_ROTATION_RATIO = 1.0` | ratio≥1.0 跳过 `ROTATION_HITS` 与冷却 |
| `sdk-run-dispatch.ts` | `maybeRotateSessionForPressure` | 每次 pre-send 覆盖 `lastPreSendUsedTokens/Ratio` |
| `sdk-run-dispatch.ts` | `sendWithRetry` L128–133 | ratio≥1.0 且 `!rotated` → `context_blocked` |
| `sdk-failure-messages.ts` | `isContextExhaustedByPreSend` | pre-send≥95% 独立于 peak |
| `sdk-run-finalize.ts` | `notifyPreSendContextFailure` | `errorNotified` 闩 + 复用文案器 |
| `sdk-session-registry.ts` | `warnIfSharedWorkspaceDir` | Set 去重，count>1 时 WARN |
| `agent-sdk.ts` | launch L177/196–197；dispatch L250/259–260 | WARN + context_blocked notify 双路径 |

### 4.3 本次执行说明

| 项目 | 说明 |
|---|---|
| 本次实跑 | `npx tsc --noEmit`（退出码 0，约 1.5s） |
| 本次未实跑 | 飞书 IM 端到端、crash_log 回放、T6 WARN 构造 |
| 后续建议 | 归档前按 `04-review.md` §7 做一次多群高压手动 smoke |

## 5、脚本位置与环境

| 项目 | 说明 |
|---|---|
| 自动化脚本目录 | 本次未新增 `auto_test/` 脚本（与 01/03 约定一致） |
| 编译命令 | `npx tsc --noEmit` |
| 手动 smoke 参考 | `crash_log/20260705225838～20260705230040`；需飞书 SDK 通道 + 多群或同目录配置 |
| 环境变量 | 无新增必填项；可选 `SDK_RESIDENT_AGENT` 影响 dispatch 路径 |
| 副作用 | 编译无写库；手动 smoke 可能产生 SDK UI 日志与 IM |

## 6、输出与记录规范

本记录仅保留「命令、结果、结论性备注」摘要，不粘贴完整终端日志；详细输出以本地终端为准。

## 7、执行记录

| 日期 | 环境 | 命令 | 结果 | 备注 |
|---|---|---|---|---|
| 2026-07-05 | 本地开发机（darwin） | `npx tsc --noEmit` | 通过 | 退出码 0，无 TS 错误 |
| 2026-07-05 | 本地开发机（darwin） | 静态代码路径核对 T1–T6 | 通过 | 关键符号与 02/03 设计一致 |
| 2026-07-05 | — | 飞书 IM / crash_log 回放 | 待用户执行 | 见 §4.3；非阻断归档项 |
