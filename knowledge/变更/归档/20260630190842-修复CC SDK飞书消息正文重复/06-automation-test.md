# 修复 CC SDK 飞书消息正文重复 - 验收记录

> **变更 ID**：`20260630190842-修复CC SDK飞书消息正文重复`
> **阶段**：`/kb-test`（lite；静态契约 + 编译冒烟 + 飞书 IM 手工联调）
> **输入**：`01-proposal.md`、`02-design.md`、`03-tasks.md`（LITE-01 / T1 `done`）
> **manifest**：`stage=tested`（静态 + 编译已记录；K1–K5 台架待用户执行）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（符号/分支/行数对照 02/03）+ **编译冒烟**（`npx tsc --noEmit`）+ **飞书 IM 手工联调**（CC 引擎 + f41 stream-text）；**不新增**单元测试/集成测试/`auto_test/` |
| **目标** | 覆盖 `01` 验收 1–6、`02` 步骤 E-1～E-5、`03` T1 各条验收标准 |
| **通过口径** | 静态与编译项 kb-recorder 已勾；**01·1/2/4/5** 须 `npm run dev` + 飞书私聊 CC Profile 实测；**01·3** 无 partial 回退路径以静态 + 可选台架负例佐证 |
| **与 review 分工** | review 偏实现与规范；本文负责验收追溯、场景清单与执行记录 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·1/2**：飞书 f41 流式 assistant 正文不重复、增量可见 | 依赖 Claude Profile + 飞书 IM + SDK 实时 `text_delta`/`assistant` 双路；须 Electron + Daemon 全链 |
| **01·3**：无 `text_delta` 仅 assistant text 回退 | SDK 默认 `includePartialMessages: true` 常态发 partial；负例须 mock 或偶发观测，无稳定 headless 脚本 |
| **01·4**：thinking/tool/usage/Presentation 时序 | 须含 tool/thinking 任务与 UI/IM 对照；静态可证分支未改，行为须手工 |
| **01·5**：多轮 dispatch 与 reset 后标志清零 | 须连续 IM 消息 + 观察多轮正文；session 内存标志无对外 API |
| **`auto_test/` 脚本** | 本期未新增；以静态 + 编译 + 手工清单为主 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** | CC + f41 流式：飞书 IM assistant 正文**不整段重复两遍** | 台架 **K1** | 联调 / IM | ⏳ **待用户执行** |
| **01·2** | 流式过程正文仍随 `text_delta` 增量更新 | 台架 **K2** | 联调 / UI | ⏳ **待用户执行** |
| **01·3** | 无 `text_delta`、仅 assistant text block 时正文正常 | 静态 + 可选 **K3** | 代码 / 联调 | ✅ 静态；⏳ K3 可选 |
| **01·4** | thinking、tool、usage、Presentation 时序不变 | 静态 + 台架 **K4** | 代码 / 联调 | ✅ 静态；⏳ **待用户执行** |
| **01·5** | 连续多轮 dispatch 每轮不重复；reset 后标志清零 | 静态 + 台架 **K5** | 代码 / 联调 | ✅ 静态；⏳ **待用户执行** |
| **01·6** | TypeScript 编译通过 | `npx tsc --noEmit` | 命令 | ✅ |
| **E-1/E-2** | `text_delta` append 前置位 `ccTextFromPartialStream` | 静态 §4.2 | 源码 | ✅ |
| **E-3** | `assistant` text block 条件跳过 append | 静态 §4.2 | 源码 | ✅ |
| **E-4** | assistant 收尾清零标志 | 静态 §4.2 | 源码 | ✅ |
| **E-5** | `resetCcRunPresentationState` 清零标志 | 静态 §4.2 | 源码 | ✅ |
| **E-6** | `CcSessionAgent` 字段与 JSDoc | 静态 §4.2 | 源码 | ✅ |
| **T1·行数** | 改动文件均 ≤300 行 | `wc -l` | 命令 | ✅ |
| **T1·HTTP** | 无对外 API 变更 | `agent-cc-http.ts` 无 diff | 命令 | ✅（本变更未改） |

## 4、场景摘要

### 4.1 飞书 IM 必测清单

