# 远程指令全员与群聊开放 - 变更总结

> **变更 ID**：`20260704152837-远程指令全员与群聊开放`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（待 `/kb-archive`）  
> **范围**：T1–T6 + T-FIX-01

---

## 1、实际变更

### 代码

| 文件 | 关键改动 |
|------|----------|
| `src/shared/feishu-addons.ts` | 移除 `adminOnly`；菜单 event_key 映射扁平化 |
| `src/shared/feishu-help-text.ts` | `buildHelpText()` 无参，恒返回全量指令说明；删除管理员门槛措辞 |
| `src/bridge/feishu-menu.ts` | `resolveMenuCommand` / 事件处理去掉 `isAdmin` 与拒绝文案 |
| `src/daemon/feishu-event-handlers.ts` | 接线适配无参菜单/帮助签名；删除 admin 维度门控 |
| `electron/daemon/daemon-manager.ts` | 删除 `denyNonAdmin` 及 8 处 `if (!isAdmin)`；`/stop` 经 `resolveCommandSessionKey` 再 `stopSessionAgent`；`/list` 展示全量队列 |
| `src/renderer/pages/Settings.tsx` | event_key 对照表权限列统一「全员」 |

**修复批次 T-FIX-01（R1）**：主用户 p2p 活跃键为 `chatKey::workspaceDir` 时，`/stop` 与 `/reset` 同路径先 `resolveCommandSessionKey` 再停会话。

**版本与 changelog**：`package.json` **1.12.0**、`changelog/1.12.0.json`。

**不变**：通道级准入（`allowOthers` 等）、fcmd 队列、CardKit/流式、各 `handle*Command` 内部逻辑。

### 变更文档

- `00-manifest.json`、`01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `05-summary.md`（本文件）

---

## 2、与设计的差异

无功能性偏差；与 `02-design` S1–S12、T1–T6 一致。

| 项 | 状态 |
|----|------|
| 删除 `denyNonAdmin` / `adminOnly` | ✅ |
| `buildHelpText()` 无参全量 | ✅ |
| `/stop` 统一 `resolveCommandSessionKey` | ✅（T-FIX-01 修复 R1） |
| `/list` 全队列 | ✅ |
| 微信通道 | ✅ 同 `daemon-manager` 枢纽自动生效 |

**accepted_debt**：

| ID | 说明 |
|----|------|
| D1 | `daemon-manager.ts` 历史枢纽超 300 行；本变更净删行，不拆枢纽 |
| D2 | `/stop` 对 `temp_*` 临时会话键可能仍匹配不到；改前非 admin 行为一致，非本变更范围 |

---

## 3、影响范围

- **指令权限**：飞书/微信斜杠与菜单路径不再按管理员二分；任意已授权用户可使用完整指令集。
- **场景一致**：私聊与群聊指令集合相同；`/help`、进入私聊帮助卡与菜单文案不再强调角色门槛。
- **`/stop`**：仅停当前会话；会话键解析与 `/reset` 对齐。
- **`/list`**：返回全量待执行队列，不再按会话过滤。
- **非目标**：通道准入策略、飞书后台物理菜单分组、运维指令二次确认（01·R2 产品接受）。

### 3.1 Ponytail 技术债

无。

---

## 4、知识库影响清单

archive 阶段由 **kb-librarian** 落盘。

### （一）必须更新

- [x] `knowledge/业务域/Agent调度/04-远程指令.md` — 删除权限二分；指令表与 event_key 权限列改全员；`/stop`、`/list` 行为更新
- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — 菜单/help 不再按角色分叉

### （二）可能更新

- [x] `knowledge/业务域/消息桥接/03-微信通道.md` — 补一句：斜杠指令与飞书同规则（全员、同枢纽）

### （三）不需要更新

- [x] `knowledge/知识索引.md` — 总入口未变化
- [x] CardKit、工作流独立文档 — 不在范围（02 §十·（三））
