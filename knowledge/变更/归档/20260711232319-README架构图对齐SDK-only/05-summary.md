# README架构图对齐SDK-only - 变更总结

> **变更 ID**：`20260711232319-README架构图对齐SDK-only`
> **来源**：kb-lite
> **lite 类型**：超轻记录型 lite
> **阶段**：`applied`（LITE-01 done；待 `/kb-archive` 迁移）

---

## 1、实际变更

| 文件 | 关键改动 |
|------|----------|
| `README.md` | 架构图 MCP Server 区块：将「HTTP poll-message（拉取）」改为「dispatch 入站（Daemon→SDK）」，对齐 IM SDK-only 现状（`GET /api/poll-message` 已 404） |

**变更文档**：`01-proposal.md`、`00-manifest.json`、`05-summary.md`（本文件）。

**统计**：1 文件、1 行架构图表述修正；无业务代码与配置变更。

## 2、与设计的差异

无，与 `01-proposal.md` 验收标准一致。

## 3、影响范围

- **涉及模块**：仓库根 README 架构示意，无运行时行为变更。
- **用户可见性**：仅文档图示与既有 KB（`knowledge/业务域/消息桥接/01-概览.md`、Daemon HTTP 文档）口径一致。
- **接口/proto/数据**：无变更。

### 3.1 Ponytail 技术债

无（本次 diff 未新增 `ponytail:` 注释）。

## 4、知识库影响清单

超轻记录型 lite：**知识库无需更新**。

| 文件/分区 | 结论 | 原因 |
|-----------|------|------|
| `knowledge/**` | 无需更新 | 本次仅将根 README 对齐既有 KB 已记录的 SDK-only 事实，未改变产品语义或新增知识条目 |
| `knowledge/知识索引.md` | 无需更新 | 无新领域/分区入口 |
| `knowledge/知识地图.md` | 无需更新 | 总览结构未变 |

- [x] 业务域 — 无正文变更，README 追随 KB 而非反向修改 KB
- [x] 工程平台 — 无正文变更
- [x] 知识索引 — 总入口未变化
