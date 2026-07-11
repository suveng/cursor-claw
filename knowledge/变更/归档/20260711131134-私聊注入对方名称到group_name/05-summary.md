# 私聊注入对方名称到 group_name - 变更总结

## 1、实际变更

| 路径 | 改动摘要 |
|------|----------|
| `src/daemon/daemon.ts` | `pushMessage` 入队前 `resolveLaunchChatName`；有名则正文末尾 append `\ngroup_name: <名称>`；失败/无名不拼、不阻断 |
| `src/daemon/chat-name-resolve.ts` | 新增：按 chat_type 解析群名/私聊对方显示名（复用于入队） |
| `src/daemon/AGENTS.md` | Daemon 入队拼尾约定 |
| `electron/agent/shared/agent-launcher.ts` | `buildPrompt` 仅透传 `taskMessage`；废止首行 `group_name:` 注入 |
| `electron/agent/cursor-sdk/agent-sdk.ts` | 去掉仅为首行注入的 `buildPrompt` 透传 |
| `electron/agent/claude-code/agent-claude-sdk.ts` | 同上 |
| `electron/agent/codex/agent-codex-sdk.ts` | 同上 |
| `electron/agent/opencode/agent-opencode-sdk.ts` | 同上 |
| `electron/agent/shared/AGENTS.md` | Prompt 不再首行注入；入队拼尾归 Daemon |
| `electron/session/session-dispatcher.ts` | 拉名失败 WARN 节流（既有可观测增强，Rev1 保留） |
| `electron/session/AGENTS.md` | 与 session 侧约定对齐 |
| `src/shared/feishu-addons.ts` | `FEISHU_MENU_SCOPES` 增 `contact:contact.base:readonly`（T2） |
| `src/shared/AGENTS.md` | feishu-addons 权限 SSOT 约定 |
| `package.json` | version `1.14.2`（本变更预留，复用） |
| `changelog/1.14.2.json` | 用户可见变更（Rev1 口径） |
| 本目录 `01`～`08` / `00-manifest.json` | 变更文档与状态 |
| `knowledge/业务域/Agent调度/03-启动与自动重连.md` | **已更新**：注入改为入队正文末尾；废止 Prompt 首行 |
| `knowledge/业务域/消息桥接/02-飞书通道.md` | **已更新**：扫码 contact / 入队正文约定 |

## 2、与设计的差异

无（相对 Rev1）。实现与 `02-design.md` A1–A3 / B1–B2、`04-review` 通过结论一致：入队拼尾；`buildPrompt` 不再首行注入；launch `chat_name` 保留供会话列表/广播；T2 contact 权限仍有效；T1 / T-FIX-1 / T-FIX-2 已作废。

## 3、影响范围

- **模块**：Daemon 入队（`pushMessage` + chat-name-resolve）、agent-launcher / 四引擎 Prompt 收敛、feishu-addons 扫码权限、session 拉名 WARN
- **接口**：无新 HTTP/proto；入队正文约定 `\ngroup_name: <名称>`
- **数据**：无持久化变更；沿用 chatNameCache / 飞书拉名

### 3.1 Ponytail 技术债

无（本次 diff 无新增 `ponytail:` 注释；既有注释非本变更引入）。

## 4、知识库影响清单

> 业务域正文由 **kb-librarian** 写入；本清单仅列目标，勿在 scribe 轮改业务域正文。

- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — **必须**：注入改为入队正文末尾 `\ngroup_name:`；废止 Prompt 首行描述
- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — **可能**：扫码增量 scopes 含 `contact:contact.base:readonly`；若写明入队正文约定则同步
- [x] `src/daemon/AGENTS.md` / `electron/agent/shared/AGENTS.md` / `electron/session/AGENTS.md` / `src/shared/AGENTS.md` — apply 已对齐（非业务域正文）
- [x] `knowledge/业务域/Agent调度/00-README.md` / `01-概览.md` — 入口未失真，无需更新
- [x] `knowledge/业务域/消息桥接/00-README.md` — 入口未失真，无需更新
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新

## 5、用户可见变更

- 飞书私聊/群聊消息入队时，能取得名称则在消息正文末尾追加 `group_name`（私聊=对方显示名，群聊=群名），Agent 可在用户消息末尾看到
- 拿不到名称时不追加该行，不阻断发消息
- 扫码更新权限清单含通讯录读权限，便于开通获取用户名
