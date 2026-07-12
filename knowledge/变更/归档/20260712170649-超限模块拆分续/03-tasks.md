# 超限模块拆分续 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **现盘锚点（2026-07-12）**：`lark-core.ts` 1190、`Settings.tsx` 962、`Dashboard.tsx` 764、`ChannelPanel.tsx` 687、`command-handler.ts` 750、`updater.ts` 864
> **质量门**：上述超限本轮一次性切至 ≤300，**禁止** defer；排除 `src/daemon/**`、`workflow-engine`、`wechat-manager`
> **并行原则**：不同文件树可并行；同文件（如 `lark-core.ts`）必须串行

## 一、执行计划

### （一）依赖图

```
桥接（串行）:  T1 ──→ T2 ──→ T3 ──→ T4
UI（互不改同一源码）:  T5 ‖ T6 ‖ T7
Electron:  T8 ‖ T9
收口:  (T4 ∧ T5 ∧ T6 ∧ T7 ∧ T8 ∧ T9) ──→ T10
```

| 任务 | 落点树 | 对应 02 §六 / 步骤 ID | 01 验收 |
|------|--------|----------------------|---------|
| T1 | `src/bridge/` | §六-2；S2-d | §七·7.1、R1 |
| T2 | `src/bridge/` | §六-3；S1、S1-a/b | §七·7.1-1、R1/R2 |
| T3 | `src/bridge/` | §六-4；S2、S2-a/b | §七·7.1-1～2、R1/R2 |
| T4 | `src/bridge/` + AGENTS | §六-5；S2-d、S7 | §七·7.1-3、R8 |
| T5 | `src/renderer/pages/` | §六-6；S3、S3-b | §七·7.2、R3/R5/R8 |
| T6 | `src/renderer/components/` | §六-7；S4、S4-a | §七·7.2、R4/R5/R8 |
| T7 | `src/renderer/pages/` | §六-8；S8 | §八·（二）Dashboard、R8 |
| T8 | `electron/scheduling/` | §六-9；S5、S5-a | §七·7.3、R6/R8（**必做**） |
| T9 | `electron/config/` | §六-10；S6、S6-a | §七·7.3、R7/R8（**必做**） |
| T10 | 门禁 + renderer AGENTS | §六-11；S7 | §七·7.4；02 八·（二） |

### （二）分组调度

| 轮次 | 任务 | 并行 | 说明 |
|------|------|------|------|
| **第一轮** | T1, T5, T6, T7, T8, T9 | **是** | 六棵文件树互不重叠；冲突见下表 |
| **第二轮** | T2 | — | 仅改 `lark-core` + 新建 stream/outbound |
| **第三轮** | T3 | — | 仅改 `lark-core` + 新建 merge/progress |
| **第四轮** | T4 | — | parse/connection + 门面 ≤300 + `src/bridge/AGENTS.md` |
| **第五轮** | T10 | — | 全白名单 `wc -l`；沉淀 `components/AGENTS.md`；行为回归清单 |

**同文件冲突清单（须串行）**

| 文件 | 涉及任务（顺序） |
|------|------------------|
| `src/bridge/lark-core.ts` | T1 → T2 → T3 → T4 |
| `src/renderer/components/AGENTS.md` | **仅 T10**（避免 T5/T6/T7 并行写冲突） |
| `src/bridge/AGENTS.md` | T4 |
| `electron/scheduling/AGENTS.md` | T8 |
| `electron/config/AGENTS.md` | T9 |

**禁止改写**：`src/daemon/**`、`electron/daemon/daemon-manager.ts`、`src/workflow/workflow-engine.ts`、`src/bridge/wechat-manager.ts`、`src/renderer/env.d.ts`（业务实现）。

## 二、任务清单

<!-- 以下每条任务自包含；子 agent 执行时只读单条 T{n} + 上下文文件 -->

---

## T1: 抽出 lark-types 与 lark-utils

### 背景

