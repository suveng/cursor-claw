# 飞书机器人自定义菜单快捷指令 - 变更总结

> **范围**：T1–T6 + T-FIX-01（stage: tested + reviewed）。

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `src/shared/feishu-addons.ts` | **新增** — 菜单能力 scopes/events SSOT（`FEISHU_MENU_ADDONS`） |
| `src/shared/feishu-help-text.ts` | **新增** — `buildHelpText(isAdmin)` 帮助文案 SSOT |
| `electron/scheduling/feishu-help-text.ts` | **新增** — 主进程 re-export 帮助文案 |
| `src/bridge/feishu-menu.ts` | **新增** — event_key→斜杠映射、24h 节流、`HELP_CARD_INTERVAL_MS` |
| `src/daemon/feishu-event-handlers.ts` | **新增** — `menu_v6` / `p2p_entered` 事件处理，admin 基于 openId |
| `src/renderer/components/FeishuQrFlow.tsx` | **新增** — 扫码更新权限 UI 流程 |
| `src/bridge/lark-core.ts` | 注册 `menu_v6`、`bot_p2p_chat_entered_v1`；`sendHelpCard` |
| `electron/daemon/daemon-manager.ts` | IPC `feishu:update-app-permissions`；QR 会话互斥（T-FIX-01） |
| `electron/preload.ts` / `src/renderer/env.d.ts` | IPC 类型与桥接 |
| `src/daemon/daemon.ts` | 接线 `feishu-event-handlers`；fcmd 超时 reply 补 `chatId`（T-FIX-01） |
| `src/renderer/components/ChannelPanel.tsx` | 飞书通道「扫码更新权限」入口 |
| `src/renderer/pages/Settings.tsx` | event_key 对照表与菜单配置说明 |
| `src/renderer/constants.ts` | 飞书菜单相关常量 |
| `package.json` | `@larksuiteoapi/node-sdk` **^1.67**；版本 **1.11.0** |
| `package-lock.json` | SDK 依赖锁定 |
| `changelog/1.11.0.json` | 用户可见变更摘要 |

**修复批次 T-FIX-01**：admin 判定与 `chatId` 回退解耦；`register-app` / `update-app-permissions` QR 互斥；`cleanExpiredCommands` 超时回复传入 `parsed.chatId`。

**变更文档**：`00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`、`05-summary.md`（本文件）。

## 2、与设计的差异

| 项 | 设计 | 实际 | 状态 |
|----|------|------|------|
| 功能路径 S1–S6 | 02-design 流程与 event_key 表 | 与 02 一致；fcmd/斜杠路径未改 | ✅ 无功能性偏差 |
| T4 单测 | 映射与节流单测 | 未新增 test；与 AGENTS 不写单测冲突 | R4 false_positive → accepted_debt |
| 单文件 ≤300 行 | 新文件合规 | `ChannelPanel` 658 行、`lark-core` 1154 行 | R5/R6 accepted_debt |

无其他与已确认决策（addons SSOT、私聊范围、群聊/CardKit 不改）相悖的偏差。

## 3、影响范围

- **飞书私聊**：推送事件菜单（`menu_v6`）与进入私聊帮助卡（`p2p_entered` + 24h 节流）并入现有 fcmd 队列，与文本斜杠语义一致。
- **设置页**：存量通道可「扫码更新权限」增量开通菜单相关 scopes/events；与「一键创建应用」并存。
- **权限模型**：管理员菜单项仍走 `denyNonAdmin`；非 admin 点击有明确回复。
- **不变**：群聊菜单、CardKit 合并/流式、微信通道、fcmd 核心调度逻辑。

### 3.1 Ponytail 技术债

无。本次 diff **未新增** ponytail 注释。

存量 accepted_debt（非 ponytail）：R5 `ChannelPanel` 行数超限（`FeishuQrFlow` 已抽出，archive 后持续拆分）；R6 `lark-core` 历史枢纽不拆（本变更仅增量事件注册）。

## 4、知识库影响清单

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — 菜单、帮助卡、扫码开权、event_key 与接口表
- [x] `knowledge/业务域/Agent调度/04-远程指令.md` — 菜单触达与 event_key 映射、同路径入队
- [x] `knowledge/业务域/消息桥接/01-概览.md` — 边界与术语表补「菜单触达」
- [x] `knowledge/业务域/消息桥接/03-微信通道.md` — 无变更
- [x] CardKit / 工作流 / MCP 独立文档 — 不在范围（02 §十·（三））
