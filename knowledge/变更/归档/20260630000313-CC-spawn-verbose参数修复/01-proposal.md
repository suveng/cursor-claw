# CC spawn --verbose 参数修复轻量变更说明

> **变更 ID**：`20260630000313-CC-spawn-verbose参数修复`
> **来源**：kb-lite
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P1
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无
> **关联变更**：`knowledge/变更/归档/20260629164130-执行引擎扩展接入ClaudeCode/`

---

## 背景

执行引擎切换为 Claude Code（CC）后，Electron 主进程通过 `agent-claude-sdk.ts` 的 `buildSpawnArgs` 构建 `claude` CLI spawn 参数，以 `--print` + `--output-format stream-json` 拉取流式 JSON 事件。

当前 CC CLI 版本要求：使用 `--print` 且 `--output-format=stream-json` 时**必须**同时传入 `--verbose`。缺失时子进程立即以 code=1 退出，Claude Code 引擎路径无法启动 Agent Run。

本 hotfix 在 spawn 参数中补全 `--verbose`，最小 diff 恢复 CC 执行路径；不改动 Cursor SDK 路径，也不挂接无关变更「完全移除 Cursor CLI 依赖」。

## 根因

- **落点**：`electron/agent-claude-sdk.ts`，函数 `buildSpawnArgs`（约 249–254 行）。
- **现状**：args 含 `"--print"`、`"--output-format"`、`"stream-json"` 及 model/resume 等，**缺少** `"--verbose"`。
- **CLI 约束**：Claude Code CLI 校验 `--print` + `stream-json` 组合时强制 `--verbose`。
- **运行时表现**（stderr）：
  ```
  Error: When using --print, --output-format=stream-json requires --verbose
  ```
  子进程 exit code=1，CC Agent 无法 spawn。

## 变更说明

### LITE-01：`buildSpawnArgs` 添加 `--verbose`

- 在 `buildSpawnArgs` 返回的 args 数组中加入 `"--verbose"`（与 `--print`、`--output-format stream-json` 同组传递）。
- 保持其余参数不变（`--dangerously-skip-permissions`、`--model`、`--resume` 等）。
- 若 `electron/AGENTS.md` 有 CC spawn 参数约定，同步一句说明 `--verbose` 为 stream-json 必需项。

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、stderr、根因、修复方向已明确 |
| 修改范围 | 单函数、单文件为主（+ 可选 AGENTS 一句） |
| 接口契约 | 无 proto/HTTP/IPC 变更（+0） |
| 数据/权限 | 不变（+0） |
| 跨端联动 | Electron CC spawn 路径（+0） |
| 知识库 | 记录型，05-summary 说明即可（+0） |
| **总分** | **≤2**，可走 hotfix-lite |

## 验收标准

1. **复现消除**：配置 CC 引擎后触发 Agent launch/dispatch，stderr **不再**出现 `stream-json requires --verbose`，子进程 exit code ≠ 1（因该参数缺失）。
2. **spawn 成功**：CC CLI 子进程正常启动，stream-json 事件可被现有解析逻辑消费。
3. **回归**：Cursor SDK 路径不受影响；已有 CC session `--resume` 行为不变。
4. **TypeScript 编译通过**。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/agent-claude-sdk.ts` | **主改动**：`buildSpawnArgs` 增加 `--verbose` |
| `electron/AGENTS.md` | 可选：CC spawn 参数约定补一句 |
| CC 执行路径 | IM / 任务 / 工作流经 CC 引擎的 Run 恢复可用 |
| Cursor SDK 路径 | 无改动 |

**不在范围**：`agent-sdk.ts`、Daemon、proto/DB、Settings UI、changelog（archive 阶段再定是否 patch bump）。

## 待 builder 事项

- 实现 LITE-01 后更新 manifest：`tasks[0].status = done`，`files[]` 写入实际变更路径与 status。
- 完成后由 kb-scribe 补写 `05-summary.md`；hotfix-lite 可与实现同轮归档。
