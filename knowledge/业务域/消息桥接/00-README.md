# 消息桥接

> 将飞书 / 微信用户消息接入 Daemon，经文件队列投递给 Agent，并将 Agent 回复路由回对应通道。

## 文件清单

| 编号 | 文件 | 职责 |
|------|------|------|
| 00 | [00-README.md](./00-README.md) | 领域局部索引（本文件） |
| 01 | [01-概览.md](./01-概览.md) | 模块总图、术语、依赖 |
| 02 | [02-飞书通道.md](./02-飞书通道.md) | WebSocket 接收、LarkSender 发送、权限与消息类型 |
| 03 | [03-微信通道.md](./03-微信通道.md) | iLink API、扫码登录、ClawBot 长轮询 |
| 04 | [04-消息队列与路由.md](./04-消息队列与路由.md) | file-queue 子模块族、session_key、双通道并存 |

## 职责边界

**负责**：多通道（飞书 / 微信）消息收发、入队、会话路由、媒体缓存、通道状态上报。

**不负责**：Electron SDK launch 实现（见 Agent 域）、Electron 设置 UI 凭据录入、工作流 / 指令子系统细节（仅说明入队前拦截点）。

## 源码锚点

| 模块 | 路径 |
|------|------|
| 飞书门面 | `src/bridge/lark-core.ts`（`LarkSender` + re-export；域外唯一入口） |
| 飞书子模块 | `lark-types` / `lark-utils` / `lark-sender-{stream,outbound,merge,progress,help,parse,connection}.ts` |
| 通道类型 | `src/shared/channel-types.ts` |
| 微信客户端 | `src/bridge/wechat/` |
| 微信管理 | `src/bridge/wechat-manager.ts`（门面；typing 见 `wechat-progress-typing.ts`） |
| 文件队列 | `file-queue.ts`（入口）+ `file-queue-*.ts` 子模块（`AGENTS.md`） |
| Daemon 薄组装 | `src/daemon/daemon.ts`（`daemonMain` ≤200） |
| Daemon 队列/合并 | `daemon-queue.ts`（`createQueueController`）、`daemon-queue-types.ts`、`daemon-queue-merge*.ts` |
| Daemon 通道 | `daemon-channel.ts`（`createChannelRegistry`）、`daemon-channel-feishu.ts`、`daemon-channel-wechat.ts` |
| Daemon 日志/接线 | `daemon-logging.ts`、`daemon-wire.ts`、`daemon-bootstrap.ts` |
| Daemon HTTP | `daemon-http-server.ts`、`daemon-http-routes*.ts`、`daemon-http-mcp.ts`、`daemon-http-non-api-routes.ts` |
| Daemon 编排 | `daemon-orchestrator.ts`（claim/dispatch；MergeBatch claim 经 `daemon-http-routes-orchestrator.ts`） |
| Presentation 出站 | `daemon-presentation-enqueue.ts`、`daemon-presentation-stream.ts`、`daemon-presentation-handlers.ts` 及 `daemon-presentation-*` |
| 飞书事件 | `feishu-event-handlers.ts` |

## 推荐阅读路径

1. **01-概览** — 建立全局认知
2. **04-消息队列与路由** — claim/dispatch 与子模块落点（§二/§五）
3. **02-飞书通道** 或 **03-微信通道** — 按接入平台选读
4. 配置细节见根目录 `README.md`「平台接入配置」

## 变更记录

2026-07-12：飞书锚点补 `lark-sender-*` 门面/子模块；勾销 lark-core 行数债（archive 20260712170649）。
2026-07-12：勾销批2 注记；queue/channel/logging 锚点迁至 `daemon-queue*`/`daemon-channel*`/`daemon-logging`（archive 20260712170438）。
2026-07-12：file-queue 子模块族锚点与阅读路径（archive 20260712145152）。
2026-07-11：Daemon 路由/队列锚点补充批1 子模块（HTTP、orchestrator、presentation-*）。
2026-07-02：源码锚点对齐 `src/bridge/*` 与 `src/daemon/daemon.ts`（archive 20260702120154）。
2026-06-27：Daemon IM 编排与 MergeBatch（archive 20260627162620）。
