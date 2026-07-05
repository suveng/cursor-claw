# 飞书私聊去前缀与 Markdown 渲染

## 背景

用户反馈飞书私聊回复带有 `【cursor-claw】` 等工作区目录名前缀，体验冗余；同时 Agent 回复中的 Markdown（代码块、列表等）以纯文本展示，无法渲染。

## 目标

1. **私聊**：不再附加工作区目录名前缀（群聊仍保留 `post.title` 便于区分项目）。
2. **出站消息**：飞书普通文本默认使用 `post` + `md` 标签，支持 Markdown 渲染；含 `<at user_id=` 的 mention 场景降级为 `text`。

## 验收

- [ ] 主用户私聊 Agent 回复无 `【cursor-claw】` 等工作区前缀
- [ ] 群聊回复仍可在标题区展示工作区名
- [ ] 代码块、列表等 Markdown 在飞书客户端正确渲染
- [ ] 流式更新（`im.message.update`）与首包 msg_type 一致
