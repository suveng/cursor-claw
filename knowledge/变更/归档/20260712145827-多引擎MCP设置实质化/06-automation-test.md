# 多引擎MCP设置实质化 - 验收记录

> **来源**：`/kb-test`（kb-recorder）
> **追溯**：`01-proposal.md` §6.1–6.3、`03-tasks.md` T1–T6、`02-design.md` §八·（二）ST-M1～M5
> **父变更**：`20260712144931-斜杠执行模式稳态收尾`（`/mcp-admin` 410、injector 口径）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | 源码静态 + 纯函数断言 + mock `/mcp ls` + 临时 Daemon HTTP；Settings/Electron UI 实机走查为可选补证 |
| **目标** | 验证健康降级 SSOT、Codex/OpenCode 只读实质化、Daemon 可复制指引、稳态收尾无回归 |
| **与验收关系** | ST-M* 对应 `02` §八·（二）；T1–T5 以静态/契约为辅证；T6 含 AGENTS 对齐 |
| **本期执行** | `auto_test/run-mcp-settings-contract.sh`（含 `tsc --noEmit` + emit + bundle）；**ALL PASS** |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 | 残留风险 |
|----------|------|----------|
| Settings MCP Tab 实机 Codex/OpenCode 列表渲染 | 需 Electron 窗口 + 通道绑定 codex/opencode | 契约已证 `supported:true` 与 IPC 读盘模块 |
| `agent-api-port.json` 真实缺失时 admin `POST /api/mcp` info 全文 | mock 仅覆盖斜杠 `/mcp ls` 降级路径 | 静态确认三处共用 `formatMcpHealthDisplay` |
| 剪贴板一键复制实机 | 需 renderer 用户手势 | 静态确认 `JSON.stringify` 合法片段 |
| 工程平台 KB 正文（`04-配置与更新` 等） | 归 `/kb-archive` + librarian | AGENTS 已对齐实现口径 |
| `daemonPort` 与实跑 Daemon 不一致 | 产品已知边界（`02` §八·（一）） | 指引脚注已说明以 Settings 配置为准 |

## 3、验收追溯表

| ID | 验收摘要（01/02/03） | 验证方式 | 证据类型 | 状态 |
|----|---------------------|----------|----------|------|
| ST-M1 | agent-api 不可用时健康列含中文降级句，无裸「未知」 | 静态 SSOT + mock `/mcp ls` | 源码 + mock | ✅ |
| ST-M2 | Settings Codex/OpenCode 非静默占位 | 静态 `SettingsMcpDiskReadonly`、`mcp-view-strategy` | 源码 | ✅ |
| ST-M3 | 可复制合法 `mcp.json` 片段（`cursor-claw` url） | 静态 `buildCursorMcpSnippet` + injector 对齐 | 源码 | ✅ |
| ST-M4 | 改动文件 ≤300 行、中文注释 | 行数扫描 + `session-mcp-disk-fallback` 拆分 | 静态 | ✅ |
| ST-M5 | `/mcp-admin` 410、`GET /api/mcp` 200 无回归 | 临时 Daemon HTTP + injector 静态 | HTTP + 源码 | ✅ |
| T1 | 三处健康文案 SSOT | 合成 ST-M1 | — | ✅ |
| T2 | codex/opencode 无 session 读盘 | ST-M4 fallback 模块 + `04-review` | review + 静态 | ✅ |
| T3 | Settings 只读块 | 合成 ST-M2 | — | ✅ |
| T4 | Daemon 指引 | 合成 ST-M3 | — | ✅ |
| T5 | SessionMcpPanel disk 空 status | ST-M1 `formatMcpPanelStatusLabel` | 源码 | ✅ |
| T6 | AGENTS 对齐 + 01 全量验收 | 三处 AGENTS 更新 + 本脚本 + `tsc` | 文档 + 契约 | ✅ |
| 01 §6.1.1 R1 | 占位消除 | ST-M2 | — | ✅ |
| 01 §6.1.2 R2 | 健康非静默未知 | ST-M1 | — | ✅ |
| 01 §6.1.3 R3 | 指引可用 | ST-M3 | — | ✅ |
| 01 §6.2 | 无整页重做 / 无协议变更 / 无微信 | `04-review` + ST-M5 | review | ✅ |

