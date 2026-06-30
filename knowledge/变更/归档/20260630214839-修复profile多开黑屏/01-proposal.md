# 修复 profile 多开黑屏轻量变更说明

> **变更 ID**：`20260630214839-修复profile多开黑屏`
> **来源**：kb-lite
> **lite 类型**：记录型
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

Cursor Claw 支持通过 `--profile=<名称>` 多开实例，各 profile 使用独立 `userData` 目录。当前存在两类黑屏场景：

1. **打包版第二实例黑屏**：在终端残留 `ELECTRON_RENDERER_URL`（常见于刚跑过 `electron-vite dev` 的 shell）时，用 `open -n` 再开一窗，窗口为黑屏、无 UI。
2. **dev 多 profile 争用端口**：多个 `electron-vite dev` 默认争用 5173，后启动实例 renderer 加载异常。

窗口为 `frame: false` 无边框；renderer 加载失败时 body 默认黑底，React 未挂载，表现为整窗黑屏。

## 根因（CodeGraph 复核）

### 主因：打包版误走 dev URL

- **落点**：`electron/main.ts`，`createWindow` 内 renderer 加载分支（约 134–138 行）。
- **现状**：仅判断 `process.env.ELECTRON_RENDERER_URL` 是否存在，存在则 `loadURL`；**未**结合 `app.isPackaged` 限制。
- **触发链**：打包版从带 dev 环境变量的终端启动 → 第二实例继承 `ELECTRON_RENDERER_URL` → 连接已退出或未监听的 Vite dev server → `did-fail-load` → 黑屏。
- **预期**：`app.isPackaged === true` 时应始终 `loadFile` 本地 `renderer/index.html`，忽略残留 dev 环境变量。

### 次因：dev 多开端口冲突

- **落点**：`electron.vite.config.ts`、`package.json`（dev 脚本 / 端口配置）。
- **现状**：多实例 dev 可能共用默认 5173，后启动实例 renderer 与主进程端口不一致或争用失败。
- **预期**：按 `--profile=` 计算稳定端口偏移（如 hash/序号 + base port），使不同 profile 的 dev 实例可同时运行。

## 变更说明

### LITE-01：打包版 renderer 加载路径修复与 dev profile 端口分配

| 项 | 要点 |
|----|------|
| **主进程加载** | `app.isPackaged` 为 true 时强制 `loadFile`；仅 dev 且存在 `ELECTRON_RENDERER_URL` 时 `loadURL`。可留在 `electron/main.ts` 或抽至 `electron/main-window.ts`（若主文件超行数约束）。 |
| **dev 端口** | `electron.vite.config.ts` 读取 `--profile=`，为 renderer dev server 分配稳定偏移端口；必要时同步 `package.json` dev 脚本或文档化启动方式。 |
| **知识同步（各一句）** | `02-主进程与IPC.md`：补充打包版 renderer 加载策略（packaged 走 `loadFile`）。`05-构建与打包.md`：补充 dev 多 profile 端口分配说明。 |

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、根因、落点已由 CodeGraph 复核 |
| 修改范围 | 主进程加载分支 + vite 端口配置 + 少量工程平台知识（+0） |
| 接口契约 | 无 proto/HTTP/IPC 契约变更（+0） |
| 数据/权限 | 不变（+0） |
| 跨端联动 | Electron 主进程与 dev 构建配置（+0） |
| 知识库 | 工程平台两处各一句，非多域联动（+1） |
| **总分** | **≤2**，可走 lite |

## 验收标准

1. **打包版多开**：已安装打包版前提下，执行  
   `open -n -a "Cursor Claw" --args --profile=<另一 profile>`  
   第二窗口**正常显示 UI**（非黑屏），可完成基本导航。
2. **dev 多 profile**：两个不同 `--profile=` 的 `electron-vite dev` 实例**同时运行**，各自窗口 UI 正常，无端口争用导致的加载失败。
3. **残留环境变量**：终端仍 export `ELECTRON_RENDERER_URL` 时，启动**打包版**实例仍走 `loadFile`，不连接 dev server。
4. **回归**：单实例 dev / 单实例打包版启动与 renderer 热更新行为不退化；TypeScript 编译通过。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/main.ts`（或 `electron/main-window.ts`） | **主改动**：packaged 与 dev 的 renderer 加载分支 |
| `electron.vite.config.ts` | **主改动**：按 profile 分配 dev server 端口 |
| `package.json` | 视实现调整 dev 脚本或端口相关配置 |
| `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` | 一句：packaged renderer 加载策略 |
| `knowledge/工程平台/Electron桌面应用/05-构建与打包.md` | dev 多 profile 端口说明 |

**不在范围**：renderer 业务逻辑、Daemon、IM 通道、changelog（archive 阶段再定是否 patch bump）。

## 待 builder 事项

- 实现 LITE-01 后更新 manifest：`tasks[0].status = done`，`files[]` 写入实际变更路径与 `status: changed`（若新建 `main-window.ts` 则替换 planned 中的 `main.ts`）。
- 完成后由 kb-scribe 补写 `05-summary.md`（本轮不写）。
- integrations 未启用，无需 external sync。