一期桥接拆分的地基：把类型与无状态工具从 `lark-core.ts`（1190 行）迁出，供后续 sender 子模块引用；`lark-core` 先 re-export，保证 daemon / feishu-event-handlers 等既有 `lark-core.js` import 不崩。对应 02 §六-2、S2-d。

### 上下文文件

- CodeGraph: `LarkSender` / `PresentationCardState` / `MergeBatchCardState` / `createLarkClient` / `MEDIA_CACHE_DIR` — 类型与工具边界
- 必读: `src/bridge/lark-core.ts` — 顶部类型（约 L24–130：`PresentationCardState`、`MergeBatchCard*`、`LarkSenderOptions`）；工具（约 L64–124：`MEDIA_CACHE_DIR`、`cleanupMediaCache`、`stripProxyEnv`、`localTimestamp`、`createLarkClient`）；尾部事件类型（约 L1129–1190：`ParsedMessage`、`LarkMessageEvent`、`Feishu*Event`、`FeishuConnectionCallbacks`）
- 必读: `src/bridge/AGENTS.md` — import 须带 `.js` 后缀；禁止 barrel `index.ts`
- 参考: `src/daemon/feishu-card-action.ts` — 仅确认仍从 `lark-core` 取类型（本任务不改 daemon）

### 实现范围

- 新建: `src/bridge/lark-types.ts`（≤300）— 迁出全部对外/对内类型与接口（含 Card 状态、事件、`LarkSenderOptions`）
- 新建: `src/bridge/lark-utils.ts`（≤300）— 迁出 `MEDIA_CACHE_DIR`、`cleanupMediaCache`、`stripProxyEnv`、`localTimestamp`、`createLarkClient` 及仅工具用的常量
- 修改: `src/bridge/lark-core.ts` — 删除已迁符号；`export type` / `export { … } from './lark-*.js'` re-export；类体暂留
- 禁止: 改 CardKit/流式语义；改 `wechat-manager`；新建 `index.ts`；引入未批准抽象基类

### 接口契约

- 域外仍可：`import { LarkSender, PresentationCardState, … } from '../bridge/lark-core.js'`
- 域内新模块：`import type { … } from './lark-types.js'`；`import { createLarkClient, … } from './lark-utils.js'`
- 符号集合不减少；序列化/事件字段形状不变

### 验收标准

- [ ] `wc -l`：`lark-types.ts`、`lark-utils.ts` 均 ≤300
- [ ] `lark-core.ts` 仍 re-export 原对外类型与工具符号
- [ ] 编译通过；未改 `src/daemon/**` / `wechat-manager.ts`
- [ ] 中文注释覆盖新建文件公共导出
- [ ] 无 `02`/`03` 未要求的抽象层或未批准新依赖（Ponytail）

### 依赖

- 前置任务: 无
- 后续任务: T2

---

## T2: 抽出流式 CardKit 与出站文本/媒体

### 背景

将流式实体 create/PATCH/close 与 plain text / 媒体出站从 `LarkSender` 迁至邻接模块，由门面委托。对应场景 S1、验收 §七·7.1-1、R1/R2；落点见 02 S1-a/S1-b。

### 上下文文件

- CodeGraph: `createStreamingCardEntity` / `sendStreamingCardMessage` / `updateStreamingCardText` / `closeStreamingCardMode` / `sendStreamMessage` / `sendMessage` / `sendImage`
- 必读: `src/bridge/lark-core.ts` — `LarkSender` 流式方法（约 L194–318、L695–715）；文本/媒体出站（约 L147–227、L717–831）；`formatForSend` / `buildOutboundPayload` / `containsAtTag`
- 必读: T1 产出 `lark-types.ts`、`lark-utils.ts`
- 必读: `src/bridge/AGENTS.md` — CardKit 失败须可判失败、不吞错
- 参考: `../shared/tool-presentation.js` — 本任务不搬工具卡（归 T3）

### 实现范围

