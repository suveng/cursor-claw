# 巨型单体拆分 - 验收记录

> **口径**：`01` §七 验收 1～5（批1 子集：验收 5 仅约束批1 新建 `daemon-*.ts` ≤300，`daemon.ts` >300 可接受）；`03` T1～T7 + T-FIX-01；批2～4 **deferred**  
> **策略**：**静态冒烟 + 行数抽查**（已执行）+ **手工 E2E**（必须）；无本变更 `auto_test/` 脚本；不新增单测脚手架

## 1、测试策略与范围

| 维度 | 说明 |
|---|---|
| 验收目标 | 批1 将 `daemon.ts` 机械拆分为 orchestrator / presentation / HTTP 子模块；满足 AGENTS 单文件 ≤300（新建模块）；行为与拆分前等价 |
| 层级 | **构建冒烟**（`build:mcp`）+ **行数抽查**（`wc -l daemon-*.ts`）+ **手工 E2E**（01 验收 1～4） |
| 主证据 | `npm run build:mcp` exit 0；全部 `src/daemon/daemon-*.ts` ≤300；`daemon.ts` 由 3591 降至 ~1710；E2E 见冷启动/入队/dispatch/`/restart` |
| 不覆盖 | 批2～4（T8～T16：queue/channel/logging/Electron/bridge 等）；T7 调度 SSOT 迁移；`dispatchSessionAgents` 空实现；日志双写统一；R2 `@ts-nocheck` 移除；R3/R4 文档与并行变更归属 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 | 残留风险 |
|---|---|---|
| 01 §七·1 冷启动（场景 A） | 需 Electron 拉起 Daemon + lock/`/health`/`/api/status` 实机 | 仅静态无法证 HTTP 监听与 lock 写入 |
| 01 §七·2 飞书入队（场景 B） | 需飞书私聊/群聊 + 排队/合并预览 | 入队与 F1/Get 文案须肉眼 |
| 01 §七·3 Agent dispatch（场景 C） | 需 Electron Agent API + 飞书流式/终态回复 | dispatch 链路运行时 deps 遗漏难静态捕获 |
| 01 §七·4 `/restart`（场景 D） | 需授权用户发斜杠指令 + 重启后复验 1～3 | 重启语义须实机 |
| `daemon.ts` 仍 >300 行 | 批1 设计允许 queue/channel/logging 驻留；批2 T8～T11 再瘦身 | 01 验收5 对 `daemon.ts` 全量 ≤300 待批2 |
| R2 `@ts-nocheck` | 类型债务；T-FIX-02 deferred | deps 字段遗漏编译期不可见 |
| R4 `daemon-session-routing.ts` | 并行变更 `20260711205108` 渗透 diff | 归档边界须拆分 commit 或交叉引用 |

## 3、验收追溯表

| 验收点（01/03/04） | 方式 | 冒烟/必须手工 | 证据类型 | 状态 |
|---|---|---|---|---|
| 01 §七·1 Daemon 冷启动 | E2E-A | **必须手工** | `/health` + `/api/status` + lock `port` | R5 open |
| 01 §七·2 飞书收消息入队 | E2E-B | **必须手工** | 队列增长 + F1/Get/合并预览 | R5 open |
| 01 §七·3 Agent dispatch | E2E-C | **必须手工** | launch/dispatch + 飞书回复 | R5 open |
| 01 §七·4 `/restart` 不回归 | E2E-D | **必须手工** | 重启后 1～3 仍成立 | R5 open |
| 01 §七·5 单文件行数（批1 子集） | `wc -l` | **冒烟（已通过）** | 全部 `daemon-*.ts` ≤300；`daemon.ts` 1710 行可接受 | T-FIX-01 |
| 02 §八·（二）验收1～4 | E2E-A～D | **必须手工** | 同 01 §七·1～4 | R5 open |
| 02 §八·（二）验收5 | `wc -l` | **冒烟（已通过）** | 批1 新建模块合规 | T-FIX-01 |
| 02 §八·（二）poll-message 404 | 静态 | **冒烟（已通过）** | `04-review` 路由体确认 | T5 |
| 02 §八·（二）ponytail | 静态 | **冒烟（已通过）** | 未假装 T7 迁移 / 空实现 / 日志双写 | T7 |
| T1 deps 接口零行为变更 | `build:mcp` | **冒烟（已通过）** | 类型声明 + 构建 | T1 |
| T2 ordering 抽出 ≤300 | `wc -l` | **冒烟（已通过）** | ordering 簇 3 文件均 ≤130 | T2 |
| T3 orchestrator ≤300 | `wc -l` | **冒烟（已通过）** | 274 行 | T3 |
| T4 presentation handlers 簇 ≤300 | `wc -l` | **冒烟（已通过）** | handlers 221 + 子文件均 ≤277 | T4 |
| T5 HTTP routes 簇 ≤300 | `wc -l` | **冒烟（已通过）** | routes 52 + 路由簇/admin 均 ≤191 | T5 |
| T6 HTTP server 簇 ≤300 | `wc -l` | **冒烟（已通过）** | server 115 + mcp/non-api ≤191 | T6 |
| T7 组装 + `daemon.ts` 瘦身 | `wc -l` + build | **冒烟（部分）** | 1710 行（原 3591）；E2E 待手工 | T7 |
| T-FIX-01 R1 超限垂直切分 | `wc -l` + build | **冒烟（已通过）** | 17 个批1 子模块均 ≤300 | R1 resolved |
| R1 批1 模块超 300 行 | T-FIX-01 | **已解决** | 垂直切分后零超标 | resolved |
| R5 无 E2E 冒烟证据 | E2E-A～D | **必须手工** | 归档前须补证 | open |
| T8～T16 批2～4 | — | **deferred** | manifest `deferred` | — |

