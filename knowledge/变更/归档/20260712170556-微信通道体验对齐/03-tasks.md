# 微信通道体验对齐 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）
> **一期范围**：文案 / 能力对照 / typing 终态停；**二期**合并/菜单不在本变更
> **质量门**：终态 `stopSessionProgress` 补漏等可修项**禁止 defer**

## 一、执行计划

### （一）依赖图

```
T1 ──┐
T2 ──┼──→ T5
T3 ──┤
T4 ──┘
T1～T4 无互相依赖（不同文件簇；T3/T4 若同改 wechat-manager 则改串行）
```

### （二）分组调度

| 轮次 | 并行任务 | 说明 |
|------|----------|------|
| 第一轮 | T1、T2、T3、T4 | UI 文案与 Daemon/Bridge 进度互不阻塞 |
| 第二轮 | T5 | 飞书回归抽检 + 行数/注释收尾 |

## 二、任务清单

## T1: ChannelEditWechat 群模式文案

### 背景
01 R1/R2、S1/S2：群策略 option 仅有短 label，用户不知启发式局限与 `all` 适用场景。在既有辅助说明区补文案，不改 gate 逻辑、无新视觉。

### 上下文文件
- CodeGraph: `ChannelEditWechat` — 群策略 UI 落点
- 必读: `src/renderer/components/ChannelEditWechat.tsx` — 现有 select/显示名控件
- 必读: `knowledge/业务域/消息桥接/03-微信通道.md` — 产品限制口径
- 参考: `src/daemon/wechat-group-enqueue-gate.ts` — 行为 SSOT（只读对齐文案）

### 实现范围
- 修改: `ChannelEditWechat.tsx` — 在「群聊入队策略」「机器人显示名」旁补用户可读说明：
  - `mention_required`：须 @；正文启发式可能误判
  - `all`：小群/无稳定 @ 习惯时适用
  - 显示名：参与 @ 匹配（可选）
  - 排障：日志关键字 `wechat_group_skip`
- 不改: 字段形状、gate 纯函数、`ChannelPanel` 列表

### 接口契约
- 无新 IPC/字段；仍 `set({ wechatGroupEnqueueMode | wechatBotDisplayName })`
- 文案可 inline；**禁止**预建帮助框架或跨文件抽象（仅当与 T2 出现重复句时才抽同文件常量）

### 验收标准
- [ ] 设置编辑微信通道可见：启发式局限、`all` 场景、显示名用途、`wechat_group_skip`（01 §6.1-1、R1/R2；02 八·（二））
- [ ] option 名称与真实入队语义一致（须 @ vs 全量）
- [ ] 无新布局组件/路由；文件 ≤300 行；中文注释；无未批准抽象/新依赖（Ponytail）

### 依赖
- 前置任务: 无
- 后续任务: T5

---

## T2: SettingsSetupTab 主次通道能力对照

### 背景
01 R5、S5：帮助 Tab 偏飞书权限，无飞书/微信能力差异说明。在既有引导区块新增对照摘要，口径对齐概览 §九；合并/菜单标「微信一期无」。

### 上下文文件
- CodeGraph: `SettingsSetupTab` — 帮助引导 Tab
- 必读: `src/renderer/pages/SettingsSetupTab.tsx` — 现有配置指引结构
- 必读: `knowledge/业务域/消息桥接/01-概览.md` §九 — 对照表 SSOT
- 参考: `src/renderer/pages/Settings.tsx` — Tab 挂载（只读）

### 实现范围
- 修改: `SettingsSetupTab.tsx` — 新增「主/次通道能力」小节（表格或等价列表），覆盖：
  - 群过滤 / 进行中 / track / 合并·菜单
  - 飞书：协议 @、Get+CardKit、`open_message_id`、有合并/菜单
  - 微信：正文启发式可 `all`、typing 4s 续期、`wxc_<clientId>`、一期无合并/菜单
- 不改: 飞书权限/菜单增量配置正文语义；不新增独立路由

### 接口契约
- 无；静态文案，不持久化
- 禁止新建「帮助中心」服务或未批准共享层