- 新建: `src/bridge/lark-sender-stream.ts`（≤300）— `createStreamingCardEntity`、`sendStreamingCardMessage`、`updateStreamingCardText`、`closeStreamingCardMode`（以独立函数或 `createStreamSender(ctx)` 形式，由 `LarkSender` 委托）
- 新建: `src/bridge/lark-sender-outbound.ts`（≤300）— `sendStreamMessage`、`updateMessageContent`、`replyMessage`、`sendMessage`、`addReaction`、`sendImage`、`sendFile`、`downloadImage`、`fetchMessageContent` 及 `formatForSend`/`buildOutboundPayload`
- 修改: `src/bridge/lark-core.ts` — 删除已迁方法体；类方法改为调用新建模块；保持公开实例方法签名不变
- 若单文件仍 >300：同任务再切（如 media 单独文件），**禁止 defer**

### 接口契约

- `LarkSender` 对外方法名与参数不变（daemon presentation 继续调实例方法）
- 新建模块可接收 `{ client, log, messagePrefix }` 上下文，禁止要求调用方改 import 路径

### 验收标准

- [ ] 新建与改动后相关文件均 `wc -l` ≤300（本任务范围内）
- [ ] 流式 create/PATCH/close 与 plain text 流式行为与迁出前一致（无系统性卡片空白）
- [ ] `@` 含提及时 Markdown→text 降级逻辑不变
- [ ] 中文注释；Ponytail；未改 daemon / wechat-manager

### 依赖

- 前置任务: T1
- 后续任务: T3

---

## T3: 抽出合并卡与工具/思考/帮助卡

### 背景

合并批次卡与工具/思考/帮助进度卡是飞书展示主路径（S2）。从 `LarkSender` 垂直迁出，保持 `renderMergeBatchCard` / `renderToolProgressCard` / `renderThinkingCard` / help 行为等价。对应 §七·7.1-1～2；`card.action.trigger` 链不改（仍走 daemon，仅继续调 `LarkSender`）。

### 上下文文件

- CodeGraph: `renderMergeBatchCard` / `createMergeBatchCardEntity` / `renderToolProgressCard` / `renderThinkingCard` / `createHelpCardEntity`
- 必读: `src/bridge/lark-core.ts` — 合并卡（约 L320–446）；工具/思考/帮助（约 L448–693）；`formatToolProgressCardMarkdown` / `formatToolStatusLabel`
- 必读: T1/T2 产出模块 — 复用 types/utils/stream 上下文形态
- 参考: `src/daemon/feishu-card-action.ts` — **只读**，确认仍调 `LarkSender`，本任务不改 daemon

### 实现范围

- 新建: `src/bridge/lark-sender-merge.ts`（≤300）— merge 实体 create/send/update/`renderMergeBatchCard`/`formatMergeBatchPlainText`
- 新建: `src/bridge/lark-sender-progress.ts`（≤300）— tool/thinking/help 卡渲染与 PATCH；若逼近 300 则同任务再拆 `lark-sender-help.ts`
- 修改: `src/bridge/lark-core.ts` — 删除已迁实现，门面委托
- 禁止: 改合并策略、按钮 schema、`card.action.trigger` 返回值约定

### 接口契约

- `LarkSender.renderMergeBatchCard` / `renderToolProgressCard` / `renderThinkingCard` / `sendHelpCard` 签名与行为不变
- shell 工具展示仍经 `../shared/tool-presentation.js`，不在 bridge 重复截断逻辑

### 验收标准

- [ ] 本任务新建/改动文件均 ≤300（含再切 help）
- [ ] 合并卡 / 工具卡 / 思考卡主路径与迁出前一致；对齐 01 §七·7.1-1～2
- [ ] 未修改 `src/daemon/**` 业务实现
- [ ] 中文注释；Ponytail

### 依赖

- 前置任务: T2
- 后续任务: T4

---

## T4: 抽出解析/连接并瘦身 lark-core 门面 + bridge AGENTS

### 背景