| 场景 ID | 前置 | 步骤摘要 | 期望 | 关联 |
|---------|------|----------|------|------|
| **K1 正文不重复（核心）** | 通道绑定 **Claude Agent** Profile；飞书**私聊**（f41 流式 eligible）；`npm run dev` + Daemon 已运行 | 发送短句（如「你好」）与一段长文（≥200 字）各一次；观察 IM 最终 assistant 消息 | 正文与模型输出**一致**；**无**「你好你好」类整段重复；长文首尾不各出现一遍全文 | 01·1、E-1/E-3 |
| **K2 流式增量** | 同 K1 | 长文回复过程中观察 IM 消息更新 | 正文**逐段增长**（400ms 节流下可见刷新）；末包内容与 K1 一致；非一次性跳变双倍长度 | 01·2、E-1 |
| **K3 无 partial 回退（可选）** | 同 K1；若 SDK 某轮仅发 assistant text、无 stream_event | 触发一次可得纯 assistant 路径的回复（或 devtools 观测无 text_delta） | 正文仍完整展示；**非**空白或截断 | 01·3、E-3 负例 |
| **K4 旁路不退化** | 同 K1；任务需 **tool** 或可见 **thinking**（或含上下文 footer） | 触发含工具调用的任务；对照 Agent 面板 CC 日志与 IM | tool 卡片、thinking（飞书侧按现网门控）、usage/footer 与修复前一致；**无**丢事件或乱序 | 01·4 |
| **K5 多轮与 reset** | 同 K1；同会话 resident 模式 | 连续 **3 轮** dispatch（不 Stop/Reset）；每轮不同长度回复；可选新 Run（Stop 后再发） | 每轮正文均不重复；轮间无上一轮正文残留；新 Run 首条正常 | 01·5、E-4/E-5 |

**观测提示**：重复 bug 表现为 stream-text 累积全文约为实际长度 **2 倍**；修复后 IM 最终字数应与 Agent 面板 CC `text` 日志一致（勿贴含 token 的完整日志）。

### 4.2 静态/编译（kb-recorder 已执行）

| 检查 | 落点 | 期望 | 结果 |
|------|------|------|------|
| session 字段 | `agent-cc-types.ts` L95 | `ccTextFromPartialStream?: boolean` + 中文 JSDoc | ✅ |
| partial 置位 | `agent-cc-events.ts` `handleStreamEvent` L80–83 | `f41Stream` + `text_delta` 时先 `= true` 再 `appendCcAssistantStreamDelta` | ✅ |
| assistant 跳过 | `handleContentBlocks` L45–46 | `f41Stream` 且 `ccTextFromPartialStream` 为真时**不** append text block | ✅ |
| 非 f41 不变 | `handleContentBlocks` L47 | 非 f41 仍 `appendCcLog` | ✅ |
| assistant 收尾清零 | `handleSdkMessage` assistant 分支 L141–142 | `ccTextFromPartialStream = false` | ✅ |
| reset 清零 | `agent-cc-utils.ts` `resetCcRunPresentationState` L131 | `ccTextFromPartialStream = false` | ✅ |
| SDK 配置不改 | `agent-claude-sdk.ts` L88 | `includePartialMessages: true` 保留 | ✅ |
| thinking/tool 分支 | `handleContentBlocks` / `handleStreamEvent` | thinking_delta、tool_use、tool_result 逻辑未包裹在去重条件内 | ✅ |
| 文档约定 | `electron/AGENTS.md` L28 | 一句 partial/assistant 去重语义 | ✅ |
| 行数 | 改动 3 个 ts + AGENTS | 均 ≤300 | ✅（279/96/161/113） |
| TS 类型检查 | `npx tsc --noEmit` | exit 0 | ✅ |

**静态验证命令指针**（仅摘要，不贴长输出）：

```bash
npx tsc --noEmit
rg 'ccTextFromPartialStream' electron/
wc -l electron/agent-cc-events.ts electron/agent-cc-types.ts electron/agent-cc-utils.ts
```

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **脚本目录** | 本期无 `auto_test/` 新增 |
| **运行依赖** | Electron dev；Claude Profile（`ANTHROPIC_API_KEY`、可选 `ANTHROPIC_BASE_URL`）；飞书通道凭据 |
| **环境变量** | `CC_RESIDENT_AGENT`（K5 多轮续聊）；`DAEMON_PORT`；通道 `LARK_*` — **勿写入真实密钥** |
| **eligible 条件** | 飞书私聊 + CC 资源 → `f41Stream` + stream-text；与 Daemon `isStreamTextEligible` 一致 |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 联调失败区分：**操作/环境** vs **SDK 双路投递** vs **Presentation/stream-text 节流**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-06-30 | 本地 dev | `npx tsc --noEmit` | 通过 | exit 0 |
| 2026-06-30 | 本地 dev | 静态 §4.2（符号/分支/行数） | 通过 | kb-recorder |
| 2026-06-30 | 本地 dev | `rg ccTextFromPartialStream electron/` | 通过 | 4 处落点一致 |
| 2026-06-30 | — | **K1** 正文不重复 | 待执行 | 核心台架 |
| 2026-06-30 | — | **K2** 流式增量 | 待执行 | 台架 |
| 2026-06-30 | — | K3 无 partial 回退 | 待执行 | 可选 |
| 2026-06-30 | — | **K4** thinking/tool/usage | 待执行 | 台架 |
| 2026-06-30 | — | **K5** 多轮 dispatch/reset | 待执行 | 台架 |
