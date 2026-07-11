# PRD 修订记录

> **变更 ID**：`20260711131134-私聊注入对方名称到group_name`
> **说明**：按轮次追加；实现由 `/kb-revise-apply` 执行，完成后更新「实现状态」。

## Rev1

| 字段 | 内容 |
|------|------|
| **轮次编号** | Rev1 |
| **日期** | 2026-07-11 |
| **变更摘要** | 消息入队前将 `group_name` **拼到消息正文末尾**（固定格式 `\ngroup_name: <名称>`）；取不到名称则不拼。因 Prompt 首行注入不生效，**废止** `buildPrompt` 首行 `group_name:` 注入及相关仅服务该路径的透传/日志；群聊用群名、私聊用对方显示名，解析失败不阻断入队。 |
| **动因/来源** | 验收反馈：`buildPrompt` 首行注入不生效；用户已确认改「入队正文末尾」口径（待确认项=无）。 |
| **与上一版差异要点** | ① 注入落点：Prompt **首行** → 文件队列消息 **正文末尾**。② 格式固定：`\ngroup_name: <名称>`；无名不拼。③ **去掉** `buildPrompt` 首行注入；可观测 `pushUiLog group_name=` 若仅服务首行可移除/降级。④ 验收改为：Agent 在用户消息正文末尾可见 `group_name`。⑤ 复用 `chat-name-resolve` 于入队，不再依赖 launch 透传 `chat_name` 做首行注入。 |
| **影响范围** | 产品：`01-proposal.md` F1/场景/验收；设计：`02-design.md` 流程与改动点；实现：`src/daemon/daemon.ts` `pushMessage`、`chat-name-resolve.ts`；收敛：`electron/agent/shared/agent-launcher.ts` 及仅为首行注入的 chatName 透传链路。 |
| **关联 03 任务** | `T-Rev1-01`（入队前 append）、`T-Rev1-02`（去掉 buildPrompt 首行注入） |
| **实现状态** | **已完成** |
