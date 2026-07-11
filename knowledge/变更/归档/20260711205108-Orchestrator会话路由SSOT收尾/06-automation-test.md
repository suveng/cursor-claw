# Orchestrator 会话路由 SSOT 收尾 - 验收记录

> **口径**：`01` §六·1～6、`03` T1～T3；T4 持久化 **deferred**  
> **策略**：**静态冒烟 + rg 定向扫描**（已执行）+ **手工 E2E**（必须）；无本变更 `auto_test/` 脚本；不新增单测脚手架

## 1、测试策略与范围

| 维度 | 说明 |
|---|---|
| 验收目标 | 回退栈 SSOT 迁至 Daemon；清理 `previousActiveSessionMap` / `dispatchSessionAgents`；知识库与现网一致 |
| 层级 | **构建冒烟** + **rg 零命中** + **符号/路由静态对照** + **手工 E2E**（场景 A～D） |
| 主证据 | `npm run build` 通过；源码零遗留符号；`daemon-client` / HTTP 三路由存在；E2E 见活跃路由切换与系统提示 |
| 不覆盖 | T4 Daemon 重启持久化（deferred）；不跑全量部署或飞书自动化脚本 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 | 残留风险 |
|---|---|---|
| 01 §六·1 回退基线（场景 A） | 需飞书私聊 + 双会话 Agent 运行 | 仅静态无法证 F6 切回 |
| 01 §六·2 跨 Electron 重启（场景 B） | 需中途杀/重启 Electron 主进程 | 核心修复须实机 |
| 01 §六·3 定时任务独立触发（场景 C） | 需配置 cron + `__IND_LAUNCH__` | 与 /chat new 语义须对照 |
| 01 §六·4 容错（场景 D） | 需构造无回退/目标已停/手动切换 | 行为须肉眼 + 日志 |
| HTTP 契约运行时 | 未起 Daemon 打 curl | 路由逻辑已静态命中；运行时 400/幂等待手工 |
| `daemon-http-routes.ts` 行数 | 历史文件已 >300 行（461） | T1 验收「≤300」对本文件为已知缺口；新增 `daemon-session-routing.ts` 21 行合规 |

## 3、验收追溯表

| 验收点（01/03） | 方式 | 冒烟/必须手工 | 证据类型 |
|---|---|---|---|
| 01 §六·1 回退基线 | E2E-A | **必须手工** | 活跃路由切回 + 系统提示 |
| 01 §六·2 跨重启修复 | E2E-B | **必须手工** | Electron 重启后仍回退 |
| 01 §六·3 独立触发对齐 | E2E-C | **必须手工** | cron 结束后回退一致 |
| 01 §六·4 容错 | E2E-D | **必须手工** | 无报错、不错误覆盖 active |
| 01 §六·5 架构约束 | rg + KB 静态 | **冒烟（已通过）** | 零命中 + `05-定时任务.md` 指向 orchestrator |
| 01 §六·6 工程规范 | build + 行数抽查 | **冒烟（部分）** | build 通过；routing 新文件 ≤300 |
| T1 三路由 + Map SSOT | ST-1～ST-3 | **冒烟（已通过）** | 代码 / 路由路径 |
| T2 `previousActiveSessionMap` 零命中 | `rg` | **冒烟（已通过）** | 零命中 |
| T2 client 三函数 | ST-2 | **冒烟（已通过）** | `daemon-client.ts` |
| T3 `dispatchSessionAgents` 零命中 | `rg` | **冒烟（已通过）** | 零命中（变更文档历史引用除外） |
| T3 KB 同步 | ST-4 | **冒烟（已通过）** | `02-多会话模型` / `05-定时任务` |
| T3 `npm run build` | build | **冒烟（已通过）** | exit 0 |
| T4 持久化 | — | **deferred** | manifest `deferred` |
| 02 §八·（二）手动 1～4 | E2E-A～D | **必须手工** | 同 01 §六·1～4 |

## 4、场景摘要

### 4.1 手工 E2E（必须）

