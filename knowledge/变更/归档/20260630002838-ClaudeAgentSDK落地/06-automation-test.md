# Claude Agent SDK 落地 - 验收记录

> **变更 ID**：`20260630002838-ClaudeAgentSDK落地`
> **阶段**：`/kb-test`（构建 + 静态扫描 + 手工/runtime 冒烟；builder 已执行前者）
> **输入**：`01-proposal.md`、`02-design.md`、`03-tasks.md`（T1–T8 均 `done`）

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **构建编译**（`npm run build`）+ **静态契约**（rg 残留扫描、HTTP 契约 diff）+ **手工/runtime 冒烟**（dev launch、MCP、流式呈现、打包 dist:mac）；**不新增**单元测试/集成测试 |
| **目标** | 覆盖 `01` 验收 1–9、`02` 八·（二）工程补充项、`03` T1–T8 各条验收标准 |
| **通过口径** | 静态与构建项 builder 已勾；**01·1/2/4/5/6** 及任务/工作流/ Cursor 回归须 dev 或打包环境实测；无双轨 CLI 残留为发布阻断项 |
| **与 review 分工** | review 偏实现与规范；本文负责验收追溯、场景清单与执行记录 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·1/2**：IM launch/dispatch + thinking/tool/stream-text | 依赖 Claude Profile、IM 通道与 SDK 实时流；须 `npm run dev` + 飞书/微信联调 |
| **01·3**：任务与工作流多节点 | 须任务面板/YAML 工作流真实触发 |
| **01·4**：MCP 工具调用 | 须已配置 `~/.cursor/mcp.json` 或 workspace MCP + OAuth；SDK inline 注入仅静态可证 |
| **01·5**：session 续跑 | 须 launch → complete → dispatch 全链路；`CC_RESIDENT_AGENT=0` 与默认 resident 各测一轮 |
| **01·6**：macOS 打包 IM Run | `dist:mac` 构建 + 安装包内执行；无 headless 等价脚本 |
| **01·9**：Cursor SDK 回归 | 须 Cursor Profile 路径 smoke，与本变更并行但独立 |
| **`auto_test/` 脚本** | 本期未新增；以 build + rg + 手工清单为主 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** | IM 绑定 Claude Profile 可 launch/dispatch 并收到回复 | runtime K1 | 联调 | ⏳ **待人工** |
| **01·2** | thinking / tool / stream-text 呈现不退化 | runtime K2 | 联调 / UI | ⏳ **待人工** |
| **01·3** | 任务触发与 ≥3 节点工作流完整执行 | runtime K3 | 联调 | ⏳ **待人工** |
| **01·4** | 至少一个 MCP 在 Claude Run 可调用 | runtime K4 + T2 静态 | 联调 / 代码 | ⏳ K4 待人工；T2 ✅ 静态 |
| **01·5** | 同 Profile session 续跑上下文连贯 | runtime K5 | 联调 | ⏳ **待人工** |
| **01·6** | macOS 打包版无需本机 CLI 可完成 IM Run | runtime K6 | 打包联调 | ⏳ **待人工** |
| **01·7** | 无双轨：无 CLI spawn / claude-code dep | build + rg | 命令 | ✅ builder |
| **01·8** | 品牌「Claude Agent」；无禁用表述 | rg 文案 + UI 抽查 K7 | 代码 / 手工 | ✅ T7 静态；⏳ K7 UI |
| **01·9** | Cursor SDK 路径无回归 | runtime K8 | 联调 | ⏳ **待人工** |
| **T1** | 依赖迁移；无 `@anthropic-ai/claude-code` | build + rg package | 命令 | ✅ build 通过 |
| **T2** | `cc-mcp-loader.ts` MCP 合并 API | 编译 + K4 | 代码 / 联调 | ✅ 编译；⏳ K4 |
| **T3** | `query()` 核心；无 spawn；HTTP 无 diff | build + rg + diff | 命令 | ✅ builder |
| **T4** | `streamCcSdkMessages`；无 stream-json | rg electron | 命令 | ✅ builder |
| **T5** | `activeQuery`；二进制路径工具 | build | 编译 | ✅ build 通过 |
| **T6** | `asarUnpack` 平台包 | K6 dist:mac | 打包 | ⏳ **待人工** |
| **T7** | 文档与 UI 品牌文案 | rg + K7 | 代码 / 手工 | ✅ 静态；⏳ K7 |
| **T8** | 全库 spawn/stream-json 扫尾 | rg electron | 命令 | ✅ builder |
| **§8.2·resident** | `CC_RESIDENT_AGENT=0` 与默认双模式 | runtime K5 | 联调 | ⏳ **待人工** |
| **§8.2·MCP 双类型** | stdio 相对路径 + HTTP OAuth 各一条 | runtime K4 | 联调 | ⏳ **待人工** |
| **§8.2·dist:mac** | arm64 安装包内 Claude Agent Run | runtime K6 | 打包 | ⏳ **待人工** |

## 4、场景摘要

### 4.1 手工/runtime 必测清单