### 验收标准
- [ ] 帮助/引导入口可查阅四项对照，与概览 §九 一致（01 §6.1-4、R5；02 八·（二））
- [ ] 明确微信不假装 CardKit/合并卡/菜单
- [ ] 文件 ≤300 行；中文注释；无未批准抽象/新依赖（Ponytail）

### 依赖
- 前置任务: 无
- 后续任务: T5

---

## T3: 终态 stopSessionProgress 审计补漏

### 背景
01 R4、S4：**质量门禁止 defer**。完成后仍「正在输入」根因是终态漏调 `stopSessionProgress`。须全路径审计完成/失败/取消，缺口必补；飞书 Get 语义不改。

### 上下文文件
- CodeGraph: `stopSessionProgress` — 停 typing SSOT（`daemon-presentation-handlers.ts`）
- 必读: `src/daemon/daemon-presentation-handlers.ts` — `stopSessionProgress` → `stopProgressTyping`
- 必读: `src/daemon/daemon-presentation-stream.ts` — stream-text final
- 必读: `src/daemon/daemon-http-routes-send.ts` — `stop_progress` / send-image|file
- 必读: `src/daemon/daemon-queue.ts`、`daemon-orchestrator-notify.ts`、`daemon-presentation-ordering-release.ts` — 取消/notify/释放
- 参考: `src/daemon/AGENTS.md` — 会话进度规矩；`src/bridge/wechat-manager.ts` `stopProgressTyping`

### 实现范围
- 审计清单（须逐条核对并记录结论；缺口**本任务内修复**）：
  1. `ackOnReply` / presentation 转发
  2. `/api/stream-text` final
  3. send-text `stop_progress`、send-image、send-file
  4. notify 失败且需停进度
  5. 队列取消/释放 / ordering-release
- 修改: 上述缺调用的文件 — 在终态补 `deps.stopSessionProgress(sessionKey)`（或既有等价路径）
- 不改: 飞书 CardKit 卡片形态；不重写 typing 续期主体

### 接口契约
- 沿用 `stopSessionProgress(sessionKey: string): void`
- 微信分支经 handlers 调 `stopProgressTyping(chatId)` 并清 timer

### 验收标准
- [ ] 完成、失败、取消路径均覆盖 `stopSessionProgress`，无遗漏（01 §6.1-3、R4；02 八·（二））— **禁止 defer**
- [ ] 任务结束后微信无残留「正在输入」
- [ ] 飞书主路径 stop/Get 行为无故意变更
- [ ] 触改文件 ≤300 行（超限就地拆最小相关函数）；中文注释；无未批准抽象（Ponytail）

### 依赖
- 前置任务: 无
- 后续任务: T5

---

## T4: 长任务 typing 可感知与续期可观测

### 背景
01 R3、S3：长任务须能感到仍在处理；现网 4s 续期已有，须联调/契约确认 `wechat_typing_refresh` 可持续出现，续期失败须 WARN；最小修复，不改飞书。

### 上下文文件
- CodeGraph: `startProgressTyping` / `stopProgressTyping` — 续期与停
- 必读: `src/bridge/wechat-manager.ts` — 4s 定时器与 `wechat_typing_refresh` 日志
- 必读: `src/daemon/daemon-presentation-enqueue.ts` — 入队启 typing
- 参考: 归档 `20260712145946` 契约脚本（若有）— 复用约定口径

### 实现范围
- 核对: 续期间隔与 INFO `wechat_typing_refresh`、失败 WARN 已接线；缺则补
- 修改（仅必要时）: `wechat-manager.ts` — 可观测或最小续期修复；**不**顺手全量拆 387 行预存债（02 明示）
- 约定验收: ≥2 分钟窗口内应持续出现 refresh 日志（实机或契约）；与 T3 终态停衔接

### 接口契约
- 沿用 `startProgressTyping` / `stopProgressTyping`；无新协议字段

### 验收标准
- [ ] 长任务约定窗口内 typing 不长时间中途消失；refresh 可观测（01 §6.1-2、R3；02 八·（二））
- [ ] 续期失败有 WARN；成功有可检索日志关键字
- [ ] 不改飞书进度形态；manager 大拆不属本期；中文注释；无未批准抽象（Ponytail）

