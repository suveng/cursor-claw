# 修复打包版 Daemon 版本读取 — 变更总结

> **变更 ID**：`20260702143057-修复打包版Daemon版本读取`
> **来源**：kb-lite / kb-builder
> **lite 类型**：记录型
> **阶段**：`applied`（归档由 kb-release 执行）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `scripts/bundle-daemon.cjs` | 扩展 `inlinePackageJson` 插件：新增 `PACKAGE_JSON_REQUIRE_RE`，匹配 `require("../package.json")`、`_require("../../package.json")` 等相对路径变体（支持单/双引号、多级 `../`）；构建时将 `package.json` 内联为 JSON 常量，避免打包产物运行时解析失败 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

## 2、根因与修复摘要

| 项 | 说明 |
|----|------|
| **现象** | 打包版启动 Agent 时 Daemon 崩溃：`Cannot find module '../../package.json'` |
| **根因** | `src/daemon/daemon.ts` 通过 `createRequire` 读取 `../../package.json` 获取版本号；`bundle-daemon.cjs` 原正则仅覆盖 `require("../package.json")`，未内联 `_require("../../package.json")` 变体。产物部署至 `Contents/Resources/daemon/` 后，运行时 `../../package.json` 指向不存在的 `Contents/package.json` |
| **修复** | 构建期统一替换所有 `*require*("…/package.json")` 相对路径调用为内联 JSON，Daemon 不再依赖运行时模块解析 |
| **与设计差异** | 无。lite 无 `02-design.md`；实现与 `01-proposal.md` LITE-01 优选方案一致，未改动 `src/daemon/daemon.ts` |

## 3、影响范围

| 范围 | 说明 |
|------|------|
| **Electron 打包 Daemon** | `bundle-daemon` 构建产物 `daemon-entry.mjs` 版本号在构建期内联，打包版 Agent 调度可正常拉起 Daemon |
| **dev 行为** | 非打包路径仍走源码 `createRequire`，不受影响 |
| **用户可见** | **是** — 修复打包版 Agent 启动时 Daemon 因版本读取失败而崩溃 |
| **不涉及** | renderer、Electron 主进程、IM 通道、MCP 工具契约、Daemon 对外接口 |

### 3.1 Ponytail 技术债

无。

## 4、知识库影响清单

**记录型 lite** — 纯打包构建脚本修复，**无需更新业务域或工程平台知识正文**。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/**` | 不需要 | 无业务语义、接口或调度契约变更 |
| `knowledge/工程平台/**` | 不需要 | 改动限于 `scripts/bundle-daemon.cjs` 构建内联逻辑，不改变已文档化的运行时架构 |
| `knowledge/知识索引.md` | 不需要 | 总入口与阅读路径未变化 |

## 5、验证结果

| 项 | 结果 |
|----|------|
| LITE-01 实现 | done — `scripts/bundle-daemon.cjs` 正则扩展已落地 |
| `bundle-daemon` 构建 | **待 kb-release 或人工确认** — 构建通过且产物无残留 `require.*package.json` |
| 打包版 Daemon 启动 | **待 kb-release 安装包验收**（01 验收项 1–2：无模块找不到错误、version 字段正确） |
| dev 回归 | **待人工确认** `npm run dev` 下 Daemon 仍正常（01 验收项 3） |

## 6、遗留风险

- 若未来 Daemon 源码引入其他相对路径读取 `package.json` 的写法（非 `\w+("…/package.json")` 模式），需同步扩展正则或改构建期 define 方案。

## 7、归档待办（`/kb-archive`，归 kb-release）

| # | 项 | 说明 |
|---|-----|------|
| 1 | **版本 bump** | `package.json`：`1.10.3` → `1.10.4` |
| 2 | **Changelog** | 新建 `changelog/1.10.4.json`，建议条目：修复打包版 Agent 启动时 Daemon 因无法读取版本号而崩溃 |
| 3 | **manifest.files** | 归档轮次将 `package.json`、`changelog/1.10.4.json` 写入 `files[]` |
| 4 | **目录迁移** | `mv` 至 `knowledge/变更/归档/`（本步骤不由 kb-scribe 执行） |
| 5 | **知识库同步** | **跳过** — 见 §4 |
