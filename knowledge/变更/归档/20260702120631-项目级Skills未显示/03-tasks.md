# 项目级 Skills 显示与管理 - 任务分解

> **来源**：`/kb-plan`（基于 `01-proposal.md`、`02-design.md`）

## 1、执行计划

### 1.1 依赖图

```
T1 ──┐
     ├──→ T3 ──→ T4
T2 ──┘
```

### 1.2 分组调度

| 轮次 | 任务 | 说明 |
|------|------|------|
| 第一轮（并行） | T1、T2 | 主进程 IPC 模块与 Preload/类型契约可并行，契约以本文各任务「接口契约」为准 |
| 第二轮 | T3 | 依赖 T1+T2 完成后实现双区块 UI 面板 |
| 第三轮 | T4 | 依赖 T3 完成后挂载面板并清理 Settings |

## 2、任务清单

## T1: 主进程 Skills IPC 模块与 main 接线

### 背景

现网 `electron/main.ts` L180-281 全部 `skills:*` handler 硬编码 `path.join(os.homedir(), ".cursor", "skills")`，仅支持用户级。本任务将 skills IPC 迁至独立模块，增加 `scope: SkillScope` 末位可选参数，`project` 时解析 `{workspaceDir}/.cursor/skills/`，写操作在无主工作区时返回明确错误。同时缩减 `main.ts` 行数以满足 ≤300 行规范。

### 上下文文件

| 文件 | 关注点 |
|------|--------|
| `electron/main.ts` L146-178 | `rules:*` 工作区校验与路径模板（对齐错误契约） |
| `electron/main.ts` L180-281 | 待迁移的现网 `skills:*` 与 `buildTree` 逻辑 |
| `electron/config-store.ts` | `getConfig().workspaceDir` 读取主工作区 |
| `electron/AGENTS.md` | 主进程模块边界与行数规范 |

### 实现范围

1. **新建** `electron/skills-ipc.ts`，导出：
   - `type SkillScope = "user" | "project"`
   - `interface SkillTreeNode { name: string; type: "file" \| "directory"; children?: SkillTreeNode[] }`
   - `resolveSkillsDir(scope: SkillScope): string` — `user` → `~/.cursor/skills`；`project` → `path.join(workspaceDir, ".cursor", "skills")`
   - `buildSkillTree(dirPath: string): SkillTreeNode[]` — 自 `main.ts` 迁入目录树构建
   - `registerSkillsIpcHandlers(): void` — 注册全部 `skills:*` handler
2. **迁移并扩展** 9 个 channel（`list`/`tree`/`read-file`/`save-file`/`create-dir`/`delete-file`/`save`/`rename`/`delete`），各 handler **末位**加 `scope?: SkillScope`，省略时默认 `"user"`。
3. **project 路径**：`getConfig().workspaceDir` + `/.cursor/skills/`。
4. **写操作**（`save`/`save-file`/`create-dir`/`delete*`/`rename`）当 `scope === "project"` 且 `!workspaceDir.trim()`：返回 `{ ok: false, error: "未配置主工作区，无法保存技能。请先在「通用」中设置主工作区。" }`。
5. **读操作**（`list`/`tree`）当 `scope === "project"` 且无工作区：返回 `[]`，不抛错。
6. **`skills:save` 成功**：`user` 保持 `skillsDir: ~/.cursor/skills`；`project` 返回 `skillsDir: {workspaceDir}/.cursor/skills`。
7. **`main.ts`**：删除 L180-281 内联 skills 块；在 `registerIpcHandlers` 内调用 `registerSkillsIpcHandlers()`。

### 接口契约

```typescript
type SkillScope = "user" | "project"

// 各 channel 末位 scope 可选，默认 "user"
skills:list       (_, scope?) → { name: string; content: string }[]
skills:tree       (_, scope?) → SkillTreeNode[]
skills:read-file  (_, skillName, relativePath, scope?) → { ok, content?, error? }
skills:save-file  (_, skillName, relativePath, content, scope?) → { ok, error? }
skills:create-dir (_, skillName, relativePath, scope?) → { ok, error? }
skills:delete-file(_, skillName, relativePath, scope?) → { ok, error? }
skills:save       (_, name, content, scope?) → { ok, skillsDir?, error? }
skills:rename     (_, oldName, newName, scope?) → { ok, error? }
skills:delete     (_, name, scope?) → { ok, error? }
```

