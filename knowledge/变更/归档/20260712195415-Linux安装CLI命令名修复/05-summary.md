---
type: ChangeSummary
title: Linux安装CLI命令名修复
description: Linux 安装脚本在 ~/.local/bin 暴露 cursor-claw 命令并检测旧 deb 冲突
timestamp: 2026-07-12T20:05:00+0800
related: []
depends_on: []
---

# Linux安装CLI命令名修复 - 变更总结

> **变更 ID**：`20260712195415-Linux安装CLI命令名修复`
> **来源**：kb-lite
> **lite 类型**：记录型 lite
> **阶段**：`applied`（LITE-01 done；待 `/kb-archive` 迁移）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `scripts/deploy/linux.cjs` | 新增 `ensureBinSymlink`：AppImage / pack 安装后在 `~/.local/bin/cursor-claw` 创建符号链接，指向本次安装产物；新增 `warnSystemDebConflict`：检测 `/usr/bin/cursor-claw` 旧 deb 并打印版本与处理建议 |
| `scripts/deploy/AGENTS.md` | 补充 Linux 用户目录安装须在 `~/.local/bin/<app>` 暴露 CLI 命令名的约定 |
| `README.md` | 一行：`dist:linux` 安装后 `~/.local/bin/cursor-claw` 可用 |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**未纳入（显式）**：proto/数据库、业务域知识、`knowledge/工程平台/**` 正文、deb 安装路径逻辑（`--artifact=deb` 仍走系统包管理）。

**统计**：1 部署脚本 + 1 AGENTS + 1 README 行；局部 deploy 行为修正。

## 2、与设计的差异

无，与 `01-proposal.md` 验收标准一致。

## 3、影响范围

- **涉及模块**：Linux 本地打包与安装（`scripts/deploy/linux.cjs`）。
- **行为变更**：`dist:linux` / `pack:linux` 安装完成后，用户 PATH 含 `~/.local/bin` 时可直接执行 `cursor-claw`；若系统曾装 deb，安装日志输出冲突提示。
- **接口/proto/数据**：无对外契约变更；无持久化模型变更。
- **用户可见性**：Linux 用户安装后 CLI 命令名与 README 描述一致；旧 deb 用户收到明确迁移提示。

### 3.1 Ponytail 技术债

无（本次 diff 未新增 `ponytail:` 注释）。

## 4、知识库影响清单

记录型 lite：**知识库无需更新**。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/业务域/**` | 无需更新 | 无 IM/调度/通道等业务行为变更 |
| `knowledge/工程平台/**` | 无需更新 | 局部 deploy 脚本 bug 修复；安装约定已写入 `scripts/deploy/AGENTS.md`（代码仓 AGENTS，非 KB 十段式正文） |
| `knowledge/知识索引.md` | 无需更新 | 无新领域/分区入口 |
| `README.md` | 已更新（根文档，非 KB） | 一行安装说明与实现行为对齐 |

- [x] 业务域 — 无用户可见业务行为变更
- [x] 工程平台 — 内部 deploy 脚本修正，记录型不扩 KB
- [x] 知识索引 — 总入口未变化

## 5、验收步骤

| # | 项 | 操作 | 状态 |
|---|-----|------|------|
| 1 | 重新打包安装 | 在 Linux 上执行 `npm run dist:linux`（或 `pack:linux`），完成安装流程 | ⏳ 建议人工 |
| 2 | CLI 命令解析 | `which cursor-claw` 应指向 `~/.local/bin/cursor-claw`（PATH 含 `~/.local/bin` 且优先于 `/usr/bin`） | ⏳ 建议人工 |
| 3 | 符号链接目标 | `readlink -f ~/.local/bin/cursor-claw` 应指向本次安装的 AppImage 或 pack 可执行文件 | ⏳ 建议人工 |
| 4 | 旧 deb 冲突 | 若仍命中 `/usr/bin/cursor-claw`，安装日志应出现 deb 版本提示；建议 `sudo apt remove cursor-claw` 或改用 `--artifact=deb` | ⏳ 建议人工 |

## 6、归档待办（`/kb-archive`，归 kb-release）

- **迁移**：`stage` → `archived`，目录 `mv` 至 `knowledge/变更/归档/`
- **版本/changelog**：局部 bug 修复，archive 时按 patch 口径评估是否 bump
