# 验收闭环

> 关联：`20260711131134-私聊注入对方名称到group_name` 第 1 轮验收问题

## 第 2 轮（本 hotfix）

### 现象

私聊 `group_name_inject: omit reason=no_name`；`senderOpenId` 正常。

### 根因

权限 ID 配错：`contact:contact.base:readonly` 无法使 `contact.user.get` 返回 `name`。

### 修复

改为 `contact:user.base:readonly`；用户飞书后台开通并扫码更新后验收通过。

### 日志证据（修复后预期）

```
group_name_inject: ok chat=... type=p2p name=...
agent_launch_prompt: ... text_has_group_name=true preview="...\ngroup_name: ..."
[Prompt] INFO [...] group_name=... | ...
```