迁出 WS 连接与入站解析，将 `lark-core.ts` 收敛为 `LarkSender` 门面 + 稳定 re-export（目标 ≤300）。更新 `src/bridge/AGENTS.md` 飞书小节，勾销「行数债务」表述。对应 §六-5、S7、R8。

### 上下文文件

- CodeGraph: `startConnection` / `parseMessageContent` / `processIncomingMessage` / `extractCardText`
- 必读: `src/bridge/lark-core.ts` — `extractCardText`/`parseMessageContent`/`processIncomingMessage`（约 L833–1022）；`startConnection`（约 L1024–1128）；类残留
- 必读: T1～T3 全部新建 `lark-*.ts` — 确认委托齐全
- 必读: `src/bridge/AGENTS.md` — 现「飞书 Lark 核心」节（须改为门面 + 子模块表）

### 实现范围

- 新建: `src/bridge/lark-sender-parse.ts`（≤300）— `parseMessageContent`、`processIncomingMessage`、`extractCardText`
- 新建: `src/bridge/lark-sender-connection.ts`（≤300）— `startConnection` 及 EventDispatcher 注册逻辑
- 修改: `src/bridge/lark-core.ts` — 仅保留：import、re-export、`LarkSender` 构造与委托方法、必要 glue；**`wc -l` ≤300**
- 修改: `src/bridge/AGENTS.md` — 用子模块职责表替换「行数债务」；写明域外仍 import `lark-core.js`；子模块 ≤300
- 禁止: 改 `card.action.trigger` 回传约定；改 wechat-manager

### 接口契约

- 对外导出符号集合 ≥ 拆分前（允许 re-export）
- `startConnection(…, callbacks?: FeishuConnectionCallbacks)` 行为不变（未提供回调 early return；card action 须 `return await onCardAction`）

### 验收标准

- [ ] `wc -l src/bridge/lark-core.ts` ≤300；全部 `lark-*.ts` ≤300
- [ ] 既有相对路径 `lark-core.js` import 仍可用；导出不减少
- [ ] `src/bridge/AGENTS.md` 已描述 `lark-sender-*` / types / utils 边界
- [ ] 对齐 01 §七·7.1-3；中文注释；Ponytail
- [ ] **未**改 daemon / workflow-engine / wechat-manager

### 依赖

- 前置任务: T3
- 后续任务: T10

---

## T5: Settings 内联 Tab 垂直切分

### 背景

`Settings.tsx`（962 行）仍内联 general/proxy/tasks/setup/about JSX。按已有 MCP/Rules/Skills 壳模式迁出 Tab 组件，主文件收敛为 Tab 壳与状态组装。对应 S3、R3/R5/R8；**不改**布局与字段语义。本任务**不写** `components/AGENTS.md`（归 T10）。

### 上下文文件

- CodeGraph: `Settings` / `Tab` / `TABS`
- 必读: `src/renderer/pages/Settings.tsx` — `Tab`/`TABS`（约 L50–70）；状态与 load/save（约 L72–260）；`tab === "general"|"proxy"|"tasks"|"setup"|"about"` JSX（约 L443–850）；任务编辑弹窗
- 必读: `src/renderer/components/SettingsRulesPanel.tsx` 或 `SettingsEngineShell.tsx` — 已拆子面板 props 传递范例
- 参考: `src/renderer/components/AGENTS.md` — Settings 引擎感知分块约定（只读）

### 实现范围

- 新建（均 ≤300）:
  - `src/renderer/pages/SettingsGeneralTab.tsx`
  - `src/renderer/pages/SettingsProxyTab.tsx`
  - `src/renderer/pages/SettingsTasksTab.tsx`（含任务列表与编辑弹窗若同文件超限则同任务再拆 modal）
  - `src/renderer/pages/SettingsSetupTab.tsx`
  - `src/renderer/pages/SettingsAboutTab.tsx`
