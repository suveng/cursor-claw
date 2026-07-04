# PRD 修订记录

> **变更 ID**：`20260704190748-IM通知消息顺序与流式推送优化`
> **说明**：按轮次追加；实现由 `/kb-revise-apply` 执行，完成后更新「实现状态」。

## Rev2

| 字段 | 内容 |
|------|------|
| **轮次编号** | Rev2 |
| **日期** | 2026-07-04 |
| **变更摘要** | **过程实时、答复收尾流式**：thinking / task / notify 级工具过程继续实时推送飞书里程碑；含实质过程的 Run 期间 **禁止** assistant IM 出站（无 mid-run release、无 non-final 首建/更新）；仅在 `streamRunEvents` 收尾、过程全部结束后 **首建** 单条 assistant CardKit 并以流式 PATCH 增长至 final；无实质过程短问答（F5）仍允许 preamble 短窗及时首包。 |
| **动因/来源** | 08-verify-issue 第 2 轮（`reason=requirement`）：v1.13.3 修复 T-FIX 后仍报 assistant 文案重复；产品明确「工具实时推送、assistant 答复放到最后才流式发送飞书」。 |
| **与上一版差异要点** | ① **废弃 idle release 为主路径**：不再在 thinking/tool 过程 idle 时 `enqueueRelease` / `maybeReleaseDeferredAssistant` 首建 assistant IM。② **F2.2 澄清**：「最后才发送」指 **首条 IM 出站时机** 在 Run 过程结束之后；首建后仍须流式 PATCH，**不是** 一次性长文。③ **F8 新增**：过程实时不变；含工具 Run 中 assistant 零 IM 出站；单 Run 单条 assistant 消息。④ **02-design**：defer-on-idle → **end-only assistant IM**（Electron + Daemon 双侧）。⑤ **T-FIX-1~4** 串行/飞行窗口保留，但 mid-run release 路径由 T-Rev2 取代。 |
| **影响范围** | 产品：`01-proposal.md` F2.2、F8、验收 10–11；设计：`02-design.md` §2 Rev2、§3 release 时机、§10；实现：`sdk-run-presentation.ts`、`sdk-run-stream.ts`、`daemon.ts`（`handleStreamText` / `enqueueRelease`）；验收：`08-verify-issue` E10 去重、含工具 Run 过程结束前无 assistant IM。 |
| **关联 03 任务** | T-Rev2-01（Electron end-only assistant）、T-Rev2-02（Daemon end-only release）、T-Rev2-03（去重验收）、T-Rev2-04（AGENTS + 06 文档同步） |
| **实现状态** | **未开始** |
