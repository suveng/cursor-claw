# 移除 Agent 启动工作流提示词轻量变更说明

> **变更 ID**：`20260630005510-移除Agent启动工作流提示词`
> **来源**：kb-lite
> **类型**：Refactor（行为简化）
> **优先级**：P3
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无
> **lite 类型**：记录型 lite

---

## 背景

`electron/agent-launcher.ts` 的 `buildPrompt` 在组装 Agent 启动 Prompt 时，**无条件**在首部 push 两条硬编码工作流前缀之一：

- `useMainWorkspace === true` 或 `meta.chatType === "workflow"` 时：`请绝对严格遵守工作流规则cursor-claw开始工作`
- 否则：`请按照digital-identity数字身份定义并绝对严格遵守工作流规则cursor-claw开始工作`

上述文案与 workflow / digital-identity 启动规则强绑定，但 Agent 侧规则应通过项目 rules、skills 或用户任务本身承载，不应在每次 launch 时由主进程硬编码注入。该前缀对所有 SDK / Claude Code 会话生效，增加 Prompt 噪声且与「最小注入」原则不符。

## 变更说明

### LITE-01：移除 buildPrompt 硬编码工作流前缀

- **删除** `buildPrompt` 内 L39–43 两条硬编码前缀 push 及关联分支逻辑
- **保留** `taskMessage` 拼接（含 `---` 分隔与「任务内容:」标签）
- **保留** 会话元数据拼接（`---`、`会话元数据:`、`session_key`、`chat_type`）
- 若移除前缀后 `useMainWorkspace` 等参数仅用于已删分支，builder 可一并清理签名与调用方传参（最小 diff 优先，避免无关重构）

### 约束

- 中文注释；单文件 ≤300 行；最小 diff
- **不**改变 IM 通道、Daemon launch API、会话调度语义
- **不**新增替代性硬编码前缀

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 删除两行前缀、保留任务与元数据，验收可 grep 验证 |
| 修改范围 | 主改 `agent-launcher.ts` 单文件（+0） |
| 接口契约 | 内部 Prompt 组装，非 proto / IPC 契约变更（+0） |
| 数据/权限 | 不变（+0） |
| 跨端联动 | Electron 单仓（+0） |
| 知识库 | 记录型，实现后 05-summary 说明即可（+0） |
| **总分** | **0**，可走 lite |

## 验收标准

1. **grep 无硬编码文案**：仓库内（至少 `electron/`）不再出现上述两句启动前缀原文。
2. **buildPrompt 输出结构**：有 `taskMessage` 时仍含 `---`、`任务内容:` 与任务正文；始终含 `---`、`会话元数据:` 及 `[session_key=…]` / `[chat_type=…]`（在对应入参存在时）。
3. **调用方无需功能性改动**：`agent-sdk.ts`、`agent-claude-sdk.ts` 继续调用 `buildPrompt` 即可；若签名精简导致 TypeScript 报错，仅做参数对齐。
4. **TypeScript 编译通过**。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/agent-launcher.ts` | **主改**：移除硬编码前缀，保留任务与元数据拼接 |
| `electron/agent-sdk.ts` | 调用方；Prompt 首部不再含工作流前缀（行为变更，通常无需改逻辑） |
| `electron/agent-claude-sdk.ts` | 同上 |
| `electron/session-dispatcher.ts` | 间接依赖 `agent-launcher` 类型/符号；不直接调用 `buildPrompt` |
| `electron/AGENTS.md`（可选） | 若模块边界描述仍暗示「启动注入工作流前缀」，builder 同步一句说明 |

**不在范围**：proto/DB、飞书/微信通道文案、Daemon orchestrator、changelog（archive 阶段再定）。

## 实现要点（供 builder）

- **分隔符 `---`**：移除首段前缀后，首个 `---` 可能直接出现在任务块或元数据块前；保持现有「任务块 / 元数据块」分段语义即可，无需为删前缀单独增段。
- **代码注释**：在 `buildPrompt` 注明仅拼接任务与用户可见会话元数据，不注入 rules/skills 类启动指令。
- **`electron/AGENTS.md`**：当前仅提及 `buildPrompt` 为共享符号；若无「硬编码工作流前缀」表述则不必改。

## 待 builder 事项

- 实现 LITE-01 后更新 manifest：`tasks[].status`、`files[]` 写入实际代码路径
- 完成后由 kb-scribe 补写 `05-summary.md`；archive 时按需 bump 版本与 changelog