- 修改: `Settings.tsx` — 仅保留 tab state、共享 load（`getConfig`/`loadChannelContext`）、已有子面板挂载、对新 Tab 传 props；**壳 ≤300**
- 不改: `ChannelPanel`/`AgentPanel`/`WorkflowPanel`/`SettingsMcp*` 内部；IPC 字段名与默认值

### 接口契约

- 各 `Settings*Tab` 为 React 组件；props 由壳传入当前 state 与 setter / save 回调
- `window.electronAPI` 调用语义不变；Tab id 联合类型不变

### 验收标准

- [ ] `Settings.tsx` 及全部新建 Tab 文件 `wc -l` ≤300
- [ ] 各 Tab 字段集合、校验、保存与拆分前一致（01 §七·7.2-1）
- [ ] 中文注释；Ponytail；无布局/文案/默认值无关改动

### 依赖

- 前置任务: 无
- 后续任务: T10

---

## T6: ChannelPanel 编辑弹窗拆分

### 背景

`ChannelPanel.tsx`（687 行）列表与 `ChannelEditModal` 同文件。迁出编辑弹窗与辅助函数，列表壳 ≤300；表单/扫码/凭据行为等价。对应 S4、R4/R5/R8。不写共享 AGENTS（归 T10）。

### 上下文文件

- CodeGraph: `ChannelPanel` / `ChannelEditModal` / `emptyChannel`
- 必读: `src/renderer/components/ChannelPanel.tsx` — `emptyChannel`/`newLocalChannelId`（约 L12–40）；列表主组件（约 L42–234）；`ChannelEditModal`（约 L235–末）
- 必读: `src/renderer/components/ChannelModelSection.tsx` — 编辑弹窗内模型区块协作（只读约定）
- 参考: `electron/config/AGENTS.md` — 通道字段三处同步（本任务不改类型契约）

### 实现范围

- 新建: `src/renderer/components/ChannelEditModal.tsx`（≤300；微信块若仍超限同任务再拆 `ChannelEditWechat.tsx`）
- 新建: `src/renderer/components/channel-panel-helpers.ts`（≤300）— `emptyChannel`、`newLocalChannelId`、`isDefaultChannelName` 等纯辅助
- 修改: `ChannelPanel.tsx` — 列表 + 打开/关闭编辑 + import 弹窗；**≤300**
- 禁止: 改通道字段默认值、扫码流程产品语义、wechat-manager

### 接口契约

- `export default function ChannelPanel` 保持；`ChannelEditModal` 具名导出供面板使用
- `emptyChannel(type, defaultName)` 行为与迁出前一致

### 验收标准

- [ ] `ChannelPanel.tsx`、`ChannelEditModal.tsx`、helpers（及再切文件）均 ≤300
- [ ] 飞书/微信编辑、扫码、凭据保存与拆分前一致（01 §七·7.2）
- [ ] 中文注释；Ponytail

### 依赖

- 前置任务: 无
- 后续任务: T10

---

## T7: Dashboard 主页拆分

### 背景

现盘补入：`Dashboard.tsx`（764 行）超限。按 02 S8 拆 onboard / status cards / log 面板，壳 ≤300。验收挂 02 §八·（二）。不写共享 AGENTS（归 T10）。

### 上下文文件

- CodeGraph: `Dashboard` / `LogLine` / `StatusCard` / `OnboardState`
- 必读: `src/renderer/pages/Dashboard.tsx` — 主组件与引导（约 L39–664）；`LOG_RE`/`LogLine`/`StatusCard`/颜色常量（约 L665–末）
- 参考: `src/renderer/components/AGENTS.md` — 单文件 ≤300 通则

### 实现范围

- 新建: `src/renderer/pages/DashboardOnboard.tsx`（≤300）— 引导三步及相关 state UI
- 新建: `src/renderer/pages/DashboardStatusCards.tsx`（≤300）— `StatusCard` 与状态文案常量
- 新建: `src/renderer/pages/DashboardLogPanel.tsx`（≤300）— `LogLine`、`displayLogMessageBody`、日志正则与配色
- 修改: `Dashboard.tsx` — 组装壳 + 数据订阅/IPC；**≤300**
- 禁止: 改引导文案产品语义、日志解析格式（除非搬迁必需且行为等价）

