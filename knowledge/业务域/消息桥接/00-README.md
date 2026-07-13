# 消息桥接

> 将飞书 / 微信用户消息接入 Daemon，经文件队列投递给 Agent，并将 Agent 回复路由回对应通道。

## 职责边界

**负责**：多通道（飞书 / 微信）消息收发、入队、会话路由、媒体缓存、通道状态上报。

**不负责**：Electron SDK launch 实现（见 Agent 域）、Electron 设置 UI 凭据录入、工作流 / 指令子系统细节（仅说明入队前拦截点）。

## 文件清单

* [[01-概览]] - 模块总图、术语、依赖
* [[02-飞书通道]] - WS、LarkSender、CardKit 心跳续期
* [[03-微信通道]] - iLink、扫码登录、typing
* [[04-消息队列与路由]] - file-queue、MergeBatch、入队「已排队」文案

## 源码锚点

| 模块 | 路径 |
|------|------|
| 飞书门面 | `src/bridge/lark-core.ts`（`LarkSender` + re-export；域外唯一入口） |
| 飞书子模块 | `lark-sender-*`、`lark-cardkit-renewal.ts` |
| 飞书长任务心跳 | `daemon-presentation-feishu-heartbeat.ts`（CardKit 续期 /「仍在处理中…」） |
| 通道类型 | `src/shared/channel-types.ts` |
| 微信客户端 | `src/bridge/wechat/`、`wechat-manager.ts` |
| 文件队列 | `file-queue.ts` + `file-queue-*.ts` |
| Daemon 队列/合并 | `daemon-queue.ts`、`daemon-queue-merge*.ts` |
| Presentation 出站 | `daemon-presentation-enqueue.ts`、`daemon-presentation-feishu-heartbeat.ts` 及 `daemon-presentation-*` |

## 推荐阅读路径

1. [[01-概览]] — 全局认知
2. [[04-消息队列与路由]] — claim/dispatch 与入队文案
3. [[02-飞书通道]] 或 [[03-微信通道]] — 按平台选读
4. 长任务呈现：[[02-飞书通道]] → [[04-消息队列与路由]] → [[业务域/Agent调度/06-CursorSDK执行引擎]]
