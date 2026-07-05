# 飞书全通道普通文本消息 - 变更总结

## 1、实际变更

| 文件 | 改动 |
|------|------|
| `src/bridge/lark-core.ts` | `sendMessage`/`sendStreamMessage`/`updateMessageContent` 统一 `msg_type: text`；合并预览、进入私聊帮助改 plain text + update |
| `src/daemon/daemon.ts` | `handleStreamText`/`releaseDeferredAssistantStreamImpl` 跳过 CardKit，走 text 首包 + `updateMessageContent`；移除 CardKit 降级 helper |
| `src/daemon/feishu-event-handlers.ts` | 注释：帮助消息改 plain text |

**用户可见**：飞书私聊/群聊所有出站（Agent 回复、合并预览、帮助、里程碑、状态通知）均为普通文本消息，不再渲染 interactive 卡片或 CardKit。

## 2、与设计的差异

无。lite 变更，口径与用户反馈「不用卡片，普通文本就行」一致。

## 3、影响范围

- **LarkSender 出站层**：`formatForSend`/`formatStreamForSend` 仅产出 text；可选工作区标题前缀 `【标题】`
- **stream-text**：飞书首包 `sendMessage`/`sendStreamMessage`，后续 `im.message.update`；失败降级分段发送
- **合并预览**：`renderMergeBatchCard` 内部改 text update（保留 API 名兼容 daemon）
- **帮助**：`sendHelpCard` 改 `sendMessage`
- **f41 assistant plain 收尾**：不变，仍经 `feishu-plain-assistant-reply` Run 末条 `send-text`

### 3.1 Ponytail 技术债

无（本次 diff 未新增 ponytail 注释）。

## 4、知识库影响清单

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — 出站全 plain text；合并预览/帮助/里程碑描述同步
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新