### 接口契约

- `export default function Dashboard({ onSettings, active })` 签名不变
- 子组件 props 由壳传入；不新增全局 store

### 验收标准

- [ ] `Dashboard.tsx` 及三个新建文件均 ≤300
- [ ] 引导三步与日志区行为与拆分前一致（02 §八·（二））
- [ ] 中文注释；Ponytail

### 依赖

- 前置任务: 无
- 后续任务: T10

---

## T8: command-handler 按指令族拆分（本轮必做）

### 背景

01 原标三期可选；**本变更质量门禁止 defer**。将 `command-handler.ts`（750 行）按 model/task/mcp/workflow/shared 垂直切，入口保留公开 API re-export。对应 S5、R6/R8。

### 上下文文件

- CodeGraph: `handleFeishuModelCommand` / `handleFeishuTaskCommand` / `handleFeishuMcpCommand` / `handleFeishuWorkflowCommand` / `reportCommandResult`
- 必读: `electron/scheduling/command-handler.ts` — shared（约 L19–95）；model（约 L97–203）；task（约 L205–461）；mcp（约 L463–578）；workflow（约 L580–末）
- 必读: `electron/scheduling/AGENTS.md` — 模块边界；须更新子文件表
- 必读: `electron/scheduling/command-executor.ts` — 调用方如何 import handler（保持入口路径）

### 实现范围

- 新建（均 ≤300）:
  - `electron/scheduling/command-handler-shared.ts` — `reportCommandResult`、`runWithHttpCommandResultSink`、`ListedModel`/`parseListModelsStdout` 等共享
  - `electron/scheduling/command-handler-model.ts`
  - `electron/scheduling/command-handler-task.ts`
  - `electron/scheduling/command-handler-mcp.ts`
  - `electron/scheduling/command-handler-workflow.ts`
- 修改: `command-handler.ts` — 薄入口 re-export 上述公开符号；**≤300**
- 修改: `electron/scheduling/AGENTS.md` — 补充子文件职责；单文件 ≤300；公开入口仍为 `command-handler.ts`
- 禁止: 改斜杠产品语义、spawn Agent、新建 barrel `index.ts`

### 接口契约

- 仍可从 `command-handler` 入口 import：`handleFeishuModelCommand` / `Task` / `Mcp` / `Workflow`、`reportCommandResult`、`TaskRunFn`、`TaskEnqueueFn` 等
- 函数签名与错误文案策略不变

### 验收标准

- [ ] 入口与全部 `command-handler-*.ts` ≤300
- [ ] 授权斜杠 model/task/mcp/workflow 主路径与拆分前一致（01 §七·7.3）
- [ ] `AGENTS.md` 已更新；中文注释；Ponytail
- [ ] **不得** defer 本任务

### 依赖

- 前置任务: 无
- 后续任务: T10

---

## T9: updater 按职责拆分（本轮必做）

### 背景

01 原标三期可选；**禁止 defer**。将 `updater.ts`（864 行）按 types/modal/release/apply 拆分，入口保留 `initAppUpdater` / `registerUpdaterIpc` / `fetchLatestRelease` 等公开 API。对应 S6、R7/R8。

### 上下文文件

- CodeGraph: `initAppUpdater` / `registerUpdaterIpc` / `fetchLatestRelease` / `runBrewUpgrade` / `wireAutoUpdater` / `UpdaterCheckResult`
- 必读: `electron/config/updater.ts` — types（约 L25–88）；modal（约 L145–243）；release/changelog（约 L245–468）；apply/brew/win/startup/IPC（约 L470–末）
- 必读: `electron/config/AGENTS.md` — 须更新 updater 子文件边界
- 参考: `electron/main.ts` — 如何调用 `initAppUpdater`（保持 import 路径）

### 实现范围

