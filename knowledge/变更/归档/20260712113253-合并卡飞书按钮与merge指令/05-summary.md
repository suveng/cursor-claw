# 合并卡飞书按钮与merge指令 - 变更总结

## 1、实际变更

| 路径 | 关键改动 |
|------|----------|
| `src/shared/feishu-addons.ts` | `FEISHU_MENU_EVENTS` 增 `card.action.trigger` |
| `src/bridge/lark-core.ts` | 注册 `card.action.trigger` handler；`return await onCardAction` 透传 toast；`FeishuCardActionEvent` 类型 |
| `src/bridge/AGENTS.md` | 卡片回调透传约定 |
| `src/daemon/feishu-card-action.ts` | **新增** 合并卡按钮路由、500ms 防抖、`merge_action` 日志 |
| `src/daemon/daemon-merge-command.ts` | **新增** `/merge` 斜杠 Daemon 内闭环 |
| `src/daemon/daemon-merge-action-feedback.ts` | **新增** 用户可见文案 SSOT |
| `src/daemon/daemon.ts` | 注入 `onCardAction`；`handleCommand` 先 `tryHandleMergeSlashCommand`；COMMANDS 增 `/merge` |
| `src/shared/feishu-help-text.ts` | help 文案增 `/merge` |
| `src/daemon/AGENTS.md` | 新模块边界与 `merge_action` 日志约定 |

## 2、与设计的差异

无。R1（toast 透传）经 T-FIX-01 修复并复评通过；与 `02-design` §二双入口、SSOT、防抖决策一致。

## 3、影响范围

- **飞书 WS**：`card.action.trigger` 订阅与回调链（按钮 → `handleMergeBatchAction`）。
- **斜杠**：`/merge` send|split|edit 不经 `.fcmd`，与按钮共用防抖与文案。
- **合并控制 SSOT**：`handleMergeBatchAction`（HTTP 入口未改语义）。
- **可观测**：`merge_action` 结构化日志（`action`、`session_key`、`ok`、`source`、`error`）。

### 3.1 Ponytail 技术债

无（本次 diff 未新增 `ponytail:` 注释）。

## 4、知识库影响清单

- [x] `knowledge/工程平台/Daemon守护进程/01-概览.md` — §九 关闭 T8；注明按钮与 `/merge` 双入口
- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — §三 `card.action.trigger`；§九 移除按钮未接线
- [x] `knowledge/业务域/Agent调度/04-远程指令.md` — 合并控制表增按钮与 `/merge`；§九 更新限制
- [x] `knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md` — §三 `/merge` 闭环与三入口 SSOT
- [x] `knowledge/业务域/消息桥接/01-概览.md` — §三 主流程补按钮/斜杠分支；§九 关闭 T8
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新

## 5、验收与归档债务

| 项 | 状态 | 说明 |
|----|------|------|
| 静态检查（tsc/grep） | ✅ | 见 `06-automation-test.md` §4.1 |
| R1 toast 透传 | ✅ | T-FIX-01 已修复 |
| D1 `lark-core.ts` 行数 | ⚠️ 接受债务 | 1190 行，整体拆分另开任务 |
| S-E2E-01～07 飞书实机 | ⏳ 待用户 | 订阅、toast UI、M7 排队、R5 联调 |
| §八·1 运维订阅实测 | ⏳ 待用户 | 代码 SSOT 已补 addons |

归档建议：`archived_with_debt`（D1 + E2E 待用户项）；由 kb-release 迁移目录与 commit。
