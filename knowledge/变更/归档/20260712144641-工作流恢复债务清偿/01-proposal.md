# 工作流恢复债务清偿（kb-lite）

## 背景

父变更 `20260712113344-工作流恢复入口与信号接口` 已归档；评审 §7 遗留 D1/D3 需清偿，D2 日志双轨保留为 accepted_debt。

## 范围

| 债务 | 动作 |
|------|------|
| D1 | `resumeWorkflowAndEmit` 入口 `logWorkflowResume(id)` 省略 `ok`，与 Electron 对齐 |
| D2 | **不修改**（console.log vs stderr 双轨） |
| D3 | `/workflow resume` 实例未命中：`❌ 找不到该实例` → `❌ 实例不存在`（仅 resume 分支） |

## 不在范围

- HTTP 契约、引擎逻辑、status 子命令文案
- D2 日志格式统一

## 验收

`bash knowledge/变更/归档/20260712113344-工作流恢复入口与信号接口/auto_test/run-workflow-resume-contract.sh` → ALL PASS
