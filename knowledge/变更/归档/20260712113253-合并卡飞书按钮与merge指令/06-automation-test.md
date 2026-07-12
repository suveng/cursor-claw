# 合并卡飞书按钮与merge指令 - 验收记录

> **来源**：`/kb-test`（基于 `03-tasks.md`、`02-design.md` §八·（二）、`04-review.md`）
> **stage**：`tested`（静态检查已执行；E2E 项见 §2、§7）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 静态（tsc + grep）为主；冒烟/手工 E2E 为辅 |
| **目标** | 验证 T1–T6 与 `02` §八·（二）工程项可追溯；不新增单测 |
| **与验收关系** | 每一行追溯表对应 `03` 任务验收或 `01` AC1–AC5 |
| **执行方** | kb-recorder 已完成静态；飞书实机与 R5 联调须维护者本地执行 |

**静态检查摘要**（2026-07-12）：

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run build:mcp`（tsc） | 通过 | 无类型错误 |
| grep `card.action.trigger` | 命中 | `feishu-addons.ts`、`lark-core.ts` handler、`daemon.ts` 注入 |
| grep `merge_action` | 命中 | `feishu-card-action.ts` `logMergeAction` |
| grep `ackMessages`/`releaseClaimedMessages` 于新模块 | 无命中 | R5 边界合规 |
| `wc -l` 新建三文件 | ≤300 | 186 / 121 / 78 行 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 飞书后台订阅 `card.action.trigger` 实机 | 需运维扫码/开放平台配置 | 未订阅则按钮无回调 |
| 卡片点击即时 toast UI | 依赖飞书 WS SDK 回传与客户端渲染 | 代码链已闭合（R1），仍须点按确认 |
| M7 排队文案 + idle 后 flush | 需 Agent processing 态与多消息合并场景 | 代码路径未改，回归须 E2E |
| R5 dispatch 失败重入 `.qmsg` | 需模拟 dispatch 失败与重试 | 本变更未改队列；联调验证契约 |
| D1 `lark-core.ts` 行数债务 | 接受债务，非本议题 scope | 后续拆分任务跟踪 |

## 3、验收追溯表

| 来源 ID | 验收摘要 | 验证方式 | 证据类型 | 状态 |
|---------|----------|----------|----------|------|
| T1 | `FEISHU_MENU_EVENTS` 含 `card.action.trigger` | grep `feishu-addons.ts` | 静态 | ✅ |
| T1 | `startConnection` 注册 handler | grep `lark-core.ts:1074` | 静态 | ✅ |
| T1 | 未提供 `onCardAction` 不破坏 menu_v6 | 可选回调类型；04-review 无回归 | 评审 | ✅ |
| T1·D1 | `lark-core.ts` ≤300 行 | `wc -l` 1190 行 | 接受债务 D1 | ⚠️ 债务 |
| T2 | 错误文案 SSOT、纯函数 | 读 `daemon-merge-action-feedback.ts` | 静态+评审 | ✅ |
| T3 | 三 action 路由 + toast 返回 | grep `buildToast`/`onFeishuCardAction` | 静态+评审 R1 | ✅ |
| T3 | 无 ack/release 越界 | grep 新模块无 `ackMessages` | 静态 | ✅ |
| T3·§八·2 | callback 200 + toast 实机 | 合并卡点按「立即发送」 | E2E | ⏳ 待用户 |
| T4 | `onCardAction` 注入 daemon | grep `daemon.ts:1169` | 静态 | ✅ |
| T4 | 单条 `onMessageEnqueued` 不变 | 04-review AC5 | 评审 | ✅ |
| T5 | `/merge` 子命令映射 | 读 `daemon-merge-command.ts` | 静态 | ✅ |
| T5·§八·3 | 不写 `.fcmd` | `handleCommand` 先 `tryHandleMergeSlashCommand` 再 `pushCommandToQueue` | 静态 | ✅ |
| T5 | `/help` 含 `/merge` | grep `feishu-help-text.ts` | 静态 | ✅ |
| T6 | 500ms 防抖双入口 | grep `shouldIgnoreMergeActionDebounce` | 静态 | ✅ |
| T6·§八·6 | `merge_action` 可 grep | grep + 日志字段约定 `AGENTS.md` | 静态 | ✅ |
| T6·§八·4 | M7 排队文案 + idle flush | Agent busy 时发合并卡 + send_now | E2E | ⏳ 待用户 |
| T6·§八·5 | R5 失败重入队联调 | dispatch 失败 → `.qmsg` 恢复 → 再 send | E2E | ⏳ 待用户 |
| AC1 | 立即发送可投递可感知 | 按钮 + IM/toast | E2E | ⏳ 待用户 |
| AC2 | 拆开/编辑合法态 | 按钮 + F3 引导 | E2E | ⏳ 待用户 |
| AC3 | `/merge` 核心动作 | 斜杠四形态 | E2E | ⏳ 待用户 |
| AC4 | 无批次明确提示 | T2 映射 + 双入口 | 静态+评审 | ✅ |
| AC5 | 单条路径无回归 | 04-review | 评审 | ✅ |
| §八·1 | 飞书后台订阅事件 | 设置页/扫码 addons + 开放平台 | 运维 E2E | ⏳ 待用户 |
| §八·7 | 新建文件 ≤300 行 | `wc -l` | 静态 | ✅ |

## 4、场景摘要

### 4.1 静态冒烟清单（已执行）

| 场景 | 前置 | 步骤 | 期望 | 判责 |
|------|------|------|------|------|
| S-STATIC-01 编译 | 仓库根目录 | `npm run build:mcp` | exit 0 | 失败→类型/导入问题 |
| S-STATIC-02 事件 SSOT | — | `rg card.action.trigger src/` | addons + lark-core handler | 缺失→T1 未合入 |
| S-STATIC-03 斜杠拦截 | — | 读 `daemon.ts` `handleCommand` | `tryHandleMergeSlashCommand` 在 `pushCommandToQueue` 前 | 顺序错→T5 回归 |
| S-STATIC-04 R5 边界 | — | `rg ackMessages\|releaseClaimedMessages src/daemon/feishu-card-action.ts src/daemon/daemon-merge-command.ts` | 无命中 | 命中→越界改队列 |
| S-STATIC-05 结构化日志 | — | `rg merge_action src/daemon/` | `feishu-card-action.ts` INFO 日志 | 缺失→T6 未合入 |
| S-STATIC-06 toast 透传链 | — | `rg "return await callbacks.onCardAction" src/bridge/lark-core.ts` | 命中 | 缺失→R1 复发 |

### 4.2 手工/E2E 场景（待维护者执行）

| 场景 | 前置 | 触发 | 期望现象 | 失败判责 |
|------|------|------|----------|----------|
| S-E2E-01 订阅与按钮 | 飞书应用已订阅 `card.action.trigger`；Daemon 飞书通道在线 | 私聊连发 ≥2 条 → 合并卡点「立即发送」 | 即时 toast + 可选 IM；daemon 日志 `merge_action` `source=button` `ok=true` | 无 toast→订阅/SDK；无日志→接线 |
| S-E2E-02 拆开/编辑 | collecting 合法批次 | 点「拆开」/「编辑」 | split 成功或编辑引导文案；无未捕获异常 | phase 错误→业务状态 |
| S-E2E-03 `/merge` 无 fcmd | 同上批次 | 发 `/merge send`、`/merge split`、`/merge edit hello` | IM 反馈；队列目录无新 `.fcmd` | 有 fcmd→T5 拦截失败 |
| S-E2E-04 双入口防抖 | 同上 | 连点按钮后 500ms 内 `/merge send` | 友好提示，非抛栈 | 重复 dispatch→防抖/phase |
| S-E2E-05 M7 排队 | Agent 处于 processing | send_now 后看合并卡脚本文案 | 显示排队提示；idle 后自动 flush | 文案/flush→M7 回归 |
| S-E2E-06 R5 重入队 | 可模拟 dispatch 失败（依赖变更已 archived） | send_now → 失败 → 查 `.qmsg` → 再 send/静默 | 消息重入队可再投递；合并路径无自行 ack | 队列语义→R5 变更 |
| S-E2E-07 无批次提示 | 无 active merge batch | 点按钮或 `/merge` | T2 中文错误 IM/toast | 文案→T2 映射 |

**日志采集**（执行 E2E 时）：

```bash
# daemon 日志中检索合并动作（勿粘贴含 token 的完整行到 KB）
rg 'merge_action' <daemon-log-path>
```

**`.fcmd` 检查**（S-E2E-03）：

```bash
# 执行 /merge 前后对比命令队列目录（路径以本地 data 目录为准）
ls -la <queue-dir>/*.fcmd 2>/dev/null | rg merge || echo "无 merge fcmd"
```

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 本变更未新增脚本（仓库约定不增单测） |
| **静态入口** | 仓库根 `npm run build:mcp` |
| **环境** | Node 与项目 `package.json` 一致；飞书 `APP_ID`/`APP_SECRET` 已配置（不写真实值） |
| **数据目录** | 本地 Daemon `data/` 下 `.qmsg`/`.fcmd`（路径因部署而异） |
| **依赖变更** | `20260711232817-dispatch失败重入队与ack策略` 已 `archived_with_debt`；R5 联调只读契约 |

## 6、输出与记录规范

- 会话与本文档**禁止**粘贴完整终端日志或含 token 的行。
- §7 执行记录每行一词结论（通过/待用户/债务）。
- E2E 失败时记录：场景 ID、环境、现象摘要、判责（脚本/服务/配置）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 开发机 / cursor-claw | `npm run build:mcp` | 通过 | tsc 无错误 |
| 2026-07-12 | 开发机 | S-STATIC-02～06（grep/wc） | 通过 | 见 §4.1 |
| 2026-07-12 | — | S-E2E-01～07 | 待用户 | 飞书实机与 R5 联调 |
| 2026-07-12 | — | §八·1 运维订阅 | 待用户 | 代码 SSOT 已补 |
| 2026-07-12 | 评审 | 04-review R1/D1 | 通过/债务 | R1 已修复；D1 accepted_debt |
