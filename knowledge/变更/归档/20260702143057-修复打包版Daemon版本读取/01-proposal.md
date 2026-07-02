# 修复打包版 Daemon 版本读取 — 轻量变更说明

> **变更 ID**：`20260702143057-修复打包版Daemon版本读取`
> **来源**：kb-lite
> **lite 类型**：记录型
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无

---

## 背景

打包版启动 Agent 时 Daemon 进程崩溃，报错：

`Cannot find module '../../package.json'`

用户无法通过打包版正常使用 Agent 调度能力。

## 根因

- **落点**：`src/daemon/daemon.ts` 第 52–53 行
  - `const _require = createRequire(import.meta.url);`
  - `const PKG_VERSION = (_require("../../package.json") as { version: string }).version;`
- **构建插件缺口**：`scripts/bundle-daemon.cjs` 的 `inlinePackageJson` 插件仅匹配并内联 `require("../package.json")` 模式（正则 `\w+\("\.\.\/package\.json"\)`），**不覆盖** `_require("../../package.json")` 变体。
- **运行时路径**：打包产物 `dist-bundle/daemon-entry.mjs` 复制到 `Contents/Resources/daemon/`。运行时 `../../package.json` 解析为 `Contents/package.json`（不存在），导致模块加载失败。

## 变更说明

### LITE-01：修复打包版 Daemon package.json 内联

| 项 | 要点 |
|----|------|
| **优选方案** | 扩展 `scripts/bundle-daemon.cjs` 的 `inlinePackageJson` 插件，覆盖 `../../package.json` 及 `_require(...)` 变体，将版本号在构建时内联为 JSON 常量 |
| **备选方案** | Daemon 侧构建时直接内联版本常量（如 `define` 或构建期替换），避免运行时 `require` package.json |
| **原则** | 最小改动，不改变 Daemon 对外接口与 MCP 契约 |

### lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 现象、根因、落点已核实 |
| 修改范围 | 单文件或少量强相关文件（bundle 脚本 ± daemon 源） |
| 接口契约 | 无 proto/HTTP/IPC 契约变更 |
| 数据/权限 | 不变 |
| 跨端联动 | 仅 Electron 打包 Daemon 路径 |
| 知识库 | 记录型，工程平台正文无需联动 |
| **总分** | **≤2**，可走 lite |

## 验收标准

1. **打包版 Daemon 启动**：本地或 CI 构建安装包后启动 Agent，Daemon 进程正常拉起，控制台无 `Cannot find module '../../package.json'`。
2. **版本号可用**：Daemon 日志与 MCP 服务元信息中 `version` 字段为正确应用版本（与 `package.json` 一致），非空或占位值。
3. **dev 不受影响**：`npm run dev` / 非打包路径下 Daemon 仍正常读取版本并启动。
4. **回归**：`bundle-daemon` 构建通过；TypeScript 编译通过；打包版基本 Agent 调度不退化。

## 影响范围

| 范围 | 说明 |
|------|------|
| `scripts/bundle-daemon.cjs` | **主改动**：扩展 inline 插件覆盖 `../../package.json` / `_require` 变体 |
| `src/daemon/daemon.ts` | **备选落点**：若选构建期内联常量方案 |
| `package.json` / `changelog/` | 用户可见修复时 patch bump 与 changelog（归档轮次） |

**不在范围**：renderer、Electron 主进程路径、IM 通道业务逻辑、MCP 工具契约。

## 待 builder 事项

- 实现 LITE-01 后更新 manifest：`tasks[0].status = done`，`files[]` 写入实际变更文件。
- 记录型 lite：实现后补写 `05-summary.md` 并归档；用户可见修复需 bump 版本与 changelog。
- integrations 未启用，无需 external sync。
