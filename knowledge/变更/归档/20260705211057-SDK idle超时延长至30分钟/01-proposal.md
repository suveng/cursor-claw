# SDK idle 超时延长至 30 分钟

## 背景

Cursor SDK 长任务在无 SDK 事件输出时（如长时间 shell 执行、子 Agent 静默运行），watchdog 的 **idle 超时**原先回退至 `PLATFORM_RUN_LIMIT_MS`（约 **7 分钟**），导致运行尚未结束即被误杀并触发超时收尾与用户通知。

commit `875eb5a` 已将 idle 默认延长至 30 分钟，并与 absolute（平台长时）阈值解耦。

## 目标

1. **idle 默认 30min**：`sdk-run-watchdog.ts` 引入 `DEFAULT_SDK_IDLE_TIMEOUT_MS = 30 * 60 * 1000`，不再复用 `LEGACY_RUN_WATCHDOG_TIMEOUT_MS`。
2. **idle / absolute 解耦**：idle 由 `SDK_IDLE_TIMEOUT_MS`（或 `sdk_idle_timeout_ms`）控制；absolute 仍走 `SDK_RUN_WATCHDOG_MS` / `PLATFORM_RUN_LIMIT_MS`（默认 7min）。
3. **可覆盖**：运维可通过环境变量 `SDK_IDLE_TIMEOUT_MS` 按需调整 idle 阈值。
4. **文档同步**：`electron/agent/cursor-sdk/AGENTS.md` 与 `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` 反映新默认值。

## 验收

- [ ] 长 idle 运行（无 SDK 事件、非 tool_running/awaiting_user 豁免）在 **30 分钟**内不被 watchdog idle 取消
- [ ] 未设置 `SDK_IDLE_TIMEOUT_MS` 时 idle 默认 **30min**，absolute 默认 **7min**，二者独立
- [ ] 设置 `SDK_IDLE_TIMEOUT_MS` 后 idle 阈值按环境变量生效
- [ ] `tool_running` / `awaiting_user` / `lastTool.running` 豁免 idle 取消行为不变
- [ ] `NEVER_CANCEL_ON_DURATION` 默认 true 时不按总时长硬杀行为不变
- [ ] AGENTS.md 与业务域知识库 watchdog 段落已同步 30min 默认值
