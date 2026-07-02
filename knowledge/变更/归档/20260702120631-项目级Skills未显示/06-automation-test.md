# 项目级 Skills 显示与管理 - 验收记录

> **变更 ID**：`20260702120631-项目级Skills未显示`
> **来源**：`/kb-test`（基于 `01-proposal.md`、`02-design.md`、`03-tasks.md`、`04-review.md`）
> **实现状态**：T1–T4 done；04-review 通过；本文产出后 `stage=tested`

## 1、测试策略与范围

| 维度 | 说明 |
|------|------|
| **层级** | **静态编译**（`npx tsc --noEmit`）+ **手工 Settings UI 冒烟**（Skills Tab 双区块）；无新增 `auto_test/` 脚本 |
| **目标** | 覆盖 `01-proposal` §五 1–8、`03-tasks` T1–T4、`02-design` §八·（二）E1–E6、`04-review` R1–R6 修复项 |
| **在范围** | 主进程 `skills-ipc.ts` scope 契约、Preload/env.d.ts 签名、Settings Skills 双区块 CRUD 与禁用态 |
| **不在范围** | Daemon/IM 通道、SDK 会话运行时 Skills 加载、`/api/skills` 协议；本变更仅 Settings 可见性与 IPC 管理 |
| **默认行为** | 静态项由 review + tsc 覆盖；手工 S1–S8 待用户在 Electron 应用内执行 |

## 2、局限与未自动化原因

| 未覆盖项 | 原因 |
|----------|------|
| **01 验收 1–8 运行时 UI 行为** | 无 E2E 框架；须启动 Electron 并操作 Settings Tab |
| **项目级 CRUD 落盘一致性** | 依赖真实文件系统与 `{workspaceDir}/.cursor/skills/` 可写权限 |
| **无主工作区禁用态** | 须切换/清空 `config.workspaceDir` 后观察琥珀色提示与按钮 `disabled` |
| **R1/R2 workspaceDir 时序** | 首进 Skills Tab、通用页变更工作区后刷新，须手工触发 |
| **SDK/Daemon Skills 生效** | 不在本变更范围；`settingSources` 与 Daemon 路径未改 |
| **单元/集成测试** | 仓库规范不写单测；由静态编译 + review + 手工冒烟覆盖 |

## 3、验收追溯表

| 来源 | 验收要点 | 验证方式 | 状态 |
|------|----------|----------|------|
| **01·1** / **T3** / **S3** | 项目级 skill 可见，名称/内容与磁盘一致 | 手工（§4.2 S3） | ⏳ 待手工 |
| **01·2** / **T2/T3** / **S2,S6** | 用户级列表行为与变更前一致 | 手工（§4.2 S2,S6） | ⏳ 待手工 |
| **01·3** / **T3** / **S4** | 双区块标题/布局可区分项目级与用户级 | 手工（§4.2 S4） | ⏳ 待手工 |
| **01·4** / **T1/T3** / **S5** | 有工作区时可新建/编辑/保存项目级 skill | 手工（§4.2 S5） | ⏳ 待手工 |
| **01·5** / **T1/T3** / **S5** | 可删除项目级 skill，列表与磁盘一致 | 手工（§4.2 S5） | ⏳ 待手工 |
| **01·6** / **T1/T3** / **S7** | 无主工作区时项目级操作禁用 + 明确提示 | 手工（§4.2 S7） | ⏳ 待手工 |
| **01·7** / **T3** / **S8** | 说明文案涵盖双来源及项目级绑定主工作区 | 手工（§4.2 S8） | ⏳ 待手工 |
| **01·8** / **T3/T4** | 与 Rules Tab 项目级/用户级心智一致 | 手工（§4.2 S4,S7） | ⏳ 待手工 |
| **T1** | `skills-ipc.ts` + `registerSkillsIpcHandlers`；project 路径与写守卫 | 静态（§4.1）+ review §5 | ✅ 静态通过 |
| **T2** | preload/env.d.ts 9 个 API 末位 `scope?` 签名一致 | 静态（§4.1 tsc） | ✅ 静态通过 |
| **T3** | 双区块 UI、expand key、CRUD 透传 scope、保存 hint 区分 | review §5 + 手工 S3–S8 | ✅ 静态；⏳ 手工 |
| **T4** | Settings 挂载 `SettingsSkillsPanel` 并清理残留 | 静态（§4.1）+ 手工 S1 | ✅ 静态；⏳ 手工 S1 |
| **E1** | `main.ts` ≤300 行（skills 迁出后 248 行） | 静态（§4.1） | ✅ 通过 |
| **E2** | `SettingsSkillsPanel.tsx` ≤300 行（289 行） | 静态（§4.1） | ✅ 通过 |
| **E3** | 全部 `skills:*` 经 `resolveSkillsDir` 单点解析 | review §5 | ✅ 静态通过 |
| **E4** | preload 与 env.d.ts Skills API 签名一致 | `npx tsc --noEmit` | ✅ 通过 |
| **E5** | project 无工作区 list/tree 返回 `[]` 不抛错 | review §5 | ✅ 静态通过 |
| **E6** | 同名 skill expand key 含 scope 互不干扰 | 手工（§4.2 S4,S6） | ⏳ 待手工 |
| **R1** SKILL-001 | 首进 Skills tab 加载 `workspaceDir` | review T-FIX + 手工 S1 | ✅ 修复；⏳ 手工 S1 |
| **R2** SKILL-002 | `workspaceDir` 变更刷新/清空项目列表 | review T-FIX + 手工 S7 | ✅ 修复；⏳ 手工 S7 |
| **R3** SKILL-003 | IPC 失败不误 `showSaveHint`，改 `showAlert` | review T-FIX + 手工 S5,S6 | ✅ 修复；⏳ 手工 |
| **R4** SKILL-004 | `assertSkillPath` 路径穿越防护 | review §5 | ✅ 静态通过 |
| **R5** IPC-01 | 无工作区 read-file 返回 `PROJECT_WRITE_NO_WORKSPACE` | review §5 | ✅ 静态通过 |
| **R6** UX-01 | 刷新按钮随 `disabled` 禁用 | review T-FIX + 手工 S7 | ✅ 修复；⏳ 手工 S7 |