### 依赖
- 前置任务: 无（若与 T3 同改 `wechat-manager.ts` 则串在 T3 后）
- 后续任务: T5

---

## T5: 飞书回归与收尾自检

### 背景
01 R6、S6：共享 presentation/进度路径上的文案与 stop 补漏不得破坏飞书主通道。汇总 T1–T4 后做抽检与行数/注释门禁。

### 上下文文件
- CodeGraph: 飞书 presentation / MergeBatch 入口（只读对照）
- 必读: T1–T4 触改文件 diff
- 参考: `knowledge/业务域/消息桥接/02-飞书通道.md` — 主路径预期

### 实现范围
- 抽检: 飞书入队、合并卡、菜单、Get+CardKit/进度展示无退化
- 自检: 触改文件 ≤300 行、中文注释、无未批准抽象；文案与概览 §九 无双口径
- 不改: 二期 R7/R8；协议层

### 接口契约
- 无

### 验收标准
- [ ] 飞书主路径抽检通过（01 §6.1-5、R6；02 八·（二））
- [ ] 微信能力说明与行为一致；终态无残留 typing；长任务可感知
- [ ] 一期不交付合并/菜单；无 02/03 未要求的抽象层（Ponytail）

### 依赖
- 前置任务: T1、T2、T3、T4
- 后续任务: 无

---

## T-FIX-01: 拆分 wechat-manager typing 进度簇（R1）

### 背景
评审 R1：触改后 `wechat-manager.ts` 仍 391 行 > AGENTS ≤300；禁止 accepted_debt，须拆出 typing 进度相关实现。

### 上下文文件
- 必读: `src/bridge/wechat-manager.ts` — 门面
- 必读: `src/bridge/AGENTS.md` — 微信子模块边界
- 参考: `04-review.md` R1

### 实现范围
- 新增: `wechat-progress-typing.ts` — ticket + 4s 续期 timer；`start/stopProgress` / `ensure` / `cancel`
- 新增: `wechat-manager-types.ts` — 对外类型（压门面行数）
- 修改: `wechat-manager.ts` — 委托 typing；对外 API 不变；`stop()` 清全部 timer
- 修改: `bridge/AGENTS.md` — 子模块职责表一句

### 接口契约
- 域外仍仅经 `wechat-manager.js`：`startProgressTyping` / `stopProgressTyping` / `sendText` / `sendMedia`
- 禁止 daemon 直引 `wechat-progress-typing`

### 验收标准
- [x] `wechat-manager.ts` 与新增文件均 ≤300 行
- [x] 对外 API 与续期可观测关键字不变
- [x] 中文注释；无未批准抽象

### 依赖
- 前置任务: T4、T5
- 后续任务: 无

---

## T-FIX-02: finishFinal ack-or-stop 终态必停（R2）

### 背景
评审 R2：`finishFinal("ack-or-stop")` 有 `message_id` 时仅调 `ackOnReply`；`ackOnReply` 在 ack 空集早退且不 stop，可能残留 typing。须与 send-image/file 双调对齐。

### 上下文文件
- 必读: `src/daemon/daemon-presentation-stream.ts` — `finishFinal`
- 必读: `src/daemon/daemon-presentation-ordering-release.ts` — 同构
- 参考: `src/daemon/daemon-http-routes-send.ts` send-image/file；`daemon-queue.ts` `ackOnReply`

### 实现范围
- 修改: stream / ordering-release 的 `finishFinal` — ack 后无条件再调 `stopSessionProgress`（幂等）
- 修改: `daemon/AGENTS.md` — 完成路径须 stop 编码规矩

### 接口契约
- `stopSessionProgress(sessionKey)` 无 state 早退（幂等）
- 失败路径 `stop-only` 仍只 stop、不 ack

### 验收标准
- [x] 有 `message_id` 且 ack 空集时仍 stop
- [x] 与 send-image/file 双调语义一致
- [x] 触改文件 ≤300；中文注释

### 依赖
- 前置任务: T3
- 后续任务: 无