## 4、场景摘要

### 4.1 环境与前置

| 项 | 要求 |
|----|------|
| 构建 | `npm run build:mcp` → `npm run build:bundle`（脚本自动执行） |
| 临时 Daemon | `APP_DATA_DIR` 隔离；`CLAW_CHANNELS_JSON` 最小飞书通道 |
| mock 数据 | 临时工作区 `.cursor/mcp.json` 含 `kb-contract` 条目 |
| 凭据 | **勿**写入本文；实机 UI 项标「已配置」后手工补证 |

### 4.2 ST-M 冒烟清单

| # | 场景 | 前置 | 操作 | 期望 | 本期 |
|---|------|------|------|------|------|
| ST-M1 | 健康 SSOT | — | 静态 + mock fetch 失败 | `暂不可查（…）`；无「未知」 | ✅ |
| ST-M2 | Settings 实质化 | — | 静态组件/strategy | 无 Placeholder；codex/opencode `supported:true` | ✅ |
| ST-M3 | Daemon 指引 | — | 静态 snippet | 合法 JSON；仅 `cursor-claw` | ✅ |
| ST-M4 | 工程规范 | — | 行数扫描 | 改动文件 ≤300 | ✅ |
| ST-M5 | 稳态回归 | Daemon 运行 | `GET /mcp-admin`、`GET /api/mcp` | 410；200 | ✅ |

### 4.3 失败判责

| 现象 | 优先怀疑 |
|------|----------|
| 健康列仍「未知」 | 未引用 `mcp-health-label` 或 bypass SSOT |
| `/mcp ls` mock 无降级句 | 工作区无 MCP 条目（ls 早退空列表） |
| Settings 仍占位 | `SettingsMcpEngineBlock` 未走 `DiskReadonly` |
| `/mcp-admin` 200 | `daemon-http-server` 回归 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| `auto_test/run-mcp-settings-contract.sh` | 入口：`tsc --noEmit` → `build:mcp` → `build:bundle` → `.mts` |
| `auto_test/run-mcp-settings-contract.mts` | ST-M1～M5 静态 + mock + 临时 Daemon HTTP |
| 环境变量名 | `KB_MCP_TEST_PORT`（可选）、`APP_DATA_DIR`（脚本内设） |

## 6、输出与记录规范

会话与本文均**禁止**粘贴完整终端日志；§7 备注列仅用结论性短语。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-12 | 本地 | `tsc --noEmit -p tsconfig.json` | 通过 | ST-M4 |
| 2026-07-12 | 本地 | `npm run build:mcp` + `build:bundle` | 通过 | bundle 须 emit 后打包 |
| 2026-07-12 | 契约脚本 | ST-M1 健康 SSOT 静态 | 通过 | 三处引用 shared |
| 2026-07-12 | 契约脚本 | ST-M1 mock `/mcp ls` 降级 | 通过 | 临时 ws mcp.json |
| 2026-07-12 | 契约脚本 | ST-M2 Settings 只读 | 通过 | 无 Placeholder |
| 2026-07-12 | 契约脚本 | ST-M3 Daemon 指引 | 通过 | cursor-claw only |
| 2026-07-12 | 契约脚本 | ST-M4 行数规范 | 通过 | status 292 行 |
| 2026-07-12 | 契约脚本 | ST-M5 HTTP 回归 | 通过 | mcp-admin 410 |
| 2026-07-12 | 契约脚本 | `run-mcp-settings-contract.sh` 全量 | 通过 | ALL PASS |
