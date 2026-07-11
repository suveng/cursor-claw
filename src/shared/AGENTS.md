# shared 域编码约定

> 仅放**跨 daemon / bridge / electron / renderer** 共用的类型、门控与常量；工作流专属类型已迁至 `workflow/`，Lark 实现已迁至 `bridge/`。

## 目录职责

| 文件 | 职责 | 主要引用方 |
|------|------|------------|
| `channel-types.ts` | `MessageChannel`、`AgentResource`、`makeChatKey` 等通道 SSOT | daemon、electron、renderer |
| `feishu-presentation-gate.ts` | `isFeishuProcessPresentationSuppressed` 飞书过程展示门控 | daemon、electron |
| `tool-presentation.ts` | 工具名归一化、Shell/Task 字段解析、里程碑文案 `formatToolMilestoneText` 与截断常量 | bridge/lark-core、electron、daemon |
| `sdk-tool-presentation-tier.ts` | 归一化后工具名 → notify/silent 分级 SSOT | electron cursor-sdk、claude-code |
| `format-unknown-error.ts` | `formatUnknownError` 未知 rejection/exception 诊断格式化 SSOT | electron `main.ts`、daemon 全局 handler、cursor-sdk `sdk-async-guard` |
| `constants.ts` | `LOCK_FILE_NAME` 等进程级常量 | daemon-entry |
| `feishu-addons.ts` | 扫码增量 scopes/events SSOT（`FEISHU_MENU_*`）与菜单 event_key 映射 | renderer Settings、registerApp addons |

## feishu-addons 约定

- **两套权限 SSOT 禁止合并**：创建侧 `REQUIRED_FEISHU_SCOPES`（`src/renderer/constants.ts`）与扫码增量 `FEISHU_MENU_SCOPES`（本文件）各自维护；增量开权只改本文件。
- **ADDONS 派生**：`FEISHU_MENU_ADDONS.scopes.tenant` / `events.items.tenant` **须**由对应数组 `.map` 生成，禁止手写第二份 scope/event 列表。
- **设置页展示**：增量表直接 `FEISHU_MENU_SCOPES.map` / `FEISHU_MENU_EVENTS.map`，改 SSOT 即可见，勿为单条权限改 UI。

## import 约定

- 跨域引用：`../shared/<file>.js`（Node16 ESM，**须** `.js` 后缀）。
- shared 内**禁止** import `daemon/`、`bridge/`、`workflow/`（保持无环依赖）。
- 禁止 barrel `index.ts`；新增跨域符号优先归入已有文件，避免碎片化。

## channel-types 三端同步

- `MessageChannel` / `AgentResource` / `DaemonChannelConfig` 增删字段须同步：
  - `src/shared/channel-types.ts`（本文件，SSOT）
  - `electron/preload.ts`
  - `src/renderer/env.d.ts`（`ChannelConfig`）
- `AgentResource.type` 与 `engineType` 变更时同步扩展 electron `findFirstRunnableResource` 与 config-store 兜底；详见 [electron/config/AGENTS.md](../../electron/config/AGENTS.md)。
- `CHAT_KEY_SEP`、`makeChatKey`、`parseChatKey` 为会话键唯一拼装口径，daemon 与 electron 不得另写分隔规则。

## presentation gate 引用约定

- **飞书过程抑制**：daemon `handleToolPresentationEvent` / `handleThinkingPresentationEvent` **须**调用 `isFeishuProcessPresentationSuppressed` 决定 CardKit/里程碑出站；**SDK/CC** `postPresentationEvent` **禁止**飞书早退（Codex/OpenCode 仍早退，待对齐）。禁止在调用方复制通道判断逻辑。
- **门控范围**：仅抑制飞书 tool/thinking CardKit；assistant `stream-text` 与 `PRESENTATION_ORDERING` 不受影响；微信路径不经此 gate。
- **tool-presentation**：`TOOL_LOG_DETAIL_MAX`、`TOOL_CARD_SHELL_OUTPUT_MAX`、`TOOL_MILESTONE_TEXT_MAX` 为截断上限 SSOT；`formatToolMilestoneText` 为飞书 tool 里程碑文案 SSOT；`lark-core`、electron agent 与 daemon 里程碑须引用本模块，不重复定义 magic number。
- **工具名归一化**：`normalizePresentationToolName(rawName)` 将 CC/SDK 原始名映射为 tier 与里程碑 canonical 名；未命中别名表则 `toLowerCase().trim()` 原样返回（默认 silent）。**CC 别名**（`PRESENTATION_TOOL_NAME_ALIASES`）：`bash`→`shell`、`edit`/`strreplace`→`strreplace`、`write`→`write`、`delete`→`delete`、`task`→`task`；调用 `resolveSdkToolPresentationTier` 前须先归一化。
- **分级门控**：`resolveSdkToolPresentationTier` 查 notify 白名单（`shell`/`write`/`strreplace`/`delete`/`task`）；notify → `markProcessEventSeen` + `postPresentationEvent`；silent → 跳过出站，UI 日志与 `lastTool` 仍全量。
- **shell 工具里程碑**：`extractShellPresentationFields` 从 args 解析 `command` → `tool_shell_command`；`formatToolMilestoneText` shell `started` 优先 `shell执行：{截断}`，无命令时 `命令执行已开始（具体命令暂不可展示）`；禁止裸 `shell：已开始`；completed/failed 分别为 `shell完成：{截断}` / `shell失败：{截断}`（有命令字段时）。
- **task 工具里程碑**：`tool_call` 名 `task` 时，`extractTaskPresentationFields` 从 args 解析 `description` → `tool_task_description`；`formatToolMilestoneText` task `started` 优先 `task开始：{截断描述}`，无描述时 `子任务已开始（描述暂不可展示）` 或引擎侧 `#N` 序号降级；禁止裸 `task：已开始`；completed/failed 分别为 `task完成：{截断}` / `task失败：{截断}`（有描述字段时）。task **事件**路径文案见 `mapTaskMilestoneText`（`electron/agent/shared/tool-presentation-dedup.ts`）。

## 全局异常日志

- **格式化 SSOT**：daemon `daemon.ts` 与 electron `main.ts` 的 `uncaughtException` / `unhandledRejection` **须**调用 `formatUnknownError(..., { includeRegistrationHint: true })`；禁止内联 `instanceof Error` 或 `e?.stack` 退化输出 `[unknown]`。
- **rejection 上下文**：`unhandledRejection` 日志须追加 `promise=[object Promise]`（`Object.prototype.toString.call(promise)`）；daemon 用 `log("ERROR", ...)`，electron 用 `broadcastLog`。

## format-unknown-error 约定

- **ConnectError 形态**：`instanceof Error` 且 `name === 'ConnectError'`、message 以 `[unknown]` 开头、或存在 `rawMessage` / 数字 `code`（gRPC）时走 ConnectError 分支；去掉 message 前缀 `[unknown]`/`[unavailable]`；数字 `code` 经展示别名映射（如 `2`/`14` → `UNAVAILABLE`）后输出 `UNAVAILABLE read ETIMEDOUT | code=14 | …` 形态，而非 `[unknown] [unavailable]…`。

## 禁止

- 禁止将工作流、Lark 发送、队列实现放入 `shared/`（已按域迁移）。
- 禁止在 shared 写业务编排逻辑；仅类型、纯函数门控与常量。
