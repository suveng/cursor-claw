# 斜杠执行模式稳态收尾 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` §6.1–6.3、`03-tasks.md` T6、`02-design.md` §八·（二）ST-S1～ST-S7
> **父变更**：`20260712113307-控制层HTTP化与斜杠去Electron依赖`（契约脚本模式参照）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 源码静态 + 单元 mock（`executeSlashCommand`）+ 临时 Daemon HTTP 契约；飞书 IM 端到端为可选补证 |
| **目标** | 验证默认 `SLASH_EXEC_MODE=daemon` 稳态、`/mcp-admin` 移除、dual 兼容保留、父债 `/merge` 划界 |
| **与验收关系** | ST-S* 逐项对应 `02` §八·（二）；T1–T5 实现项以静态/契约为辅证 |
| **本期执行** | `auto_test/run-slash-steady-state-contract.sh`（含 `tsc --noEmit` + emit + bundle）；**ALL PASS** |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| 飞书连发 `/status` 观测双回复（ST-S2） | 无已配置飞书 Bot；Daemon 测试实例无 IM 出站 | 默认 daemon 已静态确认不写 `.fcmd`；契约证队列空 |
| `dual` 模式飞书单条去重时序（ST-S3） | 需 dual + Electron 5s poll + IM 联调 | skip-check HTTP 200 已证；`handleCommand` dual 分支静态保留 |
| 菜单 `cmd_status` 不经 poll（ST-S7） | 需飞书卡片点击实机 | `feishu-event-handlers` 注释与父债 S8 静态无回归点 |
| `daemon.ts` 行数 ~1888 | 历史债务；`02` Ponytail 不扩 scope 拆分 | 不影响本变更行为 |

## 3、验收追溯表

| ID | 验收摘要（01/02/03） | 验证方式 | 证据类型 | 状态 |
|----|---------------------|----------|----------|------|
| ST-S1 | 未设 env 默认 daemon；`/status` 不经 Electron claim | 静态 `?? "daemon"` + 运行时启动日志 + mock `/status` | 源码 + 日志 + mock | ✅ |
| ST-S2 | 默认无双写重复执行 | 静态 dual-only 注释 + 默认 Daemon `GET /commands` 空队列 | 源码 + HTTP | ✅ |
| ST-S3 | 显式 `dual` 双写 + skip-check；回 daemon 无新 `.fcmd` | 静态 dual 分支 + dual Daemon skip-check 200；默认队列空 | 源码 + HTTP | ✅ |
| ST-S4 | `/mcp-admin` 410 指引；`/api/mcp` 可用 | `GET /mcp-admin` 410 + `GET /api/mcp` 200；injector 无 admin URL | HTTP + 源码 | ✅ |
| ST-S5 | Electron 未就绪 `/help` 可回、`/stop` 中文 | mock `executeSlashCommand` | mock | ✅ |
| ST-S6 | 中文注释、`tsc`、改动文件 ≤300 行 | `tsc --noEmit`；workspace-injector 等行数扫描 | 编译 + 静态 | ✅ |
| ST-S7 | `/merge` 与 `/status` 无交叉；菜单不经 poll | mock `/merge` skip；父债静态 | mock + 源码 | ✅ |
| T1 | 默认 daemon；显式 dual 仍双写 | 合成 ST-S1/S3 | — | ✅ |
| T2 | poll/skip-check dual-only 注释 | grep 注释落点 | 源码 | ✅ |
| T3 | `/mcp-admin` 移除；启动日志无双 MCP | 合成 ST-S4 + 运行时日志文案 | HTTP + 日志 | ✅ |
| T4 | `buildMcpServers` 仅 `cursor-claw` | 源码断言 | 源码 | ✅ |
| T5 | AGENTS + KB 三文件默认 daemon | `04-review` 已勾选；KB diff 人工 spot | review | ✅ |
| T6 | ST-S 全清单 + `tsc` | 本脚本 + §7 执行记录 | 契约 | ✅ |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| 构建 | `npm run build:mcp` → `npm run build:bundle`（脚本自动执行） |
| 临时 Daemon | `APP_DATA_DIR` 隔离；`CLAW_CHANNELS_JSON` 最小飞书通道 |
| 环境变量 | 默认用例**删除** `SLASH_EXEC_MODE`；dual 用例显式 `dual` |
| 凭据 | **勿**写入本文；飞书实机项标「已配置」后手工补证 |

