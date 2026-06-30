# 修复 profile 多开黑屏 - 变更总结

> **变更 ID**：`20260630214839-修复profile多开黑屏`
> **来源**：kb-builder hotfix
> **阶段**：`applied`（归档前文档更新；`stage=archived` 与目录迁移由 kb-release 完成）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `electron/main-window.ts` | **新增**：`createWindow`、renderer 加载（仅 `!isPackaged && ELECTRON_RENDERER_URL` 时 `loadURL`；打包始终 `loadFile`）、dev `did-fail-load` fallback、`backgroundColor: #030712` |
| `electron/main.ts` | 移除窗口创建逻辑，改 import `main-window` |
| `electron.vite.config.ts` | 解析 `--profile=`，`port: 5173 + profilePortOffset(name)`（0–49 稳定 hash），`strictPort: true` |
| `package.json` | 新增 `"dev:multi": "electron-vite dev --"`（**version `1.9.0` → `1.9.1` bump 待 kb-release**） |
| `electron/AGENTS.md` | 补充 `main-window.ts` 模块边界 |

| 文件 | 状态 |
|------|------|
| `changelog/1.9.1.json` | **待 kb-release 落盘**（用户可见：修复打包版多开黑屏、dev 多 profile 端口隔离） |
| `package.json` `version` | **待 kb-release bump 至 `1.9.1`** |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

## 2、与设计的差异

无。lite 无 `02-design.md`；实现与 `01-proposal.md` LITE-01 一致（主进程加载分支抽至 `main-window.ts`、按 profile 分配 dev 端口）。

## 3、影响范围

| 范围 | 说明 |
|------|------|
| **Electron 主进程窗口加载** | `electron/main-window.ts`：打包版忽略 shell 残留 `ELECTRON_RENDERER_URL`，强制 `loadFile` 本地 `renderer/index.html`；dev 失败时 fallback |
| **dev 多 profile 端口** | `electron.vite.config.ts` + `package.json` `dev:multi`：不同 `--profile=` 使用稳定偏移端口，避免争用默认 5173 |
| **用户可见** | **是** — 打包版 `open -n` 多开不再黑屏；dev 多实例可同时运行 |
| **不涉及** | renderer 业务逻辑、Daemon、IM 通道、IPC 契约 |

### 3.1 Ponytail 技术债

无（本次变更 diff 无 `ponytail:` 注释）。

| 位置 | 说明 | 升级路径 |
|------|------|----------|
| `electron/main.ts`（345 行） | 仓库 AGENTS 单文件 ≤300 行约束；窗口逻辑已抽至 `main-window.ts`，`main.ts` 仍超限 | 后续继续拆分主进程模块（**已知债务，不阻断归档**） |

## 4、知识库影响清单

- [ ] `knowledge/工程平台/Electron桌面应用/02-主进程与IPC.md` — 打包版 renderer 加载策略：`app.isPackaged === true` 时始终 `loadFile`，忽略 shell 残留 `ELECTRON_RENDERER_URL`；仅 dev 且存在 `ELECTRON_RENDERER_URL` 时 `loadURL`（逻辑在 `electron/main-window.ts`）（**待 kb-librarian**）
- [ ] `knowledge/工程平台/Electron桌面应用/05-构建与打包.md` — dev 多 profile：`npm run dev:multi -- --profile=<名>`；`electron.vite.config.ts` 按 `--profile=` 计算 `5173 + profilePortOffset`（0–49），`strictPort: true`（**待 kb-librarian**）
- [x] `knowledge/知识索引.md` — 总入口未变化，无需更新

## 5、验证与用法（保留）

| 项 | 结果 |
|----|------|
| `npm run build` | 通过 |
| 打包路径逻辑 | 产物含 `!isPackaged && Boolean(ELECTRON_RENDERER_URL)`，打包版忽略残留 env |

**dev 多开用法**：

```bash
# 终端 1（首次需 build）
npm run dev

# 终端 2（不重复 build，独立 profile 与端口）
npm run dev:multi -- --profile=foo
```

## 6、遗留风险

- `profilePortOffset` 范围 0–49，极端多 profile 可能端口碰撞（概率低）。
- dev fallback 依赖本地 `out/renderer/index.html` 已存在；纯 `dev:multi` 首启若从未 build 可能 fallback 仍失败。
