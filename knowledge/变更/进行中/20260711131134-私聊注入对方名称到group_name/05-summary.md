# 私聊注入对方名称到 group_name - 变更总结

## 1、实际变更

| 路径 | 改动摘要 |
|------|----------|
| `electron/agent/shared/agent-launcher.ts` | `buildPrompt` 增可选末参 `senderOpenId`，经 `resolveSessionChatName` 命中私聊用户名缓存后首行注入 `group_name:` |
| `electron/agent/cursor-sdk/agent-sdk.ts` | launch/dispatch 调用 `buildPrompt` 透传 `senderOpenId` |
| `electron/agent/claude-code/agent-claude-sdk.ts` | 同上 |
| `electron/agent/codex/agent-codex-sdk.ts` | 同上 |
| `electron/agent/opencode/agent-opencode-sdk.ts` | 同上 |
| `electron/agent/shared/AGENTS.md` | 模块边界：有名注入 / 四引擎透传约定 |
| `src/shared/feishu-addons.ts` | `FEISHU_MENU_SCOPES` 增 `contact:contact.base:readonly` |
| `src/shared/AGENTS.md` | feishu-addons 两套权限 SSOT 与 map 派生约定 |
| `package.json` | version `1.14.1` → `1.14.2` |
| `changelog/1.14.2.json` | 用户可见变更条目 |
| `knowledge/业务域/Agent调度/03-启动与自动重连.md` | Prompt 解析含私聊 `senderOpenId` |
| `knowledge/业务域/消息桥接/02-飞书通道.md` | 扫码增量 scopes 含 contact |
| 本目录 `05-summary.md` | 本总结 |

## 2、与设计的差异

无。实现与 `02-design.md` A3/A4/C2 一致；未改群聊路径、`REQUIRED_FEISHU_SCOPES`、Daemon poll / `fetchUserNames`。

## 3、影响范围

- **模块**：agent-launcher、四引擎 sdk、feishu-addons、Settings 扫码增量表（经 map 自动展示）
- **接口**：无新 HTTP/proto；`buildPrompt` 可选末参向后兼容
- **数据**：无持久化变更；沿用 chatNameCache（chatId / open_id）

### 3.1 Ponytail 技术债

无（本次 diff 无新增 `ponytail:` 注释）。

## 4、知识库影响清单

- [x] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — 「二」Prompt：私聊经 `senderOpenId` 命中用户名；格式仍 `group_name:`；无名省略
- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — 扫码增量 scopes 含 `contact:contact.base:readonly`
- [x] `electron/agent/shared/AGENTS.md` / `src/shared/AGENTS.md` — 代码约定已在 apply 对齐（非业务域正文）
- [x] `knowledge/业务域/Agent调度/00-README.md` / `01-概览.md` — 入口未失真，无需更新
- [x] `knowledge/业务域/消息桥接/00-README.md` — 入口未失真，无需更新
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新
