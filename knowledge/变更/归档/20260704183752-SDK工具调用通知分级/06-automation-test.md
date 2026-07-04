# SDK 工具调用通知分级 - 验收记录

> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **范围**：分级 SSOT 冒烟 + IM/Electron 手工 E2E；**不含** daemon 改动（本变更无 daemon diff）

## 1、测试策略与范围

| 层级 | 覆盖 | 说明 |
|------|------|------|
| **冒烟** | `resolveSdkToolPresentationTier` 纯函数 | 白名单 notify 五项 + silent 七项边界；`npx tsx -e` inline，无 `auto_test/` 目录 |
| **手工 E2E** | Electron + 飞书/微信/群聊 IM 过程流 | 01 验收 1–6、02 §8.2 六项；须本地已配置通道凭据 |
| **不测** | daemon、飞书 gate、Claude/Codex/OpenCode 引擎 | 02 §1.3 明确不改；无回归义务 |

**目标**：证明分级 SSOT 与 T2 门控契约正确；IM 侧过程条数、里程碑、ordering defer 由维护者本地手测补证。

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| IM 过程条数对比（01 验收 1/4） | 需真实 Agent 多步任务 + 通道呈现，无稳定 headless 契约 |
| 飞书里程碑 / 微信 CardKit（01 验收 2、8.2·2） | 依赖 Electron 运行时 + 外部 IM API；凭据不可写入 KB |
| PRESENTATION_ORDERING defer 时序（8.2·3/5） | 需 p2p+ordering 场景与 read burst 对照，仅日志/时序可证 |
| think/task 不回归（01 验收 3、8.2·4） | 与归档变更 `20260704174846` 水平对照，须人工感知时延 |
| 多通道原则一致（01 验收 5） | 飞书/微信/群聊各需独立手测 |
| 失败可见性（8.2·6） | 需构造 write/delete 失败路径 |
| `sdk-run-stream.ts` 门控分支 | 无单测脚手架；04-review W2 已知；E2E 手测间接覆盖 |

**残留风险**：分级函数已 PASS；IM/Electron 行为以代码评审 + 手测策略为准，归档前建议维护者补跑 S-B～S-E。

## 3、验收追溯表

| 来源 | 验收项 | 验证方式 | 证据类型 | 状态 |
|------|--------|----------|----------|------|
| T1 | notify 白名单五项 → notify | S-A 冒烟 | tsx inline exit 0 | **PASS** |
| T1 | Read/Glob/未知/空串 → silent | S-A 冒烟 | tsx inline exit 0 | **PASS** |
| T1 | ≤300 行、shared 无环 | 04-review 静态 | 评审表 | **PASS** |
| T2 | silent 跳过 mark+post；UI `[tool]` 全量 | 04-review 代码路径 + S-B 手测 | 评审 + 手测 | 代码 PASS / IM **待手测** |
| T2 | notify 保留 mark+post+release | 04-review + S-C 手测 | 评审 + 手测 | 代码 PASS / IM **待手测** |
| T3 | 两处 AGENTS.md tier 说明 | 04-review | 评审表 | **PASS** |
| 01·1 | read/glob IM 不出站 | S-B | IM 过程流观察 | **待维护者手测** |
| 01·2 | shell/write/delete/Task 可见可区分 | S-C | IM 里程碑/CardKit | **待维护者手测** |
| 01·3 | think/task 不回归 | S-D | 时延对照 | **待维护者手测** |
| 01·4 | 过程条数明显下降 | S-B + 变更前后对比 | IM 条数 | **待维护者手测** |
| 01·5 | 多通道原则一致 | S-E | 各通道手测 | **待维护者手测** |
| 01·6 | 短任务首包/三态不劣化 | S-D | IM 时序 | **待维护者手测** |
| 01·7 | 02 分级表交付 | 02 §1.4 | 设计文档 | **PASS**（设计已交付） |
| 02·8.2·1 | silent UI 日志 + lastTool | S-B | Electron UI 日志 | **待维护者手测** |
| 02·8.2·2 | notify 多通道可达 | S-C | 飞书/微信 | **待维护者手测** |
| 02·8.2·3 | read burst 不误 defer | S-B | assistant 首包时延 | **待维护者手测** |
| 02·8.2·4 | think/task 不变 | S-D | 与 01·3 同 | **待维护者手测** |
| 02·8.2·5 | shell defer 仍有效 | S-C | ordering 场景 | **待维护者手测** |
| 02·8.2·6 | 失败仍可见 | S-C 失败路径 | 三态/正文 | **待维护者手测** |