| 场景 | 返回 |
|------|------|
| project 写操作、无工作区 | `{ ok: false, error: "未配置主工作区，无法保存技能。请先在「通用」中设置主工作区。" }` |
| project 读操作、无工作区 | `[]`（list/tree） |
| 文件不存在（读/删） | `{ ok: false, error: "文件不存在" }` |
| 重命名目标已存在 | `{ ok: false, error: "目标目录已存在" }` |
| 重命名源不存在 | `{ ok: false, error: "原目录不存在" }` |

### 验收标准（含 Ponytail 项；映射 01 §五 与 02 E1-E6）

| 映射 | 验收项 |
|------|--------|
| 01-4 | 主工作区已配置时，`skills:save(..., "project")` 写入 `{workspaceDir}/.cursor/skills/` 并返回正确 `skillsDir` |
| 01-5 | `skills:delete(..., "project")` 删除项目级 skill 后磁盘目录消失 |
| 01-6 | 无工作区时 project 写操作返回上述错误文案，不抛未捕获异常 |
| E1 | `electron/main.ts` 行数 ≤300（skills 逻辑迁出后） |
| E3 | 所有 `skills:*` handler 经 `resolveSkillsDir` 单点解析，无散落 `homedir` 硬编码 |
| E5 | 未配置主工作区时 `skills:list("project")`/`skills:tree("project")` 返回 `[]`，不抛错 |
| Ponytail | 仅新增 `SkillScope` 联合类型与 `resolveSkillsDir` 纯函数；无新 npm 依赖、无 trait 抽象；`skills-ipc.ts` 单文件 ≤300 行 |

### 依赖

无（第一轮并行）。

---

## T2: Preload 与 env.d.ts scope 扩展

### 背景

渲染层通过 `window.electronAPI` 调用 Skills API。现网 `preload.ts` 与 `env.d.ts` 无 `scope` 参数，无法区分用户级与项目级。本任务扩展全部 Skills API 签名，末位加可选 `scope?: SkillScope` 并透传至 IPC；省略 scope 时行为与现网完全一致（向后兼容）。

### 上下文文件

| 文件 | 关注点 |
|------|--------|
| `electron/preload.ts` L290-298 | 现网 `getSkills`/`getSkillTree`/… 定义 |
| `src/renderer/env.d.ts` | `ElectronAPI` 接口声明 |
| 本文 T1「接口契约」 | IPC channel 与 scope 语义（契约 SSOT） |

### 实现范围

1. **`electron/preload.ts` L290-298 区域**：全部 Skills API 末位加 `scope?: SkillScope`，`ipcRenderer.invoke` 透传 scope。
2. **`src/renderer/env.d.ts`**：
   - 导出/声明 `type SkillScope = "user" | "project"`
   - 同步以下签名（与 §4.2 一致）：
     - `getSkills(scope?)`
     - `getSkillTree(scope?)`
     - `readSkillFile(skillName, relativePath, scope?)`
     - `saveSkillFile(skillName, relativePath, content, scope?)`
     - `createSkillDir(skillName, relativePath, scope?)`
     - `deleteSkillFile(skillName, relativePath, scope?)`
     - `saveSkill(name, content, scope?)`
     - `renameSkill(oldName, newName, scope?)`
     - `deleteSkill(name, scope?)`
3. 省略 `scope` 时不传末位参数或传 `undefined`，主进程默认 `"user"`，行为不变。

### 接口契约

```typescript
type SkillScope = "user" | "project"

getSkills: (scope?: SkillScope) => Promise<{ name: string; content: string }[]>
getSkillTree: (scope?: SkillScope) => Promise<SkillTreeNode[]>
readSkillFile: (skillName: string, relativePath: string, scope?: SkillScope) => Promise<{ ok: boolean; content?: string; error?: string }>
saveSkillFile: (skillName: string, relativePath: string, content: string, scope?: SkillScope) => Promise<{ ok: boolean; error?: string }>
createSkillDir: (skillName: string, relativePath: string, scope?: SkillScope) => Promise<{ ok: boolean; error?: string }>
deleteSkillFile: (skillName: string, relativePath: string, scope?: SkillScope) => Promise<{ ok: boolean; error?: string }>
saveSkill: (name: string, content: string, scope?: SkillScope) => Promise<{ ok: boolean; skillsDir?: string; error?: string }>
renameSkill: (oldName: string, newName: string, scope?: SkillScope) => Promise<{ ok: boolean; error?: string }>
deleteSkill: (name: string, scope?: SkillScope) => Promise<{ ok: boolean; error?: string }>
```