- 新建（均 ≤300）:
  - `electron/config/updater-types.ts` — `LatestRelease`、`UpdaterCheckResult`、`UpdaterApplyResult` 等
  - `electron/config/updater-modal.ts` — `showAppModal*` / `ensureModalProcessor` / `promptInstallDownloaded`
  - `electron/config/updater-release.ts` — fetch release、changelog、`resolveReleaseNotes`
  - `electron/config/updater-apply.ts` — brew/win apply、`wireAutoUpdater`、cache 清理
- 修改: `updater.ts` — 组装入口：`runStartupUpdateCheck`、`registerUpdaterIpc`、`initAppUpdater`、re-export 类型；**≤300**
- 修改: `electron/config/AGENTS.md` — 子模块表；入口仍为 `updater.ts`
- 禁止: 改更新渠道策略默认值、IPC channel 名；新建 barrel

### 接口契约

- `initAppUpdater` / `registerUpdaterIpc` / `fetchLatestRelease` 等公开符号仍从 `updater` 入口导出
- 检查/安装用户可见流程与拆分前一致

### 验收标准

- [ ] `updater.ts` 及全部 `updater-*.ts` ≤300
- [ ] 更新检查与应用主路径语义不变（01 §七·7.3）
- [ ] `AGENTS.md` 已更新；中文注释；Ponytail
- [ ] **不得** defer 本任务

### 依赖

- 前置任务: 无
- 后续任务: T10

---

## T10: 全量行数门禁、renderer AGENTS 与行为回归

### 背景

收口任务：确认白名单内全部源文件 ≤300；沉淀 `src/renderer/components/AGENTS.md`（Settings Tab / ChannelPanel / Dashboard 结构）；按 01 §七 + 02 §八·（二）做行为等价核对；确认未碰排除名单。

### 上下文文件

- 必读: 同目录 `01-proposal.md` §七验收、场景 S1～S7
- 必读: 同目录 `02-design.md` §八·（二）工程补充验收项、§一白名单
- 必读: T1～T9 产出的全部新建/瘦身文件路径
- 必读: `src/renderer/components/AGENTS.md` — 追加 Settings pages Tab、ChannelEditModal、Dashboard 子组件约定
- 参考: `src/bridge/AGENTS.md`、`electron/scheduling/AGENTS.md`、`electron/config/AGENTS.md` — 抽检 T4/T8/T9 是否已写全

### 实现范围

- 修改: `src/renderer/components/AGENTS.md` — 增加：
  - `pages/Settings*.tsx` Tab 拆分与壳职责（或注明路径在 `pages/`）
  - `ChannelEditModal` / `channel-panel-helpers`
  - `DashboardOnboard` / `DashboardStatusCards` / `DashboardLogPanel`
- 验证（必须执行；失败则最小接线修复，不得扩 scope）:
  1. `wc -l` 白名单：所有本变更改动/新建的 `.ts`/`.tsx` ≤300
  2. `lark-core.js` 导出符号不减少（re-export 允许）
  3. 未修改 `src/daemon/**`、`workflow-engine.ts`、`wechat-manager.ts` 业务实现
  4. 飞书 S1/S2、设置 S3、通道 S4、斜杠 S5、更新 S6、Dashboard S8 行为等价清单勾选
  5. 中文注释；无无关默认值/文案/IPC 变更
- 禁止: 借回归引入新功能或 defer 残留超限文件

### 接口契约

- 无新对外接口；回归证明既有契约保持

### 验收标准

- [ ] 白名单内每个相关 `.ts`/`.tsx`：`wc -l` ≤300（含全部新建）
- [ ] 02 §八·（二）全部勾选通过
- [ ] 01 §七·7.1～7.4 对应项可追溯到 T1～T9 完成态
- [ ] `components/AGENTS.md` 已沉淀 UI 拆分边界
- [ ] 无未批准抽象/新依赖（Ponytail）；无 defer 超限债

### 依赖

- 前置任务: T4, T5, T6, T7, T8, T9
- 后续任务: 无
