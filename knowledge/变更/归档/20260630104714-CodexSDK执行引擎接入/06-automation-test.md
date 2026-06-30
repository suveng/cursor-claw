# Codex SDK 执行引擎接入 - 验收记录

> **变更 ID**：`20260630104714-CodexSDK执行引擎接入`
> **阶段**：`/kb-test`（轻量；编译 + T-FIX 关键路径静态追溯）
> **输入**：`01-proposal.md`、`02-design.md`、`03-tasks.md`（T1–T8、T-FIX-01~05 均 `done`）；`04-review.md` R7 `pass`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **编译验证**（`npx tsc --noEmit`）+ **关键路径静态追溯**（rg/读源码，不跑 IM 联调） |
| **静态焦点** | IM Daemon → Codex 路由（T-FIX-01）；飞书 process gate import（T-FIX-02）；`stop`/`list`/daemon 运行态（T-FIX-03）；`completeCodexRun` 代际 + 日志脱敏 + 失败文案单点（T-FIX-04）；`getAgentResource` F6 + Profile model 覆盖（T-FIX-05） |
| **目标** | 覆盖 `03` T-FIX-01~05 验收标准；`01` F1–F6 / 验收 1–10 **runtime 留待人工** |
| **通过口径** | 编译 exit 0；T-FIX 静态项 ✅；全量 IM/任务/工作流/Codex CLI 真跑为 archive 前 debt |
| **不新增** | 单元测试 / 集成测试 / `auto_test/` |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·1/2/3**：IM launch/dispatch、任务、工作流 Codex Run | 依赖 Daemon、飞书/微信通道、`@openai/codex` CLI 与 API Key |
| **01·5/6/10**：流式呈现、上下文 footer、续接/超时/冷却 | 须长时 Run 与真实 SDK 事件流 |
| **01·7/8/9**：Profile UI、双通道绑定、切换回 SDK/CC | 须 `npm run dev` 目视 + 配置操作 |
| **Dashboard stop/list** | T-FIX-03 静态已覆盖符号；停止/列表交互须 dev 面板实测 |

## 3、追溯矩阵（T-FIX-01~05）

| 任务 | 验证方式 | 静态追溯要点 | 结果 |
|------|----------|--------------|------|
| **T-FIX-01** | 静态读 `agent-sdk.ts` | `resolveBoundAgentResourceType` 含 `"codex"` / `"codex-missing"`；launch/dispatch 分支调 `launchCodexAgentFromHttp` / `dispatchToCodexAgent` | ✅ |
| **T-FIX-02** | 静态读 `agent-codex-stream.ts` | `import { … as feishuSuppressesProcessKind }` 与 `:69` 调用一致（对齐 `agent-cc-stream.ts`） | ✅ |
| **T-FIX-03** | 静态读 `session-dispatcher.ts` / `daemon-manager.ts` / `agent-codex-session-registry.ts` | `stopSessionAgent`/`isSessionAgentRunning`/`getSessionAgentList` 含 Codex；`getCodexSessionList` 合并 daemon 运行态；导出 `stopCodexSession` | ✅ |
| **T-FIX-04** | 静态读 `agent-codex-complete.ts` / `agent-codex-sdk.ts` / `codex-failure-messages.ts` | `completeCodexRun` 代际不匹配 no-op；ERROR/WARN 经 `sanitizeCodexSensitiveText`；`completeCodexRun` 注释明确 IM 兜底不经二次 `formatCodexFailureMessage` | ✅ |
| **T-FIX-05** | 静态读 `config-store.ts` / `session-dispatcher.ts` | `getAgentResource`：`isCodexResourceId(id)` 已删绑定返回 `undefined` 不 fallback；`launchAgent` codex 分支 `model` 取自 `resource.model` | ✅ |

## 4、场景摘要（runtime 待人工）

| 场景 ID | 前置 | 步骤摘要 | 期望 | 关联 |
|---------|------|----------|------|------|
| **K1 IM Codex** | Codex Profile + IM 通道绑定 | 飞书/微信发消息 → Daemon launch | Run 走 Codex HTTP；非 sdk/cc | 01·1、T-FIX-01 |
| **K2 飞书 process** | 飞书通道 + 含 tool/thinking 任务 | 观察流式与 UI 日志 | 无 ReferenceError；process gate 与 CC 对等 | T-FIX-02 |
| **K3 Dashboard** | Codex Run 进行中 | 会话列表 → 停止 | 列表含 codex；stop 可 abort | T-FIX-03 |
| **K4 连发代际** | 同 session 快速连发 | dispatch 两次 | 旧 run 收尾不覆盖新 run 状态 | T-FIX-04 |
| **K5 F6 / model** | 删除已绑定 Profile；或通道残留 sdk model | IM 触发 / 切 Codex 再 Run | 不静默换 Profile；model 来自 Profile | T-FIX-05、01·9 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **脚本** | 本期无 `auto_test/` |
| **编译** | 仓库根目录 `npx tsc --noEmit` |
| **runtime 依赖** | Electron + Daemon；`OPENAI_API_KEY`；可选 `@openai/codex` CLI；IM 凭据 |

## 6、输出与记录规范

- 禁止粘贴完整终端日志或含 apiKey 的快照。
- 执行记录仅用 §7 表格：日期、环境、命令/场景、结果、备注（一词结论）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-06-30 | 本地 dev | `npx tsc --noEmit` | 通过 | exit 0 |
| 2026-06-30 | — | K1–K5 runtime | 待执行 | 轻量 kb-test 未跑联调 |