`preload.ts` 与 `env.d.ts` 中 `SkillScope` 及上述 9 个方法签名须逐字一致。

### 验收标准（含 Ponytail 项；映射 01 §五 与 02 E1-E6）

| 映射 | 验收项 |
|------|--------|
| 01-2 | 不传 scope 调用 `getSkills()` 行为与变更前一致（用户级列表） |
| E4 | `preload.ts` 与 `env.d.ts` 中 Skills API 签名完全一致；TypeScript 编译无类型错误 |
| Ponytail | 仅扩展末位可选参数，不新增桥接层或包装类 |

### 依赖

无（第一轮并行；契约以本文为准，不阻塞于 T1 落盘，但集成测试需 T1 完成）。

---

## T3: SettingsSkillsPanel 双区块 UI

### 背景

`Settings.tsx` Skills Tab 约 370 行，仅展示用户级 Skills。本任务拆出独立面板组件，上区块展示项目级、下区块展示用户级，交互对齐 Rules Tab 的 info box 与 MCP 的 scope 分区模式；所有 CRUD 透传对应 `scope`；expand 状态 key 含 scope 前缀防止同名冲突。

### 上下文文件

| 文件 | 关注点 |
|------|--------|
| `src/renderer/pages/Settings.tsx` L112-119 | skills state |
| `src/renderer/pages/Settings.tsx` L400-453 | skills handlers |
| `src/renderer/pages/Settings.tsx` L605-642 | Rules info box + 禁用态模板（L608-620） |
| `src/renderer/pages/Settings.tsx` L686-771 | Skills Tab JSX |
| `src/renderer/pages/Settings.tsx` L963-1041 | Skills 编辑/新建弹窗 |
| `src/renderer/components/SettingsMcpPanel.tsx` | scope 分区 UI 参考模式 |
| `src/renderer/env.d.ts` | T2 扩展后的 API 签名 |

### 实现范围

1. **新建** `src/renderer/components/SettingsSkillsPanel.tsx`（≤300 行；超限可拆同目录 `SkillEditModals.tsx`）。
2. **Props**：`{ workspaceDir: string }`，由父组件传入。
3. **自 `Settings.tsx` 迁入**：
   - skills 相关 state（原 L112-119）
   - handlers（原 L400-453）
   - Tab 主体 JSX（原 L686-771）
   - 弹窗（原 L963-1041）
4. **上区块 — 项目级**：
   - 标题/说明对齐 Rules info box（琥珀色提示框结构，L608-620）
   - `getSkills("project")` / `getSkillTree("project")` 加载
   - `disabled={!workspaceDir.trim()}` 禁用新建/编辑/删除等操作
   - 无工作区时展示配置指引文案
5. **下区块 — 用户级**：
   - 保留现网交互与文案（`~/.cursor/skills`、`settingSources` 说明）
   - 默认 `scope="user"` 或不传 scope
6. **CRUD**：所有 IPC 调用传对应 scope（`"project"` 或 `"user"`）。
7. **expand key**：`${scope}/${skillName}` 或 `${scope}/${skillName}/${relativePath}`。
8. **保存成功 hint**：按 scope 区分路径 — 用户级绿色 hint 指向 `~/.cursor/skills`；项目级指向 `{workspaceDir}/.cursor/skills`。
9. **作用域说明文案（S8）**：项目区说明绑定主工作区；用户区说明全局可用；不再将 Skills 整体描述为「仅用户级」。
10. 面板自行管理 `tab === "skills"` 时的 refresh 逻辑（`useEffect` 进入时双区块分别 refresh）。

### 接口契约

