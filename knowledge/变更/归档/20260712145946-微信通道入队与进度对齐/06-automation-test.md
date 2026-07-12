# 微信通道入队与进度对齐 - 验收记录

> **口径**：`01` §六、`02` §八·（二）ST-W1～ST-W4 / ST-F1、`03` T7  
> **策略**：**gate 表驱动 + 源码静态契约 + `tsc --noEmit`**（已执行）；**可选手工联调**（微信实机 typing/入队，非 archive 阻断）

## 1、测试策略与范围

| 维度 | 说明 |
|---|---|
| 验收目标 | 微信群聊默认 @ 过滤可配置；typing 4s 续期；出站 `wxc_<clientId>` track；飞书主路径零触碰 |
| 层级 | **契约脚本**（gate 纯函数 + 源码接线静态）+ **构建冒烟**（`tsc`）+ **可选微信实机 E2E** |
| 主证据 | `run-wechat-enqueue-progress-contract.sh` 全绿；`tsc --noEmit` exit 0 |
| 与 01 关系 | ST-W* 覆盖 §6.1 R1–R4；ST-F1 覆盖 §6.2 飞书无回归 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 | 残留风险 |
|---|---|---|
| 微信 typing 肉眼可感知（>10s） | 需 iLink 联机与真机 UI | 静态已证 4s 续期接线；联调结论待 archive 回写知识库 |
| 群聊 @ 启发式误判 | 协议无 mention 元数据 | `all` 模式回退 + `wechat_group_skip` 日志；`02` §八·（一）已记载 |
| E2E 入队确认 + stream final | 需 Daemon + 微信通道在线 | gate 表驱动 + 入站接线静态已证 |
| `wechat-manager.ts` 387 行 | 变更前已超限；typing/track 内聚 | manifest `R-01` false_positive；不阻断 test/archive |
| 知识库三文件 | `02` §十 归 `/kb-archive` | archive 前文档与代码短暂不一致 |

## 3、验收追溯表

| 验收点（01/02/03） | 方式 | 自动化/手工 | 证据类型 |
|---|---|---|---|
| 01 §6.1-1 非 @ 可过滤 / R1 / S1 | gate 表驱动 + 入站静态 | **自动化** | ST-W1：`mention_required` false/true；`wechat_group_skip` |
| 01 §6.1-1 可配置全量 / R2 / S2 | 配置静态 | **自动化** | ST-W2：三端类型 + UI 默认 `mention_required` |
| 01 §6.1-2 进度可感知 / R3/R5 / S3 | typing 静态 | **自动化**（静态） | ST-W3：`TYPING_REFRESH_MS`、`wechat_typing_refresh` |
| 01 §6.1-3 track 等价 id / R4 / S4 | track 静态 | **自动化** | ST-W4：`wxc_` + send-text `trackMessageSession` |
| 01 §6.2-1 飞书无回归 / R6 / S5 | 飞书块 grep | **自动化** | ST-F1：`isBotMentioned` 无微信 gate |
| T1 通道配置 | 契约 + `04-review` | **自动化** | ST-W2 |
| T2 gate 纯函数 | 契约表驱动 | **自动化** | ST-W1；gate ≤120 行 |
| T3 入站接线 | 契约静态 | **自动化** | `initWeChatChannel` + gate |
| T4 typing 续期 | 契约静态 | **自动化**（静态） | ST-W3 |
| T5 出站 track | 契约静态 | **自动化** | ST-W4 |
| T6 编译 + AGENTS | 契约 tsc + review | **自动化** | `tsc` 绿；AGENTS 已评审 |
| T7 契约脚本 + 本文 | 本命令 | **自动化** | 脚本 exit 0 |
| 微信实机 typing/入队 | 手工联调 | **可选** | 见 §4.1；不阻断 archive |

## 4、场景摘要

### 4.1 可选手工联调（微信实机）

| ID | 场景 | 前置 | 触发 | 期望 | 失败判责 |
|---|---|---|---|---|---|
| E2E-W1 | 群未 @ 不入队 | 微信通道在线；默认 mention | 群内发闲聊 | 无 typing/无队列；日志 `wechat_group_skip` | 仍入队→查 gate 接线或 mode |
| E2E-W2 | @ 后入队+typing | 同上 | `@机器人` 发任务 | 入队确认 + typing 持续 >5s | typing 闪断→查续期 timer |
| E2E-W3 | send-text track | Daemon HTTP | `POST /api/send-text` 微信 | 响应 `message_id` 以 `wxc_` 开头 | 无 id→查 send 分支 |
| E2E-W4 | 全量入队模式 | cfg `all` | 群聊无 @ 消息 | 正常入队 | 仍跳过→查 cfg 下发 |

### 4.2 契约冒烟（已执行）

| ID | 核对点 | 命令 | 期望 | 结果 |
|---|---|---|---|---|
| CT-1 | ST-W1 gate 表驱动 | `run-wechat-enqueue-progress-contract.sh` | @/all/@所有人 语义 | **通过** |
| CT-2 | ST-W2～W4 源码接线 | 同上 | 配置/typing/track 静态符合 `02` | **通过** |
| CT-3 | ST-F1 飞书隔离 | 同上 | `startFeishuChannel` 无微信 gate | **通过** |
| CT-4 | tsc + gate 行数 | 同上 | `tsc --noEmit` exit 0；gate ≤120 | **通过** |

## 5、脚本位置与环境

| 项目 | 说明 |
|---|---|
| 入口 | `auto_test/run-wechat-enqueue-progress-contract.sh` |
| 实现 | `auto_test/run-wechat-enqueue-progress-contract.mts` |
| 运行 | 仓库根目录执行上述 `.sh`；依赖 `tsx` + `electron-import-hook.mjs` |
| 环境变量 | 无新增必填；**不写密钥** |
| 副作用 | 只读源码 + 进程内 gate 调用；**不写队列目录** |
| 可选 E2E | 微信 iLink 登录态、`CLAW_*` 通道配置按现网；见 §4.1 |

## 6、输出与记录规范

执行记录仅表格一行一次（命令/结果/结论短语）；**禁止**粘贴完整终端或含 token 日志。

## 7、执行记录

| 日期 | 环境 | 命令/动作 | 结果 | 备注 |
|---|---|---|---|---|
| 2026-07-12 | 本地（kb-test） | `run-wechat-enqueue-progress-contract.sh` | 通过 | ST-W1～W4 + ST-F1 全绿 |
| 2026-07-12 | 本地（kb-test） | `npx tsc --noEmit`（脚本内复跑） | 通过 | T6 工程规范 |
| 2026-07-12 | 本地（kb-test） | ST-W1 gate 表驱动 | 通过 | CT-1 |
| 2026-07-12 | 本地（kb-test） | ST-W2～W4 + ST-F1 静态 | 通过 | CT-2/CT-3 |
| 2026-07-12 | — | E2E-W1～W4（可选） | 未执行 | 不阻断 archive；上线前可补强 |
