# 私聊 group_name 权限修正 — 轻量变更说明

> **变更 ID**：`20260711201000-私聊group_name权限修正`
> **来源**：kb-lite（验收反馈跟进）
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P1
> **关联变更**：`20260711131134-私聊注入对方名称到group_name`（1.14.2）

---

## 背景

1.14.2 上线后私聊 `group_name` 仍无法注入。`daemon.log` 显示：

- `group_name_inject: omit ... reason=no_name`
- `chat_name_field=omit text_has_group_name=false`
- `senderOpenId` 已正确传入

飞书开发者后台确认：**未开通** `contact:user.base:readonly`。

根因：创建/扫码权限清单误配 `contact:contact.base:readonly`（通讯录基本信息），而 `contact.user.get` 返回 `user.name` 须 `contact:user.base:readonly`（用户基本信息）。API 不抛错但 `name` 为空，导致静默 omit。

## 变更说明

1. **权限 SSOT 修正**：`REQUIRED_FEISHU_SCOPES`、`FEISHU_MENU_SCOPES`、README 改为 `contact:user.base:readonly`
2. **可观测日志**：入队 `group_name_inject`、launch `agent_launch_prompt`、`buildPrompt` UI `[Prompt]` 日志
3. **Linux 打包**：`scripts/deploy/linux.cjs`（随本轮工程交付一并归档）

## 验收标准

1. 开通 `contact:user.base:readonly` 并扫码更新后，私聊日志含 `group_name_inject: ok ... name=<对方名>`
2. Agent Prompt 日志含 `group_name=<对方名>` 或正文末尾 `\ngroup_name:`
3. 设置页权限对照表与复制 JSON 含 `contact:user.base:readonly`