### 4.2 ST-S 冒烟清单

| # | 场景 | 前置 | 操作 | 期望 | 本期 |
|---|------|------|------|------|------|
| ST-S1 | 默认 daemon 启动 | 未设 `SLASH_EXEC_MODE` | 启 Daemon | 日志 `SLASH_EXEC_MODE=daemon`；mock `/status` 本地回复 | ✅ |
| ST-S2 | 无双写 | 默认 daemon | `GET /commands` | `commands:[]` | ✅ |
| ST-S3 | dual 兼容 | `SLASH_EXEC_MODE=dual` | `GET /commands/skip-check` | HTTP 200 | ✅ |
| ST-S4 | admin 移除 | Daemon 运行 | `GET /mcp-admin`、`GET /api/mcp` | 410+hint；200 ok | ✅ |
| ST-S5 | Electron 未就绪 | mock deps | `/help`、`/stop` | 帮助文本；「未运行」类中文 | ✅ |
| ST-S6 | 工程规范 | — | `tsc --noEmit`；改动文件行数 | 通过；injector/http-server ≤300 | ✅ |
| ST-S7 | merge 划界 | mock deps | `/merge` | 无通用 reply（T8 前置） | ✅ |

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| 启动日志仍 `dual` | `dist/` 未 emit 或 bundle 陈旧；须先 `build:mcp` |
| `/mcp-admin` 200 MCP 握手 | `daemon-http-server` 分支未移除 |
| 默认队列有 `.fcmd` | env 仍为 `dual`/`electron` 或 `handleCommand` 回归 |
| mock `/merge` 有 reply | `shouldSkipSlashCommand` 回归 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/run-slash-steady-state-contract.sh` | 入口：`tsc --noEmit` → `build:mcp` → `build:bundle` → `.mts` |
| `auto_test/run-slash-steady-state-contract.mts` | ST-S1～S7 静态 + mock + 临时 Daemon HTTP |
| 环境变量名 | `SLASH_EXEC_MODE`（默认用例删除）、`KB_SLASH_TEST_PORT`、`APP_DATA_DIR`（脚本内设） |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端日志；§7 备注列仅用结论性短语。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地 | `tsc --noEmit -p tsconfig.json` | 通过 | ST-S6 |
| 2026-07-12 | 本地 | `npm run build:mcp` + `build:bundle` | 通过 | bundle 须 emit 后打包 |
| 2026-07-12 | 契约脚本 | ST-S1 静态默认 daemon | 通过 | `?? "daemon"` 双侧 |
| 2026-07-12 | 契约脚本 | ST-S2 静态 + 默认队列空 | 通过 | dual-only 注释 |
| 2026-07-12 | 契约脚本 | ST-S3 dual skip-check | 通过 | HTTP 200 |
| 2026-07-12 | 契约脚本 | ST-S4 mcp-admin 410 + /api/mcp | 通过 | injector 无 admin |
| 2026-07-12 | 契约脚本 | ST-S5 mock help/stop | 通过 | Electron 未运行文案 |
| 2026-07-12 | 契约脚本 | ST-S6 改动文件行数 | 通过 | daemon.ts 历史债务除外 |
| 2026-07-12 | 契约脚本 | ST-S7 merge skip mock | 通过 | 无通用 reply |
| 2026-07-12 | 契约脚本 | `run-slash-steady-state-contract.sh` 全量 | 通过 | ALL PASS |
