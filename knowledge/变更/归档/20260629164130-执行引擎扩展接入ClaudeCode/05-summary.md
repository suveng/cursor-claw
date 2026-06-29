# 执行引擎扩展接入ClaudeCode - 变更总结

## 1、实际变更

**新增文件（6 个 CC 执行引擎）**：

| 文件 | 行数 | 职责 |
|------|------|------|
| `electron/agent-claude-sdk.ts` | 293 | 主入口：会话 Map、launch/dispatch、guard 单飞 |
| `electron/agent-cc-types.ts` | 93 | 类型：ClaudeCodeLaunchOptions、CcSessionAgent、CLAUDE_CODE_MODEL_LIST |
| `electron/agent-cc-utils.ts` | 135 | spawn env/args 构建 |
| `electron/agent-cc-stream.ts` | 289 | watchdog、流式缓冲、completeCcRun |
| `electron/agent-cc-events.ts` | 257 | SDK stdout JSON → presentation event |
| `electron/agent-cc-http.ts` | 290 | HTTP server（cc-agent-api-port.json）、/api/cc/agent/launch + dispatch |

**修改文件（11 个）**：

| 文件 | 改动要点 |
|------|----------|
| `src/shared/channel-types.ts` | AgentResource.type 加 "claude-code" union |
| `electron/config-store.ts` | 持久化 Claude Code Profile |
| `electron/context-usage.ts` | claude-code 模型不查 Cursor.models.list |
| `electron/command-handler.ts` | /model ls 改用 CLAUDE_CODE_MODEL_LIST import |
| `electron/main.ts` | 新增 cc:check-api-key、cc:list-models IPC handlers |
| `electron/daemon-manager.ts` | re-export CC 相关函数 |
| `electron/session-dispatcher.ts` | resource.type === "claude-code" 路由到 CC 引擎 |
| `src/renderer/components/AgentPanel.tsx` | Claude Code Profile 管理 UI |
| `src/renderer/pages/Settings.tsx` | 设置面板 Claude Code 区块 |
| `electron/preload.ts` | 渲染层 IPC bridge 补全 |
| `src/renderer/env.d.ts` | TypeScript 类型声明（AgentResource、ElectronAPI） |

## 2、与设计的差异

1. **CC 引擎独立 HTTP server 端口**：设计 §4.2 预期共用 agent-api 端口，实际实现 `listen(0)` 分配随机端口并写入 `cc-agent-api-port.json`，与 agent-sdk.ts 模式一致，功能正常。
2. **launchCcAgentFromHttp 参数来源**：设计伪代码含 `api_key: resource.apiKey`，实际从 `channel_id` 解析 apiKey/baseUrl，安全性更高。

## 3、影响范围

涉及模块：Agent 调度（session-dispatcher、daemon-manager）、新增 CC 执行引擎、渲染层 AgentPanel/Settings、config-store 配置持久化。

调用链：`Daemon POST /api/cc/agent/launch` → `agent-cc-http.ts:handleCcHttpRequest` → `launchCcAgentFromHttp` → `launchClaudeCodeAgent (agent-claude-sdk.ts)` → spawn claude CLI → `streamCcEvents (agent-cc-events.ts)` → `postPresentationEvent`。

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `electron/agent-cc-types.ts:59` | abortController 字段及所有调用是死代码，.signal 未传给 spawn/fetch | 删除字段声明、初始化、重置、abort 调用约 4 行 |
| `electron/agent-cc-http.ts:49-113` | checkClaudeCodeApiKey 手写 65 行 https.request | 改用 global fetch()，压缩至约 15 行 |
| `electron/agent-claude-sdk.ts:136-155` vs `183-198` | launch/dispatch 重复 spawn 逻辑约 70 行 | 提取 spawnCcChild 公共函数合并 |

## 4、知识库影响清单

- [ ] `knowledge/业务域/Agent调度/00-README.md` — 文件清单加 CC 引擎 6 个新文件；关键源码加 CC 入口
- [ ] `knowledge/业务域/Agent调度/01-概览.md` — 架构图加 Claude Code 执行路径节点
- [ ] `knowledge/业务域/Agent调度/03-启动与自动重连.md` — 补充 CC SDK 启动路径、resident 模式、接口说明
- [x] `knowledge/业务域/Agent调度/02-多会话模型.md` — CC session 行为与 SDK 一致，不需要更新
- [x] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — 仅新增 2 个 cc:* IPC handler，未超阈值，不需要更新
- [x] `knowledge/知识索引.md` — Agent 调度域入口无变化，不需要更新
