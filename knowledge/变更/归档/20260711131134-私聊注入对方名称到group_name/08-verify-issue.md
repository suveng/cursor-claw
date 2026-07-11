# 验收问题报告

> 变更 ID：`20260711131134-私聊注入对方名称到group_name`

## 第 1 轮

### 反馈问题

产品验收反馈（飞书）：

1. 本会话是飞书**私聊**，但 Agent 未收到 / 未见 `group_name` 注入
2. 注入后的**最终 Prompt 应打印出来**（可观测），当前看不到
3. 飞书**群聊**同样没有注入 `group_name` 到 Prompt

### 归因结论

**主：`code`**（共享链路未在 launch 前保证名称可用）  
**次：`requirement`**（可观测日志：最终 Prompt / 是否注入 `group_name` 的验收口径未在本变更落地）

### 判定依据

- **Daemon IM 主路径不传 chat_name**：`dispatchSessionToAgent`（`src/daemon/daemon.ts`）转发 `/api/agent/launch` 仅带 `task_text` / `chat_type` / `chat_id` / `sender_open_id` 等，**不传 `chat_name`**；名称注入完全依赖 Electron 侧内存 `chatNameCache` + `buildPrompt` → `resolveSessionChatName`。
- **缓存填充滞后且易空**：`chatNameCache` 填充主要在 `daemon-manager.startStatusPolling`（约 5s 轮询）对**已存在** session 调 `fetchChatNames` / `fetchUserNames`；冷启动或 WS 重连后 Map 为空时，首轮 `buildPrompt` 必然省略 `group_name:` 前缀。
- **无可观测日志**：`buildPrompt` 与四引擎 launch / dispatch **无任何**最终 Prompt 或「是否注入 group_name」的 `pushUiLog` → 验收无法确认注入是否发生（对应反馈第 2 点，兼需求缺口）。
- **运行证据**：`daemon.log` 今日同句样本为 `[group]`；无 `[p2p]` 样本。用户坚持私聊场景，但群路径已足以证明**共享链路 miss**（群聊亦无注入，反馈第 3 点）。
- **同源架构债**：关联更早归档 `20260711095806-Agent注入群聊名提示词`——同一「轮询填缓存 + buildPrompt 读缓存」架构，本变更仅扩展私聊 `senderOpenId` 回退，未修 launch 前预取 / 透传。

### 影响范围

- 通道：飞书**群聊 + 私聊**（`chat_type=group` / `p2p`）
- 引擎：Cursor / Claude Code / Codex / OpenCode 共享 `buildPrompt`（`electron/agent/shared/agent-launcher.ts`）
- 可观测性：最终 Prompt 与注入结果对 UI / 日志均不可见，阻塞验收

### 后续处理路径

`/kb-apply` 或开新 lite/standard：修共享链路（launch 前预取名称 / orchestrator 透传 `chat_name` / 最终 Prompt 可观测日志）；关联说明挂 `20260711095806-Agent注入群聊名提示词`。
