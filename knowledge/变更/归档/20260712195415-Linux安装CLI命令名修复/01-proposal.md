---
type: ChangeProposal
title: Linux安装CLI命令名修复
description: 修复 Linux 安装脚本未创建 ~/.local/bin/cursor-claw 导致 CLI 仍指向旧 deb
timestamp: 2026-07-12T19:54:15+0800
related: []
depends_on: []
---

# Linux安装CLI命令名修复轻量变更说明

> **变更 ID**：`20260712195415-Linux安装CLI命令名修复`
> **来源**：kb-lite
> **类型**：Bug
> **优先级**：P2
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无
> **lite 类型**：记录型 lite

---

## 变更说明

`scripts/deploy/linux.cjs` 在 Linux 上安装 AppImage 或 pack 产物后，仅将文件写入 `~/.local/bin/cursor-claw.AppImage` 或 `~/.local/opt/cursor-claw/`，**未**在 `~/.local/bin` 创建统一的 `cursor-claw` 命令入口。

用户若曾通过 deb 安装旧版（如 1.2.0），系统中仍存在 `/usr/bin/cursor-claw`。当 PATH 中 `~/.local/bin` 未优先或未暴露同名命令时，`which cursor-claw` 会落到旧 deb，用户实际执行的是过期版本而非本次安装的新产物。

本变更修复安装脚本：在 AppImage / pack 两种安装路径完成后，于 `~/.local/bin` 暴露 `cursor-claw` 命令（指向新产物）；并在检测到 `/usr/bin/cursor-claw` 旧 deb 时输出明确提示，引导用户 `apt remove` 或改用 `--artifact=deb` 安装。

## 验收标准

1. **`dist:linux` / AppImage 安装后**：`~/.local/bin/cursor-claw` 存在且指向本次安装的新 AppImage 产物（符号链接或等价包装）。
2. **`pack:linux` 安装后**：同样在 `~/.local/bin` 暴露 `cursor-claw`，指向 pack 安装目录中的可执行入口。
3. **旧 deb 冲突提示**：安装流程检测到 `/usr/bin/cursor-claw` 存在时，打印明确提示（建议 `apt remove cursor-claw` 或改用 `--artifact=deb` 覆盖系统路径）。
4. **PATH 优先级**：当用户 PATH 含 `~/.local/bin` 且其优先于 `/usr/bin` 时，`which cursor-claw` 指向 `~/.local/bin/cursor-claw`（新产物），而非旧 deb。

## 影响范围

- **主文件**：`scripts/deploy/linux.cjs`
- **可选**：`README` 一行安装说明、`scripts/deploy/AGENTS.md`（若需沉淀安装后 CLI 路径约定）
- **不涉及**：proto、数据库、权限、跨端接口契约变更
- **知识库**：记录型 lite；实现后于 `05-summary.md` 说明是否需同步工程平台安装文档
