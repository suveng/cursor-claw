# 通道编辑 Agent 资源与模型按类型联动 - 验收记录

> **变更 ID**：`20260629231225-通道编辑Agent资源模型按类型联动`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`）
> **实现状态**：T1/T2 done → 本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **轻量编译**（`npm run build`）+ **静态契约**（T1 关键符号与行数）+ **手工 E2E**（设置页通道编辑弹窗）；**不新增**单元测试/集成测试 |
| **目标** | 覆盖 `01-proposal` 验收 1–6、`02-design` §八·（二）工程补充项 6 条、`03-tasks` T1/T2 全部验收条 |
| **通过口径** | 构建 exit 0 + 新增文件行数合规可静态确认；用户可见 UI 联动与回归须 **Electron 应用内手工** 勾选 |
| **默认行为** | 本轮已执行 `npm run build`（T2）；不启动 Electron、不修改通道/Profile 持久化配置 |

## 2、局限与未自动化原因

| 未自动化项 | 原因 |
|------------|------|
| **01·1/2/3/4/5** 通道编辑弹窗 UI 联动 | 依赖 Electron Renderer + 已配置 Agent 资源（CLI/SDK/CC Profile）；DOM 条件渲染与 optgroup 须 GUI 观察 |
| **01·6** Profile/任务/IM/执行引擎回归 | 需多页面 smoke 与真实 IM 触发 Run；本变更仅改 `ChannelPanel`/`ChannelModelSection`，静态确认未触及执行链 |
| **§8.2·1** 打开 CC 通道不自动 listModels/listSdkModels | 可 DevTools Network/IPC 观测；默认标手工 E2E |
| **§8.2·3** 切换 SDK→CC→CLI 无残留 | 须弹窗内连续切换并目视 DOM |
| **`auto_test/` 脚本** | 仓库规范不写单测/E2E 脚手架；Renderer 弹窗交互以手工清单为主 |
| **ChannelPanel.tsx 存量行数** | 655 行已超 AGENTS.md 300 行上限；T1 已抽取 `ChannelModelSection.tsx`，存量文件本变更未扩大违规范围 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 证据类型 | 状态 |
|------|----------|----------|----------|------|
| **01·1** | Cursor CLI/SDK：通道级主/其他人模型 +「获取模型列表」；保存后行为与变更前一致 | 手工 E2E（§4.1 S1） | 弹窗截图/摘要 | ⏳ 待用户验收 |
| **01·2** | Claude Code Profile：无「获取模型列表」/Cursor 模型下拉；体现 Profile 管理模型 | 手工 E2E（§4.1 S2） | 弹窗截图/摘要 | ⏳ 待用户验收 |
| **01·3** | 弹窗内 SDK→CC→CLI 切换：模型区形态正确、无残留 | 手工 E2E（§4.1 S3） | 切换过程摘要 | ⏳ 待用户验收 |
| **01·4** | Agent 资源下拉三类可辨（optgroup 或等价） | 手工 E2E（§4.1 S4） | 下拉分组摘要 | ⏳ 待用户验收 |
| **01·5** | 已保存 CC 通道重开编辑：不自动拉 Cursor 模型列表 | 手工 E2E（§4.1 S5） | 无 IPC 触发摘要 | ⏳ 待用户验收 |
| **01·6** | Profile 管理、任务编辑、IM 收发、执行路由无回归 | 手工 smoke（§4.1 S6） | 各页可用摘要 | ⏳ 待用户验收 |
| **§8.2·1** | 打开 CC 通道编辑不自动 `listModels`/`listSdkModels` | 手工 E2E（§4.1 S5） | DevTools/行为摘要 | ⏳ 待用户验收 |
| **§8.2·2** | `claude-code` 时 DOM 无「获取模型列表」按钮 | 手工 E2E（§4.1 S2） | DOM 摘要 | ⏳ 待用户验收 |
| **§8.2·3** | SDK→CC→CLI 切换无 Cursor 模型下拉残留 | 手工 E2E（§4.1 S3） | 切换摘要 | ⏳ 待用户验收 |
| **§8.2·4** | 资源下拉三组可辨 | 手工 E2E（§4.1 S4） | optgroup 摘要 | ⏳ 待用户验收 |
| **§8.2·5** | 新增/修改代码含中文注释；单文件 ≤300 行或已拆分 | 静态行数 + 抽样 | 文件计数 | ✅ `ChannelModelSection.tsx` 193 行；`ChannelPanel.tsx` 655 行存量超限未扩大 |
| **§8.2·6** | `npm run build` 通过 | T2 构建 | 构建摘要 | ✅ exit 0 |
| **T1** | 类型联动 UI、`fetchModels` 守卫、draft 清理、optgroup | 静态读 `ChannelModelSection.tsx` | 代码复核 | ✅ 静态 |
| **T2** | 构建 + 行数合规 + T1 快速 smoke 模板 | `npm run build` + `wc -l` | 构建/行数 | ✅ 构建通过；E2E 待用户 |

## 4、场景摘要

### 4.1 手工验收清单（设置页 → 通道编辑）

**前置（S1–S5 共用）**：Electron 应用已构建并启动；设置页至少存在三类 Agent 资源各一条（Cursor CLI、Cursor SDK、Claude Code Profile）；可选一条已绑定 CC Profile 的已保存通道。

| 场景 ID | 前置 | 触发 | 期望 | 失败判责 |
|---------|------|------|------|----------|
| **S1** Cursor CLI/SDK 模型配置 | 通道编辑弹窗打开 | 选择 CLI 或 SDK 资源 | 可见主模型、其他人模型与「获取模型列表」；点击后可列出模型；保存后执行与变更前一致 | 列表 IPC 失败 → 环境/API Key；控件缺失 → 实现问题 |
| **S2** CC Profile 只读说明 | 存在 `claude-code` 类型 Profile | 选择该 Profile 资源 | DOM **无**「获取模型列表」；**无** Cursor 模型 SearchableSelect；展示 Profile 名与默认模型说明（未配置时有 SDK 默认提示） | 仍出现 Cursor 控件 → 实现问题 |
| **S3** 类型切换联动 | 同一弹窗 | 依次选 SDK → CC Profile → CLI | 每次切换后模型区立即切换形态；CC 阶段无 Cursor 下拉/列表残留；切回 CLI 可恢复通道级模型编辑 | 残留选项或失效按钮 → 实现问题 |
| **S4** 资源下拉分组 | Agent 资源 `<select>` | 展开下拉 | 三组可辨：`Cursor CLI` / `Cursor SDK` / `Claude Code Profile`（optgroup 或等价前缀） | 混排难辨 → 实现问题 |
| **S5** 已保存 CC 通道重开 | 通道已绑定 CC Profile 并保存 | 关闭后重新打开编辑 | **不自动**触发模型列表获取；展示同 S2 | 打开即 listModels/listSdkModels → 实现问题 |
| **S6** 非通道编辑回归 smoke | 应用正常运行 | 分别打开 Profile 管理、任务编辑；可选 IM 触发一轮 Run | 与变更前行为一致；执行仍走既有 `agent-cc-http` 解析链 | 仅通道编辑异常 → 实现问题；多域异常 → 环境/配置 |

### 4.2 轻量编译与静态（已执行）

| 检查 | 操作指针 | 期望 |
|------|----------|------|
| TypeScript 全量构建 | 项目根 `npm run build` | exit 0 |
| 新子组件行数 | `src/renderer/components/ChannelModelSection.tsx` | ≤300 行（实测 193） |
| 存量文件行数 | `src/renderer/components/ChannelPanel.tsx` | 655 行（存量超限；本变更经抽取未扩大） |
| CC 守卫 | `ChannelModelSection` 内 `fetchModels` | `claude-code` 早退；不调用 `listCcModels` |
| 切换清理 | `agentResourceId` onChange | 切 CC 清空 draft 模型字段；切回 Cursor 回显持久化值 |

环境变量与凭据：**不写密钥**；Cursor API Key、Claude Code Profile 以应用内已配置为准。

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无新增（仓库规范不写单测/E2E 脚手架） |
| **运行依赖** | Electron 桌面应用；设置页 → 通道管理 → 通道编辑弹窗 |
| **测试数据** | 至少各类型 Agent 资源一条；建议准备「已绑定 CC Profile 的通道」与「Cursor SDK 通道」各一 |
| **环境变量** | 无专用变量；构建使用项目默认 `npm run build` |

## 6、输出与记录规范

- 会话与本文**禁止**粘贴完整终端日志、含 token 的配置 JSON。
- 执行记录仅用 §7 表格：日期、环境、命令/场景 ID、结果、备注（一词结论）。
- E2E 失败时区分：**操作/环境问题** vs **Renderer 实现问题**（记备注列）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-06-29 | 本地 dev；T2 | `npm run build` | 通过 | exit 0 |
| 2026-06-29 | 本地 dev；T2 | `ChannelModelSection.tsx` 行数 | 通过 | 193 行 ≤300 |
| 2026-06-29 | 本地 dev；T2 | `ChannelPanel.tsx` 行数 | 记录 | 655 行存量超限未扩大 |
| 2026-06-29 | 本地 dev；kb-test | T1 静态契约（类型分支/守卫/optgroup） | 通过 | 代码路径对齐 |
| 2026-06-29 | — | S1 Cursor CLI/SDK 模型配置 | 待用户验收 | E2E |
| 2026-06-29 | — | S2 CC Profile 只读说明 | 待用户验收 | E2E |
| 2026-06-29 | — | S3 类型切换联动 | 待用户验收 | E2E |
| 2026-06-29 | — | S4 资源下拉分组 | 待用户验收 | E2E |
| 2026-06-29 | — | S5 已保存 CC 通道重开 | 待用户验收 | E2E |
| 2026-06-29 | — | S6 非通道编辑回归 | 待用户验收 | smoke |
