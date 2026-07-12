# 超限模块拆分续 - 变更总结

## 1、实际变更

纯结构搬迁（行为等价）；白名单内全部 `.ts`/`.tsx` ≤300。

### 桥接（一期）

| 文件 | 改动 |
|------|------|
| `src/bridge/lark-core.ts` | 门面 + re-export（258 行） |
| `lark-types.ts` / `lark-utils.ts` | **新建** |
| `lark-sender-{stream,outbound,merge,progress,help,parse,connection}.ts` | **新建** |
| `src/bridge/AGENTS.md` | 子模块表；勾销「行数债务」 |

### 渲染端（二期）

| 文件 | 改动 |
|------|------|
| `Settings.tsx` + `Settings{General,Proxy,Tasks,Setup,About}Tab.tsx` | 壳 + Tab 垂直切 |
| `ChannelPanel.tsx` + `ChannelEditModal` / `ChannelEditWechat` / `ChannelEditAccess` / `channel-panel-helpers.ts` | 列表壳 + 编辑弹窗 |
| `Dashboard.tsx` + `Dashboard{Onboard,StatusCards,LogPanel,DetailPanels}.tsx` | 主页壳 + 子面板 |
| `src/renderer/components/AGENTS.md` | 沉淀拆分规矩 |

### Electron（三期）

| 文件 | 改动 |
|------|------|
| `command-handler.ts` + `command-handler-{shared,model,task,mcp,workflow}.ts` | 入口 re-export + 按族实现 |
| `updater.ts` + `updater-{types,modal,release,apply}.ts` | 入口 + 职责拆分 |
| `electron/scheduling/AGENTS.md`、`electron/config/AGENTS.md` | 子模块表 |

未改：`src/daemon/**`、`workflow-engine.ts`、`wechat-manager.ts`、`env.d.ts`。

## 2、与设计的差异

无行为偏差。相对 02 初列同轮再切（04 已确认）：`lark-sender-help`、`ChannelEditWechat`/`Access`、`DashboardDetailPanels`。

## 3、影响范围

- 模块：bridge Lark、Settings/Channel/Dashboard、scheduling 斜杠、config updater。
- 接口/数据：无对外 IPC/schema 变更；公开符号经原入口稳定。

### 3.1 Ponytail 技术债

无。

## 4、知识库影响清单

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — 门面 + `lark-sender-*` 阅读路径；勾销行数债
- [x] `knowledge/业务域/消息桥接/00-README.md` — 飞书源码锚点
- [x] `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md` — Settings/Channel/Dashboard 结构
- [x] `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` — updater 拆分；压缩至 ≤3000
- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — command-handler 入口；压缩至 ≤3000
- [x] `knowledge/工程平台/Electron桌面应用/00-README.md` — 03/04 职责摘要
- [x] `knowledge/业务域/消息桥接/01-概览.md` — 术语/架构未变，无需更新
- [x] `knowledge/知识索引.md` — 总入口未变，无需更新
- [x] 目录 AGENTS（bridge/components/scheduling/config）— apply 已同步，archive 核对通过

### 4.1 历史债务勾销

本变更清偿并**关闭**下列指向本议题的行数债（最终走向 `archived`，**禁止** `archived_with_debt` / debt review）：

| 来源 | 项 | 现盘 |
|------|-----|------|
| 巨型单体拆分 T13 / 合并卡 D1 | `lark-core.ts` 超限 | 258 行门面 + `lark-sender-*` |
| 巨型单体拆分 T15 | `command-handler.ts` | 16 行入口 + 分族文件 |
| ChannelPanel / Settings / Dashboard / updater 存量超限 | UI 与更新巨文件 | 各壳与子文件均 ≤300 |

## 5、归档前置说明

- 本文件由 kb-librarian 在步骤 6–7 写入；`manifest.stage` 保持 `reviewed`；目录 mv / stage=`archived` / commit+push 交 **kb-release**。
- `external_sync`: SKIP（无 integrations）。
- **建议白名单**（kb-release 步骤 9；含全部新建源码）见下节。

## 6、建议白名单

### 变更文档

- `knowledge/变更/进行中/20260712170649-超限模块拆分续/00-manifest.json`
- `…/01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`05-summary.md`

### 知识库

- `knowledge/业务域/消息桥接/00-README.md`
- `knowledge/业务域/消息桥接/02-飞书通道.md`
- `knowledge/工程平台/Electron桌面应用/00-README.md`
- `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md`
- `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md`
- `knowledge/工程平台/Electron桌面应用/04-配置与更新.md`

### 代码与目录 AGENTS

- `src/bridge/lark-core.ts`
- `src/bridge/lark-types.ts`
- `src/bridge/lark-utils.ts`
- `src/bridge/lark-sender-stream.ts`
- `src/bridge/lark-sender-outbound.ts`
- `src/bridge/lark-sender-merge.ts`
- `src/bridge/lark-sender-progress.ts`
- `src/bridge/lark-sender-help.ts`
- `src/bridge/lark-sender-parse.ts`
- `src/bridge/lark-sender-connection.ts`
- `src/bridge/AGENTS.md`
- `src/renderer/pages/Settings.tsx`
- `src/renderer/pages/SettingsGeneralTab.tsx`
- `src/renderer/pages/SettingsProxyTab.tsx`
- `src/renderer/pages/SettingsTasksTab.tsx`
- `src/renderer/pages/SettingsSetupTab.tsx`
- `src/renderer/pages/SettingsAboutTab.tsx`
- `src/renderer/pages/Dashboard.tsx`
- `src/renderer/pages/DashboardOnboard.tsx`
- `src/renderer/pages/DashboardStatusCards.tsx`
- `src/renderer/pages/DashboardLogPanel.tsx`
- `src/renderer/pages/DashboardDetailPanels.tsx`
- `src/renderer/components/ChannelPanel.tsx`
- `src/renderer/components/ChannelEditModal.tsx`
- `src/renderer/components/ChannelEditWechat.tsx`
- `src/renderer/components/ChannelEditAccess.tsx`
- `src/renderer/components/channel-panel-helpers.ts`
- `src/renderer/components/AGENTS.md`
- `electron/scheduling/command-handler.ts`
- `electron/scheduling/command-handler-shared.ts`
- `electron/scheduling/command-handler-model.ts`
- `electron/scheduling/command-handler-task.ts`
- `electron/scheduling/command-handler-mcp.ts`
- `electron/scheduling/command-handler-workflow.ts`
- `electron/scheduling/AGENTS.md`
- `electron/config/updater.ts`
- `electron/config/updater-types.ts`
- `electron/config/updater-modal.ts`
- `electron/config/updater-release.ts`
- `electron/config/updater-apply.ts`
- `electron/config/AGENTS.md`