## 4、场景摘要

### 4.1 手工 E2E（必须）

| ID | 场景 | 前置 | 触发 | 期望 | 失败判责 |
|---|---|---|---|---|---|
| E2E-A | 验收1：冷启动就绪 | Electron 可拉起 Daemon | 应用冷启动 → 等 `daemonMain` 完成 | `/health` 与 `/api/status` 返回 ok；lock 含 `port` | 未监听→查 `startHttpServer` / lock 写入 |
| E2E-B | 验收2：飞书入队 | Daemon + 飞书通道已绑定 | 私聊/群聊发消息 | 消息入队；F1/Get/合并预览与拆分前一致 | 丢失/重复→查 queue `pushMessage` / presentation enqueue |
| E2E-C | 验收3：dispatch 与回复 | E2E-B 已入队 | 等待调度触发 | `forwardElectronAgentApi` launch/dispatch；飞书收到流式或终态回复 | 永不执行→查 `runAgentDispatchLoop` / deps 接线 |
| E2E-D | 验收4：`/restart` | E2E-A～C 基线可用 | 授权用户发 `/restart` | Daemon 按语义重启；重启后 A～C 仍成立 | 无响应/误重启→查 Electron 指令轮询 + `daemonMain` 重启路径 |

### 4.2 静态冒烟（已执行）

| ID | 核对点 | 路径/命令 | 期望 | 结果 |
|---|---|---|---|---|
| ST-1 | MCP/TS 构建 | `npm run build:mcp` | exit 0 | **通过** |
| ST-2 | 批1 子模块行数 | `wc -l src/daemon/daemon-*.ts`（不含 `daemon.ts`） | 每个文件 ≤300 | **通过**（25 文件；最大 277 行 `daemon-presentation-process-events.ts`） |
| ST-3 | 主文件瘦身 | `wc -l src/daemon/daemon.ts` | 显著小于 3591；批1 可 >300 | **通过**（1710 行） |
| ST-4 | orchestrator 体量 | `daemon-orchestrator.ts` | ≤300 | **通过**（274 行） |
| ST-5 | HTTP server 簇 | `daemon-http-server.ts` + mcp + non-api | 各 ≤300 | **通过**（115 / 106 / 191） |
| ST-6 | routes 簇 | `daemon-http-routes*.ts` + admin 簇 | 各 ≤300 | **通过**（最大 170 `daemon-http-admin-content.ts`） |
| ST-7 | presentation 簇 | `daemon-presentation-*.ts`（含 ordering 子文件） | 各 ≤300 | **通过**（最大 277） |
| ST-8 | poll-message 404 | `04-review` 静态 | `GET /api/poll-message` → 404 | **通过**（评审确认） |

### 4.3 可选运行时契约（手工）

| 动作 | 期望 |
|---|---|
| `GET /health` | `{ status: "ok" }` 或项目等价字段 |
| `GET /api/status` | 字段集与拆分前一致 |
| `POST /api/stream-text` | 含 `{ deferred: true }` / CardKit ack 语义不变 |
| `POST /api/presentation-event` | `tool`/`thinking`/`task`/`assistant`/`merge_batch` 种类不变 |
| `GET /api/poll-message` | 404 |

## 5、脚本位置与环境

| 项目 | 说明 |
|---|---|
| 自动化脚本 | **无**（本变更未建 `auto_test/`） |
| 静态命令 | `npm run build:mcp`；`wc -l src/daemon/daemon*.ts` |
| 手工前置 | 飞书应用、Daemon + Electron 同版本；至少一会话可收发 |
| 环境变量 | 无新增必填；**不写密钥** |
| 副作用 | E2E 产生入队与路由切换；静态/构建无写库 |

## 6、输出与记录规范

执行记录仅表格一行一次（命令/结果/结论短语）；**禁止**粘贴完整终端或含 token 日志。

## 7、执行记录

| 日期 | 环境 | 命令/动作 | 结果 | 备注 |
|---|---|---|---|---|
| 2026-07-11 | 本地 | `npm run build:mcp` | 通过 | exit 0；`tsc` |
| 2026-07-11 | 本地 | `wc -l src/daemon/daemon-*.ts` | 通过 | 25 文件均 ≤300；最大 277 行 |
| 2026-07-11 | 本地 | `wc -l src/daemon/daemon.ts` | 通过 | 1710 行（原 ~3591）；批1 可接受 |
| 2026-07-11 | — | E2E-A～D | 待用户执行 | R5 open；必须手工；见 §4.1 |
