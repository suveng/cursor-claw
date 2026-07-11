# 长驻Agent空闲后静默失败修复轻量变更说明

> **变更 ID**：`20260711113147-长驻Agent空闲后静默失败修复`
> **来源**：kb-lite
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P1
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

用户飞书发消息成功后约 1 小时再发，收到：

> ⚠️ Agent 处理失败，建议精简输入后重新发送；若仍失败请稍后重试。

日志证据（`crash_log/20260711112122` 与 `20260711112808`）：

1. `dispatch_retry status=ok` → `[status] RUNNING` → 约 1～3 秒内 `[status] ERROR`
2. `waitResult` 仅有 `status=error`，无 `message` / `result` / `errorCode`（静默 ERROR）
3. 同日早些时候有 `UNAVAILABLE | read ETIMEDOUT` 未处理 Promise 拒绝
4. 长驻 resident Agent 空闲后底层 Connect/gRPC 连接僵死；`send` 表面成功但 Run 立刻失败
5. 失败文案走兜底「精简输入」，在上下文未超限时误导用户
6. `send()` 抛错才有 retry；Run 级静默 ERROR 不重试

## 变更说明

长驻 Agent 空闲后连接僵死导致静默 ERROR。补：

1. **空闲刷新**：idle 超过阈值后，dispatch 前重建 Agent
2. **静默失败一次重建重试**：早期静默 ERROR（无 message/result/tool、短 duration）自动重建并重发一次
3. **非上下文兜底文案**：非上下文静默失败改为临时故障/请重试语义，避免误导「精简输入」

## 验收标准

1. 长驻 idle ≥ 阈值后 dispatch 前重建 Agent，UI 日志含 `resident-refresh` / `stale`
2. 静默早期 ERROR（无 message/result/tool、短 duration）自动重建并重发一次，成功则用户无失败文案
3. 非上下文静默失败文案不再仅「建议精简输入」，改为临时故障/请重试语义
4. 上下文 ≥ 95% 时仍走「上下文窗口已接近或达到上限」文案

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/agent/cursor-sdk` | 空闲刷新、静默 ERROR 重建重试、失败文案归因 |
| Agent调度知识说明 | 归档时按需同步长驻空闲与静默失败策略（本阶段仅变更文档） |
| 不在范围 | 不改 proto / 跨端契约；不改飞书 UI 布局 |

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、日志证据与验收已明确 |
| 修改范围 | cursor-sdk 及调度说明，少量强相关文件 |
| 接口契约 | 无 proto/跨端契约变更 |
| 数据/权限 | 不变 |
| 跨端联动 | 仅 Electron 主进程 SDK 路径 |
| 风险 | 线上阻断、范围可控 → **hotfix-lite** |
| **总分** | **≤2**，可走 lite |
