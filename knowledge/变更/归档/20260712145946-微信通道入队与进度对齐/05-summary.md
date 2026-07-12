# 微信通道入队与进度对齐 - 变更总结

> **变更 ID**：`20260712145946-微信通道入队与进度对齐`  
> **来源**：kb-propose · standard flow  
> **阶段**：`tested`（archive 步骤 6–7 完成；**勿** mv/commit — 归 kb-release 步骤 8–10）  
> **用户可见性**：是 — 微信群聊默认须 @ 机器人才入队（可配置全量）；处理中 typing 4s 续期；出站可 track（`wxc_<clientId>` 等价 id）

---

## 1、实际变更

### 代码

| 任务 | 文件 | 改动要点 |
|------|------|----------|
| T1 | `src/shared/channel-types.ts`、`electron/preload.ts`、`src/renderer/env.d.ts`、`ChannelPanel.tsx`、`electron/daemon/daemon-manager.ts` | `wechatGroupEnqueueMode`（默认 `mention_required`）、`wechatBotDisplayName` 三端同步 |
| T2 | `src/daemon/wechat-group-enqueue-gate.ts` | 纯函数 `shouldEnqueueWechatGroupMessage`、`buildWechatBotAliases`（47 行） |
| T3 | `src/daemon/daemon.ts` | 群聊入站 gate 接线；`wechat_group_skip` 日志 |
| T4 | `src/bridge/wechat-manager.ts` | `TYPING_REFRESH_MS=4000` 续期；`WeChatSendResult` |
| T5 | `daemon-http-routes-send.ts`、`daemon-presentation-*.ts`、`daemon-http-non-api-routes.ts` | 微信出站 `trackMessageSession`；`POST /api/send-text` 返回 `wxc_` message_id |
| T6 | `src/daemon/AGENTS.md`、`src/bridge/AGENTS.md` | gate/typing/track 口径沉淀 |
| T7 | `auto_test/run-wechat-enqueue-progress-contract.{sh,mts}` | ST-W1～W4 + ST-F1 契约 |

**未纳入（显式）**：飞书 `isBotMentioned`/Get/DONE 路径；Daemon 调度内核；工作流微信节点；`wechat-manager.ts` 整体拆文件（预存行数债，manifest `R-01` false_positive）。

**统计**：1 新建 + 16 修改 + 2 验收脚本；`tsc --noEmit` 通过；ST-W1～W4、ST-F1 全绿（见 `06-automation-test.md` §7）；E2E-W1～W4 可选未跑，不阻断 archive。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`、`06-automation-test.md`
- `00-manifest.json`、`05-summary.md`（本文件）

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **S4 `.unref()`** | `02` §六 S4 字面提及 interval `.unref()` | 未调用 `.unref()` | **非功能偏差** — manifest `R-02` false_positive；daemon 长驻 + stop 必清 |
| **wechat-manager 行数** | T4 验收 ≤300 行 | 387 行（变更前 348 已超限） | **false_positive** — manifest `R-01`；typing/track 内聚留 manager |
| **其余 W1a～W7、F0、R1–R6** | 与 `02`/`03` 对照 | 实现一致 | **无功能偏差** |

---

## 3、影响范围

- **模块**：微信 bridge（typing/send 返回）、Daemon 入站 gate、出站 presentation/HTTP send、Settings 通道配置。
- **用户可见**：群聊噪声默认过滤；进行中 typing 可持续刷新；出站可关联 `messageSessionMap`（等价 id，非飞书 open_message_id）。
- **接口/proto**：无新 HTTP 路径；`POST /api/send-text` 微信成功响应补 `message_id`（`wxc_*`）；`WeChatManager.sendText/sendMedia` 返回 `WeChatSendResult`（破坏性 TS，调用方已适配）。
- **数据**：通道 JSON 增可选字段；无 DB/proto。
- **风险残留**：@ 正文启发式可能误判（`all` 模式回退 + `wechat_group_skip` 日志）；`wxc_` 为客户端 id 非服务端 message_id；微信实机 typing >10s 未 E2E（静态已证 4s 续期接线）。

### 3.1 Ponytail 技术债

| 位置 | 注释摘要 | 升级路径 |
|------|----------|----------|
| `src/daemon/wechat-group-enqueue-gate.ts:3` | iLink 无 mention 元数据，首版正文 @ 启发式 | 联调后扩展协议 mention 字段或 sender 白名单 |

`04-review` Ponytail：**Lean already. Ship.**

---

## 4、知识库影响清单

> 来源：`02-design.md` §九、§十；由 **kb-librarian** 在 archive 步骤 6 落盘；步骤 7 已合并正文。

### （一）必须更新

- [x] `knowledge/业务域/消息桥接/03-微信通道.md` — §一 能力边界（gate 归 Daemon）；§二/§三 @ 规则与 typing 续期；§五 `WeChatSendResult`；§九 track 等价 id 与启发式限制
- [x] `knowledge/业务域/消息桥接/04-消息队列与路由.md` — §三 微信群聊入队门槛（`wechat-group-enqueue-gate`）
- [x] `knowledge/业务域/消息桥接/01-概览.md` — §九 主/次通道能力对照

### （二）可能更新（视实现结果）

- [ ] `knowledge/工程平台/Daemon守护进程/` — sessionProgress 跨通道口径已在 `daemon/AGENTS.md` 沉淀；工程平台正文**未**扩散（与 `02` §十·（二）一致）
- [ ] Settings 工程说明 — 通道配置 UI 变更仅 `ChannelPanel`，无独立工程平台专文

### （三）不需要更新

- [x] `knowledge/业务域/消息桥接/02-飞书通道.md` — 飞书路径零触碰
- [x] `knowledge/知识索引.md` — 入口结构无变化
- [x] `knowledge/业务域/消息桥接/00-README.md` — 文件清单与阅读路径未失真
- [x] 变更目录外归档证据

### （四）代码侧 AGENTS（已随 apply）

- [x] `src/daemon/AGENTS.md`、`src/bridge/AGENTS.md` — 已更新；知识正文与 AGENTS 对齐

---

## 5、验收与债务状态

| 维度 | 状态 |
|------|------|
| **T1～T7** | done（manifest `tasks[]`） |
| **04-review** | ✅ 通过；严重 0；警告 0 |
| **06 契约** | ✅ ST-W1～W4、ST-F1、`tsc --noEmit` |
| **06 E2E-W1～W4** | ⏳ 可选未执行 — 不阻断 archive |
| **01 §6.1** | ✅ 契约 + 静态覆盖；实机 typing 为可选补强 |
| **知识库三文件** | ✅ librarian 步骤 7 已合并 |
| **`reviews[]`** | **零 open** — 不得 `archived_with_debt` |

---

## 6、阶段说明（步骤 6–7）

- 本轮完成 `05-summary.md` 与业务域知识三文件合并；**保持 `stage=tested`**。
- **禁止**本步骤 `mv` 至归档、**禁止** commit（归 kb-release 步骤 8–10）。
