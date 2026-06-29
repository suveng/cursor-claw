# CC spawn --verbose 参数修复 - 验收记录

> **变更 ID**：`20260630000313-CC-spawn-verbose参数修复`
> **阶段**：`/kb-test`（轻量 hotfix-lite；静态契约 + 用户手工联调）
> **实现落点**：`electron/agent-claude-sdk.ts` → `buildSpawnArgs` 已含 `"--verbose"`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态契约**（`buildSpawnArgs` 含 `--verbose`）+ **用户手工联调**（CC 通道 Daemon launch/dispatch） |
| **目标** | 覆盖 `01-proposal` 验收 1–4 |
| **通过口径** | stderr 无 `requires --verbose`；子进程非 code=1；Agent 有正常回复；Cursor SDK 路径无回归 |
| **不新增** | 单元测试 / 集成测试 / `auto_test/` 脚本 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| CC CLI spawn 与 stream-json 消费 | 依赖 Electron + Daemon + CC 引擎配置与真实 IM/任务入口 |
| Cursor SDK 回归 | 需切换引擎或走 SDK 路径手工 smoke |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 状态 |
|------|----------|----------|------|
| **01·1** | stderr 无 `stream-json requires --verbose`；非 code=1 | 手工 V1 | ⏳ 待用户执行 |
| **01·2** | CC spawn 成功；stream-json 事件可被解析 | 手工 V1 + UI 日志 | ⏳ 待用户执行 |
| **01·3** | Cursor SDK 路径不受影响；`--resume` 行为不变 | 可选 V2 | ⏳ 待用户执行 |
| **01·4** | TypeScript 编译通过 | 构建 / dev 启动 | ⏳ 待用户执行 |
| **LITE-01** | `buildSpawnArgs` args 含 `"--verbose"` | 静态读源码 | ✅ |

## 4、场景摘要

### 4.1 复现（修复前）

| 项 | 内容 |
|----|------|
| **触发** | 执行引擎为 CC；经 Daemon `POST /api/agent/launch`（或 dispatch）启动 Agent Run |
| **stderr** | `Error: When using --print, --output-format=stream-json requires --verbose` |
| **退出码** | 子进程 **code=1**，CC Agent 无法 spawn |

### 4.2 期望（修复后）

| 项 | 内容 |
|----|------|
| **spawn** | CC launch/dispatch 子进程正常启动，**无**上述 stderr |
| **事件流** | `--output-format stream-json` 输出可被现有解析逻辑消费（UI 有 Run/assistant 进展，非立即失败） |
| **响应** | IM 或任务通道收到 Agent **正常回复**（非 dispatch_failed / 启动即失败） |

### 4.3 用户验证步骤（CC 通道 launch）

| 步骤 | 操作 | 期望 |
|------|------|------|
| **V1-1 前置** | Settings 执行引擎选 **Claude Code**；Daemon 已运行；Electron 已加载本变更 | CC 路径可用 |
| **V1-2 发起** | 经 IM（飞书/微信）或任务/workflow 发消息，触发 **Daemon launch**（新会话或 dispatch 均可） | 进入 processing，非即时失败 |
| **V1-3 观测 stderr** | Electron **UI 日志**或 devtools 主进程日志 | **无** `requires --verbose`；**无** spawn code=1 |
| **V1-4 观测 Run** | 等待 Agent 处理 | stream-json 事件流正常；有 assistant 输出或完成态 |
| **V1-5 响应** | 查看 IM 回复 | 内容为正常 Agent 答复，非启动错误文案 |
| **V2（可选）** | 切回 Cursor SDK 引擎 smoke 一次 | SDK 路径与修复前一致 |
| **V3（可选）** | 同 CC session 二次 dispatch（`--resume`） | 续聊正常 |

### 4.4 静态契约（kb-recorder 已执行）

| 检查 | 落点 | 期望 | 结果 |
|------|------|------|------|
| verbose 参数 | `buildSpawnArgs` L251 | args 含 `"--verbose"`，位于 `--print` 与 `--output-format` 之间 | ✅ |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **脚本** | 本期无 `auto_test/` |
| **运行依赖** | Electron + Daemon；CC 引擎 + `ANTHROPIC_API_KEY`（及可选 `ANTHROPIC_BASE_URL`） |
| **入口** | IM 消息 → Daemon `POST /api/agent/launch` → `agent-claude-sdk` spawn |

## 6、输出与记录规范

- 禁止粘贴完整终端日志或含 token 的 JSON。
- 执行记录仅用 §7 表格：日期、环境、场景 ID、结果、备注（一词结论）。

## 7、执行记录

| 日期 | 环境 | 场景 | 结果 | 备注 |
|------|------|------|------|------|
| 2026-06-30 | 本地 dev | 静态 §4.4（`buildSpawnArgs`） | 通过 | `--verbose` 已加入 |
| 2026-06-30 | — | V1 CC launch 联调 | 待执行 | 用户 IM/Daemon 验证 |
| 2026-06-30 | — | V2 SDK 回归（可选） | 待执行 | smoke |
| 2026-06-30 | — | V3 CC resume（可选） | 待执行 | 同会话续聊 |
