# 长驻Agent空闲后静默失败修复 — 实施摘要

> **hotfix-lite** · 变更 ID：`20260711113147-长驻Agent空闲后静默失败修复`

## 实际变更

| 文件 | 说明 |
|------|------|
| `electron/agent/cursor-sdk/sdk-resident-refresh.ts` | **新增**：`RESIDENT_STALE_IDLE_MS`、`recreateSessionAgent`、`maybeRefreshStaleResidentAgent` |
| `electron/agent/cursor-sdk/sdk-opaque-retry.ts` | **新增**：`isOpaqueEarlyRunFailure`、`resendAfterOpaqueFailure` |
| `electron/agent/cursor-sdk/sdk-run-dispatch.ts` | attempt===1 空闲刷新；send 前写 `lastSendText`；轮转复用 recreate |
| `electron/agent/cursor-sdk/sdk-run-lifecycle.ts` | `completeSdkRun` error 分支 opaque_retry；成功路径在 `startSdkRun` **前**置 `opaqueRetryDone`（`startSdkRun` 不再清零该闩） |
| `electron/agent/cursor-sdk/sdk-session-types.ts` | `lastSendText` / `opaqueRetryDone` |
| `electron/agent/cursor-sdk/sdk-session-registry.ts` | `resetSdkRunPresentationState` 清零 `opaqueRetryDone` |
| `electron/agent/cursor-sdk/sdk-failure-messages.ts` | 非上下文兜底改为临时故障文案 |
| `electron/agent/cursor-sdk/AGENTS.md` | resident-refresh / opaque_retry 规矩 |
| `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md` | 服务端规则 8–9、数据字段、变更记录 |
| `package.json` | version bump `1.14.0` → `1.14.1`（用户可见修复，patch） |
| `changelog/1.14.1.json` | 新建：空闲后静默失败修复 + 临时故障提示文案 |

## 验收对照

| # | 标准 | 实现 |
|---|------|------|
| 1 | idle≥阈值 dispatch 前重建，日志含 resident-refresh | `maybeRefreshStaleResidentAgent` @ sendWithRetry attempt===1 |
| 2 | 静默早期 ERROR 自动重建重发一次，成功无失败文案 | `completeSdkRun` → `resendAfterOpaqueFailure` → `startSdkRun` 提前 return |
| 3 | 非上下文静默失败不再「建议精简输入」 | `formatUserSdkFailureMessage` 临时故障句 |
| 4 | 上下文≥95% 仍走上限文案 | peak / pre-send 分支未改 |

## 知识库已更新

- 已同步 `knowledge/业务域/Agent调度/06-CursorSDK执行引擎.md`（规则 8–9、字段、变更记录）
- 代码侧 SSOT：`electron/agent/cursor-sdk/AGENTS.md`
- `00-README` 引用未失真，未改总索引

## 风险与遗留

- opaque 判定依赖 duration/usage/lastTool；边界 case 可能漏判或误判（宁可漏判走原 notify）
- opaque 重试会丢失原 Agent 对话上下文（与 ContextRotation 同类取舍）
- 未跑全量静态检查；建议用长驻空闲 ≥15min 后发消息 + 日志关键字冒烟
