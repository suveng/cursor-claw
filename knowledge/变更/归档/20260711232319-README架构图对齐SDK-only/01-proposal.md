# README架构图对齐SDK-only轻量变更说明

> **变更 ID**：`20260711232319-README架构图对齐SDK-only`
> **来源**：kb-lite
> **类型**：Bug
> **优先级**：P3
> **外部 PRD**：无
> **任务记录**：无
> **Figma 设计图**：无
> **lite 类型**：超轻记录型 lite（根 README 文案/架构图修正，无代码与知识库正文变更）

---

## 变更说明

根 `README.md` 架构图 L63 附近仍写「HTTP poll-message（拉取）」，与当前 IM SDK-only 架构矛盾：

- **现状**：Daemon 编排 file-queue claim 后 `POST /api/agent/launch|dispatch`；Electron agent-api 转发；SDK 经 Presentation 回写出站；`GET /api/poll-message` 已废弃返回 **404**。
- **依据**：`knowledge/业务域/消息桥接/01-概览.md`（「`GET /api/poll-message` 404；IM SDK-only」）、`knowledge/工程平台/Daemon守护进程/02-HTTP与MCP服务.md`（poll-message 404 表项与 dispatch 说明）。

**目标**：最小 diff，仅修正与 poll-message 拉取矛盾的架构图表述，使根 README 与知识库一致。

## 验收标准

1. 根 `README.md` 架构图（L63 附近）**不再出现**「HTTP poll-message（拉取）」或等价 HTTP 轮询拉取表述。
2. 修正后的图示/说明与 KB 一致：IM 路径为 Daemon dispatch + Electron agent-api launch/dispatch + SDK Presentation，非 HTTP poll。
3. 除与 poll-message 矛盾部分外，**不扩散修改**其他 README 段落。

## 影响范围

| 范围 | 说明 |
|------|------|
| `README.md` | 架构图 MCP Server 区块中与 poll-message 相关的单行/连线表述 |

**不在范围**：业务代码、proto、配置、`knowledge/` 知识库正文、其他 README 章节。

## lite 判定

| 判定项 | 结论 |
|--------|------|
| 需求清晰度 | 目标与验收明确，无需追问（+0） |
| 修改范围 | 单文件局部文案/架构图（+0） |
| 接口契约 | 不变（+0） |
| 数据/权限 | 不变（+0） |
| 跨端联动 | 无（+0） |
| 知识库 | 不改 KB，仅对齐既有 KB 事实（+0） |
| **总分** | **0**，超轻记录型 lite |

## 实现要点（供 kb-builder）

- 改前读 `README.md` L55–68 架构图上下文及上述两份 KB 依据。
- 将「HTTP poll-message（拉取）」替换为与 SDK-only 一致的 capability 描述（如 dispatch / presentation 相关表述），保持 ASCII 图宽度与风格。
- 禁止改动与 poll-message 无关的 README 内容。

## 外部登记

`kb.project.json` 未启用 `integrations.registry`，跳过外部登记。
