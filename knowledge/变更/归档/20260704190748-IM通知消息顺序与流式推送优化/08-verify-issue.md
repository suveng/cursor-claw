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