| 场景 ID | 前置 | 步骤摘要 | 期望 | 关联 |
|---------|------|----------|------|------|
| **K1 IM launch/dispatch** | Claude Profile 已配置；IM 通道已绑定 | 飞书/微信发消息触发 Run | launch 成功；收到完整流式回复；dispatch 续消息正常 | 01·1、T3 |
| **K2 流式呈现** | K1 进行中或单独触发含 tool/thinking 任务 | 观察 IM 与 Agent 面板 | thinking、tool 卡片、stream-text 时序与粒度与迁移前一致；无丢事件/乱序 | 01·2、T4 |
| **K3 任务与工作流** | 任务面板 + 含 ≥3 节点的 YAML 工作流 | 各触发一次 Claude 引擎 Run | 节点间上下文与 reject/重跑逻辑不变；输出符合预期 | 01·3 |
| **K4 MCP 注入** | global/project `mcp.json` 各配一条（stdio 相对路径 + HTTP OAuth） | Claude Run 触发需 MCP 工具的任务 | 工具被调用；结果回传 Presentation/IM | 01·4、T2、§8.2 |
| **K5 会话续跑** | 同一 Profile；`CC_RESIDENT_AGENT=1` 与 `=0` 各测 | launch → complete → dispatch | `ccSessionId` resume；上下文连贯 | 01·5、§8.2 |
| **K6 打包版** | `npm run dist:mac`（arm64）；本机无 `claude` CLI | 安装 `.app`；IM 触发一次完整 Run | 引擎启动；Run 完成；`app.asar.unpacked` 内 SDK 平台包可解析 | 01·6、T6、§8.2 |
| **K7 品牌文案** | 打开 Settings、AgentPanel | 目视 + `rg 'Claude Code Agent\|Claude Code SDK' src/renderer/` | 用户可见处为「Claude Agent」；无禁用表述 | 01·8、T7 |
| **K8 Cursor 回归** | Cursor Profile 通道 | `npm run dev` 下 IM launch 一条 | Cursor SDK 路径行为与迁移前一致 | 01·9、T8 |

### 4.2 静态/构建（builder 已执行）

| 检查 | 命令/落点 | 期望 | 结果 |
|------|-----------|------|------|
| TypeScript 构建 | `npm run build` | exit 0 | ✅ 通过 |
| CLI/spawn 残留 | `rg '@anthropic-ai/claude-code\|buildSpawnArgs\|streamCcEvents' electron/` | 无命中 | ✅ 无命中 |
| HTTP 契约不变 | `agent-cc-http.ts` diff | 空 diff | ✅ 无 diff |
| SDK 依赖 | `package.json` | 含 `@anthropic-ai/claude-agent-sdk` | ✅（build 隐含） |
| MCP 模块 | `electron/cc-mcp-loader.ts` | `loadInlineCcMcpServers` 导出 | ✅ 编译通过 |
| 打包配置 | `electron-builder.yml` `asarUnpack` | 含 claude-agent-sdk 平台 glob | ✅ T6 已落代码；产物待 K6 |

**静态验证命令指针**（仅摘要，不贴长输出）：

```bash
npm run build
rg '@anthropic-ai/claude-code|buildSpawnArgs|streamCcEvents' electron/
git diff -- electron/agent-cc-http.ts   # 期望无输出
rg '@anthropic-ai/claude-agent-sdk' package.json
```

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **脚本目录** | 本期无 `auto_test/` 新增 |
| **运行依赖** | Node 与 Electron dev；Claude Profile（`ANTHROPIC_API_KEY`、可选 `ANTHROPIC_BASE_URL`）；IM 通道凭据 |
| **环境变量** | `CC_RESIDENT_AGENT`（K5 双模式）、`DAEMON_PORT`、通道 `LARK_*` / `WECHAT_*`；**勿写入真实密钥** |
| **MCP 数据** | `~/.cursor/mcp.json`、workspace `.cursor/mcp.json`、`mcp-auth.json`（OAuth） |
| **打包** | `npm run dist:mac` 或 `pack:mac`（arm64 优先） |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的 JSON。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- 联调失败区分：**操作/环境** vs **SDK/服务** vs **Presentation 映射**。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-06-30 | 本地 dev | `npm run build` | 通过 | builder |
| 2026-06-30 | 本地 dev | `rg '@anthropic-ai/claude-code\|buildSpawnArgs\|streamCcEvents' electron/` | 通过 | 无命中 |
| 2026-06-30 | 本地 dev | `agent-cc-http.ts` diff | 通过 | 无 diff |
| 2026-06-30 | — | K1 IM launch/dispatch | 待执行 | runtime 未跑 |
| 2026-06-30 | — | K2 流式呈现 | 待执行 | runtime 未跑 |
| 2026-06-30 | — | K3 任务/工作流 | 待执行 | 手工 |
| 2026-06-30 | — | K4 MCP 双类型 | 待执行 | 手工 |
| 2026-06-30 | — | K5 session 续跑 | 待执行 | 含 resident 双模式 |
| 2026-06-30 | — | K6 dist:mac 打包 Run | 待执行 | 手工 |
| 2026-06-30 | — | K7 品牌 UI 抽查 | 待执行 | 手工 |
| 2026-06-30 | — | K8 Cursor 回归 | 待执行 | 手工 |
