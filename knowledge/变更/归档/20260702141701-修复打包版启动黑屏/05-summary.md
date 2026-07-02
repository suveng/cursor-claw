# 修复打包版启动黑屏 — 变更总结

> **变更 ID**：`20260702141701-修复打包版启动黑屏`
> **来源**：kb-lite / kb-builder
> **lite 类型**：hotfix-lite
> **阶段**：`applied`（归档由 kb-release 执行）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/app/main-window.ts` | `getRendererHtmlPath()`：`../../renderer/index.html` → `../renderer/index.html`；`webPreferences.preload`：`../../preload/index.js` → `../preload/index.js`；附中文注释说明打包后 `__dirname` 为 `out/main` |
| `electron/AGENTS.md` | 补充「打包路径约定」：`out/main` 与 `out/renderer`、`out/preload` 同级，相对路径 `../renderer`、`../preload`，禁止 `../../` |
| `electron/app/AGENTS.md` | `main-window.ts` 模块边界同步上述路径约定 |
| `package.json` | version `1.10.2` → `1.10.3` |
| `changelog/1.10.3.json` | 用户可见：修复打包版启动后窗口黑屏、页面无法加载 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

## 2、与设计的差异

无。lite 无 `02-design.md`；实现与 `01-proposal.md` LITE-01 一致。

## 3、影响范围

| 范围 | 说明 |
|------|------|
| **Electron 主进程窗口加载** | `electron/app/main-window.ts`：打包版 `loadFile` 与 preload 路径修正，解析至 asar 内 `out/renderer`、`out/preload` |
| **dev 行为** | `shouldLoadDevUrl()` 逻辑未改；非打包且存在 `ELECTRON_RENDERER_URL` 时仍走 `loadURL` |
| **用户可见** | **是** — 打包版启动不再黑屏，`ERR_FILE_NOT_FOUND` 指向 `app.asar/renderer/` 的问题消除 |
| **不涉及** | renderer 业务逻辑、Daemon、IM 通道、Vite 配置、IPC 契约 |

### 3.1 Ponytail 技术债

无。

## 4、知识库影响清单

**记录型 lite** — `electron/AGENTS.md` 与 `electron/app/AGENTS.md` 已同步路径约定，**无需更新业务域知识**。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/**` | 不需要 | 纯 Electron 打包路径修复，无业务语义变更 |
| `knowledge/工程平台/**` | 不需要 | 约定已写入 `electron/AGENTS.md`，非跨域能力文档 |
| `knowledge/知识索引.md` | 不需要 | 总入口未变化 |

## 5、验证结果

| 项 | 结果 |
|----|------|
| 路径 node 校验 | OK — `../renderer`、`../preload` 自 `out/main` 解析正确 |
| `npx electron-vite build` | exit 0 |
| 打包版 UI 启动 | **待 kb-release 安装包验收**（01 验收项 1–2：窗口正常显示、preload/IPC 可用） |
| dev 回归 | **待人工确认** `electron-vite dev` 仍走 `ELECTRON_RENDERER_URL`（01 验收项 3） |

## 6、遗留风险

- 无已知代码层风险；若 asar 目录结构与 `out/main` 假设不一致需再排查 electron-vite 产物布局。