## 4、场景摘要

### 4.1 静态检查

| 检查项 | 操作 | 期望 |
|--------|------|------|
| TypeScript 编译 | 项目根 `npx tsc --noEmit` | exit 0，无类型错误 |
| 主进程行数 | `electron/main.ts` | ≤300 行（现 248 行） |
| IPC 模块行数 | `electron/skills-ipc.ts` | ≤300 行（现 244 行） |
| 面板行数 | `SettingsSkillsPanel.tsx` | ≤300 行（现 289 行） |
| scope 契约 | `skills-ipc.ts` 9 channel 末位 `scope?` | `resolveSkillsDir` 单点；project 无工作区读空、写报错 |
| Preload/类型 | `preload.ts` 与 `env.d.ts` | Skills API 签名逐字一致 |
| 挂载点 | `Settings.tsx` Skills Tab | `<SettingsSkillsPanel workspaceDir={workspaceDir} />` |
| Review 修复 | R1–R6 | 04-review §3 均已 fixed |

### 4.2 手工冒烟清单（S1–S8）

**前置**：Electron 应用已启动；可选配置主工作区 `{workspaceDir}`；测试数据使用本地 `.cursor/skills/`，勿提交敏感内容。

| 场景 ID | 步骤 | 期望 | 失败判责 |
|---------|------|------|----------|
| **S1** 打开 Skills Tab | Settings → Skills | 正确挂载双区块面板；首进时项目级区块未误禁用（R1） | 空白/误禁用 → Settings/Panel |
| **S2** 用户级列表 | 下区块查看 `~/.cursor/skills` 已有 skill | 列表与磁盘一致；行为与变更前一致 | 列表空/错 → IPC user scope |
| **S3** 项目级列表 | 上区块；`{ws}/.cursor/skills/` 至少 1 个 skill | 名称/内容与磁盘一致 | 不可见 → IPC project scope 或 workspaceDir |
| **S4** 来源区分 | 同时存在 user/project skill | 双区块标题/布局可一眼区分；同名 expand 互不干扰（E6） | 混淆 → UI 布局 |
| **S5** 项目级 CRUD | 新建/编辑/保存/删除项目级 skill | 落盘 `{ws}/.cursor/skills/`；失败时 alert 非误 hint（R3） | 落盘错 → IPC；hint 误报 → Panel |
| **S6** 用户级 CRUD | 下区块新建/编辑/删除 | 落盘 `~/.cursor/skills`；绿色 hint 指向用户目录 | 同 S5 |
| **S7** 无主工作区 | 清空主工作区或首启未配置 | 项目级操作 disabled + 琥珀色提示；刷新按钮同步 disabled（R2,R6） | 可操作/无提示 → Panel |
| **S8** 作用域文案 | 阅读项目区/用户区说明 | 双来源 + 项目级绑定主工作区；不对 Skills 整体称「仅用户级」 | 文案缺失 → Panel 文案 |

## 5、脚本位置与环境

| 项 | 说明 |
|----|------|
| **auto_test/** | 无新增（本变更以静态检查 + 手工冒烟为主） |
| **定向命令** | 项目根 `npx tsc --noEmit` |
| **运行依赖** | Electron 桌面应用；`config.workspaceDir` 可配置 |
| **测试数据** | `{workspaceDir}/.cursor/skills/` 与 `~/.cursor/skills/` 下 skill 目录 |

## 6、输出与记录规范

禁止粘贴完整终端日志；执行记录仅用 §7 表格一行摘要（日期、环境、命令/场景、结果、备注）。

## 7、执行记录

| 日期 | 环境 | 命令/场景 | 结果 | 备注 |
|------|------|-----------|------|------|
| 2026-07-02 | 本地 | `npx tsc --noEmit` | 通过 | 待手工 S1–S8 |
