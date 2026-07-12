# 工作流恢复债务清偿 - 变更总结

## 1、实际变更

| 文件 | 改动 |
|------|------|
| `src/workflow/server-workflow.ts` | `logWorkflowResume` 的 `ok` 改为可选；入口调用省略 `ok`；失败/成功出口仍写 `ok: false/true` |
| `electron/scheduling/command-handler.ts` | `sub === "resume"` 实例解析失败文案改为 `❌ 实例不存在` |

**用户可见**：斜杠 `/workflow resume` 在 ID/序号未命中时与引擎路径文案一致；Daemon 恢复日志不再在入口误标 `ok: false`。

## 2、与设计的差异

无。D2 日志双轨按评审结论保留。

## 3、影响范围

- **Daemon stderr 日志**：`workflow_resume` 入口行仅含 `instance_id` + `source: daemon`；出口行含 `ok`
- **斜杠 resume**：仅实例解析失败路径；`status` 子命令仍为 `❌ 找不到该实例`

## 4、知识库影响清单

无（债务清偿，无新业务规格变更）。
