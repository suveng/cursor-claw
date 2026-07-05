# 飞书私聊群聊回复对齐 — 变更总结

> **变更 ID**：`20260705141000-飞书私聊群聊回复对齐`  
> **来源**：kb-lite · 用户反馈  
> **lite 类型**：体验修复（飞书 IM assistant 出站形态对齐）  
> **阶段**：`ready`（代码已落地；待 kb-release 迁移目录 + bump 版本 + 知识库同步）

---

## 1、实际变更

### 1.1 代码

| 文件 | 关键改动 |
|------|----------|
| `electron/agent/shared/feishu-plain-assistant-reply.ts` | **新建**：`isFeishuPlainAssistantReply`（f41 + feishu）；`flushFeishuPlainAssistantIfNeeded` non-final 直接跳过、final 一次性 `POST /api/send-text` + 末条 `inboundMessageIds` 作 `message_id` + `stop_progress: true` |
| `electron/agent/cursor-sdk/sdk-run-presentation.ts` | `doFlushStreamPost` 飞书 plain 分支优先于 CardKit stream-text / Rev2 defer 链 |
| `electron/agent/claude-code/agent-cc-notify.ts` | **新建**（自 `agent-cc-stream` 拆出）：`notifySessionChat` / `postPresentationEvent` / `postStreamText` |
| `electron/agent/claude-code/agent-cc-stream.ts` | 通知函数迁至 `agent-cc-notify`；`doFlushStreamPost` 挂接 `flushFeishuPlainAssistantIfNeeded` |
| `electron/agent/claude-code/agent-cc-presentation.ts` | import 改指向 shared plain 模块（与 stream 层一致） |
| `electron/agent/codex/agent-codex-stream.ts` | assistant flush 挂接飞书 plain send-text |
| `electron/agent/opencode/agent-opencode-stream.ts` | 同上 |
| `src/daemon/daemon.ts` | **thinking 飞书抑制路径 ordering 闩补全**：飞书/微信 thinking 零 IM 出站时仍 mirror `thinkingOpen` / `presentationProcessActive`（与 CardKit 路径对称）；**tool 里程碑**：`edit`/`write`/`delete` 的 `started` 仅置 ordering 闩、不向 IM 发「已开始」（与既有 suppress 策略一致，本归档一并纳入） |

### 1.2 行为摘要

| 项 | 变更前 | 变更后 |
|----|--------|--------|
| 飞书私聊 assistant（f41 eligible） | CardKit 流式首句 / reply 锚点易偏 | Run 收尾**一次性** plain `send-text`，`message_id` reply **末条 inbound** |
| 飞书群聊 assistant | 已部分改为末句 reply | 与私聊**同一** plain 路径（四引擎统一） |
| Run 过程中 assistant IM | 可能 mid-run 流式 PATCH | **零** assistant IM；过程仍走 tool/task 里程碑 |
| 微信 / 非飞书 f41 | 不变 | 仍走 CardKit / 既有 stream-text |

**根因**：私聊仍走 CardKit `stream-text` 首建，reply 锚点与群聊末条 inbound 策略不一致；用户期望私聊与群聊同样「过程里程碑实时、assistant 结论 Run 末一次性 reply」。

**不变**：tool/thinking/task 过程通知分级与里程碑；MergeBatch / F1 三态；`PRESENTATION_ORDERING` 闩锁语义；Daemon `/api/stream-text` 契约（非飞书路径仍用）。

### 1.3 变更文档

- `00-manifest.json`、`05-summary.md`（本文件）

### 1.4 版本与 changelog（待 archive / kb-release）

| 文件 | 状态 |
|------|------|
| `package.json` | 待 bump `1.13.10` → **`1.13.11`** |
| `changelog/1.13.11.json` | 待新建 |

---

## 2、与设计的差异

lite 无独立 `02-design.md`。实现与用户反馈口径一致：飞书 f41 全通道 assistant 弃 CardKit 流式，改 Run 收尾 plain send-text + 末条 reply。

| 项 | 预期 | 实际 | 评估 |
|----|------|------|------|
| 私聊 + 群聊 assistant 一致 | plain 末条 reply | 四引擎 shared 模块统一 | ✅ |
| 取消 assistant 流式 | non-final 跳过 | `flushFeishuPlainAssistantIfNeeded` early return | ✅ |
| daemon thinking ordering | 飞书抑制仍置闩 | `handleThinkingPresentationEvent` 补 mirror | ✅ |
| tool started 里程碑 suppress | edit/write/delete 不 spam | `shouldSuppressToolStartedPresentation` + ordering 闩 | ✅（同文件 hunks 纳入） |

---

## 3、影响范围

| 范围 | 说明 |
|------|------|
| **端** | Electron 四引擎 presentation flush + Daemon thinking/tool ordering |
| **用户可见** | **是** — 飞书私聊/群聊 assistant 回复不再流式首句；reply 锚定用户末条消息 |
| **IM 阅读体验** | 长 Run 过程仍见 tool/task 里程碑；结论单条 plain 文本一次性出现 |
| **不涉及** | 微信 CardKit；飞书过程 CardKit/里程碑既有逻辑；Settings / proto；非 f41 路径 |

### 3.1 Ponytail 技术债

无新增 `ponytail:` 注释。`src/daemon/daemon.ts` 内既有占位/串行化注释（如 `releaseDeferredAssistantStreamImpl`、`enqueueReleaseDeferredAssistantStream`、`handleStreamText` 飞行窗口）未改语义，仅 thinking 抑制分支补 ordering mirror。

---

## 4、知识库影响清单

> 供 `/kb-archive` 步骤 6（kb-librarian）消费；本步骤**不写**业务域正文。

### （一）必须更新

- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md` — 飞书 f41 assistant **plain send-text**（私聊+群聊）；取消 CardKit 流式首句；Run 收尾 `message_id` reply 末条 inbound
- [ ] `package.json` + `changelog/1.13.11.json` — 用户可见 IM 体验对齐 → patch bump

### （二）可能更新（视 archive 细化）

- [ ] `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` — §3.4 Rev2 end-only 补充「飞书 f41 改 plain send-text，非 CardKit stream-text」例外说明
- [ ] `electron/agent/shared/AGENTS.md` — 索引 `feishu-plain-assistant-reply.ts`（若 archive 时 kb-builder 同步 AGENTS）

### （三）不需要更新

- [ ] `knowledge/业务域/消息桥接/03-微信通道.md` — 微信路径 diff 为零
- [ ] MergeBatch / F1 / 菜单快捷指令文档 — 行为不变
- [ ] 知识索引 — 无新子模块入口