## 4、场景摘要

### 4.1 S-A：分级函数冒烟（已执行）

| 项 | 内容 |
|----|------|
| **前置** | 仓库根目录；Node + tsx 可用 |
| **触发** | 见 §5 inline 命令 |
| **期望** | notify 五项均 `"notify"`；silent 七项均 `"silent"`；exit 0 |
| **判责** | 断言失败 → 检查 `sdk-tool-presentation-tier.ts`；环境错误 → 脚本/Node 问题 |

### 4.2 S-B：read/glob 静默（待手测）

| 项 | 内容 |
|----|------|
| **前置** | Electron 应用 + 已配置 IM 通道；触发含多次 Read/Glob 的多步任务 |
| **期望** | IM 过程流无 read/glob 逐条推送；Electron UI 日志仍有 `[tool] Read: running` |
| **对照** | 变更前同类任务过程条数应明显下降 |

### 4.3 S-C：notify 工具可见（待手测）

| 项 | 内容 |
|----|------|
| **前置** | 任务含 shell / Write / Delete / Task(tool) |
| **期望** | 合理时延内 IM 可见可区分过程通知；飞书里程碑、微信 CardKit 正常 |
| **扩展** | shell running + ordering 下 assistant 仍 defer 至 tool 完成（8.2·5） |

### 4.4 S-D：think/task 不回归（待手测）

| 项 | 内容 |
|----|------|
| **前置** | 短任务含 thinking；含子 task 里程碑任务 |
| **期望** | 首包过程反馈与归档 `20260704174846` 水平一致；三态/正文时序正常 |

### 4.5 S-E：多通道一致（待手测）

| 项 | 内容 |
|----|------|
| **前置** | 飞书私聊、微信、群聊（若启用）各跑一轮同类任务 |
| **期望** | read/glob 均静默；notify 类均可见；无通道间原则性相反行为 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **位置** | 无 `auto_test/` 脚本；inline 冒烟如下 |
| **命令** | `npx tsx -e "import { resolveSdkToolPresentationTier } from './src/shared/sdk-tool-presentation-tier.ts'; const assert=(n,e)=>{const a=resolveSdkToolPresentationTier(n);if(a!==e)throw new Error(n+'='+a+' want '+e);}; ['Shell','WRITE','StrReplace','Delete','Task'].forEach(n=>assert(n,'notify')); ['Read','Glob','Grep','SemanticSearch','CallMcpTool','','UnknownTool'].forEach(n=>assert(n,'silent')); console.log('tier smoke PASS');"` |
| **环境变量** | 无；不依赖 `DAEMON_*` / IM 凭据 |
| **副作用** | 无；只读 import |

## 6、输出与记录规范

**原则**：会话与本文档均禁止粘贴完整终端日志；执行记录仅用表格概括（日期、命令、结果、备注）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-04 | 本地 dev / 仓库根 | S-A tier 冒烟（§5 tsx inline） | **PASS** | notify×5 + silent×7；exit 0 |
| 2026-07-04 | — | S-B～S-E IM/Electron E2E | **未执行** | 策略已定义；待维护者手测 |
| 2026-07-04 | — | daemon / 非 SDK 引擎 | **跳过** | 变更范围外 |
