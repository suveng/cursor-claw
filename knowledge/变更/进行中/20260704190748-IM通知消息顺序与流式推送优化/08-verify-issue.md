# 验收问题报告

> 变更 ID：`20260704190748-IM通知消息顺序与流式推送优化`

## 第 1 轮

### 反馈问题

产品验收反馈：出现相同的消息，重复发送。用户侧示例：

- 「正在启动」
- 「已理解指令。将按 kb-admin 角色执行知识库管理流程。我将作为 kb-admin 协调器执行任务。」**出现两次（文案完全相同）**

### 归因结论

code

### 判定依据

- **PRD 未要求重复出站**：`01-proposal.md` F1–F3 要求过程先于结论、顺序正确；验收标准 9 要求阅读美观无违和。**未要求**「允许相同文案重复出站」，重复发送属于实现缺陷。
- **并发 release 竞态**：`src/daemon/daemon.ts` 中 `releaseDeferredAssistantStream`（约 566 行）仅用 `assistantCardReleased` 做 check-then-act，无串行化；多处 `void releaseDeferredAssistantStream(...)` 并发触发（thinking final、tool completed idle、handleStreamText final 等），存在竞态：两个调用均见 `assistantCardReleased=false` 时各创建一条 CardKit/消息 → **相同内容重复发送**。
- **Electron 收尾时序叠加**：`electron/agent/cursor-sdk/sdk-run-stream.ts` Run 收尾先 `flushDeferredStreamPost`（non-final）再 `flushStreamPost(true)`（final），与 Daemon 侧 release 时序叠加，放大双首包风险。
- **非里程碑节流缺口**：里程碑 `sendMilestoneText` 有节流/去重，但用户反馈的重复文案为 assistant 答复首段（非里程碑 kind 可解释），指向 assistant 流式首建重复而非里程碑节流缺口。
- **评审债务未覆盖**：`04-review.md` 已接受 R-D1/R-D2 债务但未覆盖并发双 release；本次验收暴露的是**新缺陷**。

### 影响范围

- 通道：飞书私聊 SDK 路径
- 配置：`PRESENTATION_ORDERING` 开启
- 场景：含 task/thinking/tool 过程后 assistant 流式首包
- 关联实现：`src/daemon/daemon.ts`（`releaseDeferredAssistantStream`）、`electron/agent/cursor-sdk/sdk-run-stream.ts`

### 后续处理路径

`/kb-apply` 或 `/kb-revise-apply`（修复 release 串行化/幂等，避免 release 与 stream-text final 双首建）

## 第 2 轮

### 反馈问题

产品验收反馈：还是存在 IM 消息重复的问题。

产品建议：

- **工具调用**：过程实时推送到飞书
- **assistant 答复**：输出放到**最后**才发送给飞书，采用流式输出方式

### 归因结论

requirement

### 判定依据

1. 第 1 轮已按 `code` 修复 T-FIX-1~4（release 串行、飞行窗口门控），v1.13.3 归档后验收仍报重复 → 现策略「过程 idle 即 `enqueueRelease` + mid-run `maybeReleaseDeferredAssistant` + Run 收尾 `flushStreamPost`」多路径仍可能向飞书发出 assistant 首包/更新，与「答复仅收尾出站」产品期望不一致。
2. 用户明确建议：**工具/过程实时推送，assistant 答复仅在过程结束后才首建 IM 流式消息**——这比现网「idle 即 release 并持续 PATCH」更严格；`01-proposal.md` F1 要求过程先于结论首包，F2 要求保留流式，但**未锁定**「含工具 Run 期间 assistant 不得有任何 IM 出站（含 mid-run release）」；`02-design` 采用 defer-on-idle 而非 end-only，与本轮产品口径存在缺口。
3. 重复发送既可由实现竞态引起，也可由「mid-run release + final flush」双通道叠加；在用户已给出明确产品方向时，优先 `/kb-revise` 修订「答复出站时机」再 `/kb-apply`，而非继续在 defer 链上打补丁。
4. 第 1 轮 `08-verify-issue` 已记录 code 归因与 T-FIX；本轮为**新反馈**，不重复第 1 轮结论。

### 影响范围

- 通道：飞书私聊 SDK 路径
- 配置：`PRESENTATION_ORDERING` 开启
- 场景：含 task/thinking/tool 过程后 assistant 流式首包
- 关联实现：`electron/agent/cursor-sdk/sdk-run-presentation.ts`、`electron/agent/cursor-sdk/sdk-run-stream.ts`、`src/daemon/daemon.ts`（`handleStreamText` / `enqueueRelease`）

### 后续处理路径

`/kb-revise`（修订 PRD：工具实时 + assistant 仅 Run 收尾首建流式；禁止含工具 Run 的 mid-run assistant IM 出站）→ `/kb-revise-apply` 或 `/kb-apply`
