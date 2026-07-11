# 私聊 group_name 权限修正 — 实施摘要

> **hotfix-lite** · 变更 ID：`20260711201000-私聊group_name权限修正` · 版本 **1.14.3**

## 实际变更

| 文件 | 说明 |
|------|------|
| `src/renderer/constants.ts` | `REQUIRED_FEISHU_SCOPES`：`contact:contact.base:readonly` → `contact:user.base:readonly` |
| `src/shared/feishu-addons.ts` | `FEISHU_MENU_SCOPES` 同上（扫码增量开权） |
| `README.md` | 权限表与 JSON 示例同步 |
| `knowledge/业务域/消息桥接/02-飞书通道.md` | 扫码权限说明与变更记录 |
| `src/daemon/daemon.ts` | `group_name_inject` / `agent_launch_prompt` 可观测日志 |
| `electron/agent/shared/agent-launcher.ts` | `extractGroupNameFromPrompt` + `buildPrompt` 可观测回调 |
| `electron/session/session-dispatcher.ts` | `setPromptObservabilityLogger` → `[Prompt]` UI 日志 |
| `scripts/deploy/linux.cjs` | Linux 打包/安装/启动入口 |
| `scripts/deploy/pipeline.cjs` | deploy 共用检查与构建 |
| `package.json` | `dist:linux` / `pack:linux`；version **1.14.3** |
| `changelog/1.14.3.json` | 用户可见变更 |

## 验收对照

| # | 标准 | 结果 |
|---|------|------|
| 1 | 私聊开通正确权限后 `group_name_inject: ok` | ✅ 用户确认已修复 |
| 2 | Prompt 可观测日志可区分注入/未注入 | ✅ 已落地 |
| 3 | 创建/扫码权限清单为 `contact:user.base:readonly` | ✅ |

## 知识库已更新

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md`
- [x] 关联变更 `20260711131134` 验收问题根因已在本 hotfix 闭环

## 风险与遗留

- 存量应用须 **扫码更新权限** 并 **发布应用** 后生效；仅改代码不能自动开通飞书后台权限
- 通讯录权限范围未覆盖用户时仍可能 omit（需在飞书后台配置数据权限）
