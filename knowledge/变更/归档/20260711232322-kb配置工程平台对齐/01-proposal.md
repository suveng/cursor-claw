# kb配置工程平台对齐轻量变更说明

> **变更 ID**：`20260711232322-kb配置工程平台对齐`
> **来源**：kb-lite
> **类型**：Bug
> **优先级**：P3
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无
> **lite 类型**：记录型 lite（配置对齐，不改知识正文）

---

## 背景

`kb.project.json` 的 `engineeringPlatforms` 当前为空数组 `[]`，而 `knowledge/工程平台/README.md` 已列出两个分区入口：Daemon守护进程、Electron桌面应用。配置与知识侧分区不一致，KB 工具链无法从项目配置解析工程平台根路径。

## 变更说明

在 `kb.project.json` 填充 `engineeringPlatforms`，条目字段结构**镜像**现有 `codeRoots`（仅 `name` / `path` / `kind`，禁止编造 schema 外字段）。

### 目标分区（与知识侧名称一致）

| name | 知识路径 | 代码依据（供 path/kind 选型） |
|------|----------|-------------------------------|
| Daemon守护进程 | `knowledge/工程平台/Daemon守护进程/` | `src/daemon-entry.ts` → `src/daemon/daemon.ts`（见分区 `00-README.md` 源码入口） |
| Electron桌面应用 | `knowledge/工程平台/Electron桌面应用/` | `electron/` 主进程与 `src/` 渲染层（见分区 `00-README.md` 职责边界） |

`path` 取值：`knowledge/工程平台/<分区>/` 或对应代码根（`src/daemon/`、`electron/` 等），实现时以分区 `00-README.md` 与 `codeRoots` 惯例为准；`kind` 与 `codeRoots` 同类语义（如 `server` / `client`）。

### 明确不在范围

- 不改 `knowledge/工程平台/` 正文与 `README.md` 分区入口
- 不修改 `codeRoots`、proto、业务代码
- 不写 `02-design.md`、`03-tasks.md`

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 填充两分区配置，验收可逐条核对 |
| 修改范围 | 单文件 `kb.project.json` |
| 接口契约 | 不变（+0） |
| 数据/权限 | 不变（+0） |
| 跨端联动 | 无（+0） |
| 知识库 | 不改知识正文（+0） |
| **总分** | **0**，可走 lite |

## 验收标准

1. `kb.project.json` 的 `engineeringPlatforms` **非空**，含 **2** 条条目。
2. 两条 `name` 分别为 **Daemon守护进程**、**Electron桌面应用**，与 `knowledge/工程平台/README.md` 分区入口名称一致。
3. 每条仅含 `name`、`path`、`kind` 三字段，结构与 `codeRoots` 条目一致。
4. 各条 `path` 指向有效目录（知识分区路径或已核实的代码根），可被仓库内路径核实。
5. JSON 合法，无 schema 外字段。

## 影响范围

| 范围 | 说明 |
|------|------|
| `kb.project.json` | `engineeringPlatforms` 由 `[]` 填充为两分区条目 |

**不在范围**：知识文件、业务代码、`codeRoots` 及其他配置节。

## 实现要点（供 kb-builder）

- 写盘前读取 `kb.project.json` 的 `codeRoots` 与 `knowledge/工程平台/README.md`、两分区 `00-README.md`。
- 禁止编造 `engineeringPlatforms` 未在 `codeRoots` 中出现的字段名。
- 完成后更新 manifest `tasks[0].status`、`files[]`。
