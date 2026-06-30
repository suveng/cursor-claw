# OpenCode SDK 执行引擎接入 - 验收记录

> **变更 ID**：`20260630105159-OpenCodeSDK执行引擎接入`
> **阶段**：`/kb-test`（编译 + 关键路径静态追溯 + 人工冒烟清单）
> **输入**：`01-proposal.md`（10 条验收）、`02-design.md`（八·（二）工程补充）、`03-tasks.md`（T1–T9、T-FIX-01/02 `done`）；`04-review.md` R1/R2 已修复，R3 info 不阻断

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **编译验证**（`npm run build`、`npx tsc --noEmit`）+ **关键路径静态追溯**（符号/调用链 grep，不跑 IM 联调） |
| **静态焦点** | 四引擎 type 同步（T1）；IM 路由 `opencode`/`opencode-missing`（T2）；HTTP launch/dispatch 与 stop/list/daemon 对称（T2/T6）；上下文 limit + `maybeRotateOpencodeSessionContext`（T-FIX-01）；退出 `closeAllEmbeddedOpencodeServers`（T-FIX-02）；失败脱敏（T8）；UI Profile/MCP 符号（T9） |
| **目标** | `01` 十条验收：**编译与静态 ✅**；IM/任务/工作流/OpenCode 真跑 **留人工冒烟** |
| **通过口径** | 编译 exit 0；静态追溯项 ✅；K1–K10 人工项 archive 前 debt |
| **不新增** | 单元测试 / 集成测试 / `auto_test/` |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·1/2/3**：IM、任务、工作流 OpenCode Run | 依赖 Electron + Daemon、飞书/微信通道、真实 OpenCode 服务与 Provider 凭证 |
| **01·4**：切回 SDK/CC/Codex 全路径回归 | 须 dev 环境逐引擎切换并触发 Run |
| **01·5**：thinking/tool/text 流式呈现 | 须真实 SSE 事件流与飞书 presentation 联调 |
| **01·6**：上下文超限压缩/轮转 | 须长上下文 Run 或 mock usage 触发 `maybeRotateContext` |
| **01·7/8/9**：Profile UI、多 Profile、双通道绑定 | 须 `npm run dev` 配置面板目视与持久化验证 |
| **01·10**：超时/冷却/用户可见错误 | 须故意失败或等待 `PLATFORM_RUN_LIMIT_MS` |
| **02·八（二）**：内嵌启动失败/外部 health 文案 | T8 单测路径未建；须 embedded 端口冲突或外部错误地址实测 |
| **R3**：`presentationOrderingEligible` 未接入 stream | info 级 YAGNI，不阻断 |

## 3、验收追溯表

### 3.1 `01-proposal` 十条

| 01# | 验收摘要 | 验证方式 | 证据/结论 | 结果 |
|-----|----------|----------|-----------|------|
| 1 | IM 消息 OpenCode 执行并回复 | 静态 + **人工冒烟 K1** | `agent-sdk` → `launchOpencodeAgentFromHttp`；`session-dispatcher` opencode POST launch | 静态✅ / runtime 待 |
| 2 | 任务面板触发 | 静态 + **人工 K2** | `launchAgent` opencode 分支 → `/api/opencode/agent/launch` | 静态✅ / runtime 待 |
| 3 | 工作流 ≥3 节点流转 | 静态 + **人工 K3** | workflow → `launchAgent` 同路由（02 S15 不改） | 静态✅ / runtime 待 |
| 4 | 切回 SDK/CC/Codex 正常 | 静态 + **人工 K4** | 四 type 分支独立；`findFirstRunnableResource` 含 opencode 兜底 | 静态✅ / runtime 待 |
| 5 | 事件流 progress 展示 | 静态 + **人工 K5** | `agent-opencode-events` + stream；飞书 gate import 对齐 CC | 静态✅ / runtime 待 |
| 6 | 上下文超限轮转 | 静态 + **人工 K6** | T-FIX-01：`resolveOpencodeContextLimit` → `maybeRotateOpencodeSessionContext` | 静态✅ / runtime 待 |
| 7 | UI 部署模式/Provider/模型 | 静态 + **人工 K7** | `OpenCodeEditModal`、`ChannelModelSection` opencode 分组 | 静态✅ / runtime 待 |
| 8 | 多 Profile 独立保存 | 静态 + **人工 K8** | `newOpencodeResourceId`、`AgentOpencodeProfileSection` CRUD | 静态✅ / runtime 待 |
| 9 | 两通道不同 Profile | 静态 + **人工 K9** | 通道 `agentResourceId` + `isProfileResource("opencode")` | 静态✅ / runtime 待 |
| 10 | 超时/冷却/错误提示 | 静态 + **人工 K10** | `watchOpencodeRunGuard`、`formatOpencodeFailureMessage`、`maskOpencodeApiKey` | 静态✅ / runtime 待 |

### 3.2 `02-design` 八·（二）工程补充

