# 修复打包版启动黑屏 — 轻量变更说明

> **变更 ID**：`20260702141701-修复打包版启动黑屏`
> **来源**：kb-lite
> **lite 类型**：hotfix-lite
> **类型**：Bug
> **优先级**：P1
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

打包版（`app.isPackaged === true`）启动 Cursor Claw 时窗口黑屏，无 UI。窗口为 `frame: false` 无边框；renderer 加载失败时 body 默认黑底，React 未挂载，表现为整窗黑屏。

控制台可见：

`ERR_FILE_NOT_FOUND file:///.../app.asar/renderer/index.html`

## 根因

- **落点**：`electron/app/main-window.ts`
  - `getRendererHtmlPath()`（约第 32–34 行）：`path.join(__dirname, "../../renderer/index.html")`
  - `webPreferences.preload`（约第 122 行）：`path.join(__dirname, "../../preload/index.js")`
- **现状**：打包后主进程运行于 `out/main`（asar 内 `__dirname` 指向 `app.asar/out/main`）。`../../renderer` 解析为 `app.asar/renderer/`（不存在）；`../../preload` 同理指向 `app.asar/preload/`（不存在）。
- **正确路径**：`out/renderer/index.html` 与 `out/preload/index.js` 与 `out/main` 同级，应从 `__dirname` 出发使用 `../renderer/index.html` 与 `../preload/index.js`。
- **dev 分支**：`shouldLoadDevUrl()` 已限制仅非打包且存在 `ELECTRON_RENDERER_URL` 时走 `loadURL`，dev 逻辑本身不受本次路径修正影响。

## 变更说明

### LITE-01：修正打包版 renderer / preload 相对路径

| 项 | 要点 |
|----|------|
| **renderer** | `getRendererHtmlPath()` 改为 `../renderer/index.html` |
| **preload** | `webPreferences.preload` 改为 `../preload/index.js` |
| **AGENTS.md** | `electron/AGENTS.md` 补充打包后 `out/main` 与 `out/renderer`、`out/preload` 同级路径约定 |
| **版本** | patch bump `1.10.2` → `1.10.3`，新增 `changelog/1.10.3.json` |

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、根因、落点已明确 |
| 修改范围 | 单文件主改动 + AGENTS + changelog |
| 接口契约 | 无 proto/HTTP/IPC 契约变更 |
| 数据/权限 | 不变 |
| 跨端联动 | 仅 Electron 主进程路径 |
| 知识库 | 记录型，工程平台正文无需联动 |
| **总分** | **≤2**，hotfix-lite 一轮直通 |

## 验收标准

1. **打包版启动**：本地或 CI 构建安装包后启动，窗口**正常显示 UI**（非黑屏），`loadFile` 解析到存在的 `renderer/index.html`，控制台无 `ERR_FILE_NOT_FOUND` 指向 `app.asar/renderer/`。
2. **preload 可用**：打包版 renderer 与主进程 IPC/preload 桥接正常（设置页、窗口控制等基本交互可用）。
3. **dev 不受影响**：`electron-vite dev` 下仍走 `ELECTRON_RENDERER_URL` + `loadURL`；残留环境变量逻辑与 `shouldLoadDevUrl()` 行为不退化。
4. **回归**：TypeScript 编译通过；单实例 dev / 打包版基本导航不退化。

## 影响范围

| 范围 | 说明 |
|------|------|
| `electron/app/main-window.ts` | **主改动**：renderer / preload 路径 |
| `electron/AGENTS.md` | 一句：打包产物目录相对路径约定 |
| `package.json` | version `1.10.3` |
| `changelog/1.10.3.json` | 用户可见修复说明 |

**不在范围**：renderer 业务逻辑、Daemon、IM 通道、Vite 配置。

## 待 builder 事项

- 实现 LITE-01 后更新 manifest：`tasks[0].status = done`，`files[]` 中 code/config 条目 `status` 改为 `changed`。
- hotfix-lite 可与实现同轮补写 `05-summary.md` 并归档。
- integrations 未启用，无需 external sync。