```typescript
// 组件入口
interface SettingsSkillsPanelProps {
  workspaceDir: string
}

// 内部 expand 状态 key 约定
type ExpandKey = `${SkillScope}/${string}` | `${SkillScope}/${string}/${string}`

// IPC 调用约定（经 T2 API）
getSkills("project" | "user")
getSkillTree("project" | "user")
saveSkill(name, content, scope)
// …其余 CRUD 均末位传 scope
```

### 验收标准（含 Ponytail 项；映射 01 §五 与 02 E1-E6）

| 映射 | 验收项 |
|------|--------|
| 01-1 | 主工作区 `.cursor/skills/` 有 skill 时，上区块列表名称/内容与磁盘一致 |
| 01-2 | 下区块用户级列表行为与变更前一致 |
| 01-3 | 双区块标题/布局使用户能一眼区分项目级与用户级 |
| 01-4 | 有工作区时可新建/编辑/保存项目级 skill，刷新后内容已更新 |
| 01-5 | 可删除项目级 skill，列表与磁盘一致 |
| 01-6 | 无 `workspaceDir` 时项目级操作禁用 + 琥珀色提示 |
| 01-7 | 说明文案涵盖双来源及项目级绑定主工作区 |
| 01-8 | 与 Rules Tab 对项目级/用户级的心智与操作预期一致 |
| E2 | `SettingsSkillsPanel.tsx`（+ 若有 `SkillEditModals.tsx`）主面板文件 ≤300 行 |
| E6 | user/project 同名 skill 同时存在时，展开/编辑互不干扰（expand key 含 scope） |
| Ponytail | 复用现网树渲染与 CRUD 逻辑迁入，不新建配置中心服务 |

### 依赖

- T1（project 路径 IPC 与错误契约）
- T2（带 scope 的 preload API）

---

## T4: Settings.tsx 挂载面板并清理

### 背景

T3 完成双区块面板后，本任务将 `Settings.tsx` Skills Tab 替换为 `<SettingsSkillsPanel />`，删除已迁出的 state/handlers/弹窗/Tab JSX，并移除父级 `useEffect` 中对 skills 的 refresh 调用，显著降低 Settings 文件行数。

### 上下文文件

| 文件 | 关注点 |
|------|--------|
| `src/renderer/pages/Settings.tsx` | 全文；定位 skills 相关残留 |
| `src/renderer/components/SettingsSkillsPanel.tsx` | T3 产出，挂载目标 |
| `src/renderer/pages/Settings.tsx` Rules/MCP Tab | 同级面板挂载模式（`workspaceDir` 传参） |

### 实现范围

1. `import SettingsSkillsPanel from "../components/SettingsSkillsPanel"`（路径按实际调整）。
2. Skills Tab 内容替换为：`<SettingsSkillsPanel workspaceDir={workspaceDir} />`。
3. **删除**已迁出内容：
   - skills 相关 state（原 L112-119）
   - skills handlers（原 L400-453）
   - Skills Tab JSX（原 L686-771）
   - Skills 弹窗（原 L963-1041）
4. **移除** `useEffect` 中 `tab === "skills"` 分支的 `refreshSkills` 调用（由面板自管）。
5. 确认无未使用的 skills 相关 import/type。

### 接口契约

```tsx
// Settings.tsx Skills Tab 唯一挂载点
{tab === "skills" && (
  <SettingsSkillsPanel workspaceDir={workspaceDir} />
)}
```

`workspaceDir` 来源与 Rules/MCP Tab 一致（来自 Settings 已有 state/props）。

### 验收标准（含 Ponytail 项；映射 01 §五 与 02 E1-E6）

| 映射 | 验收项 |
|------|--------|
| 01-1～8 | 经 Settings 入口打开 Skills Tab，全部验收项仍通过（回归） |
| S1 | Skills Tab 正确挂载 `SettingsSkillsPanel` |
| S6 | 用户级 CRUD 逻辑未在 Settings 父组件残留重复实现 |
| E1 | `Settings.tsx` 行数显著下降；配合 T1 后 `main.ts` ≤300 |
| Ponytail | 仅做挂载与清理，不新增 Settings 内 skills 逻辑 |

### 依赖

- T3（`SettingsSkillsPanel` 组件就绪）
