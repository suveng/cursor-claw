# 微信通道体验对齐 - 变更总结

> **变更 ID**：`20260712170556-微信通道体验对齐`  
> **来源**：kb-propose · standard flow  
> **阶段**：`reviewed`（archive 步骤 6–7 完成；**勿** mv/commit — 归 kb-release 步骤 8–10）  
> **用户可见性**：是 — 设置群模式说明、帮助主次能力对照；长任务 typing 可感知；终态必停 typing

---

## 1、实际变更

### 代码

| 任务 | 文件 | 改动要点 |
|------|------|----------|
| T1 | `ChannelEditWechat.tsx` | 群模式 option 旁说明：启发式局限、`all` 场景、显示名、`wechat_group_skip` |
| T2 | `SettingsSetupTab.tsx` | 飞书/微信能力对照（群过滤 / 进行中 / track / 合并·菜单） |
| T3 | daemon presentation / HTTP send / orchestrator / wire；四引擎 cancel → `run-notify` | 终态路径审计补 `stopSessionProgress` |
| T4 | `wechat-manager` → 续期可观测 | `wechat_typing_refresh` INFO；无 ticket/抛错 WARN |
| T5 | 各目录 `AGENTS.md` | 完成路径 / typing 拆分 / 取消停进度规矩 |
| T-FIX-01 | `wechat-progress-typing.ts`、`wechat-manager-types.ts`、`wechat-manager.ts` | typing 簇拆分；门面 296 行 ≤300 |
| T-FIX-02 | `daemon-presentation-stream.ts`、`ordering-release.ts` | `finishFinal` ack 后无条件 stop |

**未纳入（显式）**：gate/`wxc_` track 主体；飞书 CardKit/合并/菜单；微信二期合并连发/菜单（R7/R8）；`accepted_debt`（禁止）。

### 变更文档

- `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`
- `00-manifest.json`、`05-summary.md`（本文件）

---

## 2、与设计的差异

| 项 | 设计预期 | 实际实现 | 处置 |
|----|----------|----------|------|
| **manager 行数** | 02 称预存债本期不拆 | 触改后超 300 → T-FIX-01 就地拆分 | **实现强化** — 禁止 debt；对外 API 不变 |
| **finishFinal** | 终态必停审计 | ack 空集补无条件 stop（T-FIX-02） | **实现强化** — 与 send-image/file 双调对齐 |
| **其余 R1–R6 / S1–S6** | 与 02/03 对照 | 实现一致 | **无功能偏差** |

---

## 3、影响范围

- **模块**：renderer 设置/帮助文案；daemon 终态 stop 完整性；bridge typing 拆分与续期可观测；四引擎取消停进度。
- **用户可见**：群模式可读说明；帮助主次能力对照；长任务 typing 续期；结束后不残留「正在输入」。
- **接口/proto**：无新 HTTP/IPC；`send-text` 可仅 `stop_progress` 无 text。
- **数据**：无 schema 变更。
- **风险残留**：启发式 @ 仍可能误判（文案 + `all` + `wechat_group_skip`）；`wxc_*` 非服务端 message_id。

### 3.1 Ponytail 技术债

无（本变更触改文件 diff 无新增 `ponytail:`；gate 既有启发式注释属前置变更）。

---

## 4、知识库影响清单

> 来源：`02-design.md` §十；由 **kb-librarian** archive 步骤 6–7 落盘。

### （一）必须更新

- [x] `knowledge/业务域/消息桥接/03-微信通道.md` — §九 可感知/终态结论；用户入口；typing 拆分；勾销 manager 行数债
- [x] `knowledge/业务域/消息桥接/01-概览.md` — §九 对照表与 `SettingsSetupTab` 同口径

### （二）可能更新（视实现结果）

- [x] `knowledge/工程平台/Electron桌面应用/03-渲染端界面.md` — ChannelEdit / SetupTab 文案落点
- [x] `knowledge/业务域/消息桥接/00-README.md` — 源码锚点补 typing 子模块（清单未失真，仅锚点一句）
- [ ] `knowledge/业务域/消息桥接/02-飞书通道.md` — **不需要**（对照引用未改飞书正文）

### （三）不需要更新

- [x] gate/typing/track 工程主体（前置 archive 已写）
- [x] Agent 调度域、工作流域正文
- [x] `knowledge/知识索引.md` / 领域文件清单阅读路径（无新叶子）

---

## 5、验收与债务状态

| 维度 | 状态 |
|------|------|
| **T1～T5 / T-FIX-01 / T-FIX-02** | done |
| **04-review** | ✅ 通过；R1/R2=fixed；open=**0** |
| **accepted_debt** | **无**（禁止 debt） |
| **知识库** | ✅ §十必须 + Electron 落点已合并 |
| **stage** | **保持 `reviewed`**（本步不 mv / 不 commit） |

---

## 6、阶段说明（步骤 6–7）

- 本轮完成 `05-summary.md` 与知识合并；**保持 `stage=reviewed`**。
- **禁止**本步骤 `mv` 至归档、**禁止** commit（归 kb-release 步骤 8–10）。