| ID | 场景 | 前置 | 触发 | 期望 | 失败判责 |
|---|---|---|---|---|---|
| E2E-A | 场景 A：/chat new 结束回退 | 主会话 Agent 运行；Daemon 运行 | `/chat new <任务>` → 等临时会话结束 | 活跃路由回到创建前会话；有回退提示 | 未回退→查 `getSessionFallback` / `handleSessionClosed` |
| E2E-B | 场景 B：Electron 重启后回退 | E2E-A 中途 | 重启 Electron（Daemon 保持）→ 临时会话结束 | 仍自动切回原活跃会话 | 未回退→Daemon Map 是否仍在 |
| E2E-C | 场景 C：定时任务独立 | 存在其他活跃会话 | 独立模式 cron 触发 → 任务结束 | 回退语义同 E2E-A | 对比 `__IND_LAUNCH__` 是否 `setSessionFallback` |
| E2E-D | 场景 D：容错 | 无原活跃 / 目标已停 / 手动切走 | 临时会话结束 | 不报错、不强制覆盖当前 active | 错误覆盖→F6-a/b 回归 |

### 4.2 静态冒烟（已执行）

| ID | 核对点 | 路径/命令 | 期望 | 结果 |
|---|---|---|---|---|
| ST-1 | session-fallback 三路由 | `daemon-http-routes.ts` L312/332/343 | POST/GET/DELETE `/api/session-fallback` | **通过** |
| ST-2 | client 封装 | `daemon-client.ts` L64/71/82 | `set/get/clearSessionFallback` | **通过** |
| ST-3 | 回退栈模块 | `daemon-session-routing.ts` | `fallbackSessionMap` + helper | **通过**（21 行） |
| ST-4 | KB 无过时符号 | `02-多会话模型.md` §二；`05-定时任务.md` §四 | Daemon SSOT；`runAgentDispatchLoop` | **通过** |
| ST-5 | 遗留符号清零 | `rg previousActiveSessionMap --glob '*.{ts,tsx,js}'` | 零命中 | **通过** |
| ST-6 | dead code 清零 | `rg dispatchSessionAgents --glob '*.{ts,tsx,js}'` | 零命中 | **通过** |
| ST-7 | 构建 | `npm run build` | exit 0 | **通过** |

### 4.3 可选运行时契约（手工）

| 动作 | 期望 |
|---|---|
| `POST /api/session-fallback` body `{sessionKey,fallbackSessionKey}` | `{ ok: true }` |
| `GET /api/session-fallback?sessionKey=` | `{ fallbackSessionKey: string \| null }` |
| `DELETE /api/session-fallback?sessionKey=` | `{ ok: true }`（幂等） |

## 5、脚本位置与环境

| 项目 | 说明 |
|---|---|
| 自动化脚本 | **无**（本变更未建 `auto_test/`） |
| 定向扫描 | `rg previousActiveSessionMap --glob '*.{ts,tsx,js}'`；`rg dispatchSessionAgents --glob '*.{ts,tsx,js}'` |
| 手工前置 | 飞书应用、Daemon + Electron 同版本；至少一会话 Agent 运行 |
| 环境变量 | 无新增必填；**不写密钥** |
| 副作用 | E2E 产生临时会话与路由切换；静态/构建无写库 |

## 6、输出与记录规范

执行记录仅表格一行一次（命令/结果/结论短语）；**禁止**粘贴完整终端或含 token 日志。

## 7、执行记录

| 日期 | 环境 | 命令/动作 | 结果 | 备注 |
|---|---|---|---|---|
| 2026-07-11 | 本地 | `npm run build` | 通过 | exit 0；含 bundle + vite 三目标 |
| 2026-07-11 | 本地 | `rg previousActiveSessionMap --glob '*.{ts,tsx,js}'` | 通过 | 零命中 |
| 2026-07-11 | 本地 | `rg dispatchSessionAgents --glob '*.{ts,tsx,js}'` | 通过 | 零命中 |
| 2026-07-11 | 本地 | 静态 ST-1～ST-4 | 通过 | 三路由 + client 三函数 + KB |
| 2026-07-11 | — | E2E-A～D | 待用户执行 | 必须手工；见 §4.1 |
