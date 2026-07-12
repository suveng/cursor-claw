# 变更摘要

> **变更 ID**：`20260711231744-知识地图填充`
> **stage**：applied

## 实际变更摘要

消除 `knowledge/知识地图.md` 五节占位括号，写入项目定位、三业务域清单、工程组成、外部依赖与文档入口；同步补全 `knowledge/知识索引.md` B 节三域入口链接与 `knowledge/工程平台/README.md` 两分区入口链接。纯知识库同步，无业务代码变更。

## 知识库更新清单

| 文件 | 摘要 |
|------|------|
| `knowledge/知识地图.md` | 五节由占位改为实质总览，对齐 codeRoots 与三域/两分区入口 |
| `knowledge/知识索引.md` | B 节补全 Agent调度、消息桥接、工作流三域 `00-README` 链接 |
| `knowledge/工程平台/README.md` | 分区入口补全 Daemon守护进程、Electron桌面应用两分区链接 |

## 索引更新原因

`知识索引.md` B 节原为占位说明，新人与 Agent 无法从总索引直达业务域局部索引；补全三域 `00-README` 链接后，检索路径「知识索引 → 域 README → 01-概览」可闭环。

## 摸底漂移备注（未修）

- 仓库根 `README.md` 架构图仍写 HTTP `poll-message`，与 KB 归档结论「`GET /api/poll-message` 404」不一致。
- 巨型单体拆分 T16 deferred；消息桥接 `00-README` 源码锚点可能随批2 继续漂移。
- `kb.project.json` 的 `engineeringPlatforms` 仍为空数组（知识侧已手写两分区入口）。