| 补充项 | 验证方式 | 静态要点 | 结果 |
|--------|----------|----------|------|
| 内嵌启动失败用户文案 | 静态读 `opencode-failure-messages` / `agent-opencode-utils` | `embedded_start_failed` 分支；不抛 stack 到 IM | ✅ |
| 外部 health 失败文案 | 静态 | `external_health_failed` →「无法连接 OpenCode 服务…」；探活用 `config.get`（04 设计偏差已记录） | ✅ |
| apiKey 脱敏 | 静态 | `maskOpencodeApiKey` / `sanitizeOpencodeSensitiveText` 用于日志与归档 | ✅ |
| Profile 删除 `opencode-missing` | 静态 | `agent-sdk` / `agent-opencode-http` 拦截，不自动降级 | ✅ |
| 四引擎切换 | 见 01·4 | — | 静态✅ |
| stop/isRunning/list 对称 | 静态 | `session-dispatcher` 调 `stopOpencodeSession`/`isOpencodeSessionRunning`；`getSessionAgentList` 含 `engineType: opencode` | ✅ |
| Dashboard MCP 策略 | 静态 | `getMcpViewConfig("opencode")`；`mcp-view-strategy.ts` | ✅ |
| 退出内嵌 server 清理 | 静态 | `main.ts` `before-quit` → `closeAllEmbeddedOpencodeServers`（T-FIX-02） | ✅ |

### 3.3 `03-tasks` 编译类（T1 等）

| 任务 | 验证方式 | 结论 |
|------|----------|------|
| T1 | `package.json` 含 `@opencode-ai/sdk`；`channel-types`/`preload`/`env.d` type 同步 | ✅ |
| T2–T9 | 符号存在 + `npm run build` 通过 | ✅ |
| T-FIX-01/02 | 见 01·6、02·退出清理 | ✅ |

## 4、场景摘要

### 4.1 人工冒烟清单（K1–K10）

| 场景 ID | 前置条件 | 步骤摘要 | 期望 | 关联 |
|---------|----------|----------|------|------|
| **K1 IM OpenCode** | OpenCode Profile（embedded 或 external）+ IM 通道绑定；Provider 凭证已配置 | 飞书/微信发消息 → Daemon claim → launch | Run 走 OpenCode HTTP；IM 收到回复 | 01·1 |
| **K2 任务面板** | 通道/任务绑定 opencode Profile | 任务面板触发独立 Agent | launch 成功、任务完成有输出 | 01·2 |
| **K3 工作流** | YAML 工作流 ≥3 节点 | 触发工作流执行 | 各节点顺序完成、reject/重跑可用 | 01·3 |
| **K4 引擎切换** | 曾用 OpenCode 跑通 | 切回 sdk / claude-code / codex 各触发一次 Run | 三引擎路径正常、无 opencode 残留错误 | 01·4 |
| **K5 流式 progress** | OpenCode Run 含 tool/reasoning | 观察飞书进度与 Dashboard 日志 | thinking/tool/assistant 等价展示；飞书 process gate 无 ReferenceError | 01·5 |
| **K6 上下文轮转** | 长对话或可调低 `contextLimitTokens` 测试 | 连发至超限 | `opencodeSessionId` 重建；用户侧可感知压缩/续跑 | 01·6 |
| **K7 Profile 配置** | `npm run dev` | 新建 Profile：切换 embedded/external、填 Provider/模型并保存 | 重启后配置持久；Run 使用所配模型 | 01·7 |
| **K8 多 Profile** | 新建 ≥2 个 OpenCode Profile | 分别改 deployMode/model 保存 | 互不影响、id 为 `opencode_<hex>` | 01·8 |
| **K9 双通道绑定** | 飞书+微信两通道 | 各绑不同 OpenCode Profile 后分别发消息 | 各 Run 使用对应 Profile 的 Provider/模型 | 01·9 |
| **K10 失败/超时** | 错误 apiKey 或断外部服务 | 触发失败；或等待平台超时 | 用户可见脱敏文案；冷却期内拒跑；watchdog 收尾 | 01·10 |

### 4.2 人工冒烟前置（汇总）

| 项 | 要求 |
|----|------|
| **环境** | `npm run dev` 或打包应用；Daemon 已启动 |
| **OpenCode** | embedded：本机端口可用；external：可访问 baseUrl + `config.get` 可达 |
| **凭证** | Profile `providerId` + `apiKey`（勿写入本文档）；IM 通道凭据已配置 |
| **数据** | 可选独立 workspace；测试后无需清库（非破坏性冒烟） |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 本期无 |
| **编译** | 仓库根：`npm run build`（含 `tsc` + electron-vite）；或 `npx tsc --noEmit` |
| **runtime 依赖** | Electron、Daemon、`@opencode-ai/sdk`；可选外部 OpenCode 实例 |
| **环境变量** | `OPENCODE_RESIDENT_AGENT`（可选，默认跟随 SDK）；勿记录 apiKey |

## 6、输出与记录规范

- 禁止粘贴完整终端日志或含 apiKey 的快照。
- 执行记录仅用 §7 表格：日期、环境、命令/场景、结果、备注（一词结论）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-06-30 | 本地 macOS | `npm run build` | 通过 | exit 0，electron-vite 三段构建成功 |
| 2026-06-30 | 本地 macOS | `npx tsc --noEmit` | 通过 | exit 0 |
| 2026-06-30 | 本地 macOS | §3 静态追溯（四引擎路由/stop/list/T-FIX/context/脱敏/UI） | 通过 | rg+读源码 |
| 2026-06-30 | — | K1–K10 人工冒烟 | 待执行 | 需 OpenCode 服务与 IM 凭据 |
