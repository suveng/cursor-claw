# cursor-claw规则SDK-only对齐 - 变更总结

> **变更 ID**：`20260711233412-cursor-claw规则SDK-only对齐`
> **来源**：kb-lite
> **lite 类型**：知识同步型 lite
> **阶段**：`applied`（LITE-01 done；待 `/kb-archive` 迁移）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `resources/template/rule/cursor-claw.mdc` | 顶部 **Legacy 废弃说明**；`alwaysApply: false`；正文改写为 **SDK 长驻 Agent 通信约定**（dispatch 入站、`send_text`/Presentation 出站、四阶段状态机）；**移除** poll-message、Shell 保活轮询及 CLI 五阶段主路径表述 |
| `README.md` | L46–65 架构图：Electron 标注「Rules 不自动注入」；`.cursor/rules/` 改为可选手动 inject；MCP 区块为 `dispatch 入站（Daemon→SDK）`；去除运行时依赖 `cursor-claw.mdc` 的图示暗示 |
| `README.md`（修订） | L34 功能表「工作区注入」与 L46 对齐：去除「自动写入 Loop 协议规则」；改为 launch 写入 mcp.json、Rules 不自动注入（workspace-injector no-op）、Skills 可选、Loop/cursor-claw.mdc 可选手动 inject |
| `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` | 「工作区注入」表后补 **Legacy 指针**：`cursor-claw.mdc` 仅供手动参考、launch 不注入；链至 Agent调度/03；「十、变更记录」追加本 lite 摘要 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入（显式）**：`src/`、`electron/` 业务代码；`electron/agent/shared/AGENTS.md`（KB 已覆盖，未重复增链）；`knowledge/知识地图.md`、`knowledge/知识索引.md`；进行中变更 `20260711232258-*`、`20260711232817-*`。

**统计**：1 规则模板 + 1 根 README 架构图区块 + 1 工程平台叶子知识文件；无运行时行为变更。

## 2、与设计的差异

无，与 `01-proposal.md` 验收标准一致。KB 指针落点择 `04-配置与更新.md`（未改 `AGENTS.md`）。

## 3、影响范围

- **涉及模块**：规则参考模板、仓库根 README 架构示意、Electron 桌面应用配置知识叶子。
- **行为变更**：无；仅文档/模板与现网 SDK-only IM 路径（`workspace-injector` no-op、poll-message 404）对齐。
- **接口/proto/数据**：无契约变更。
- **用户可见性**：手动复制 rule 模板者可见 Legacy 说明；IM 主路径不依赖 rule 注入。

### 3.1 Ponytail 技术债

无（本次 diff 未新增 `ponytail:` 注释）。

## 4、知识库影响清单

知识同步型 lite：以下文件已更新。

| 文件 | 摘要 |
|------|------|
| `knowledge/工程平台/Electron桌面应用/04-配置与更新.md` | `cursor-claw.mdc` Legacy 与 SDK-only 链；工作区注入表语义与模板/README 一致 |

**无需更新**：

- [x] `knowledge/知识索引.md` — 总入口未变化
- [x] `knowledge/知识地图.md` — 领域/分区结构未变
- [x] `knowledge/业务域/**` — 本次为工程平台/模板对齐，业务域事实已在 Agent调度/消息桥接文档中记录
- [x] `electron/agent/shared/AGENTS.md` — `workspace-injector` no-op 已准确；KB 叶子已补链，避免重复
